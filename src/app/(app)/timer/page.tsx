import Link from "next/link";
import { requireOrg } from "@/lib/context";
import { clockState } from "@/lib/clock";
import { colleagues } from "@/lib/data";
import { ClockButton } from "@/components/ClockButton";
import { EntryForm } from "@/components/EntryForm";
import { addDays, dayBounds, formatDateLong, formatHours, localDate, localTime, workedMinutes } from "@/lib/time";
import { approveEntries, confirmShift, deleteEntry } from "./actions";
import { loadPayroll } from "@/lib/payroll-data";
import { loadCompTime } from "@/lib/report-data";

const STATUS: Record<string, [string, string]> = {
  draft: ["Utkast", "bg-paper text-muted"],
  submitted: ["Venter på godkjenning", "bg-brand-soft text-brand"],
  approved: ["Godkjent", "bg-good-soft text-good"],
  locked: ["Låst (eksportert)", "bg-paper text-muted"],
};

type Entry = {
  id: string; employee_id: string; shift_id: string | null; starts_at: string; ends_at: string | null;
  break_minutes: number; status: string; source: string; comment: string | null;
  shifts: { starts_at: string; ends_at: string; break_minutes: number } | null;
};

const SELECT = "id, employee_id, shift_id, starts_at, ends_at, break_minutes, status, source, comment, shifts!time_entries_shift_id_fkey(starts_at, ends_at, break_minutes)";

