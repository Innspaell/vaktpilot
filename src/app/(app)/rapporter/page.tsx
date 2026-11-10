import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { loadReport } from "@/lib/report-data";
import { addDays, formatDateLong, localDate } from "@/lib/time";
import type { Grouping } from "@/lib/report";

const num = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 2 });
const signed = (n: number) => `${n > 0.004 ? "+" : ""}${num(n)}`;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ fra?: string; til?: string; per?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin();
  const today = localDate(new Date(), ctx.org.timezone);
  const iso = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = iso(sp.fra) ?? today.slice(0, 8) + "01";
  let to = iso(sp.til) ?? addDays(addDays(from, 32).slice(0, 8) + "01", -1);
  if (to < from) to = from;
  // Maks ett år om gangen, så siden holder seg rask
  if (Date.parse(to) - Date.parse(from) > 366 * 86400000) to = addDays(from, 365);
  const grouping: Grouping = sp.per === "maned" ? "maned" : "uke";

  const r = await loadReport(ctx, from, to, grouping);
  const q = (p: Record<string, string>) => `/rapporter?${new URLSearchParams({ fra: from, til: to, per: grouping, ...p })}`;
  const presets: [string, string, string][] = [
    ["Denne måneden", today.slice(0, 8) + "01", addDays(addDays(today.slice(0, 8) + "01", 32).slice(0, 8) + "01", -1)],
    ["Forrige måned", addDays(today.slice(0, 8) + "01", -1).slice(0, 8) + "01", addDays(today.slice(0, 8) + "01", -1)],
    ["Hittil i år", today.slice(0, 5) + "01-01", today],
  ];
  const t = r.employees.reduce((s, e) => ({
    planned: s.planned + e.planned, registered: s.registered + e.registered, approved: s.approved + e.approved,
    overtime: s.overtime + e.overtime, extra: s.extra + e.extra, holidayWorked: s.holidayWorked + e.holidayWorked,
    paidAbsence: s.paidAbsence + e.paidAbsence, absenceDays: s.absenceDays + e.absenceDays,
  }), { planned: 0, registered: 0, approved: 0, overtime: 0, extra: 0, holidayWorked: 0, paidAbsence: 0, absenceDays: 0 });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">Rapporter</h1>
        <a href={`/api/rapport?fra=${from}&til=${to}&per=${grouping}`} className="btn-primary">Last ned Excel</a>
      </header>

      <form action="/rapporter" className="card grid gap-3 md:grid-cols-5">
        <label className="block"><span className="label">Fra</span><input name="fra" type="date" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">Til</span><input name="til" type="date" defaultValue={to} className="input" /></label>
        <label className="block"><span className="label">Del opp per</span>
          <select name="per" defaultValue={grouping} className="input"><option value="uke">Uke</option><option value="maned">Måned</option></select>
        </label>
        <div className="self-end"><button className="btn-ghost w-full">Vis</button></div>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          {presets.map(([l, f, tt]) => <Link key={l} href={q({ fra: f, til: tt })} className="text-brand underline-offset-2 hover:underline">{l}</Link>)}
        </div>
      </form>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Planlagt" value={`${num(t.planned)} t`} />
        <Stat label="Registrert" value={`${num(t.registered)} t`} hint={`${num(t.approved)} t godkjent`} />
        <Stat label="Overtid og mertid" value={`${num(t.overtime + t.extra)} t`} hint={`overtid ${num(t.overtime)} · mertid ${num(t.extra)}`} />
        <Stat label="Bemanning" value={r.coverage.daysWithNeed ? `${r.coverage.daysCovered} av ${r.coverage.daysWithNeed} dager` : "Ingen behov"}
          hint={r.coverage.missingHours ? `mangler ${num(r.coverage.missingHours)} persontimer` : "fullt dekket"} warn={r.coverage.daysShort > 0} />
      </section>

      <section className="card overflow-x-auto p-0">
        <h2 className="h2 px-4 pt-4">Per ansatt</h2>
        <p className="px-4 text-xs text-muted">Overtid og mertid regnes bare av godkjente timer. Saldo er avtalt tid mot jobbet tid pluss betalt fravær.</p>
        <table className="mt-2 w-full min-w-[56rem] text-sm">
          <thead className="bg-paper text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2">Ansatt</th>
              <Th>Planlagt</Th><Th>Registrert</Th><Th>Godkjent</Th><Th>Avvik plan</Th><Th>Overtid</Th><Th>Mertid</Th>
              <Th>På helligdag</Th><Th>Betalt fravær</Th><Th>Fraværsdager</Th><Th>Saldo</Th><Th>Avspasering</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {r.employees.map((e) => {
              const comp = r.comp.balances.get(e.id);
              return (
                <tr key={e.id}>
                  <td className="px-4 py-2 font-medium">{e.name}</td>
                  <Td>{num(e.planned)}</Td><Td>{num(e.registered)}</Td><Td>{num(e.approved)}</Td>
                  <Td className={Math.abs(e.registered - e.planned) > 0.01 ? "text-warn" : "text-muted"}>{signed(e.registered - e.planned)}</Td>
                  <Td>{num(e.overtime)}</Td><Td>{num(e.extra)}</Td><Td>{num(e.holidayWorked)}</Td><Td>{num(e.paidAbsence)}</Td>
                  <Td>{e.absenceDays}</Td>
                  <Td className={e.balance < -0.01 ? "text-warn" : e.balance > 0.01 ? "text-brand" : "text-good"}>{signed(e.balance)}</Td>
                  <Td>{comp ? num(comp.balance) : "0"}</Td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-line font-semibold">
            <tr>
              <td className="px-4 py-2">Sum</td>
              <Td>{num(t.planned)}</Td><Td>{num(t.registered)}</Td><Td>{num(t.approved)}</Td><Td>{signed(t.registered - t.planned)}</Td>
              <Td>{num(t.overtime)}</Td><Td>{num(t.extra)}</Td><Td>{num(t.holidayWorked)}</Td><Td>{num(t.paidAbsence)}</Td><Td>{t.absenceDays}</Td><Td /><Td />
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="card overflow-x-auto p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="h2">Per {grouping === "uke" ? "uke" : "måned"}</h2>
          <div className="flex gap-2 text-sm">
            <Link href={q({ per: "uke" })} className={grouping === "uke" ? "font-semibold text-ink" : "text-brand"}>Uke</Link>
            <Link href={q({ per: "maned" })} className={grouping === "maned" ? "font-semibold text-ink" : "text-brand"}>Måned</Link>
          </div>
        </div>
        <p className="px-4 text-xs text-muted">Planlagt mot registrert tid. Per ansatt: registrert / planlagt.</p>
        <table className="mt-2 w-full min-w-[40rem] text-sm">
          <thead className="bg-paper text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2">Periode</th><Th>Planlagt</Th><Th>Registrert</Th><Th>Avvik</Th>
              {r.employees.map((e) => <Th key={e.id}>{e.name.split(" ")[0]}</Th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {r.buckets.map((b) => (
              <tr key={b.key}>
                <td className="px-4 py-2 capitalize">{b.label}</td>
                <Td>{num(b.planned)}</Td><Td>{num(b.registered)}</Td>
                <Td className={Math.abs(b.registered - b.planned) > 0.01 ? "text-warn" : "text-muted"}>{signed(b.registered - b.planned)}</Td>
                {r.employees.map((e) => {
                  const x = b.byEmployee.get(e.id);
                  return <Td key={e.id} className="text-muted">{x ? `${num(x.registered / 60)} / ${num(x.planned / 60)}` : "–"}</Td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="h2">Bemanningsdekning</h2>
        <p className="mt-1 text-xs text-muted">Bemanningsbehov mot publiserte vakter, regnet per kvarter.</p>
        {r.coverage.short.length === 0 ? (
          <p className="mt-3 text-sm text-good">{r.coverage.daysWithNeed ? "Alle dager med behov er fullt bemannet." : "Ingen bemanningsbehov i perioden."}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {r.coverage.short.map((d) => (
              <li key={d.date} className="flex items-center justify-between py-2">
                <Link href={`/vaktplan?visning=dag&dato=${d.date}`} className="capitalize text-brand">{formatDateLong(d.date)}</Link>
                <span className="tabular-nums text-warn">behov {d.required}, planlagt {d.planned} · mangler {num(d.missingHours)} persontimer</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-muted">
        Se også <Link href="/fravaer" className="text-brand">fraværsoversikten</Link> for sykefravær og ferie,
        og <Link href={`/lonn?fra=${from}&til=${to}`} className="text-brand">lønn</Link> for lønnsgrunnlaget i samme periode.
      </p>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-2 py-2 text-right font-medium">{children}</th>;
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-2 text-right tabular-nums ${className}`}>{children}</td>;
}
function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${warn ? "text-warn" : ""}`}>{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}
