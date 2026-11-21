import type { GradedRow } from "@/lib/graded-sick";
import { formatDateLong } from "@/lib/time";

const num = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 1 });

/** Gradert sykmelding regnet på både arbeidsevne og tid. */
export function GradedSickTable({ rows, xlsxHref }: { rows: GradedRow[]; xlsxHref: string }) {
  if (!rows.length) return null;
  return (
    <section id="gradert-sykmelding" className="card scroll-mt-20 overflow-x-auto p-0">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4">
        <div>
          <h2 className="h2">Gradert sykmelding regnet på tid</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            Graden gjelder arbeidsevnen. Her regnes også tiden med: er den ansatte 50 % sykmeldt og på jobb halve avtalte tiden,
            er arbeidsinnsatsen 50 % × 50 % = 25 %, som tilsvarer 75 % sykmelding. Timebasis og tilkalling regnes mot planlagte vakter.
          </p>
        </div>
        <a href={xlsxHref} className="btn-ghost shrink-0">Last ned (Excel)</a>
      </div>
      <table className="mt-2 w-full min-w-[46rem] text-sm">
        <thead className="bg-paper text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-2">Ansatt</th>
            <th className="px-2 py-2">Periode</th>
            <th className="px-2 py-2 text-right">Grad</th>
            <th className="px-2 py-2 text-right">Grunnlag</th>
            <th className="px-2 py-2 text-right">Jobbet</th>
            <th className="px-2 py-2 text-right">På jobb</th>
            <th className="px-2 py-2 text-right">Innsats</th>
            <th className="px-4 py-2 text-right">Tilsvarer</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums">
          {rows.map((r) => (
            <tr key={`${r.employeeId}-${r.from}`}>
              <td className="px-4 py-2 font-medium">{r.name}</td>
              <td className="px-2 py-2">{r.from === r.to ? formatDateLong(r.from) : `${formatDateLong(r.from)} – ${formatDateLong(r.to)}`}</td>
              <td className="px-2 py-2 text-right">{r.grade} %</td>
              <td className="px-2 py-2 text-right">{num(r.basisHours)} t <span className="text-xs text-muted">{r.basis}</span></td>
              <td className="px-2 py-2 text-right">{num(r.workedHours)} t</td>
              <td className="px-2 py-2 text-right">{num(r.timePct)} %</td>
              <td className="px-2 py-2 text-right">{num(r.effortPct)} %</td>
              <td className={`px-4 py-2 text-right font-semibold ${r.effectivePct > r.grade ? "text-warn" : ""}`}>{num(r.effectivePct)} % syk</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs text-muted">Regnet til og med i dag. Timer som ikke er registrert ennå, regnes ikke med. Tallene er til oppfølging, ikke en ny sykmeldingsgrad.</p>
    </section>
  );
}
