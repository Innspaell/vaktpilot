"use server";

import { revalidatePath } from "next/cache";
import { requirePlanner, requireOrg } from "@/lib/context";
import { addDays, localDate, zonedToUtc } from "@/lib/time";

import type { ActionState } from "../actions";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function refresh() {
  revalidatePath("/timer");
  revalidatePath("/vaktplan", "layout");
  revalidatePath("/");
}

/** Bekreft arbeidsdag: lager timer lik planlagt vakt. Kan rettes til den er godkjent. */
export async function confirmShift(fd: FormData) {
  const ctx = await requireOrg();
  if (!ctx.employeeId) return;
  const shiftId = text(fd, "shift_id");
  if (!shiftId) return;
  // Databasen sjekker at vakten er din, publisert, ikke fram i tid og ikke registrert fra før
  await ctx.supabase.rpc("confirm_shift", { p_shift: shiftId, p_comment: "Bekreftet som planlagt" });
  // Leder og administrator trenger ikke godkjenne sine egne timer en gang til
  if (ctx.canPlan) await approveOwn(ctx, { shiftId });
  refresh();
}

type OrgCtx = Awaited<ReturnType<typeof requireOrg>>;
/** Godkjenner egne timer for ledere: timene for en vakt, eller én registrering. */
async function approveOwn(ctx: OrgCtx, by: { shiftId?: string; entryId?: string }) {
  if (!ctx.canPlan || !ctx.employeeId) return;
  let q = ctx.supabase.from("time_entries").select("id").eq("employee_id", ctx.employeeId).in("status", ["draft", "submitted"]).not("ends_at", "is", null);
  if (by.shiftId) q = q.eq("shift_id", by.shiftId);
  else if (by.entryId) q = q.eq("id", by.entryId);
  else return;
  const { data } = await q;
  if (data?.length) await ctx.supabase.rpc("approve_time_entries", { p_ids: data.map((r) => r.id) });
}

/** Ny eller rettet timeregistrering. Ansatte retter egne til de er godkjent; admin kan rette alle. */
export async function saveEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  const id = text(fd, "id");
  const date = text(fd, "date");
  const start = text(fd, "start");
  const end = text(fd, "end");
  if (!date || !start || !end) return { error: "Fyll inn dato, fra og til." };
  if (start === end) return { error: "Fra og til kan ikke være like." };
  const tz = ctx.org.timezone;
  const startsAt = zonedToUtc(date, start, tz);
  const endsAt = zonedToUtc(end <= start ? addDays(date, 1) : date, end, tz);
  const breakMinutes = Math.max(0, Number(text(fd, "break_minutes") ?? 0));
  if ((endsAt.getTime() - startsAt.getTime()) / 60000 <= breakMinutes) return { error: "Pausen er lengre enn arbeidstiden." };
  if (date > localDate(new Date(), tz)) return { error: "Du kan ikke registrere timer fram i tid." };

  const employeeId = ctx.canPlan ? text(fd, "employee_id") ?? ctx.employeeId : ctx.employeeId;
  if (!employeeId) return { error: "Velg ansatt." };

  // Overlapp med andre registreringer
  const { data: others } = await ctx.supabase.from("time_entries").select("id")
    .eq("employee_id", employeeId).neq("id", id ?? "00000000-0000-0000-0000-000000000000")
    .lt("starts_at", endsAt.toISOString()).gt("ends_at", startsAt.toISOString()).limit(1);
  if (others?.length) return { error: "Overlapper med en annen registrering samme dag." };

  const values = {
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    break_minutes: breakMinutes,
    comment: text(fd, "comment"),
  };

  if (id) {
    const { data: cur } = await ctx.supabase.from("time_entries").select("status, employee_id").eq("id", id).maybeSingle();
    if (!cur) return { error: "Fant ikke registreringen." };
    if (cur.status === "locked") return { error: "Timene er låst etter lønnseksport." };
    if (!ctx.canPlan && cur.status === "approved") return { error: "Godkjente timer kan bare endres av leder." };
    const { error } = await ctx.supabase.from("time_entries")
      .update({ ...values, status: ctx.canPlan ? cur.status === "draft" ? "submitted" : cur.status : "submitted" })
      .eq("id", id);
    if (error) return { error: error.message };
    if (cur.employee_id === ctx.employeeId) await approveOwn(ctx, { entryId: id });
    refresh();
    return { ok: "Endret." };
  }

  // Leder som registrerer for andre eller seg selv: godkjent med en gang
  const adminForOther = ctx.canPlan && employeeId !== ctx.employeeId;
  const selfLeader = ctx.canPlan && employeeId === ctx.employeeId;
  // Bekreftet med endringer: koble til vakten, men bare hvis vakten er den ansattes og ikke registrert fra før
  let shiftId = text(fd, "shift_id");
  if (shiftId) {
    const { data: sh } = await ctx.supabase.from("shifts").select("employee_id").eq("id", shiftId).maybeSingle();
    const { data: taken } = await ctx.supabase.from("time_entries").select("id").eq("shift_id", shiftId).maybeSingle();
    if (!sh || sh.employee_id !== employeeId) shiftId = null;
    if (taken) return { error: "Denne vakten er allerede registrert." };
  }
  const { error } = await ctx.supabase.from("time_entries").insert({
    org_id: ctx.org.id, employee_id: employeeId, shift_id: shiftId, ...values,
    source: adminForOther ? "admin" : "manual",
    status: adminForOther ? "approved" : "submitted",
    approved_by: adminForOther ? ctx.userId : null,
    approved_at: adminForOther ? new Date().toISOString() : null,
  });
  if (error) return { error: error.message };
  if (selfLeader) {
    const { data: mine } = await ctx.supabase.from("time_entries").select("id").eq("employee_id", employeeId)
      .eq("starts_at", values.starts_at).maybeSingle();
    if (mine) await approveOwn(ctx, { entryId: mine.id });
  }
  refresh();
  return { ok: adminForOther || selfLeader ? "Registrert og godkjent." : "Registrert. Lederen godkjenner timene." };
}

