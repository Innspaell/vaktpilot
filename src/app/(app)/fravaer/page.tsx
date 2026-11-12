import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { addDays, formatDateLong, localDate } from "@/lib/time";
import { vacationYearOf } from "@/lib/vacation";
import { loadVacation } from "@/lib/vacation-data";
import { absenceWorkdays, employedWorkdays, selfCertification, sickLeavePercent, type StatAbsence, type StatEmployee } from "@/lib/absence-stats";

const MON = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];
const pct = (n: number) => `${n.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %`;

export default async function AbsenceOverviewPage({ searchParams }: { searchParams: Promise<{ aar?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin();
  const today = localDate(new Date(), ctx.org.timezone);
  const year = /^\d{4}$/.test(sp.aar ?? "") ? Number(sp.aar) : Number(today.slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year}-12-31` < today ? `${year}-12-31` : today;
  const since12 = addDays(today, -365);

  const [{ data: emps }, { data: terms }, { data: abs }, { data: org }] = await Promise.all([
    ctx.supabase.from("employees").select("id, full_name, start_date, end_date").eq("org_id", ctx.org.id).order("full_name"),
    ctx.supabase.from("employment_terms").select("employee_id, position_pct, vacation_days, valid_to").eq("org_id", ctx.org.id).is("valid_to", null),
    ctx.supabase.from("absence_requests").select("employee_id, from_date, to_date, partial_hours, status, absence_types(key, name)")
      .eq("org_id", ctx.org.id).in("status", ["approved", "pending"]).gte("to_date", since12 < from ? since12 : from),
    ctx.supabase.from("organizations").select("vacation_year_start_month").eq("id", ctx.org.id).single(),
  ]);
  type A = { employee_id: string; from_date: string; to_date: string; partial_hours: number | null; status: string; absence_types: { key: string; name: string } | null };
  const rawAbs = (abs ?? []) as unknown as A[];
  const approved: StatAbsence[] = rawAbs.filter((a) => a.status === "approved").map((a) => ({
    employeeId: a.employee_id, from: a.from_date, to: a.to_date, typeKey: a.absence_types?.key ?? "annet", partialHours: a.partial_hours,
  }));
  const employees: StatEmployee[] = (emps ?? [])
    .filter((e) => e.full_name !== "Tidligere ansatt" || (e.end_date ?? "") >= from)
    .map((e) => ({
      id: e.id, name: e.full_name, startDate: e.start_date, endDate: e.end_date,
      positionPct: Number((terms ?? []).find((t) => t.employee_id === e.id)?.position_pct ?? 100),
    }));
  const active = employees.filter((e) => !e.endDate || e.endDate >= from);

  const total = sickLeavePercent(active, approved, from, to);
  const selfPct = sickLeavePercent(active, approved, from, to, ["syk"]);
  const docPct = sickLeavePercent(active, approved, from, to, ["sykmelding"]);
  const monthsUpTo = to.slice(0, 7) === `${year}-12` ? 12 : Number(to.slice(5, 7));
  const months = Array.from({ length: monthsUpTo }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    const mFrom = `${year}-${m}-01`;
    const mTo = addDays(addDays(mFrom, 32).slice(0, 8) + "01", -1);
    return { label: MON[i], self: sickLeavePercent(active, approved, mFrom, mTo < to ? mTo : to, ["syk"]), doc: sickLeavePercent(active, approved, mFrom, mTo < to ? mTo : to, ["sykmelding"]) };
  });
  const maxMonth = Math.max(5, ...months.map((m) => m.self + m.doc));
  const vy = vacationYearOf(today, org?.vacation_year_start_month ?? 1);
  const vac = await loadVacation(ctx, [vy]);
  const upcoming = rawAbs.filter((a) => a.from_date > today && a.from_date <= addDays(today, 45)).sort((a, b) => a.from_date.localeCompare(b.from_date));
  const name = new Map(employees.map((e) => [e.id, e.name]));

  // Det som venter på svar fra leder
  const head = { count: "exact" as const, head: true };
  const [pAbs, pShift, pSwap, { data: pCarry }] = await Promise.all([
    ctx.supabase.from("absence_requests").select("id", head).eq("org_id", ctx.org.id).eq("status", "pending"),
    ctx.supabase.from("shift_requests").select("id", head).eq("org_id", ctx.org.id).eq("status", "pending"),
    ctx.supabase.from("shift_swaps").select("id", head).eq("org_id", ctx.org.id).eq("status", "pending").or("to_employee_id.is.null,to_accepted.eq.true"),
    ctx.supabase.from("vacation_carryovers").select("id, employee_id, days, from_year").eq("org_id", ctx.org.id).eq("status", "pending").is("employer_accepted_at", null),
  ]);
  const waiting: { label: string; n: number; href: string }[] = [
    { label: "Søknader om fri", n: pAbs.count ?? 0, href: "/foresporsler?vis=fri" },
    { label: "Påmeldinger til ledige vakter", n: pShift.count ?? 0, href: "/foresporsler?vis=vakter" },
    { label: "Vaktbytter", n: pSwap.count ?? 0, href: "/foresporsler?vis=bytte" },
  ].filter((w) => w.n > 0);

  return (
    <div className="space-y-4">
      <section className={`card ${waiting.length || pCarry?.length ? "border-brand/30 bg-brand-soft" : ""}`}>
        <h2 className="h2">Venter på svar fra deg</h2>
        {waiting.length === 0 && !pCarry?.length ? (
          <p className="mt-1 text-sm text-muted">Ingenting venter. Alt er behandlet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line/70 text-sm">
            {waiting.map((w) => (
              <li key={w.href}><Link href={w.href} className="flex items-center justify-between py-2 hover:text-brand"><span>{w.label}</span><span className="badge bg-bad text-white">{w.n}</span></Link></li>
            ))}
            {(pCarry ?? []).map((c) => (
              <li key={c.id}><Link href={`/ferie/overforing/${c.id}`} className="flex items-center justify-between py-2 hover:text-brand">
                <span>Ferieoverføring: {name.get(c.employee_id) ?? "Ansatt"}, {Number(c.days).toLocaleString("nb-NO")} dager fra {c.from_year}</span><span className="text-brand">Signer ›</span>
              </Link></li>
            ))}
          </ul>
        )}
      </section>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/fravaer?aar=${year - 1}`} className="btn-ghost px-3" aria-label="Forrige år">‹</Link>
          <h1 className="h1">Fravær og godkjenning {year}</h1>
          {year < Number(today.slice(0, 4)) && <Link href={`/fravaer?aar=${year + 1}`} className="btn-ghost px-3" aria-label="Neste år">›</Link>}
        </div>
        <Link href="/foresporsler?vis=fri" className="btn-primary">Registrer eller godkjenn fravær</Link>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <Kpi label="Sykefravær" value={pct(total)} hint={`hittil i ${year}`} />
        <Kpi label="Egenmeldt" value={pct(selfPct)} />
        <Kpi label="Legemeldt" value={pct(docPct)} />
      </section>

      <section className="card">
        <h2 className="h2">Sykefravær per måned</h2>
        <div className="mt-4 flex h-40 items-end gap-1.5" role="img" aria-label="Sykefravær per måned">
          {months.map((m) => (
            <div key={m.label} className="flex flex-1 flex-col items-center gap-1">
              <div className="text-[10px] tabular-nums text-muted">{m.self + m.doc > 0 ? pct(Math.round((m.self + m.doc) * 10) / 10) : ""}</div>
              <div className="flex w-full flex-col justify-end" style={{ height: "7rem" }}>
                <div className="w-full rounded-t bg-bad/70" style={{ height: `${(m.doc / maxMonth) * 100}%` }} title={`Legemeldt ${pct(m.doc)}`} />
                <div className={`w-full bg-warn/70 ${m.doc === 0 ? "rounded-t" : ""}`} style={{ height: `${(m.self / maxMonth) * 100}%` }} title={`Egenmeldt ${pct(m.self)}`} />
              </div>
              <div className="text-xs text-muted">{m.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-muted">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-warn/70" /> Egenmeldt</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-bad/70" /> Legemeldt</span>
        </div>
      </section>

      <section className="card overflow-x-auto p-0">
        <h2 className="h2 px-4 pt-4">Per ansatt</h2>
        <table className="mt-2 w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Ansatt</th>
              <th className="px-2 py-2 text-right font-medium">Sykefravær {year}</th>
              <th className="px-2 py-2 text-right font-medium">Egenmelding siste 12 mnd</th>
              <th className="px-2 py-2 text-right font-medium">Legemeldt {year}</th>
              <th className="px-2 py-2 text-right font-medium">Sykt barn {year}</th>
              <th className="px-2 py-2 text-right font-medium">Ferie {vac.currentYear} (brukt / igjen)</th>
              <th className="px-4 py-2 text-right font-medium">Annet fravær</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {active.map((e) => {
              const sc = selfCertification(approved, e.id, today);
              const sick = sickLeavePercent([e], approved, from, to);
              const v = vac.byEmployee.get(e.id)?.[0];
              const warn = sc.periods >= 4 || sc.days >= 12;
              return (
                <tr key={e.id}>
                  <td className="px-4 py-2 font-medium">{e.name}<span className="ml-1 text-xs font-normal text-muted">{e.positionPct} %</span></td>
                  <td className="px-2 py-2 text-right tabular-nums">{pct(sick)}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${warn ? "font-semibold text-bad" : ""}`} title={warn ? "Nær eller over grensen for egenmelding" : undefined}>
                    {sc.periods} {sc.periods === 1 ? "gang" : "ganger"} · {sc.days} d{warn ? " ⚠" : ""}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{absenceWorkdays(approved, e.id, ["sykmelding"], from, to)} d</td>
                  <td className="px-2 py-2 text-right tabular-nums">{absenceWorkdays(approved, e.id, ["sykt_barn"], from, to)} d</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${v && v.remaining < 0 ? "text-bad" : ""}`}>
                    {v ? <Link href={`/ansatte/${e.id}`} className="hover:text-brand">{(v.taken + v.booked).toLocaleString("nb-NO")} / {v.remaining.toLocaleString("nb-NO")}</Link> : "–"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{absenceWorkdays(approved, e.id, ["velferd", "permisjon", "annet", "avspasering"], from, to)} d</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-muted">
          Sykefravær = tapte dagsverk delt på avtalte dagsverk, vektet med stillingsprosent (samme metode som SSB). Hverdager uten helligdager.
          Egenmelding: etter folketrygdloven kan egenmelding brukes opptil 4 ganger på 12 måneder med inntil 3 dager hver gang
          (bedrifter med IA-avtale kan ha andre regler). ⚠ vises ved 4 ganger eller 12 dager. Ansatte: {active.length} · arbeidsdager i perioden: {active[0] ? employedWorkdays({ ...active[0], startDate: from, endDate: null }, from, to) : 0}.
        </p>
      </section>

      <section className="card">
        <h2 className="h2">Kommende fravær (45 dager)</h2>
        {upcoming.length === 0 ? <p className="mt-2 text-sm text-muted">Ingen.</p> : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {upcoming.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b>{name.get(a.employee_id)}</b> · {a.absence_types?.name}: <span className="capitalize">{formatDateLong(a.from_date)}</span>{a.to_date !== a.from_date && <> – <span className="capitalize">{formatDateLong(a.to_date)}</span></>}</span>
                <span className={`badge ${a.status === "approved" ? "bg-good-soft text-good" : "bg-warn-soft text-warn"}`}>{a.status === "approved" ? "Godkjent" : "Venter"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}
