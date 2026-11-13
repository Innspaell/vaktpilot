import "server-only";
import type { AppContext } from "./context";
import { addDays, dayBounds } from "./time";
import { checkWorkPeriods, type WorkPeriod, type WorkWarning } from "./worktime";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

function group(rows: { employee_id: string | null; starts_at: string; ends_at: string | null }[]) {
  const m = new Map<string, WorkPeriod[]>();
  for (const r of rows) {
    if (!r.employee_id || !r.ends_at) continue;
    m.set(r.employee_id, [...(m.get(r.employee_id) ?? []), { start: new Date(r.starts_at), end: new Date(r.ends_at) }]);
  }
  return m;
}

/** Registrerte timer i perioden mot arbeidstidsreglene (med 52 uker historikk for overtidsgrensene). */
export async function checkWorkTime(ctx: Ctx, from: string, to: string, onlyEmployee?: string) {
  const tz = ctx.org.timezone;
  let q = ctx.supabase.from("time_entries").select("employee_id, starts_at, ends_at")
    .eq("org_id", ctx.org.id).gte("starts_at", dayBounds(addDays(from, -371), tz).start.toISOString())
    .lt("starts_at", dayBounds(addDays(to, 2), tz).start.toISOString()).not("ends_at", "is", null).limit(20000);
  if (onlyEmployee) q = q.eq("employee_id", onlyEmployee);
  const { data } = await q;
  const out = new Map<string, WorkWarning[]>();
  for (const [emp, periods] of group(data ?? [])) {
    const w = checkWorkPeriods(periods, from, to, tz);
    if (w.length) out.set(emp, w);
  }
  return out;
}

/** Planlagte vakter (utkast og publiserte) mot arbeidstidsreglene. */
export async function checkPlannedShifts(ctx: Ctx, from: string, to: string) {
  const tz = ctx.org.timezone;
  const { data } = await ctx.supabase.from("shifts").select("employee_id, starts_at, ends_at")
    .eq("org_id", ctx.org.id).neq("status", "cancelled").not("employee_id", "is", null)
    .gte("starts_at", dayBounds(addDays(from, -35), tz).start.toISOString())
    .lt("starts_at", dayBounds(addDays(to, 2), tz).start.toISOString()).limit(20000);
  const out = new Map<string, WorkWarning[]>();
  for (const [emp, periods] of group(data ?? [])) {
    const w = checkWorkPeriods(periods, from, to, tz).filter((x) => x.severity === "brudd");
    if (w.length) out.set(emp, w);
  }
  return out;
}