export async function deleteEntry(fd: FormData) {
  const ctx = await requireOrg();
  const id = text(fd, "id");
  if (!id) return;
  // RLS: ansatte kan bare slette egne ugodkjente; admin alt som ikke er låst
  await ctx.supabase.from("time_entries").delete().eq("id", id).neq("status", "locked");
  refresh();
}

export async function approveEntries(fd: FormData) {
  const ctx = await requirePlanner();
  const ids = fd.getAll("ids").map(String).filter(Boolean);
  if (ids.length) await ctx.supabase.rpc("approve_time_entries", { p_ids: ids });
  refresh();
}

/**
 * Godkjenn vakter som timer selv om den ansatte ikke har bekreftet dem: timene blir lik planlagt vakt.
 * Lederen har fått advarselen i skjemaet før dette kjøres.
 */
export async function approvePlannedShifts(fd: FormData) {
  const ctx = await requirePlanner();
  // Utkast (stemplet eller registrert, men ikke sendt inn) godkjennes som de er
  const drafts = fd.getAll("ids").map(String).filter(Boolean);
  if (drafts.length) await ctx.supabase.rpc("approve_time_entries", { p_ids: drafts });
  const ids = fd.getAll("shift_ids").map(String).filter(Boolean);
  if (!ids.length) return refresh();
  const [{ data: shifts }, { data: taken }] = await Promise.all([
    ctx.supabase.from("shifts").select("id, employee_id, starts_at, ends_at, break_minutes").eq("org_id", ctx.org.id)
      .in("id", ids).eq("status", "published").not("employee_id", "is", null).lte("starts_at", new Date().toISOString()),
    ctx.supabase.from("time_entries").select("shift_id").in("shift_id", ids),
  ]);
  const done = new Set((taken ?? []).map((t) => t.shift_id));
  const now = new Date().toISOString();
  const rows = (shifts ?? []).filter((s) => !done.has(s.id)).map((s) => ({
    org_id: ctx.org.id, employee_id: s.employee_id!, shift_id: s.id, starts_at: s.starts_at, ends_at: s.ends_at,
    break_minutes: s.break_minutes, source: "admin", status: "approved", approved_by: ctx.userId, approved_at: now,
    comment: "Godkjent av leder uten bekreftelse fra den ansatte",
  }));
  if (rows.length) await ctx.supabase.from("time_entries").insert(rows);
  refresh();
}

/** Registrer hendelser med fast beløp (f.eks. utlevering). Ansatt for seg selv, leder for alle. */
export async function addPayEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  const employee = text(fd, "employee_id") ?? ctx.employeeId;
  const date = text(fd, "date");
  const key = text(fd, "key");
  const count = Math.round(Number(fd.get("count") ?? 1));
  if (!employee || !date || !key || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Velg dato og type." };
  if (!(count >= 1 && count <= 100)) return { error: "Antall må være mellom 1 og 100." };
  if (date > localDate(new Date(), ctx.org.timezone)) return { error: "Datoen kan ikke være fram i tid." };
  const { error } = await ctx.supabase.from("pay_events").insert({
    org_id: ctx.org.id, employee_id: employee, date, key, count, note: text(fd, "note"), created_by: ctx.userId,
  });
  if (error) return { error: error.message.includes("låst") ? error.message : "Kunne ikke registrere." };
  refresh();
  revalidatePath("/lonn");
  return { ok: "Registrert." };
}

export async function deletePayEvent(fd: FormData) {
  const ctx = await requireOrg();
  const id = text(fd, "id");
  if (id) await ctx.supabase.from("pay_events").delete().eq("id", id);
  refresh();
  revalidatePath("/lonn");
}
