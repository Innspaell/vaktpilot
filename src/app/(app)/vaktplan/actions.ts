"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireOrg } from "@/lib/context";
import { addDays, formatDateLong, isoWeekday, localDate, zonedToUtc } from "@/lib/time";
import { holidayOn } from "@/lib/holidays";
import { checkShift, type Warning } from "@/lib/warnings";
import { insertEmployee } from "@/lib/employees";
import type { ActionState } from "../actions";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function refresh() {
  revalidatePath("/vaktplan", "layout");
  revalidatePath("/");
  revalidatePath("/foresporsler");
}

/** Start og slutt som UTC. Slutt før eller lik start betyr at vakten går over midnatt. */
function interval(date: string, start: string, end: string, tz: string) {
  const s = zonedToUtc(date, start, tz);
  const e = zonedToUtc(end <= start ? addDays(date, 1) : date, end, tz);
  return { s, e };
}

type Ctx = Awaited<ReturnType<typeof requireOrg>>;

/** Advarsler for en ansatt: andre vakter, fravær, hviletid. */
async function warningsFor(ctx: Ctx, employeeId: string, s: Date, e: Date, breakMinutes: number, ignoreShiftId?: string) {
  const from = new Date(s.getTime() - 8 * 86400000).toISOString();
  const to = new Date(e.getTime() + 8 * 86400000).toISOString();
  const [{ data: shifts }, { data: absences }] = await Promise.all([
    ctx.supabase.from("shifts").select("id, starts_at, ends_at, break_minutes")
      .eq("employee_id", employeeId).neq("status", "cancelled").gt("ends_at", from).lt("starts_at", to),
    ctx.supabase.from("absence_requests").select("from_date, to_date")
      .eq("employee_id", employeeId).eq("status", "approved")
      .lte("from_date", localDate(e, ctx.org.timezone)).gte("to_date", localDate(s, ctx.org.timezone)),
  ]);
  const absenceDates: string[] = [];
  for (const a of absences ?? []) for (let d = a.from_date; d <= a.to_date; d = addDays(d, 1)) absenceDates.push(d);
  const dates = [localDate(s, ctx.org.timezone), localDate(new Date(e.getTime() - 1), ctx.org.timezone)];
  return checkShift(
    { start: s, end: e, breakMinutes },
    (shifts ?? []).filter((x) => x.id !== ignoreShiftId).map((x) => ({ start: new Date(x.starts_at), end: new Date(x.ends_at), breakMinutes: x.break_minutes })),
    absenceDates,
    dates,
  );
}

function describe(w: Warning[]) {
  return w.map((x) => x.message).join(" ");
}

// ---------------- Administrator ----------------

export async function createShift(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const date = text(fd, "date");
  const start = text(fd, "start");
  const end = text(fd, "end");
  if (!date || !start || !end) return { error: "Fyll inn dato og klokkeslett." };
  let employeeId = text(fd, "employee_id");
  let createdName: string | null = null;
  if (employeeId === "__new") {
    const r = await insertEmployee(ctx, fd);
    if (r.error) return { error: r.error };
    employeeId = r.id!;
    createdName = text(fd, "full_name");
  }
  const breakMinutes = Number(text(fd, "break_minutes") ?? 0);
  const dateTo = text(fd, "date_to") ?? date;
  if (dateTo < date) return { error: "Til-dato kan ikke være før fra-dato." };
  const weekdays = new Set(fd.getAll("weekday").map(Number));
  const repeatWeeks = Math.min(52, Math.max(1, Number(text(fd, "repeat_weeks") ?? 1)));
  const skipHolidays = fd.get("skip_holidays") === "on";

  // Alle datoer i perioden som passer ukedagene, gjentatt ukentlig om valgt
  const dates: string[] = [];
  for (let w = 0; w < repeatWeeks; w++) {
    for (let d = addDays(date, 7 * w); d <= addDays(dateTo, 7 * w); d = addDays(d, 1)) {
      if (date !== dateTo && weekdays.size > 0 && !weekdays.has(isoWeekday(d))) continue;
      if (skipHolidays && holidayOn(d)) continue;
      if (!dates.includes(d)) dates.push(d);
    }
  }
  if (dates.length === 0) return { error: "Ingen datoer passer valgene. Sjekk ukedagene." };
  if (dates.length > 400) return { error: "For mange vakter på én gang. Velg en kortere periode." };
  const seriesId = dates.length > 1 ? crypto.randomUUID() : null;

  const rows = [];
  const warningLines: string[] = [];
  for (const d of dates) {
    const { s, e } = interval(d, start, end, ctx.org.timezone);
    if (employeeId && warningLines.length < 4) {
      const w = await warningsFor(ctx, employeeId, s, e, breakMinutes);
      if (w.length) warningLines.push(`${formatDateLong(d)}: ${describe(w)}`);
    }
    rows.push({
      org_id: ctx.org.id,
      employee_id: employeeId,
      work_role_id: text(fd, "work_role_id"),
      starts_at: s.toISOString(),
      ends_at: e.toISOString(),
      break_minutes: breakMinutes,
      status: fd.get("publish") === "on" ? "published" : "draft",
      auto_approve: fd.get("auto_approve") === "on",
      called_overtime: fd.get("called_overtime") === "on",
      series_id: seriesId,
      note: text(fd, "note"),
    });
  }
  const warnings = warningLines;

  let created = 0;
  let overlaps = 0;
  for (const row of rows) {
    const { error } = await ctx.supabase.from("shifts").insert(row);
    if (!error) created++;
    else if (error.code === "23P01") overlaps++;
    else return { error: error.message };
  }
  refresh();
  if (created === 0) return { error: "Den ansatte har allerede en vakt som overlapper." };
  const parts = [`${created} ${created === 1 ? "vakt" : "vakter"} lagt til.`];
  if (createdName) parts.unshift(`${createdName} er lagt til som ansatt.`);
  if (overlaps) parts.push(`${overlaps} hoppet over fordi de overlapper med andre vakter.`);
  if (warnings.length) parts.push(`Advarsel – ${warnings.join(" ")}`);
  return warnings.length || overlaps ? { error: parts.join(" ") } : { ok: parts.join(" ") };
}

