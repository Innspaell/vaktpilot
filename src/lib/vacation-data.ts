import "server-only";
import type { AppContext } from "./context";
import { localDate } from "./time";
import { vacationForYear, vacationYearOf, type VacAbsence, type VacLedger, type VacationYear } from "./vacation";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

export interface Carryover {
  id: string; employee_id: string; from_year: number; days: number; reason: string; status: string; note: string | null;
  employee_accepted_at: string | null; employer_accepted_at: string | null; created_at: string;
}

/** Feriesaldo for gitte år, for én ansatt eller alle. */
export async function loadVacation(ctx: Ctx, years: number[], onlyEmployee?: string) {
  const { data: org } = await ctx.supabase.from("organizations").select("vacation_year_start_month, vacation_days_year, vacation_carryover_max_days").eq("id", ctx.org.id).single();
  const startMonth = org?.vacation_year_start_month ?? 1;
  const today = localDate(new Date(), ctx.org.timezone);
  const mm = String(startMonth).padStart(2, "0");
  const minFrom = `${Math.min(...years)}-${mm}-01`;

  let termQ = ctx.supabase.from("employment_terms").select("employee_id, vacation_days, hours_per_week").eq("org_id", ctx.org.id).is("valid_to", null);
  let ledQ = ctx.supabase.from("leave_ledger").select("id, employee_id, amount, effective_date, source, note").eq("org_id", ctx.org.id).eq("kind", "vacation").gte("effective_date", minFrom).order("effective_date");
  let absQ = ctx.supabase.from("absence_requests").select("employee_id, from_date, to_date, partial_hours, status, absence_types!inner(key)")
    .eq("org_id", ctx.org.id).eq("absence_types.key", "ferie").in("status", ["approved", "pending"]).gte("to_date", minFrom);
  let coQ = ctx.supabase.from("vacation_carryovers").select("id, employee_id, from_year, days, reason, status, note, employee_accepted_at, employer_accepted_at, created_at")
    .eq("org_id", ctx.org.id).order("created_at", { ascending: false });
  if (onlyEmployee) {
    termQ = termQ.eq("employee_id", onlyEmployee);
    ledQ = ledQ.eq("employee_id", onlyEmployee);
    absQ = absQ.eq("employee_id", onlyEmployee);
    coQ = coQ.eq("employee_id", onlyEmployee);
  }
  const [{ data: terms }, { data: led }, { data: abs }, { data: co }] = await Promise.all([termQ, ledQ, absQ, coQ]);

  const ids = new Set<string>([...(terms ?? []).map((t) => t.employee_id), ...(onlyEmployee ? [onlyEmployee] : [])]);
  const result = new Map<string, VacationYear[]>();
  for (const id of ids) {
    const t = (terms ?? []).find((x) => x.employee_id === id);
    const ledger: VacLedger[] = (led ?? []).filter((l) => l.employee_id === id)
      .map((l) => ({ id: l.id, amount: Number(l.amount), date: l.effective_date, source: l.source, note: l.note }));
    const absences: VacAbsence[] = (abs ?? []).filter((a) => a.employee_id === id)
      .map((a) => ({ from: a.from_date, to: a.to_date, status: a.status as "approved" | "pending", partialHours: a.partial_hours ? Number(a.partial_hours) : null }));
    result.set(id, years.map((year) => vacationForYear({
      year, startMonth, today,
      entitlement: Number(t?.vacation_days ?? org?.vacation_days_year ?? 25),
      hoursPerWeek: Number(t?.hours_per_week ?? 37.5),
      ledger, absences,
    })));
  }
  return {
    byEmployee: result,
    carryovers: (co ?? []) as Carryover[],
    startMonth,
    currentYear: vacationYearOf(today, startMonth),
    maxCarryover: Number(org?.vacation_carryover_max_days ?? 10),
    today,
  };
}

/** Hvilke år som er aktuelle å vise: i år, og neste år når det er planlagt noe der eller det nærmer seg. */
export function relevantYears(current: number, today: string, hasNext: boolean) {
  const month = Number(today.slice(5, 7));
  return hasNext || month >= 9 ? [current, current + 1] : [current];
}
