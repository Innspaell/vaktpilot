import "server-only";
import type { AppContext } from "./context";
import { addDays, dayBounds } from "./time";
import { calculatePay, timeBalance, type PayAbsence, type PayEmployee, type PayEntry } from "./pay";
import { loadPayRules } from "./pay-rules-data";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

/**
 * Henter alt som trengs for lønnsgrunnlag og timesaldo i en periode.
 * Lønn bruker godkjente og låste timer; saldo tar også med timer som venter på godkjenning.
 */
export async function loadPayroll(ctx: Ctx, from: string, to: string, onlyEmployee?: string) {
  const tz = ctx.org.timezone;
  const start = dayBounds(from, tz).start.toISOString();
  const end = dayBounds(addDays(to, 1), tz).start.toISOString();

  let empQ = ctx.supabase.from("employees").select("id, full_name, employee_number, start_date, end_date, is_shift_worker")
    .eq("org_id", ctx.org.id).lte("start_date", to).or(`end_date.is.null,end_date.gte.${from}`).order("full_name");
  if (onlyEmployee) empQ = empQ.eq("id", onlyEmployee);
  let entQ = ctx.supabase.from("time_entries")
    .select("employee_id, starts_at, ends_at, break_minutes, status, shifts!time_entries_shift_id_fkey(called_overtime, starts_at, ends_at)")
    .eq("org_id", ctx.org.id).gte("starts_at", start).lt("starts_at", end).not("ends_at", "is", null);
  if (onlyEmployee) entQ = entQ.eq("employee_id", onlyEmployee);
  let absQ = ctx.supabase.from("absence_requests").select("employee_id, from_date, to_date, partial_hours, absence_types(key, name, paid, counts_as_work)")
    .eq("org_id", ctx.org.id).eq("status", "approved").lte("from_date", to).gte("to_date", from);
  if (onlyEmployee) absQ = absQ.eq("employee_id", onlyEmployee);

  const [{ data: emps }, { data: terms }, { data: org }, { data: ents }, { data: abs }, rules] = await Promise.all([
    empQ,
    ctx.supabase.from("employment_terms").select("employee_id, valid_from, valid_to, hours_per_week, pay_type, paid_holidays")
      .eq("org_id", ctx.org.id).lte("valid_from", to).or(`valid_to.is.null,valid_to.gte.${from}`),
    ctx.supabase.from("organizations").select("full_time_hours_week").eq("id", ctx.org.id).single(),
    entQ,
    absQ,
    loadPayRules(ctx),
  ]);

  const fullTime = Number(org?.full_time_hours_week ?? 37.5);
  const employees: PayEmployee[] = (emps ?? []).map((e) => {
    const t = (terms ?? []).filter((x) => x.employee_id === e.id).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
    return {
      id: e.id, name: e.full_name, employeeNumber: e.employee_number,
      payType: (t?.pay_type ?? "hourly") as "fixed" | "hourly",
      hoursPerWeek: Number(t?.hours_per_week ?? 0), fullTimeHours: fullTime,
      isShiftWorker: e.is_shift_worker, paidHolidays: t?.paid_holidays ?? true, startDate: e.start_date,
    };
  });

  type Row = { employee_id: string; starts_at: string; ends_at: string; break_minutes: number; status: string;
    shifts: { called_overtime: boolean; starts_at: string; ends_at: string } | null };
  const rows = (ents ?? []) as unknown as Row[];
  const toEntry = (r: Row): PayEntry => ({
    employeeId: r.employee_id, start: new Date(r.starts_at), end: new Date(r.ends_at), breakMinutes: r.break_minutes,
    calledOvertime: r.shifts?.called_overtime ?? false,
    plannedStart: r.shifts ? new Date(r.shifts.starts_at) : null, plannedEnd: r.shifts ? new Date(r.shifts.ends_at) : null,
  });
  const approved = rows.filter((r) => r.status === "approved" || r.status === "locked").map(toEntry);
  const all = rows.map(toEntry);
  const pending = rows.filter((r) => r.status === "submitted" || r.status === "draft");

  type A = { employee_id: string; from_date: string; to_date: string; partial_hours: number | null;
    absence_types: { key: string; name: string; paid: boolean; counts_as_work: boolean } | null };
  const absences: PayAbsence[] = ((abs ?? []) as unknown as A[]).map((a) => ({
    employeeId: a.employee_id, from: a.from_date, to: a.to_date, partialHours: a.partial_hours ? Number(a.partial_hours) : null,
    typeKey: a.absence_types?.key ?? "annet", typeName: a.absence_types?.name ?? "Fravær",
    paid: a.absence_types?.paid ?? false, countsAsWork: a.absence_types?.counts_as_work ?? false,
  }));

  const period = { from, to };
  return {
    period,
    pay: employees.map((e) => calculatePay(e, approved, absences, period, rules.resolve, tz)),
    rulesName: rules.setOn(to)?.name ?? "Uten tariff (arbeidsmiljøloven)",
    balances: new Map(employees.map((e) => [e.id, timeBalance(e, all, absences, period, tz)])),
    pendingByEmployee: pending.reduce((m, r) => m.set(r.employee_id, (m.get(r.employee_id) ?? 0) + 1), new Map<string, number>()),
    lockedCount: rows.filter((r) => r.status === "locked").length,
    totalCount: rows.length,
    entries: rows,
  };
}