/** Fjern vakter i en periode, for alle eller én ansatt. */
export async function clearPeriod(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const from = text(fd, "from");
  const to = text(fd, "to") ?? from;
  if (!from || !to || to < from) return { error: "Velg en gyldig periode." };
  const { data, error } = await ctx.supabase.rpc("clear_shifts", {
    p_org: ctx.org.id, p_from: from, p_to: to,
    p_employee: text(fd, "employee_id"),
    p_include_published: fd.get("include_published") === "on",
  });
  if (error) return { error: error.message };
  refresh();
  const r = (data as { deleted: number; cancelled: number }[])?.[0] ?? { deleted: 0, cancelled: 0 };
  if (r.deleted + r.cancelled === 0) return { ok: "Ingen vakter å fjerne i perioden." };
  return { ok: `${r.deleted} utkast slettet${r.cancelled ? `, ${r.cancelled} publiserte vakter fjernet (de ansatte er varslet)` : ""}.` };
}

export async function cancelShift(fd: FormData) {
  const ctx = await requireAdmin();
  const id = text(fd, "id")!;
  const { data: s } = await ctx.supabase.from("shifts").select("status").eq("id", id).single();
  if (s?.status === "draft") await ctx.supabase.from("shifts").delete().eq("id", id).eq("org_id", ctx.org.id);
  else await ctx.supabase.from("shifts").update({ status: "cancelled" }).eq("id", id).eq("org_id", ctx.org.id);
  refresh();
}

export async function assignShift(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const id = text(fd, "id")!;
  const employeeId = text(fd, "employee_id");
  const { data: shift } = await ctx.supabase.from("shifts").select("starts_at, ends_at, break_minutes").eq("id", id).single();
  if (!shift) return { error: "Fant ikke vakten." };
  const { error } = await ctx.supabase.from("shifts").update({ employee_id: employeeId }).eq("id", id).eq("org_id", ctx.org.id);
  if (error) return { error: error.code === "23P01" ? "Den ansatte har allerede en vakt som overlapper." : error.message };
  refresh();
  if (employeeId) {
    const w = await warningsFor(ctx, employeeId, new Date(shift.starts_at), new Date(shift.ends_at), shift.break_minutes, id);
    if (w.length) return { error: `Lagret, men: ${describe(w)}` };
  }
  return { ok: "Lagret." };
}

export async function publishWeek(fd: FormData) {
  const ctx = await requireAdmin();
  const from = text(fd, "from")!;
  const days = Number(text(fd, "days") ?? 7);
  await ctx.supabase.rpc("publish_shifts", {
    p_org: ctx.org.id,
    p_from: zonedToUtc(from, "00:00", ctx.org.timezone).toISOString(),
    p_to: zonedToUtc(addDays(from, days), "00:00", ctx.org.timezone).toISOString(),
  });
  refresh();
}

