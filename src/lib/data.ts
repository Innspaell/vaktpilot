import type { AppContext } from "./context";
import { addDays, dayBounds, localDate } from "./time";
import { dayCoverage, requirementsFor, type DayCoverage, type StaffingOverrideRow, type StaffingTemplateRow } from "./staffing";
import { holidayOn } from "./holidays";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

export interface ShiftRow {
  id: string;
  employee_id: string | null;
  work_role_id: string | null;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  status: "draft" | "published" | "cancelled";
  auto_approve: boolean;
}

export async function colleagues(ctx: Ctx) {
  const { data } = await ctx.supabase.rpc("org_colleagues", { p_org: ctx.org.id });
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((c) => [c.id, c.full_name]));
}

export async function shiftsBetween(ctx: Ctx, from: string, toExclusive: string) {
  const { data } = await ctx.supabase
    .from("shifts")
    .select("id, employee_id, work_role_id, starts_at, ends_at, break_minutes, status, auto_approve")
    .eq("org_id", ctx.org.id)
    .neq("status", "cancelled")
    .lt("starts_at", dayBounds(toExclusive, ctx.org.timezone).start.toISOString())
    .gt("ends_at", dayBounds(from, ctx.org.timezone).start.toISOString())
    .order("starts_at");
  return (data ?? []) as ShiftRow[];
}

/** Bemanning for et antall dager framover, med helligdager og stengte dager. */
export async function coverageForDays(ctx: Ctx, from: string, days: number, shifts: ShiftRow[]) {
  const to = addDays(from, days);
  const [{ data: templates }, { data: overrides }, { data: holidayRules }] = await Promise.all([
    ctx.supabase.from("staffing_templates").select("weekday, start_time, end_time, required, work_role_id").eq("org_id", ctx.org.id),
    ctx.supabase.from("staffing_overrides").select("date, closed, start_time, end_time, required, work_role_id").eq("org_id", ctx.org.id).gte("date", from).lt("date", to),
    ctx.supabase.from("holiday_rules").select("holiday_key, is_open").eq("org_id", ctx.org.id),
  ]);
  const t: StaffingTemplateRow[] = (templates ?? []).map((r) => ({
    weekday: r.weekday, start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5), required: r.required, workRoleId: r.work_role_id,
  }));
  const o: StaffingOverrideRow[] = (overrides ?? []).map((r) => ({
    date: r.date, closed: r.closed, start: r.start_time?.slice(0, 5), end: r.end_time?.slice(0, 5), required: r.required, workRoleId: r.work_role_id,
  }));
  const openOnHoliday = new Set((holidayRules ?? []).filter((r) => r.is_open).map((r) => r.holiday_key));

  const result: (DayCoverage & { holiday: string | null })[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const holiday = holidayOn(date);
    const hasOverride = o.some((x) => x.date === date);
    const closedForHoliday = holiday !== null && !openOnHoliday.has(holiday.key) && !hasOverride;
    const { closed, requirements } = requirementsFor(date, t, o);
    const planned = shifts
      .filter((s) => s.status === "published" || ctx.isAdmin)
      .map((s) => ({ startsAt: new Date(s.starts_at), endsAt: new Date(s.ends_at), employeeId: s.employee_id, workRoleId: s.work_role_id }));
    const cov = dayCoverage(date, requirements, planned, { tz: ctx.org.timezone, closed: closed || closedForHoliday });
    result.push({ ...cov, holiday: holiday?.name ?? null });
  }
  return result;
}

export function today(ctx: Ctx) {
  return localDate(new Date(), ctx.org.timezone);
}
