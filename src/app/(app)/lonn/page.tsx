import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { loadPayroll } from "@/lib/payroll-data";
import { addDays, localDate } from "@/lib/time";
import { BILUTLEIE_2024 } from "@/lib/pay";
import { ActionForm } from "@/components/Form";
import { addCompTime, lockPeriod, reopenPeriod } from "./actions";
import { loadCompTime } from "@/lib/report-data";

const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const num = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 2 });

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ fra?: string; til?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin();
  const today = localDate(new Date(), ctx.org.timezone);
  const monthStart = today.slice(0, 8) + "01";
  const iso = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = iso(sp.fra) ?? monthStart;
  const to = iso(sp.til) ?? addDays(addDays(from, 32).slice(0, 8) + "01", -1);

  const [data, { data: periods }, comp] = await Promise.all([
    loadPayroll(ctx, from, to),
    ctx.supabase.from("pay_periods").select("id, starts_on, ends_on, status, payroll_exports(created_at, checksum)")
      .eq("org_id", ctx.org.id).order("starts_on", { ascending: false }).limit(12),
    loadCompTime(ctx),
  ]);
  const pendingTotal = Array.from(data.pendingByEmployee.values()).reduce((a, b) => a + b, 0);
  const thisPeriod = (periods ?? []).find((p) => p.starts_on === from && p.ends_on === to);
  const locked = thisPeriod?.status === "exported";

  const monthLink = (offset: number) => {
    const d = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1 + offset, 1));
    const f = d.toISOString().slice(0, 10);
    return `/lonn?fra=${f}&til=${addDays(addDays(f, 32).slice(0, 8) + "01", -1)}`;
  };
  const label = from.slice(8) === "01" && to === addDays(addDays(from, 32).slice(0, 8) + "01", -1)
    ? `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`
    : `${from.split("-").reverse().join(".")}–${to.split("-").reverse().join(".")}`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={monthLink(-1)} className="btn-ghost px-3" aria-label="Forrige måned">‹</Link>
          <h1 className="h1 capitalize">Lønn {label}</h1>
          <Link href={monthLink(1)} className="btn-ghost px-3" aria-label="Neste måned">›</Link>
        </div>
        {locked ? <span className="badge bg-paper px-3 py-1 text-muted ring-1 ring-line">Låst og eksportert</span> : null}
      </header>

      <form action="/lonn" className="card grid gap-3 md:grid-cols-4">
        <label className="block"><span className="label">Fra</span><input name="fra" type="date" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">Til</span><input name="til" type="date" defaultValue={to} className="input" /></label>
        <div className="self-end"><button className="btn-ghost w-full">Vis periode</button></div>
        <p className="self-end text-xs text-muted">Regler: {BILUTLEIE_2024.name}. Satsene må kontrolleres mot gjeldende avtale.</p>
      </form>

      {pendingTotal > 0 && (
        <p className="card border-warn/40 bg-warn-soft text-sm text-warn">
          {pendingTotal} {pendingTotal === 1 ? "registrering venter" : "registreringer venter"} på godkjenning og er ikke med i lønnsgrunnlaget.{" "}
          <Link href={`/timer?vis=alle&fra=${from}&til=${to}`} className="font-semibold underline">Gå til godkjenning</Link>
        </p>
      )}

      <section className="card flex flex-wrap items-center gap-3">
        <a href={`/api/lonn?type=lonn&format=xlsx&fra=${from}&til=${to}`} className="btn-primary">Last ned lønnsgrunnlag (Excel)</a>
        <a href={`/api/lonn?type=lonn&fra=${from}&til=${to}`} className="btn-ghost">Som CSV</a>
        <a href={`/api/lonn?type=dager&format=xlsx&fra=${from}&til=${to}`} className="btn-ghost">Kontrollark per dag</a>
        {!locked ? (
          <ActionForm action={lockPeriod} submitLabel="Lås perioden" className="flex items-center gap-3">
            <input type="hidden" name="fra" value={from} />
            <input type="hidden" name="til" value={to} />
          </ActionForm>
        ) : (
          <form action={reopenPeriod}>
            <input type="hidden" name="period_id" value={thisPeriod!.id} />
            <button className="btn-ghost">Åpne perioden igjen</button>
          </form>
        )}
        <p className="w-full text-xs text-muted">
          Når perioden låses, kan ingen endre timene i den før den åpnes igjen. Det hindrer at timer blir endret etter at lønnen er kjørt.
          Excel-filen har ett ark med én rad per ansatt og lønnsart, og ett kontrollark med alle registreringene. CSV-filen har samme lønnsgrunnlag.
        </p>
      </section>

      {data.pay.length === 0 ? <p className="card text-sm text-muted">Ingen ansatte i perioden.</p> : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.pay.map((p) => {
            const b = data.balances.get(p.employee.id)!;
            const pending = data.pendingByEmployee.get(p.employee.id) ?? 0;
            return (
              <section key={p.employee.id} className="card">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="h2">{p.employee.name}</h2>
                  <span className="text-xs text-muted">{p.employee.payType === "fixed" ? "Fastlønn" : "Timelønn"} · {num(p.employee.hoursPerWeek)} t/uke</span>
                </div>
                {p.lines.length === 0 ? <p className="mt-2 text-sm text-muted">Ingen godkjente timer eller fravær.</p> : (
                  <table className="mt-2 w-full text-sm">
                    <tbody className="divide-y divide-line">
                      {p.lines.map((l) => (
                        <tr key={l.code}>
                          <td className="py-1.5 pr-2">{l.label}</td>
                          <td className="py-1.5 text-right tabular-nums">{l.days !== undefined && l.days > 0 ? `${l.days} d · ` : ""}{num(l.hours)} t</td>
                          <td className="w-24 py-1.5 text-right tabular-nums text-muted">{l.amount !== undefined ? `${num(l.amount)} kr` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-paper p-2 text-center text-xs">
                  <div><div className="text-muted">Forventet</div><div className="text-base font-semibold tabular-nums">{num(b.expectedHours)} t</div></div>
                  <div><div className="text-muted">Jobbet + betalt fravær</div><div className="text-base font-semibold tabular-nums">{num(b.workedHours + b.paidAbsenceHours)} t</div></div>
                  <div><div className="text-muted">Saldo</div>
                    <div className={`text-base font-semibold tabular-nums ${b.diffHours < -0.01 ? "text-warn" : b.diffHours > 0.01 ? "text-brand" : "text-good"}`}>
                      {b.diffHours > 0 ? "+" : ""}{num(b.diffHours)} t
                    </div>
                  </div>
                </div>
                {pending > 0 && <p className="mt-2 text-xs text-warn">{pending} ikke godkjent</p>}
                <CompTime employeeId={p.employee.id} c={comp.balances.get(p.employee.id)} history={comp.history.filter((h) => h.employeeId === p.employee.id).slice(0, 5)} today={today} />
              </section>
            );
          })}
        </div>
      )}

      {(periods ?? []).length > 0 && (
        <section className="card p-0">
          <h2 className="h2 px-4 pt-4">Tidligere perioder</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {(periods ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2">
                <Link href={`/lonn?fra=${p.starts_on}&til=${p.ends_on}`} className="text-brand">
                  {p.starts_on.split("-").reverse().join(".")}–{p.ends_on.split("-").reverse().join(".")}
                </Link>
                <span className={`badge ${p.status === "exported" ? "bg-good-soft text-good" : "bg-paper text-muted"}`}>{p.status === "exported" ? "Låst" : "Åpen"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CompTime({ employeeId, c, history, today }: {
  employeeId: string; c?: { earned: number; used: number; balance: number };
  history: { id: string; hours: number; comment: string; date: string }[]; today: string;
}) {
  const b = c ?? { earned: 0, used: 0, balance: 0 };
  return (
    <details className="mt-3 rounded-lg border border-line p-2 text-sm">
      <summary className="flex cursor-pointer items-center justify-between">
        <span>Avspasering</span>
        <span className={`font-semibold tabular-nums ${b.balance < -0.01 ? "text-warn" : ""}`}>{num(b.balance)} t</span>
      </summary>
      <p className="mt-2 text-xs text-muted">Opptjent {num(b.earned)} t · tatt ut {num(b.used)} t. Uttak trekkes automatisk når avspasering godkjennes.</p>
      {history.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {history.map((h) => (
            <li key={h.id} className="flex justify-between gap-2">
              <span className="truncate">{h.date.split("-").reverse().join(".")} · {h.comment}</span>
              <span className="tabular-nums">{h.hours > 0 ? "+" : ""}{num(h.hours)} t</span>
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={addCompTime} submitLabel="Legg til" className="mt-2 grid grid-cols-2 gap-2">
        <input type="hidden" name="employee_id" value={employeeId} />
        <input name="hours" inputMode="decimal" placeholder="Timer, f.eks. 7,5" className="input" aria-label="Timer" required />
        <input name="date" type="date" defaultValue={today} className="input" aria-label="Dato" />
        <input name="comment" placeholder="Forklaring, f.eks. overtid oktober" className="input col-span-2" aria-label="Forklaring" required />
      </ActionForm>
    </details>
  );
}
