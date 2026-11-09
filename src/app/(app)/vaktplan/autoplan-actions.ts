"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/context";
import { needsForDays } from "@/lib/data";
import { addDays, isoWeekday, localDate, zonedToUtc } from "@/lib/time";
import { buildPlan, type PlanEmployee } from "@/lib/autoplan";

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

export async function autoPlanWeek(_: AutoPlanState, fd: FormData): Promise<AutoPlanState> {
  const ctx = await requireAdmin();
  const tz = ctx.org.timezone;
  const from = text(fd, "from");
  if (!from) return { error: "Velg uke." };
  const days = Math.min(31, Math.max(1, Number(text(fd, "days") ?? 7)));
  const to = addDays(from, days - 1);
  const maxHours = Number((text(fd, "max_hours") ?? "8.5").replace(",", "."));
  const minHours = Number((text(fd, "min_hours") ?? "3").replace(",", "."));
  const createOpen = fd.get("create_open") === "on";

  const periodStart = zonedToUtc(addDays(from, -1), "00:00", tz).toISOString();
  const periodEnd = zonedToUtc(addDays(to, 2), "00:00", tz).toISOString();

  const [needsAll, empRes, termsRes, rolesRes, absRes, availRes, shiftsRes] = await Promise.all([
    needsForDays(ctx, from, days),
    ctx.supabase.from("employees").select("id, full_name, start_date, end_date").eq("org_id", ctx.org.id).eq("auto_plan", true)
      .lte("start_date", to).or(`end_date.is.null,end_date.gte.${from}`),
    ctx.supabase.from("employment_terms").select("employee_id, hours_per_week, valid_from, valid_to").eq("org_id", ctx.org.id)
      .lte("valid_from", to).or(`valid_to.is.null,valid_to.gte.${from}`),
    ctx.supabase.from("employee_work_roles").select("employee_id, work_role_id").eq("org_id", ctx.org.id),
    ctx.supabase.from("absence_requests").select("employee_id, from_date, to_date").eq("org_id", ctx.org.id)
      .in("status", ["approved", "pending"]).lte("from_date", to).gte("to_date", from),
    ctx.supabase.from("availability").select("employee_id, kind, date, weekday").eq("org_id", ctx.org.id),
    ctx.supabase.from("shifts").select("employee_id, work_role_id, starts_at, ends_at, break_minutes").eq("org_id", ctx.org.id)
      .neq("status", "cancelled").gte("starts_at", periodStart).lt("starts_at", periodEnd),
  ]);

  // Ikke planlegg dager som er passert
  const today = localDate(new Date(), tz);
  const needs = needsAll.map((n) => (n.date < today ? { ...n, closed: true, requirements: [] } : n));

  if (needs.every((n) => n.requirements.length === 0)) {
    return { error: "Det er ikke satt bemanningsbehov for denne perioden. Legg det inn under Bemanning først." };
  }
  const employeesRaw = empRes.data ?? [];
  if (employeesRaw.length === 0) return { error: "Ingen ansatte er med i automatisk vaktplan. Slå det på i ansattkortet." };

  const dates = needs.map((n) => n.date);
  const employees: PlanEmployee[] = employeesRaw.map((e) => {
    const terms = (termsRes.data ?? []).filter((t) => t.employee_id === e.id).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
    const weekly = Number(terms?.hours_per_week ?? 0) * 60;
    const unavailable = new Set<string>();
    for (const d of dates) {
      if (d < e.start_date || (e.end_date && d > e.end_date)) unavailable.add(d);
    }
    // Både godkjent fravær og søknader som venter regnes som borte, så forslaget ikke må endres
    for (const a of (absRes.data ?? []).filter((x) => x.employee_id === e.id)) {
      for (const d of dates) if (d >= a.from_date && d <= a.to_date) unavailable.add(d);
    }
    const avail = (availRes.data ?? []).filter((x) => x.employee_id === e.id);
    for (const a of avail.filter((x) => x.kind === "unavailable")) {
      for (const d of dates) if (a.date === d || (a.weekday && isoWeekday(d) === a.weekday)) unavailable.add(d);
    }
    return {
      id: e.id,
      name: e.full_name,
      targetMinutes: Math.round((weekly * days) / 7),
      roleIds: (rolesRes.data ?? []).filter((r) => r.employee_id === e.id).map((r) => r.work_role_id),
      unavailable: Array.from(unavailable),
      wantsExtra: avail.some((x) => x.kind === "wants_extra"),
    };
  });

  const existing = (shiftsRes.data ?? []).map((s) => ({
    employeeId: s.employee_id, workRoleId: s.work_role_id,
    start: new Date(s.starts_at), end: new Date(s.ends_at), breakMinutes: s.break_minutes,
  }));

  const plan = buildPlan(needs, employees, existing, {
    tz,
    maxShiftMinutes: Math.round(maxHours * 60),
    minShiftMinutes: Math.round(minHours * 60),
  });

  const toInsert = plan.shifts.filter((s) => s.employeeId || createOpen);
  if (toInsert.length === 0) {
    return { ok: "Behovet er allerede dekket av vaktene som finnes. Ingenting å legge til." };
  }

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

  revalidatePath("/vaktplan");
  revalidatePath("/");
  const assigned = toInsert.filter((s) => s.employeeId).length;
  const open = toInsert.length - assigned;
  return {
    ok: `Forslaget er lagt inn som utkast: ${assigned} ${assigned === 1 ? "vakt" : "vakter"} fordelt${open ? `, ${open} ledige` : ""}. Se over, juster og publiser.`,
    runId,
    openCount: open,
    summary: plan.summary
      .filter((s) => s.targetMinutes > 0 || s.shifts > 0)
      .map((s) => ({ name: s.name, target: s.targetMinutes, planned: s.plannedMinutes, shifts: s.shifts }))
      .sort((a, b) => a.name.localeCompare(b.name, "nb")),
  };
}

/** Fjern alle utkast fra ett automatisk forslag. Publiserte vakter røres ikke. */
export async function undoAutoPlan(fd: FormData) {
  const ctx = await requireAdmin();
  const runId = text(fd, "run_id");
  if (!runId) return;
  await ctx.supabase.from("shifts").delete().eq("org_id", ctx.org.id).eq("series_id", runId).eq("status", "draft");
  revalidatePath("/vaktplan");
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
  revalidatePath("/vaktplan");
}
