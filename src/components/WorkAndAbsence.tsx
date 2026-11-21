import Link from "next/link";
import type { AppContext } from "@/lib/context";
import type { EmployeeRow } from "@/lib/report";
import { absenceWorkdays, employedWorkdays, type StatAbsence } from "@/lib/absence-stats";
import { checkWorkTime } from "@/lib/worktime-check";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };
const num = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 1 });

/**
 * Arbeidstid og fravær side om side per ansatt: jobbet, overtid og mertid, brudd på arbeidstidsreglene
 * og sykefravær. Høy belastning og høyt fravær hos samme person markeres.
 */
export async function WorkAndAbsence({ ctx, from, to, rows }: { ctx: Ctx; from: string; to: string; rows: EmployeeRow[] }) {
  const [{ data: abs }, { data: emps }, { data: terms }, breaches] = await Promise.all([
    ctx.supabase.from("absence_requests").select("employee_id, from_date, to_date, partial_hours, percent, absence_types!inner(key, is_sick)")
      .eq("org_id", ctx.org.id).eq("status", "approved").eq("absence_types.is_sick", true).lte("from_date", to).gte("to_date", from),
    ctx.supabase.from("employees").select("id, start_date, end_date").eq("org_id", ctx.org.id),
    ctx.supabase.from("employment_terms").select("employee_id, position_pct").eq("org_id", ctx.org.id).is("valid_to", null),
    checkWorkTime(ctx, from, to),
  ]);
  type A = { employee_id: string; from_date: string; to_date: string; partial_hours: number | null; percent: number | null; absence_types: { key: string } | null };
  const list: StatAbsence[] = ((abs ?? []) as unknown as A[]).map((a) => ({
    employeeId: a.employee_id, from: a.from_date, to: a.to_date, typeKey: a.absence_types?.key ?? "annet", partialHours: a.partial_hours, percent: a.percent,
  }));
  const sickKeys = [...new Set(list.map((a) => a.typeKey))];
  const empById = new Map((emps ?? []).map((e) => [e.id, e]));
  const pctById = new Map((terms ?? []).map((t) => [t.employee_id, Number(t.position_pct ?? 100)]));

  const data = rows.map((r) => {
    const e = empById.get(r.id);
    const workdays = e ? employedWorkdays({ id: r.id, name: r.name, positionPct: 100, startDate: e.start_date, endDate: e.end_date }, from, to) : 0;
    const self = absenceWorkdays(list, r.id, ["syk"], from, to);
    const doctor = absenceWorkdays(list, r.id, sickKeys.filter((k) => k !== "syk"), from, to);
    const sickPct = workdays > 0 && (pctById.get(r.id) ?? 100) > 0 ? ((self + doctor) / workdays) * 100 : 0;
    const br = (breaches.get(r.id) ?? []).filter((w) => w.severity === "brudd").length;
    const load = r.overtime + r.extra;
    return { ...r, self, doctor, sickPct, br, load, flag: (load >= 10 || br > 0) && sickPct >= 5 };
  }).filter((x) => x.registered > 0 || x.self + x.doctor > 0 || x.br > 0)
    .sort((a, b) => Number(b.flag) - Number(a.flag) || b.load - a.load || b.sickPct - a.sickPct);

  return (
    <section id="arbeidstid-og-fravaer" className="card scroll-mt-20 overflow-x-auto p-0">
      <div className="px-4 pt-4">
        <h2 className="h2">Arbeidstid og fravær</h2>
        <p className="mt-1 text-xs text-muted">
          Belastning og sykefravær i perioden per ansatt. Mye overtid eller brudd på arbeidstidsreglene sammen med sykefravær kan være et tegn på for stor belastning,
          og er markert. Overtid regnes av godkjente timer. Sykefraværet regnes som hos SSB: gradert sykmelding teller med graden.
        </p>
      </div>
      {data.length === 0 ? <p className="p-4 text-sm text-muted">Ingen timer eller sykefravær i perioden.</p> : (
        <table className="mt-2 w-full min-w-[44rem] text-sm">
          <thead className="bg-paper text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2">Ansatt</th>
              <th className="px-2 py-2 text-right">Jobbet</th>
              <th className="px-2 py-2 text-right">Overtid</th>
              <th className="px-2 py-2 text-right">Mertid</th>
              <th className="px-2 py-2 text-right">Brudd</th>
              <th className="px-2 py-2 text-right">Egenmeldt</th>
              <th className="px-2 py-2 text-right">Sykmeldt</th>
              <th className="px-4 py-2 text-right">Sykefravær</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            {data.map((x) => (
              <tr key={x.id} className={x.flag ? "bg-warn-soft" : ""}>
                <td className="px-4 py-2 font-medium">{x.name}{x.flag && <span className="ml-2 text-xs font-semibold text-warn">Følg opp</span>}</td>
                <td className="px-2 py-2 text-right">{num(x.registered)} t</td>
                <td className={`px-2 py-2 text-right ${x.overtime > 0 ? "text-warn" : ""}`}>{num(x.overtime)} t</td>
                <td className="px-2 py-2 text-right">{num(x.extra)} t</td>
                <td className={`px-2 py-2 text-right ${x.br ? "font-semibold text-bad" : "text-muted"}`}>{x.br || "–"}</td>
                <td className="px-2 py-2 text-right">{num(x.self)} d</td>
                <td className="px-2 py-2 text-right">{num(x.doctor)} d</td>
                <td className="px-4 py-2 text-right font-semibold">{num(x.sickPct)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="px-4 py-3 text-xs text-muted">
        Brudd er registrerte timer som går over grensene i arbeidsmiljøloven (hvile, maks per dag og uke, overtid). Detaljene står under <Link href="/lonn" className="text-brand">Lønn</Link>, og fravær per år under <Link href="/fravaer" className="text-brand">Fravær</Link>.
      </p>
    </section>
  );
}
