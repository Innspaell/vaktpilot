"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/context";
import { NOTIFICATION_GROUPS } from "@/lib/notification-kinds";
import type { ActionState } from "@/app/(app)/actions";

export async function saveNotificationPrefs(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const prefs: Record<string, boolean> = {};
  for (const g of NOTIFICATION_GROUPS) {
    const on = fd.get(`g_${g.key}`) === "on";
    for (const k of g.kinds) if (!on) prefs[k] = false;
  }
  const { error } = await ctx.supabase.from("organizations").update({ notification_prefs: prefs }).eq("id", ctx.org.id);
  if (error) return { error: error.message };

  // E-post: bare for typer som også er på i appen
  const emailGroups = NOTIFICATION_GROUPS.filter((g) => fd.get(`e_${g.key}`) === "on" && fd.get(`g_${g.key}`) === "on");
  const emailPrefs: Record<string, boolean> = {};
  for (const g of emailGroups) for (const k of g.kinds) emailPrefs[k] = true;
  const announce = emailGroups.length
    ? `${ctx.org.name} sender nå disse varslene på e-post, i tillegg til i appen: ${emailGroups.map((g) => g.label.toLowerCase()).join(", ")}. Du kan slå av e-post for deg selv under Profil.`
    : "";
  const { data: told, error: e2 } = await ctx.supabase.rpc("set_email_prefs", { p_org: ctx.org.id, p_prefs: emailPrefs, p_announce: announce });
  if (e2) return { error: e2.message };

  revalidatePath("/innstillinger/varsler");
  const off = NOTIFICATION_GROUPS.filter((g) => fd.get(`g_${g.key}`) !== "on").length;
  const base = off ? `Lagret. ${off} varseltype${off === 1 ? "" : "r"} er slått av.` : "Lagret. Alle varsler er på i appen.";
  const mail = emailGroups.length ? ` ${emailGroups.length} sendes også på e-post.` : " Ingen sendes på e-post.";
  return { ok: base + mail + (Number(told) > 0 ? ` ${told} personer har fått beskjed om e-post i appen.` : "") };
}
