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
  revalidatePath("/innstillinger/varsler");
  const off = NOTIFICATION_GROUPS.filter((g) => fd.get(`g_${g.key}`) !== "on").length;
  return { ok: off ? `Lagret. ${off} varseltype${off === 1 ? "" : "r"} er slått av.` : "Lagret. Alle varsler er på." };
}
