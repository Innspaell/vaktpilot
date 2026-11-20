import Link from "next/link";
import type { AppContext } from "@/lib/context";
import { addDays, dayBounds, localDate } from "@/lib/time";
import { loadDepartments, managesEmployee } from "@/lib/departments";
import { monthHours } from "@/lib/month-hours";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };
const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const num = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 1 });

/** Timer per ansatt i måneden: jobbet hittil, planlagt resten, og avtalt tid. */
export async function MonthHours({ ctx }: { ctx: Ctx }) {
  const tz = ctx.org.timezone;
  const now = new Date();
  const today = localDate(now, tz);
  const monthFrom = today.slice(0, 8) + "01";
  const monthTo = addDays(addDays(monthFrom, 32).slice(0, 8) + "01", -1);
  const start = dayBounds(monthFrom, tz).start.toISOString();
  const end = dayBounds(addDays(monthTo, 1), tz).start.toISOString();

  const [deps, { data: emps }, { data: terms }, { data: entries }, { data: shifts }] = await Promise.all([
    loadDepartments(ctx),
    ctx.supabase.from("employees").select("id, full_name, start_date, end_date").eq("org_id", ctx.org.id).order("full_name"),
    ctx.supabase.from("employment_terms").select("employee_id, valid_from, valid_to, hours_per_week, on_call").eq("org_id", ctx.org.id)
      .lte("valid_from", monthTo).or(`valid_to.is.null,valid_to.gte.${monthFrom}`),
    ctx.supabase.from("time_entries").select("employee_id, starts_at, ends_at, break_minutes").eq("org_id", ctx.org.id)
      .gte("starts_at", start).lt("starts_at", end).not("ends_at", "is", null),
    ctx.supabase.from("shifts").select("employee_id, starts_at, ends_at, break_minutes").eq("org_id", ctx.org.id)
      .eq("status", "published").not("employee_id", "is", null).gte("starts_at", start).lt("starts_at", end),
  ]);

  // Lederen ser de ansatte vedkommende har ansvar for
  const mine = (id: string) => managesEmployee(ctx.isAdmin, deps, id);
  // Med: alle som har avtale, timer eller vakter i måneden (også timebasis før startdato)
  const busy = new Set([...(entries ?? []).map((x) => x.employee_id), ...(shifts ?? []).map((x) => x.employee_id as string)]);
  const withTerms = new Set((terms ?? []).map((t) => t.employee_id));
  const active = (emps ?? []).filter((e) => (!e.end_date || e.end_date >= monthFrom) && (busy.has(e.id) || (withTerms.has(e.id) && e.start_date <= monthTo)) && mine(e.id));
  const rows = monthHours({
    now, monthFrom, monthTo,
    employees: active.map((e) => ({
      id: e.id, name: e.full_name,
      terms: (terms ?? []).filter((t) => t.employee_id === e.id).map((t) => ({
        from: t.valid_from, to: t.valid_to, hoursPerWeek: Number(t.hours_per_week), onCall: Boolean(t.on_call),
      })),
    })),
    entries: (entries ?? []).map((x) => ({ employeeId: x.employee_id, start: new Date(x.starts_at), end: new Date(x.ends_at!), breakMinutes: x.break_minutes })),
    shifts: (shifts ?? []).map((x) => ({ employeeId: x.employee_id, start: new Date(x.starts_at), end: new Date(x.ends_at), breakMinutes: x.break_minutes })),
  }).filter((r) => r.done > 0 || r.plannedRest > 0 || (r.agreed ?? 0) > 0);
  const sum = rows.reduce((s, r) => ({ done: s.done + r.done, rest: s.rest + r.plannedRest }), { done: 0, rest: 0 });
  const month = MONTHS[Number(monthFrom.slice(5, 7)) - 1];

  return (
    <section className="card overflow-x-auto p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
        <h2 className="h2">Timer i {month}</h2>
        <Link href="/rapporter" className="text-sm text-brand">Flere tall i Rapporter</Link>
      </div>
      <p className="px-4 text-xs text-muted">Jobbet = registrerte timer til nå. Planlagt = publiserte vakter som ikke har startet (utkast er ikke med). Avtalt = fast avtalt tid i måneden.</p>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">Ingen timer eller vakter denne måneden ennå.</p>
      ) : (
        <table className="mt-2 w-full text-xs sm:text-sm">
          <thead className="bg-paper text-left text-xs text-muted">
            <tr>
              <th className="py-2 pl-4 pr-2">Ansatt</th>
              <th className="px-2 py-2 text-right sm:px-3">Jobbet<span className="hidden sm:inline"> hittil</span></th>
              <th className="px-2 py-2 text-right sm:px-3">Planlagt<span className="hidden sm:inline"> resten</span></th>
              <th className="px-2 py-2 text-right sm:px-3"><span className="sm:hidden">Sum</span><span className="hidden sm:inline">Til sammen</span></th>
              <th className="py-2 pl-2 pr-4 text-right">Avtalt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            {rows.map((r) => {
              const total = r.done + r.plannedRest;
              const diff = r.agreed === null ? null : total - r.agreed;
              return (
                <tr key={r.id}>
                  <td className="py-2 pl-4 pr-2 font-medium"><Link href={`/timer?ansatt=${r.id}`} className="hover:text-brand">{r.name}</Link></td>
                  <td className="px-2 py-2 text-right sm:px-3">{num(r.done)}</td>
                  <td className="px-2 py-2 text-right sm:px-3">{num(r.plannedRest)}</td>
                  <td className="px-2 py-2 text-right sm:px-3 font-semibold">{num(total)}</td>
                  <td className="py-2 pl-2 pr-4 text-right text-muted">
                    {r.agreed === null ? "timebasis" : (
                      <>{num(r.agreed)}{diff !== null && Math.abs(diff) >= 0.5 && (
                        <span className={`block sm:ml-1.5 sm:inline ${diff < 0 ? "text-warn" : "text-brand"}`}>({diff > 0 ? "+" : ""}{num(diff)})</span>
                      )}</>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-line font-semibold tabular-nums">
            <tr>
              <td className="py-2 pl-4 pr-2">Sum</td>
              <td className="px-2 py-2 text-right sm:px-3">{num(sum.done)}</td>
              <td className="px-2 py-2 text-right sm:px-3">{num(sum.rest)}</td>
              <td className="px-2 py-2 text-right sm:px-3">{num(sum.done + sum.rest)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
