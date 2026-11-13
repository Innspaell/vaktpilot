import Link from "next/link";
import { getContext } from "@/lib/context";
import { colleagues, coverageForDays, shiftsBetween, today, type ShiftRow } from "@/lib/data";
import { addDays, formatDateLong, formatHours, localDate, localTime, workedMinutes, dayBounds } from "@/lib/time";
import { clockState } from "@/lib/clock";
import { ClockButton } from "@/components/ClockButton";
import { SelfEmployeeCard } from "@/components/SelfEmployeeCard";
import { Board } from "@/components/Board";
import { requestOpenShift } from "./vaktplan/actions";
import { VacationLine } from "@/components/VacationOverview";
import { Intro } from "@/components/Intro";
import { ChangePassword } from "@/components/ChangePassword";

export default async function Home() {
  const ctx = await getContext();

  if (!ctx.org) {
    return (
      <div className="card max-w-lg">
        <h1 className="h1">Velkommen</h1>
        {ctx.isPlatformAdmin ? (
          <>
            <p className="mt-2 text-muted">Du er ikke med i noen bedrift ennå. Opprett den første.</p>
            <Link href="/ny-bedrift" className="btn-primary mt-4">Opprett bedrift</Link>
          </>
        ) : (
          <p className="mt-2 text-muted">
            Du er logget inn som {ctx.email}, men er ikke registrert hos noen arbeidsgiver ennå. Be arbeidsgiveren din legge deg inn med denne e-posten, og logg inn på nytt.
          </p>
        )}
      </div>
    );
  }

  const org = ctx as Parameters<typeof today>[0];
  const date = today(org);
  const [names, shifts, clock] = await Promise.all([
    colleagues(org),
    shiftsBetween(org, date, addDays(date, 7)),
    clockState(org),
  ]);
  const coverage = await coverageForDays(org, date, 7, shifts);
  const tz = ctx.org.timezone;

  const todays = shifts.filter((s) => localDate(new Date(s.starts_at), tz) === date && s.employee_id);
  const time = (s: ShiftRow) => `${localTime(new Date(s.starts_at), tz)}–${localTime(new Date(s.ends_at), tz)}`;
  const openShifts = shifts.filter((s) => !s.employee_id && s.status === "published");

  if (ctx.isAdmin) {
    const [{ count: pendingShifts }, { count: pendingAbsence }, { count: pendingTime }, { data: onClock }, { data: absences }] = await Promise.all([
      ctx.supabase.from("shift_requests").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id).eq("status", "pending"),
      ctx.supabase.from("absence_requests").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id).eq("status", "pending"),
      ctx.supabase.from("time_entries").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id).eq("status", "submitted"),
      ctx.supabase.from("time_entries").select("employee_id").eq("org_id", ctx.org.id).is("ends_at", null),
      ctx.supabase.rpc("org_absences", { p_org: ctx.org.id, p_from: date, p_to: date }),
    ]);
    const working = new Set((onClock ?? []).map((r) => r.employee_id));
    const short = coverage.filter((c) => c.gaps.length > 0);
    const todayCov = coverage[0];

    return (
      <div className="space-y-4">
        <header>
          <h1 className="h1 capitalize">{formatDateLong(date)}</h1>
          {todayCov.holiday && <p className="mt-1 text-warn">{todayCov.holiday}</p>}
        </header>

        <Board ctx={org} compact />

        {short.length > 0 ? (
          <section className="card border-bad/30 bg-bad-soft">
            <h2 className="h2 text-bad">Underbemanning de neste 7 dagene</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {short.flatMap((c) =>
                c.gaps.map((g, i) => (
                  <li key={`${c.date}-${i}`} className="flex justify-between gap-2">
                    <span className="capitalize">{formatDateLong(c.date)} {localTime(g.start, tz)}–{localTime(g.end, tz)}</span>
                    <span className="font-semibold text-bad">mangler {g.missing}</span>
                  </li>
                )),
              )}
            </ul>
          </section>
        ) : (
          <section className="card bg-good-soft">
            <p className="text-sm font-medium text-good">Fullt bemannet de neste 7 dagene, ut fra bemanningsbehovet.</p>
          </section>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="Vaktpåmeldinger" value={pendingShifts ?? 0} />
          <Stat label="Fraværssøknader" value={pendingAbsence ?? 0} />
          <Stat label="Timer til godkjenning" value={pendingTime ?? 0} />
        </div>

        <section className="card">
          <div className="flex items-baseline justify-between">
            <h2 className="h2">I dag</h2>
            <span className="text-sm text-muted">
              {todayCov.closed ? "Stengt" : `Behov ${todayCov.peakRequired} · planlagt ${todayCov.peakPlanned}`}
            </span>
          </div>
          {todays.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Ingen vakter i dag.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {todays.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${working.has(s.employee_id) ? "bg-good" : "bg-line"}`} title={working.has(s.employee_id) ? "Stemplet inn" : ""} />
                    {names.get(s.employee_id!) ?? "Ukjent"}
                    {s.status === "draft" && <span className="badge bg-paper text-muted">utkast</span>}
                  </span>
                  <span className="tabular-nums text-muted">{time(s)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="card">
            <h2 className="h2">Fravær i dag</h2>
            {(absences ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted">Ingen.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {(absences as { employee_id: string; type_name: string }[]).map((a) => (
                  <li key={a.employee_id} className="flex justify-between"><span>{names.get(a.employee_id)}</span><span className="text-muted">{a.type_name}</span></li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2 className="h2">Ledige vakter</h2>
            <OpenShifts shifts={openShifts} tz={tz} />
          </section>
        </div>

        {ctx.employeeId ? (clock && <ClockButton state={clock.state} since={clock.since} />) : <SelfEmployeeCard email={ctx.email} />}
      </div>
    );
  }

  // ---------------- Ansatt ----------------
  const mine = shifts.filter((s) => s.employee_id === ctx.employeeId);
  const next = mine.find((s) => new Date(s.ends_at) > new Date());
  const monthStart = date.slice(0, 8) + "01";
  const [{ data: entries }, { data: requests }, { data: notes }, { data: meRow }] = await Promise.all([
    ctx.supabase.from("time_entries").select("starts_at, ends_at, break_minutes").eq("employee_id", ctx.employeeId ?? "")
      .gte("starts_at", dayBounds(monthStart, tz).start.toISOString()).not("ends_at", "is", null),
    ctx.supabase.from("shift_requests").select("id, status, created_at, shift_id").eq("employee_id", ctx.employeeId ?? "").order("created_at", { ascending: false }).limit(3),
    ctx.supabase.from("notifications").select("id, title, created_at").is("read_at", null).order("created_at", { ascending: false }).limit(3),
    ctx.supabase.from("employees").select("full_name, intro_seen_at, must_change_password").eq("id", ctx.employeeId ?? "").maybeSingle(),
  ]);
  const claimed = new Set((requests ?? []).filter((r) => r.status === "pending").map((r) => r.shift_id));
  const monthMinutes = (entries ?? []).reduce((s, e) => s + workedMinutes(new Date(e.starts_at), new Date(e.ends_at!), e.break_minutes), 0);
  const coworkers = next
    ? shifts.filter((s) => s.id !== next.id && s.employee_id && new Date(s.starts_at) < new Date(next.ends_at) && new Date(s.ends_at) > new Date(next.starts_at)).map((s) => names.get(s.employee_id!))
    : [];

  const todaysOwn = mine.find((s) => localDate(new Date(s.starts_at), tz) === date && s.status === "published");
  let unconfirmed = false;
  if (todaysOwn) {
    const { data: te } = await ctx.supabase.from("time_entries").select("id").eq("shift_id", todaysOwn.id).maybeSingle();
    unconfirmed = !te;
  }

  return (
    <div className="space-y-4">
      {meRow?.must_change_password && (
        <section className="card border-brand/30 bg-brand-soft">
          <h2 className="h2">Lag ditt eget passord</h2>
          <p className="mb-3 mt-1 text-sm">Du logget inn med et startpassord fra lederen din. Velg et nytt passord som bare du kjenner.</p>
          <ChangePassword required />
        </section>
      )}
      {meRow && !meRow.intro_seen_at && !meRow.must_change_password && <Intro name={meRow.full_name} />}
      {todaysOwn && unconfirmed && (
        <section className="card flex flex-wrap items-center justify-between gap-3 border-brand/30 bg-brand-soft">
          <div>
            <div className="h2">Dagens vakt: <span className="tabular-nums">{time(todaysOwn)}</span></div>
            <div className="text-sm text-muted">Bekreft når du er ferdig, så registreres timene.</div>
          </div>
          <Link href="/timer#bekreft" className="btn-primary">Bekreft arbeidsdag</Link>
        </section>
      )}
      {clock && <ClockButton state={clock.state} since={clock.since} />}

      <Board ctx={org} compact />

      <section className="card">
        <h2 className="h2">Neste vakt</h2>
        {next ? (
          <>
            <p className="mt-1 text-xl font-semibold capitalize">{formatDateLong(localDate(new Date(next.starts_at), tz))}</p>
            <p className="tabular-nums text-muted">{time(next)}</p>
            {coworkers.length > 0 && <p className="mt-2 text-sm text-muted">Sammen med {coworkers.join(", ")}</p>}
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">Ingen vakter de neste 7 dagene.</p>
        )}
      </section>

      <section className="card">
        <h2 className="h2">Ledige vakter</h2>
        <OpenShifts shifts={openShifts} tz={tz} claim={{ requested: claimed }} />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="h2">De neste 7 dagene</h2>
          {mine.length === 0 ? <p className="mt-2 text-sm text-muted">Ingen vakter.</p> : (
            <ul className="mt-2 space-y-1 text-sm">
              {mine.map((s) => (
                <li key={s.id} className="flex justify-between"><span className="capitalize">{formatDateLong(localDate(new Date(s.starts_at), tz))}</span><span className="tabular-nums text-muted">{time(s)}</span></li>
              ))}
            </ul>
          )}
        </section>
        <div className="space-y-4">
          <Stat label="Registrert denne måneden" value={formatHours(monthMinutes)} />
          <VacationLine ctx={org as Parameters<typeof VacationLine>[0]["ctx"]} />
        </div>
      </div>

      {((requests ?? []).length > 0 || (notes ?? []).length > 0) && (
        <section className="card">
          <h2 className="h2">Beskjeder</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {(notes ?? []).map((n) => <li key={n.id}><a href={`/varsler/${n.id}`} className="hover:text-brand">{n.title}</a></li>)}
            {(requests ?? []).map((r) => (
              <li key={r.id} className="flex justify-between"><span>Vaktpåmelding</span><StatusBadge status={r.status} /></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function OpenShifts({ shifts, tz, claim }: { shifts: ShiftRow[]; tz: string; claim?: { requested: Set<string | null> } }) {
  if (shifts.length === 0) return <p className="mt-2 text-sm text-muted">Ingen ledige vakter.</p>;
  return (
    <ul className="mt-2 space-y-2 text-sm">
      {shifts.slice(0, 5).map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-2">
          <span>
            <span className="block capitalize">{formatDateLong(localDate(new Date(s.starts_at), tz))}</span>
            <span className="tabular-nums text-muted">{localTime(new Date(s.starts_at), tz)}–{localTime(new Date(s.ends_at), tz)}</span>
          </span>
          {claim && (claim.requested.has(s.id)
            ? <span className="badge bg-warn-soft text-warn">Påmeldt</span>
            : <form action={requestOpenShift}><input type="hidden" name="shift_id" value={s.id} /><button className="btn-ghost min-h-10 border-brand/30 text-brand">Jeg kan jobbe</button></form>)}
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending: ["Venter", "bg-warn-soft text-warn"],
    approved: ["Godkjent", "bg-good-soft text-good"],
    rejected: ["Avslått", "bg-bad-soft text-bad"],
    cancelled: ["Trukket", "bg-paper text-muted"],
  };
  const [label, cls] = map[status] ?? [status, "bg-paper text-muted"];
  return <span className={`badge ${cls}`}>{label}</span>;
}