export default async function TimePage({ searchParams }: { searchParams: Promise<{ vis?: string; fra?: string; til?: string; ansatt?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const tz = ctx.org.timezone;
  const today = localDate(new Date(), tz);
  const tab = ctx.isAdmin && (sp.vis === "alle" || !ctx.employeeId) ? "alle" : "mine";

  const tabs = ctx.isAdmin && ctx.employeeId && (
    <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm">
      <Link href="/timer" className={`rounded-md px-3 py-1.5 font-medium ${tab === "mine" ? "bg-brand text-white" : "text-muted"}`}>Mine timer</Link>
      <Link href="/timer?vis=alle" className={`rounded-md px-3 py-1.5 font-medium ${tab === "alle" ? "bg-brand text-white" : "text-muted"}`}>Alle ansatte</Link>
    </div>
  );

  const fmtTime = (iso: string) => localTime(new Date(iso), tz);
  const timeRange = (a: string, b: string | null) => `${fmtTime(a)}–${b ? fmtTime(b) : "pågår"}`;

  // ---------------------------------------------------------------- Alle ansatte (admin)
  if (tab === "alle") {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.fra ?? "") ? sp.fra! : today.slice(0, 8) + "01";
    const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.til ?? "") ? sp.til! : today;
    let q = ctx.supabase.from("time_entries").select(SELECT).eq("org_id", ctx.org.id)
      .gte("starts_at", dayBounds(from, tz).start.toISOString()).lt("starts_at", dayBounds(addDays(to, 1), tz).start.toISOString())
      .order("starts_at", { ascending: false }).limit(500);
    if (sp.ansatt) q = q.eq("employee_id", sp.ansatt);
    const [{ data }, names] = await Promise.all([q, colleagues(ctx)]);
    const rows = (data ?? []) as unknown as Entry[];
    const people = Array.from(names, ([id, name]) => ({ id, name }));
    const waiting = rows.filter((r) => r.status === "submitted" && r.ends_at);
    const totals = new Map<string, number>();
    for (const r of rows) if (r.ends_at) totals.set(r.employee_id, (totals.get(r.employee_id) ?? 0) + workedMinutes(new Date(r.starts_at), new Date(r.ends_at), r.break_minutes));

    return (
      <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="h1">Timer</h1>{tabs}</header>

        <form className="card grid gap-3 md:grid-cols-4" action="/timer">
          <input type="hidden" name="vis" value="alle" />
          <label className="block"><span className="label">Fra</span><input name="fra" type="date" defaultValue={from} className="input" /></label>
          <label className="block"><span className="label">Til</span><input name="til" type="date" defaultValue={to} className="input" /></label>
          <label className="block"><span className="label">Ansatt</span>
            <select name="ansatt" defaultValue={sp.ansatt ?? ""} className="input">
              <option value="">Alle</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="self-end"><button className="btn-ghost w-full">Vis</button></div>
        </form>

        {totals.size > 0 && (
          <section className="card">
            <h2 className="h2">Sum i perioden</h2>
            <ul className="mt-2 grid gap-1 text-sm md:grid-cols-3">
              {Array.from(totals).sort((a, b) => (names.get(a[0]) ?? "").localeCompare(names.get(b[0]) ?? "", "nb")).map(([id, min]) => (
                <li key={id} className="flex justify-between rounded-lg bg-paper px-3 py-1.5"><span>{names.get(id)}</span><b className="tabular-nums">{formatHours(min)}</b></li>
              ))}
            </ul>
          </section>
        )}

        <details className="card">
          <summary className="h2 cursor-pointer">Registrer timer for en ansatt</summary>
          <p className="mt-1 text-sm text-muted">Timer du registrerer for andre, blir godkjent med en gang.</p>
          <div className="mt-3"><EntryForm date={today} start="08:00" end="16:00" people={people} maxDate={today} /></div>
        </details>

        <section className="card p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
            <h2 className="h2">Registreringer</h2>
            {waiting.length > 0 && (
              <form id="godkjenn" action={approveEntries}>
                <button className="btn-primary">Godkjenn valgte ({waiting.length})</button>
              </form>
            )}
          </div>
          {rows.length === 0 ? <p className="p-4 text-sm text-muted">Ingen timer i perioden.</p> : (
            <ul className="mt-2 divide-y divide-line">
              {rows.map((r) => <AdminRow key={r.id} r={r} name={names.get(r.employee_id) ?? "Ukjent"} tz={tz} today={today} />)}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // ---------------------------------------------------------------- Mine timer
  if (!ctx.employeeId) {
    return <div className="space-y-4"><h1 className="h1">Timer</h1><p className="card text-sm text-muted">Du er ikke registrert som ansatt i denne bedriften.</p></div>;
  }

  const since = addDays(today, -14);
  const [clock, { data: entriesData }, { data: shiftsData }] = await Promise.all([
    clockState(ctx),
    ctx.supabase.from("time_entries").select(SELECT).eq("employee_id", ctx.employeeId).order("starts_at", { ascending: false }).limit(40),
    ctx.supabase.from("shifts").select("id, starts_at, ends_at, break_minutes").eq("employee_id", ctx.employeeId).eq("status", "published")
      .gte("starts_at", dayBounds(since, tz).start.toISOString()).lt("starts_at", dayBounds(addDays(today, 1), tz).start.toISOString())
      .order("starts_at"),
  ]);
  const entries = (entriesData ?? []) as unknown as Entry[];
  const [monthPay, yearPay, comp] = await Promise.all([
    loadPayroll(ctx, today.slice(0, 8) + "01", today, ctx.employeeId),
    loadPayroll(ctx, today.slice(0, 5) + "01-01", today, ctx.employeeId),
    loadCompTime(ctx, ctx.employeeId),
  ]);
  const cb = comp.balances.get(ctx.employeeId);
  const mb = monthPay.balances.get(ctx.employeeId);
  const yb = yearPay.balances.get(ctx.employeeId);
  const registered = new Set(entries.map((e) => e.shift_id).filter(Boolean));
  // Bare vakter som har startet kan bekreftes
  const toConfirm = (shiftsData ?? []).filter((s) => !registered.has(s.id) && new Date(s.starts_at) <= new Date());
  const monthStart = today.slice(0, 8) + "01";
  const monthMinutes = entries
    .filter((e) => e.ends_at && localDate(new Date(e.starts_at), tz) >= monthStart)
    .reduce((s, e) => s + workedMinutes(new Date(e.starts_at), new Date(e.ends_at!), e.break_minutes), 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="h1">Timer</h1>{tabs}</header>

      {mb && yb && (
        <section className="card">
          <h2 className="h2">Timesaldo</h2>
          <p className="mt-1 text-xs text-muted">Avtalt tid fram til i dag, mot timer du har registrert pluss betalt fravær. Helligdager er trukket fra.</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {([["Denne måneden", mb], ["Hittil i år", yb]] as const).map(([t, b]) => (
              <div key={t} className="rounded-lg bg-paper p-3">
                <div className="text-xs text-muted">{t}</div>
                <div className={`text-2xl font-bold tabular-nums ${b.diffHours < -0.01 ? "text-warn" : b.diffHours > 0.01 ? "text-brand" : "text-good"}`}>
                  {b.diffHours > 0 ? "+" : ""}{b.diffHours.toLocaleString("nb-NO")} t
                </div>
                <div className="text-xs text-muted tabular-nums">
                  {(b.workedHours + b.paidAbsenceHours).toLocaleString("nb-NO")} av {b.expectedHours.toLocaleString("nb-NO")} t
                </div>
              </div>
            ))}
          </div>
          {cb && (cb.earned > 0 || cb.used > 0) && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
              <span>Avspasering <span className="text-xs text-muted">(opptjent {cb.earned.toLocaleString("nb-NO")} t, tatt ut {cb.used.toLocaleString("nb-NO")} t)</span></span>
              <b className={`tabular-nums ${cb.balance < -0.01 ? "text-warn" : ""}`}>{cb.balance.toLocaleString("nb-NO")} t</b>
            </div>
          )}
        </section>
      )}

      {toConfirm.length > 0 && (
        <section id="bekreft" className="card border-brand/30">
          <h2 className="h2">Bekreft arbeidsdag</h2>
          <p className="mt-1 text-sm text-muted">Timene registreres lik det som var planlagt. Jobbet du annerledes, endrer du før du bekrefter, eller retter etterpå til lederen har godkjent.</p>
          <ul className="mt-3 space-y-3">
            {toConfirm.map((s) => {
              const st = new Date(s.starts_at);
              const date = localDate(st, tz);
              return (
                <li key={s.id} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium capitalize">{date === today ? "I dag" : formatDateLong(date)}</div>
                      <div className="text-sm tabular-nums text-muted">
                        {timeRange(s.starts_at, s.ends_at)} · pause {s.break_minutes} min · {formatHours(workedMinutes(st, new Date(s.ends_at), s.break_minutes))}
                      </div>
                    </div>
                    <form action={confirmShift}>
                      <input type="hidden" name="shift_id" value={s.id} />
                      <button className="btn-primary">Bekreft som planlagt</button>
                    </form>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-semibold text-brand">Jobbet annerledes? Endre og bekreft</summary>
                    <div className="mt-2">
                      <EntryForm shiftId={s.id} date={date} start={fmtTime(s.starts_at)} end={fmtTime(s.ends_at)} breakMinutes={s.break_minutes} maxDate={today} submitLabel="Bekreft med endringer" />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {clock && <ClockButton state={clock.state} since={clock.since} />}

      <details className="card">
        <summary className="h2 cursor-pointer">Registrer timer manuelt</summary>
        <p className="mt-1 text-sm text-muted">For dager uten vakt i planen, eller hvis du glemte å stemple.</p>
        <div className="mt-3"><EntryForm date={today} start="08:00" end="16:00" maxDate={today} /></div>
      </details>

      <section className="card p-0">
        <div className="flex items-baseline justify-between px-4 pt-4">
          <h2 className="h2">Mine registreringer</h2>
          <span className="text-sm text-muted">Denne måneden: <b className="tabular-nums text-ink">{formatHours(monthMinutes)}</b></span>
        </div>
        {entries.length === 0 ? <p className="p-4 text-sm text-muted">Ingen timer registrert ennå.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {entries.map((e) => {
              const [label, cls] = STATUS[e.status];
              const date = localDate(new Date(e.starts_at), tz);
              const editable = e.ends_at && (e.status === "draft" || e.status === "submitted");
              return (
                <li key={e.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium capitalize">{formatDateLong(date)}</div>
                      <div className="tabular-nums text-muted">
                        {timeRange(e.starts_at, e.ends_at)}{e.break_minutes > 0 && ` · pause ${e.break_minutes} min`}
                        {e.shifts && <PlanDiff e={e} tz={tz} />}
                      </div>
                      {e.comment && <div className="text-muted">«{e.comment}»</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      {e.ends_at && <span className="tabular-nums font-medium">{formatHours(workedMinutes(new Date(e.starts_at), new Date(e.ends_at), e.break_minutes))}</span>}
                      <span className={`badge ${cls}`}>{label}</span>
                    </div>
                  </div>
                  {editable && (
                    <details className="mt-2">
                      <summary className="cursor-pointer font-semibold text-brand">Rett</summary>
                      <div className="mt-2 space-y-2">
                        <EntryForm id={e.id} date={date} start={fmtTime(e.starts_at)} end={fmtTime(e.ends_at!)} breakMinutes={e.break_minutes} comment={e.comment} maxDate={today} />
                        <form action={deleteEntry}><input type="hidden" name="id" value={e.id} /><button className="text-sm text-bad">Slett registreringen</button></form>
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function PlanDiff({ e, tz }: { e: Entry; tz: string }) {
  if (!e.shifts || !e.ends_at) return null;
  const planned = workedMinutes(new Date(e.shifts.starts_at), new Date(e.shifts.ends_at), e.shifts.break_minutes);
  const actual = workedMinutes(new Date(e.starts_at), new Date(e.ends_at), e.break_minutes);
  const diff = actual - planned;
  if (diff === 0) return <span className="text-good"> · som planlagt</span>;
  return (
    <span className={diff > 0 ? "text-warn" : "text-muted"}>
      {" "}· planlagt {localTime(new Date(e.shifts.starts_at), tz)}–{localTime(new Date(e.shifts.ends_at), tz)} ({diff > 0 ? "+" : "−"}{formatHours(Math.abs(diff))})
    </span>
  );
}

function AdminRow({ r, name, tz, today }: { r: Entry; name: string; tz: string; today: string }) {
  const [label, cls] = STATUS[r.status];
  const date = localDate(new Date(r.starts_at), tz);
  const t = (iso: string) => localTime(new Date(iso), tz);
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-w-0 items-start gap-3">
          {r.status === "submitted" && r.ends_at
            ? <input type="checkbox" name="ids" value={r.id} form="godkjenn" defaultChecked className="mt-1 h-4 w-4" />
            : <span className="w-4" />}
          <span>
            <span className="font-medium">{name}</span> · <span className="capitalize">{formatDateLong(date)}</span>
            <span className="block tabular-nums text-muted">
              {t(r.starts_at)}–{r.ends_at ? t(r.ends_at) : "pågår"}{r.break_minutes > 0 && ` · pause ${r.break_minutes} min`}
              {r.shifts && <PlanDiff e={r} tz={tz} />}
              {r.source === "clock" && " · stemplet"}
            </span>
            {r.comment && <span className="block text-muted">«{r.comment}»</span>}
          </span>
        </label>
        <div className="flex items-center gap-2">
          {r.ends_at && <span className="tabular-nums font-medium">{formatHours(workedMinutes(new Date(r.starts_at), new Date(r.ends_at), r.break_minutes))}</span>}
          <span className={`badge ${cls}`}>{label}</span>
        </div>
      </div>
      {r.ends_at && r.status !== "locked" && (
        <details className="ml-7 mt-2">
          <summary className="cursor-pointer font-semibold text-brand">Rett</summary>
          <div className="mt-2">
            <EntryForm id={r.id} date={date} start={t(r.starts_at)} end={t(r.ends_at)} breakMinutes={r.break_minutes} comment={r.comment} maxDate={today} />
          </div>
        </details>
      )}
    </li>
  );
}