/** Kopier forrige ukes vakter inn i denne uken som utkast. */
export async function copyPreviousWeek(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const monday = text(fd, "from")!;
  const tz = ctx.org.timezone;
  const prev = addDays(monday, -7);
  const { data: shifts } = await ctx.supabase
    .from("shifts")
    .select("employee_id, work_role_id, starts_at, ends_at, break_minutes, auto_approve, note")
    .eq("org_id", ctx.org.id)
    .neq("status", "cancelled")
    .gte("starts_at", zonedToUtc(prev, "00:00", tz).toISOString())
    .lt("starts_at", zonedToUtc(monday, "00:00", tz).toISOString());
  if (!shifts?.length) return { error: "Forrige uke har ingen vakter." };

  let created = 0;
  let skipped = 0;
  for (const s of shifts) {
    // Flytt med samme lokale klokkeslett, så sommertid ikke forskyver vaktene
    const st = new Date(s.starts_at);
    const en = new Date(s.ends_at);
    const start = zonedToUtc(addDays(localDate(st, tz), 7), localTimeOf(st, tz), tz);
    const end = zonedToUtc(addDays(localDate(en, tz), 7), localTimeOf(en, tz), tz);
    const { error } = await ctx.supabase.from("shifts").insert({
      ...s, org_id: ctx.org.id, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "draft",
    });
    if (error) skipped++;
    else created++;
  }
  refresh();
  return skipped
    ? { error: `${created} vakter kopiert. ${skipped} hoppet over fordi de overlapper med vakter som finnes.` }
    : { ok: `${created} vakter kopiert som utkast.` };
}

function localTimeOf(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

// ---------------- Ansatt ----------------

export async function requestOpenShift(fd: FormData) {
  const ctx = await requireOrg();
  if (!ctx.employeeId) return;
  const shiftId = text(fd, "shift_id")!;
  const { data: shift } = await ctx.supabase.from("shifts").select("starts_at, ends_at, break_minutes, auto_approve, employee_id").eq("id", shiftId).single();
  if (!shift || shift.employee_id) return refresh();
  const warnings = await warningsFor(ctx, ctx.employeeId, new Date(shift.starts_at), new Date(shift.ends_at), shift.break_minutes);
  const { data: req, error } = await ctx.supabase
    .from("shift_requests")
    .insert({ org_id: ctx.org.id, employee_id: ctx.employeeId, kind: "open_shift", shift_id: shiftId, warnings })
    .select("id")
    .single();
  // Auto-godkjenning bare når det ikke er advarsler. Ellers avgjør administrator.
  if (!error && shift.auto_approve && warnings.length === 0) {
    await ctx.supabase.rpc("approve_shift_request", { p_request: req.id });
  }
  refresh();
}

export async function proposeShift(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  if (!ctx.employeeId) return { error: "Du er ikke registrert som ansatt." };
  const date = text(fd, "date");
  const start = text(fd, "start");
  const end = text(fd, "end");
  if (!date || !start || !end) return { error: "Fyll inn dato og klokkeslett." };
  const { s, e } = interval(date, start, end, ctx.org.timezone);
  const warnings = await warningsFor(ctx, ctx.employeeId, s, e, 0);
  if (warnings.some((w) => w.code === "overlap")) return { error: "Du har allerede en vakt på dette tidspunktet." };
  const { error } = await ctx.supabase.from("shift_requests").insert({
    org_id: ctx.org.id,
    employee_id: ctx.employeeId,
    kind: "proposal",
    requested_start: s.toISOString(),
    requested_end: e.toISOString(),
    work_role_id: text(fd, "work_role_id"),
    comment: text(fd, "comment"),
    warnings,
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: "Sendt. Du får beskjed når den er behandlet." };
}

export async function cancelRequest(fd: FormData) {
  const ctx = await requireOrg();
  await ctx.supabase.from("shift_requests").update({ status: "cancelled" }).eq("id", text(fd, "id")!).eq("status", "pending");
  refresh();
}

export async function decideRequest(fd: FormData) {
  const ctx = await requireAdmin();
  const id = text(fd, "id")!;
  const { error } =
    fd.get("decision") === "approve"
      ? await ctx.supabase.rpc("approve_shift_request", { p_request: id })
      : await ctx.supabase.rpc("reject_shift_request", { p_request: id, p_comment: text(fd, "comment") });
  refresh();
  if (error) redirect(`/foresporsler?vis=vakter&feil=${encodeURIComponent(error.message)}`);
}

function safeBack(v: string | null) {
  return v && v.startsWith("/vaktplan") ? v : "/vaktplan";
}

/** Sett den ansatte på vakten fraværende, med årsak. */
export async function markAbsent(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const shiftId = text(fd, "shift_id");
  const typeId = text(fd, "absence_type_id");
  if (!shiftId || !typeId) return { error: "Velg årsak." };
  const handle = text(fd, "handle") ?? "open";
  const partial = text(fd, "partial_hours");
  const { error } = await ctx.supabase.rpc("mark_absent", {
    p_shift: shiftId,
    p_absence_type: typeId,
    p_handle: handle,
    p_partial_hours: handle === "keep" && partial ? Number(partial.replace(",", ".")) : null,
    p_comment: text(fd, "comment"),
  });
  if (error) return { error: error.message };
  refresh();
  revalidatePath("/foresporsler");
  redirect(safeBack(text(fd, "back")));
}

/** Fjern vakten og gå tilbake til planen. */
export async function removeShiftAndBack(fd: FormData) {
  await cancelShift(fd);
  redirect(safeBack(text(fd, "back")));
}
