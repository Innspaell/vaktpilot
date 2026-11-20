import "server-only";
import type { AppContext } from "./context";
import { addDays, localDate } from "./time";
import { employerStatus, type EmployerStatus } from "./employer-period";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

/** Arbeidsgiverperioden per ansatt (bare de der den pågår eller nylig er brukt opp). */
export async function loadEmployerPeriods(ctx: Ctx): Promise<Map<string, EmployerStatus>> {
  const today = localDate(new Date(), ctx.org.timezone);
  const { data } = await ctx.supabase.from("absence_requests").select("employee_id, from_date, to_date, absence_types!inner(is_sick)")
    .eq("org_id", ctx.org.id).eq("status", "approved").eq("absence_types.is_sick", true).gte("to_date", addDays(today, -400)).limit(5000);
  const byEmp = new Map<string, { from: string; to: string }[]>();
  for (const a of data ?? []) byEmp.set(a.employee_id, [...(byEmp.get(a.employee_id) ?? []), { from: a.from_date, to: a.to_date }]);
  const out = new Map<string, EmployerStatus>();
  for (const [id, spells] of byEmp) {
    const s = employerStatus(spells, today);
    if (s) out.set(id, s);
  }
  return out;
}
