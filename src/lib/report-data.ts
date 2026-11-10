import "server-only";
import type { AppContext } from "./context";
import { addDays } from "./time";
import { loadPayroll } from "./payroll-data";
import { coverageForDays, shiftsBetween } from "./data";
import { buildReport, compTimeBalance, coverageSummary, type Grouping } from "./report";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

/** Avspaseringssaldo for alle (eller én) ansatte, uavhengig av periode. */
export async function loadCompTime(ctx: Ctx, onlyEmployee?: string) {
  let credQ = ctx.supabase.from("leave_ledger").select("id, employee_id, amount, source, effective_date, created_at")
    .eq("org_id", ctx.org.id).eq("kind", "time_off").order("effective_date", { ascending: false });
  let absQ = ctx.supabase.from("absence_requests").select("employee_id, from_date, to_date, partial_hours, absence_types!inner(key)")
    .eq("org_id", ctx.org.id).eq("status", "approved").eq("absence_types.key", "avspasering");
  let termQ = ctx.supabase.from("employment_terms").select("employee_id, hours_per_week").eq("org_id", ctx.org.id).is("valid_to", null);
  if (onlyEmployee) {
    credQ = credQ.eq("employee_id", onlyEmployee);
    absQ = absQ.eq("employee_id", onlyEmployee);
    termQ = termQ.eq("employee_id", onlyEmployee);
  }
  const [{ data: cred }, { data: abs }, { data: terms }] = await Promise.all([credQ, absQ, termQ]);
  const credits = (cred ?? []).map((c) => ({ employeeId: c.employee_id, hours: Number(c.amount) }));
  const taken = (abs ?? []).map((a) => ({ employeeId: a.employee_id, from: a.from_date, to: a.to_date, partialHours: a.partial_hours ? Number(a.partial_hours) : null }));
  const ids = new Set([...credits.map((c) => c.employeeId), ...taken.map((t) => t.employeeId), ...(terms ?? []).map((t) => t.employee_id)]);
  const hpw = new Map((terms ?? []).map((t) => [t.employee_id, Number(t.hours_per_week ?? 0)]));
  return {
    balances: new Map(Array.from(ids, (id) => [id, compTimeBalance(id, hpw.get(id) ?? 0, credits, taken)])),
    history: (cred ?? []).map((c) => ({ id: c.id, employeeId: c.employee_id, hours: Number(c.amount), comment: c.source, date: c.effective_date })),
  };
}

export async function loadReport(ctx: Ctx, from: string, to: string, grouping: Grouping) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const [payroll, shifts, comp] = await Promise.all([
    loadPayroll(ctx, from, to),
    shiftsBetween(ctx, from, addDays(to, 1)),
    loadCompTime(ctx),
  ]);
  const published = shifts.filter((s) => s.status === "published");
  const coverage = await coverageForDays({ ...ctx, isAdmin: false }, from, days, published);
  const report = buildReport({
    from, to, tz: ctx.org.timezone, grouping,
    employees: payroll.pay.map((p) => ({ id: p.employee.id, name: p.employee.name })),
    shifts: published.map((s) => ({ employeeId: s.employee_id, start: new Date(s.starts_at), end: new Date(s.ends_at), breakMinutes: s.break_minutes })),
    entries: payroll.entries.map((e) => ({ employeeId: e.employee_id, start: new Date(e.starts_at), end: new Date(e.ends_at), breakMinutes: e.break_minutes, status: e.status })),
    pay: payroll.pay,
    balances: payroll.balances,
  });
  return { ...report, payroll, coverage: coverageSummary(coverage), comp };
}
