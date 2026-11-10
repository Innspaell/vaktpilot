"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/context";
import type { ActionState } from "../actions";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Fast ukemønster: for hver ukedag «gjerne», «kan ikke» eller ingenting, pluss ønske om ekstravakter. */
export async function saveWeekly(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  if (!ctx.employeeId) return { error: "Du er ikke registrert som ansatt." };
  const { error: delErr } = await ctx.supabase.from("availability").delete()
    .eq("employee_id", ctx.employeeId).is("date", null);
  if (delErr) return { error: delErr.message };
  const rows: Record<string, unknown>[] = [];
  for (let wd = 1; wd <= 7; wd++) {
    const v = text(fd, `wd_${wd}`);
    if (v === "available" || v === "unavailable") {
      rows.push({ org_id: ctx.org.id, employee_id: ctx.employeeId, kind: v, weekday: wd });
    }
  }
  if (fd.get("wants_extra") === "on") {
    rows.push({ org_id: ctx.org.id, employee_id: ctx.employeeId, kind: "wants_extra", weekday: 1, note: text(fd, "extra_note") });
  }
  if (rows.length) {
    const { error } = await ctx.supabase.from("availability").insert(rows);
    if (error) return { error: error.message };
  }
  revalidatePath("/tilgjengelighet");
  return { ok: "Lagret. Lederen ser dette når vaktplanen lages." };
}

/** Enkeltdatoer: kan ikke, eller ønsker å jobbe. */
export async function addDate(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  if (!ctx.employeeId) return { error: "Du er ikke registrert som ansatt." };
  const from = text(fd, "from");
  const to = text(fd, "to") ?? from;
  const kind = text(fd, "kind") === "available" ? "available" : "unavailable";
  if (!from || !to || to < from) return { error: "Velg dato." };
  const days: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to && days.length < 92; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const { error } = await ctx.supabase.from("availability").insert(
    days.map((date) => ({ org_id: ctx.org.id, employee_id: ctx.employeeId, kind, date, note: text(fd, "note") })),
  );
  if (error) return { error: error.message };
  revalidatePath("/tilgjengelighet");
  return { ok: "Lagt til." };
}

export async function removeAvailability(fd: FormData) {
  const ctx = await requireOrg();
  const id = text(fd, "id");
  if (id && ctx.employeeId) await ctx.supabase.from("availability").delete().eq("id", id).eq("employee_id", ctx.employeeId);
  revalidatePath("/tilgjengelighet");
}
