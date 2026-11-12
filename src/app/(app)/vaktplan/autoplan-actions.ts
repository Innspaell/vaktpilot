"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/context";
import { needsForDays } from "@/lib/data";
import { addDays, isoWeekday, localDate, zonedToUtc } from "@/lib/time";
import { buildPlan, type ExistingShift, type PlanEmployee, type PlannedShift } from "@/lib/autoplan";

export type AutoPlanState =
  | {
      error?: string;
      ok?: string;
      runId?: string;
      summary?: { name: string; target: number; planned: number; shifts: number }[];
      openCount?: number;
    }
  | undefined;

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

const mondayOf = (d: string) => addDays(d, 1 - isoWeekday(d));

/**
 * Lager forslag for en periode (uke, måned eller valgfri). Planlegger én uke av gangen,
 * så avtalt ukentlig arbeidstid gjelder hver uke for seg.
 */
export async function autoPlanWeek(_: AutoPlanState, fd: FormData): Promise<AutoPlanState> {
  const ctx = await requireAdmin();
  const tz = ctx.org.timezone;
  const period = text(fd, "period") ?? "uke";
  let from = text(fd, "from");
  let to = text(fd, "to");
  if (period === "uke" && from) to = addDays(from, 6);
  if (period === "maned") {
    const m = text(fd, "month_start");
    if (m) {
      from = m;
      to = addDays(addDays(m, 32).slice(0, 8) + "01", -1);
    }
  }
  if (!from || !to || to < from) return { error: "Velg en gyldig periode." };
  if (Date.parse(to) - Date.parse(from) > 92 * 86400000) return { error: "Velg en periode på høyst tre måneder." };

  // Arbeidsdag uten pause, pluss pausen, er lengste vakt
  const workHours = Number((text(fd, "work_hours") ?? "7.5").replace(",", "."));
  const breakMin = Number(text(fd, "break_minutes") ?? 30);
  const minHours = Number((text(fd, "min_hours") ?? "3").replace(",", "."));
  const createOpen = fd.get("create_open") === "on";

  // Hele uker som dekker perioden
  const firstMonday = mondayOf(from);
  const lastSunday = addDays(mondayOf(to), 6);
  const totalDays = Math.round((Date.parse(lastSunday) - Date.parse(firstMonday)) / 86400000) + 1;
  const loadStart = zonedToUtc(addDays(firstMonday, -1), "00:00", tz).toISOString();
  const loadEnd = zonedToUtc(addDays(lastSunday, 2), "00:00", tz).toISOString();

  const [needsAll, empRes, termsRes, rolesRes, absRes, availRes, shiftsRes] = await Promise.all([
    needsForDays(ctx, firstMonday, totalDays),
    ctx.supabase.from("employees").select("id, full_name, start_date, end_date").eq("org_id", ctx.org.id).eq("auto_plan", true)
      .lte("start_date", to).or(`end_date.is.null,end_date.gte.${from}`),
    ctx.supabase.from("employment_terms").select("employee_id, hours_per_week, valid_from, valid_to").eq("org_id", ctx.org.id)
      .lte("valid_from", to).or(`valid_to.is.null,valid_to.gte.${from}`),
    ctx.supabase.from("employee_work_roles").select("employee_id, work_role_id").eq("org_id", ctx.org.id),
    ctx.supabase.from("absence_requests").select("employee_id, from_date, to_date").eq("org_id", ctx.org.id)
      .in("status", ["approved", "pending"]).lte("from_date", lastSunday).gte("to_date", firstMonday),
    ctx.supabase.from("availability").select("employee_id, kind, date, weekday").eq("org_id", ctx.org.id),
    ctx.supabase.from("shifts").select("employee_id, work_role_id, starts_at, ends_at, break_minutes").eq("org_id", ctx.org.id)
      .neq("status", "cancelled").gte("starts_at", loadStart).lt("starts_at", loadEnd),
  ]);

  // Dager utenfor perioden og dager som er passert, planlegges ikke (men vakter der telles med)
  const today = localDate(new Date(), tz);
  const needs = needsAll.map((n) =>
    n.date < from! || n.date > to! || n.date < today ? { ...n, closed: true, requirements: [] } : n,
  );
  if (needs.every((n) => n.requirements.length === 0)) {
    return { error: "Det er ikke satt bemanningsbehov for perioden, eller den er passert. Legg inn behov under Bemanning." };
  }
  const employeesRaw = empRes.data ?? [];
  if (employeesRaw.length === 0) return { error: "Ingen ansatte er med i automatisk vaktplan. Slå det på i ansattkortet." };

  const allDates = needs.map((n) => n.date);
  // «Når kan jeg jobbe» brukes bare når bedriften og den ansatte har det slått på
  let availability = ctx.org.availabilityEnabled ? (availRes.data ?? []) : [];
  if (availability.length) {
    const { data: on } = await ctx.supabase.from("employees").select("id").eq("org_id", ctx.org.id).eq("availability_enabled", true);
    const allowed = new Set((on ?? []).map((x) => x.id));
    availability = availability.filter((a) => allowed.has(a.employee_id));
  }
  const baseEmployees = (weekStart: string): PlanEmployee[] =>
    employeesRaw.map((e) => {
      // Avtalen som gjelder den uka
      const terms = (termsRes.data ?? [])
        .filter((t) => t.employee_id === e.id && t.valid_from <= addDays(weekStart, 6) && (!t.valid_to || t.valid_to >= weekStart))
        .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
      const unavailable = new Set<string>();
      for (const d of allDates) if (d < e.start_date || (e.end_date && d > e.end_date)) unavailable.add(d);
      for (const a of (absRes.data ?? []).filter((x) => x.employee_id === e.id)) {
        for (const d of allDates) if (d >= a.from_date && d <= a.to_date) unavailable.add(d);
      }
      const avail = availability.filter((x) => x.employee_id === e.id);
      for (const a of avail.filter((x) => x.kind === "unavailable")) {
        for (const d of allDates) if (a.date === d || (a.weekday && isoWeekday(d) === a.weekday)) unavailable.add(d);
      }
      return {
        id: e.id,
        name: e.full_name,
        targetMinutes: Math.round(Number(terms?.hours_per_week ?? 0) * 60),
        roleIds: (rolesRes.data ?? []).filter((r) => r.employee_id === e.id).map((r) => r.work_role_id),
        unavailable: Array.from(unavailable),
        wantsExtra: avail.some((x) => x.kind === "wants_extra"),
        preferred: allDates.filter((d) => avail.some((a) => a.kind === "available" && (a.date === d || (!a.date && a.weekday === isoWeekday(d))))),
      };
    });

  const existing: ExistingShift[] = (shiftsRes.data ?? []).map((s) => ({
    employeeId: s.employee_id, workRoleId: s.work_role_id,
    start: new Date(s.starts_at), end: new Date(s.ends_at), breakMinutes: s.break_minutes,
  }));

  const planned: PlannedShift[] = [];
  const totals = new Map<string, { name: string; target: number; planned: number; shifts: number }>();
  for (let w = firstMonday; w <= lastSunday; w = addDays(w, 7)) {
    const weekNeeds = needs.filter((n) => n.date >= w && n.date <= addDays(w, 6));
    if (weekNeeds.every((n) => n.requirements.length === 0)) continue;
    const emps = baseEmployees(w);
    const plan = buildPlan(weekNeeds, emps, existing, {
      tz,
      maxShiftMinutes: Math.round(workHours * 60 + breakMin),
      minShiftMinutes: Math.round(minHours * 60),
      breakMinutes: breakMin,
    });
    planned.push(...plan.shifts);
    // Nye vakter regnes som eksisterende når neste uke planlegges (hviletid over helg)
    for (const s of plan.shifts) {
      if (s.employeeId) existing.push({ employeeId: s.employeeId, workRoleId: s.workRoleId, start: s.start, end: s.end, breakMinutes: s.breakMinutes });
    }
    for (const s of plan.summary) {
      const t = totals.get(s.employeeId) ?? { name: s.name, target: 0, planned: 0, shifts: 0 };
      t.target += s.targetMinutes;
      t.planned += s.plannedMinutes;
      t.shifts += s.shifts;
      totals.set(s.employeeId, t);
    }
  }

  const toInsert = planned.filter((s) => s.employeeId || createOpen);
  if (toInsert.length === 0) return { ok: "Behovet er allerede dekket av vaktene som finnes. Ingenting å legge til." };

  const runId = crypto.randomUUID();
  const { error } = await ctx.supabase.from("shifts").insert(
    toInsert.map((s) => ({
      org_id: ctx.org.id,
      employee_id: s.employeeId,
      work_role_id: s.workRoleId,
      starts_at: s.start.toISOString(),
      ends_at: s.end.toISOString(),
      break_minutes: s.breakMinutes,
      status: "draft",
      series_id: runId,
      note: "Automatisk forslag",
    })),
  );
  if (error) return { error: `Kunne ikke lagre forslaget: ${error.message}` };

  revalidatePath("/vaktplan", "layout");
  revalidatePath("/");
  const assigned = toInsert.filter((s) => s.employeeId).length;
  const open = toInsert.length - assigned;
  return {
    ok: `Forslag for ${from.split("-").reverse().join(".")}–${to.split("-").reverse().join(".")} er lagt inn som utkast: ${assigned} ${assigned === 1 ? "vakt" : "vakter"} fordelt${open ? `, ${open} ledige` : ""}. Se over, juster og publiser.`,
    runId,
    openCount: open,
    summary: Array.from(totals.values())
      .filter((s) => s.target > 0 || s.shifts > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "nb")),
  };
}

/** Fjern alle utkast fra ett automatisk forslag. Publiserte vakter røres ikke. */
export async function undoAutoPlan(fd: FormData) {
  const ctx = await requireAdmin();
  const runId = text(fd, "run_id");
  if (!runId) return;
  await ctx.supabase.from("shifts").delete().eq("org_id", ctx.org.id).eq("series_id", runId).eq("status", "draft");
  revalidatePath("/vaktplan", "layout");
  revalidatePath("/");
}

/** Fjern alle automatiske utkast i perioden (om man har laget flere forslag). */
export async function clearAutoDrafts(fd: FormData) {
  const ctx = await requireAdmin();
  const from = text(fd, "from")!;
  const days = Number(text(fd, "days") ?? 7);
  await ctx.supabase.from("shifts").delete().eq("org_id", ctx.org.id).eq("status", "draft").eq("note", "Automatisk forslag")
    .gte("starts_at", zonedToUtc(from, "00:00", ctx.org.timezone).toISOString())
    .lt("starts_at", zonedToUtc(addDays(from, days), "00:00", ctx.org.timezone).toISOString());
  revalidatePath("/vaktplan", "layout");
}
