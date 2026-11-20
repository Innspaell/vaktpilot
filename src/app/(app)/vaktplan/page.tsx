import Link from "next/link";
import { cookies } from "next/headers";
import { RememberView } from "@/components/RememberView";
import { requireOrg } from "@/lib/context";
import { colleagues, coverageForDays, shiftsBetween, today, type ShiftRow } from "@/lib/data";
import { DepartmentPills } from "@/components/DepartmentPills";
import { loadDepartments, selectedDepartment, shiftInDepartment } from "@/lib/departments";
import { addDays, dayBounds, formatHours, isoWeekday, localDate, localTime, workedMinutes } from "@/lib/time";
import { groupByRole, primaryRoles, shortName, shortTime, type RosterRole } from "@/lib/roster";
import { ActionForm, Field } from "@/components/Form";
import { proposeShift, requestOpenShift } from "./actions";

type View = "mine" | "dag" | "uke" | "maned";
const VIEWS: View[] = ["mine", "dag", "uke", "maned"];

const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const WD = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];

function mondayOf(date: string) {
  return addDays(date, 1 - isoWeekday(date));
}
function weekNumber(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - start.getTime()) / 86400000 + 1) / 7);
}
function dayLabel(date: string) {
  return `${WD[isoWeekday(date) - 1]} ${Number(date.slice(8))}.`;
}
function dayLabelLong(date: string) {
  return `${WD[isoWeekday(date) - 1]} ${Number(date.slice(8))}. ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ dato?: string; visning?: View; vis?: string; vakt?: string; avdeling?: string; valgt?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const tz = ctx.org.timezone;
  const now = today(ctx);
  // Lenke fra varsel: /vaktplan?vakt=<id> åpner uka der vakta ligger
  let focusShift: string | null = null;
  if (sp.vakt && /^[0-9a-f-]{36}$/i.test(sp.vakt) && !sp.dato) {
    const { data: fs } = await ctx.supabase.from("shifts").select("id, starts_at").eq("id", sp.vakt).maybeSingle();
    if (fs) { sp.dato = localDate(new Date(fs.starts_at), tz); focusShift = fs.id; }
  }
  // Visningen: fra adressen, ellers den brukeren valgte sist, ellers «Mine vakter» for ansatte og «Uke» for ledere
  const remembered = (await cookies()).get("vp_vaktplan")?.value as View | undefined;
  const pick = (v?: string): View | null => (v && VIEWS.includes(v as View) && (v !== "mine" || ctx.employeeId) ? (v as View) : null);
  const view: View = pick(sp.visning) ?? (sp.vakt ? "uke" : null) ?? pick(remembered) ?? (ctx.employeeId && !ctx.canPlan ? "mine" : "uke");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.dato ?? "") ? sp.dato! : now;

  let from: string;
  let days: number;
  if (view === "dag") {
    from = anchor;
    days = 1;
  } else if (view === "mine") {
    from = anchor;
    days = 35;
  } else if (view === "uke") {
    from = mondayOf(anchor);
    days = 7;
  } else {
    const first = anchor.slice(0, 8) + "01";
    from = mondayOf(first);
    const next = addDays(first, 32).slice(0, 8) + "01";
    days = 0;
    while (addDays(from, days) < next || isoWeekday(addDays(from, days)) !== 1) days++;
  }
  const to = addDays(from, days - 1);

  const deps = await loadDepartments(ctx);
  const dep = selectedDepartment(sp.avdeling, deps);
  const [names, orgShifts, rolesRes, linksRes, absRes, reqRes] = await Promise.all([
    colleagues(ctx),
    shiftsBetween(ctx, from, addDays(from, days)),
    ctx.supabase.from("work_roles").select("id, name, color, sort_order").eq("org_id", ctx.org.id),
    ctx.supabase.from("employee_work_roles").select("employee_id, work_role_id").eq("org_id", ctx.org.id),
    ctx.supabase.rpc("org_absences", { p_org: ctx.org.id, p_from: from, p_to: to }),
    ctx.employeeId
      ? ctx.supabase.from("shift_requests").select("shift_id").eq("employee_id", ctx.employeeId).eq("status", "pending")
      : Promise.resolve({ data: [] as { shift_id: string | null }[] }),
  ]);
  // Avdeling valgt: bare vaktene der (alle ansatte kan se hele planen)
  const allShifts = dep ? orgShifts.filter((s) => shiftInDepartment(s, dep, deps)) : orgShifts;
  const coverage = await coverageForDays(ctx, from, days, allShifts, dep);
  const roles = (rolesRes.data ?? []) as RosterRole[];
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const primary = primaryRoles(roles, linksRes.data ?? []);
  const requested = new Set((reqRes.data ?? []).map((r) => r.shift_id));
  type Abs = { employee_id: string; from_date: string; to_date: string; type_name: string };
  const allAbsences = (absRes.data ?? []) as Abs[];

  const mine = false;
  // Ansatte ser bare publiserte vakter; utkast vises for administrator
  const visible = allShifts.filter((s) => s.status === "published" || ctx.canPlan);
  const shifts = mine ? visible.filter((s) => s.employee_id === ctx.employeeId) : visible;
  const absences = mine ? allAbsences.filter((a) => a.employee_id === ctx.employeeId) : allAbsences;
  const openShifts = visible.filter((s) => !s.employee_id && s.status === "published");

  const roleOf = (s: ShiftRow) => s.work_role_id ?? (s.employee_id ? primary.get(s.employee_id) ?? null : null);
  const dateOf = (s: ShiftRow) => localDate(new Date(s.starts_at), tz);
  const awayOn = (d: string) => absences.filter((a) => a.from_date <= d && a.to_date >= d);
  const name = (id: string | null) => (id ? names.get(id) ?? "Ukjent" : "Ledig");

  // Navigasjon
  const step = view === "dag" ? 1 : view === "uke" ? 7 : view === "mine" ? 35 : 0;
  const prev = step ? addDays(anchor, -step) : addDays(anchor.slice(0, 8) + "01", -1);
  const next = step ? addDays(anchor, step) : addDays(anchor.slice(0, 8) + "01", 32);
  const href = (p: { d?: string; v?: View; a?: string | null }) =>
    `/vaktplan?visning=${p.v ?? view}&dato=${p.d ?? anchor}${(p.a === undefined ? dep : p.a) ? `&avdeling=${p.a === undefined ? dep : p.a}` : ""}`;
  // Admin trykker på en vakt for å sette personen fraværende eller endre vakten
  const shiftLink = ctx.canPlan ? (s: ShiftRow) => `/vaktplan/vakt/${s.id}?tilbake=${encodeURIComponent(href({}))}` : undefined;
  const title =
    view === "dag" ? (anchor === now ? `I dag, ${dayLabelLong(anchor)}` : dayLabelLong(anchor))
      : view === "mine" ? (anchor === now ? "Mine vakter" : `Mine vakter fra ${dayLabelLong(anchor)}`)
      : view === "uke" ? `Uke ${weekNumber(from)}`
      : `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;
  const subtitle = view === "uke" ? `${dayLabelLong(from)} – ${dayLabelLong(to)}` : null;

  const myMinutes = ctx.employeeId
    ? visible.filter((s) => s.employee_id === ctx.employeeId && (view !== "maned" || dateOf(s).slice(0, 7) === anchor.slice(0, 7)))
        .reduce((m, s) => m + workedMinutes(new Date(s.starts_at), new Date(s.ends_at), s.break_minutes), 0)
    : 0;

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href={href({ d: prev })} className="btn-ghost px-3" aria-label="Forrige">‹</Link>
            <div>
              <h1 className="h1 capitalize leading-tight">{title}</h1>
              {subtitle && <div className="text-sm capitalize text-muted">{subtitle}</div>}
            </div>
            <Link href={href({ d: next })} className="btn-ghost px-3" aria-label="Neste">›</Link>
            {anchor !== now && <Link href={href({ d: now })} className="text-sm font-medium text-brand">I dag</Link>}
          </div>
          {ctx.canPlan && <Link href={`/vaktplan/rediger?visning=${view === "maned" || view === "mine" ? "uke" : view}&dato=${anchor}${dep ? `&avdeling=${dep}` : ""}`} className="btn-primary">Rediger plan</Link>}
        </div>
        {deps.departments.length > 0 && view !== "mine" && (
          <DepartmentPills departments={deps.departments} selected={dep} hrefFor={(id) => href({ a: id })} />
        )}
        <RememberView view={view} />
        <nav aria-label="Visning" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
          {([...(ctx.employeeId ? [["mine", "Mine vakter", ""]] : []), ["dag", "Hvem jobber", ""], ["uke", "Uke", "hidden md:flex"], ["maned", "Måned", ""]] as [View, string, string][]).map(([v, label, cls]) => (
            <Link key={v} href={href({ v, d: v === "mine" || v === "dag" ? now : anchor })} aria-current={v === view ? "page" : undefined}
              className={`${cls || "flex"} min-h-11 shrink-0 items-center border-b-[3px] px-3 text-sm font-semibold ${v === view ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>
              {label}
            </Link>
          ))}
          {ctx.employeeId && view !== "mine" && (
            <span className="ml-auto hidden items-center text-sm text-muted md:flex">
              Dine timer {view === "dag" ? "denne dagen" : view === "uke" ? "denne uka" : "denne måneden"}: <b className="ml-1 text-ink">{formatHours(myMinutes)}</b>
            </span>
          )}
        </nav>
      </header>

      {/* ---------------- MINE VAKTER ---------------- */}
      {view === "mine" && ctx.employeeId && (
        <AgendaView me={ctx.employeeId} from={from} days={days} now={now} tz={tz} shifts={visible} absences={allAbsences}
          openShifts={openShifts} requested={requested} roleName={(s) => roleById.get(roleOf(s) ?? "")?.name ?? null} name={name}
          calendarHref="/profil#kalender" />
      )}

      {/* ---------------- DAG ---------------- */}
      {view === "dag" && (
        <DayView linkFor={shiftLink} date={anchor} shifts={shifts.filter((s) => dateOf(s) === anchor)} away={awayOn(anchor)}
          cov={coverage[0]} roles={roles} roleOf={roleOf} name={name} tz={tz} isAdmin={ctx.canPlan}
          canClaim={!ctx.canPlan && Boolean(ctx.employeeId)} requested={requested} me={ctx.employeeId} isToday={anchor === now} />
      )}

      {/* ---------------- UKE ---------------- */}
      {view === "uke" && (
        <>
          {/* Tabell på PC, samme oppsett som i Planlegge: ansatte i rader, dager i kolonner */}
          {!mine && (() => {
            const cols = { gridTemplateColumns: `200px repeat(${coverage.length}, minmax(0, 1fr))` };
            // Alle med vakt eller fravær denne uka, pluss resten av kollegaene (uten avdelingsfilter)
            const ids = new Set([...shifts.filter((s) => s.employee_id).map((s) => s.employee_id!), ...absences.map((a) => a.employee_id)]);
            if (!dep) for (const id of names.keys()) ids.add(id);
            const people = Array.from(ids).map((id) => ({ id, n: name(id) })).sort((a, b) => a.n.localeCompare(b.n, "nb"));
            const hoursOf = (id: string) => shifts.filter((s) => s.employee_id === id)
              .reduce((m, s) => m + workedMinutes(new Date(s.starts_at), new Date(s.ends_at), s.break_minutes), 0);
            return (
              <section className="card hidden overflow-x-auto p-0 md:block">
                <div className="min-w-[60rem]">
                  <div className="grid border-b border-line bg-paper text-xs font-semibold text-muted" style={cols}>
                    <div className="px-3 py-2">Ansatt</div>
                    {coverage.map((c) => (
                      <div key={c.date} className={`border-l border-line px-2 py-2 ${c.date === now ? "text-brand" : ""}`}>
                        <span className="capitalize">{dayLabel(c.date)}</span>
                        {c.holiday && <span className="block font-normal text-warn">{c.holiday}</span>}
                      </div>
                    ))}
                  </div>
                  {ctx.canPlan && (
                    <div className="grid border-b border-line text-xs" style={cols}>
                      <div className="px-3 py-2 font-semibold text-muted">Mangler</div>
                      {coverage.map((c) => (
                        <div key={c.date} className="flex flex-col gap-1 border-l border-line p-1.5">
                          {c.closed ? <span className="text-muted">Stengt</span>
                            : c.gaps.length ? c.gaps.map((g, i) => <span key={i} className="badge bg-bad-soft text-bad">{g.missing} · {localTime(g.start, tz)}–{localTime(g.end, tz)}</span>)
                            : c.peakRequired > 0 ? <span className="font-semibold text-good">Fullt</span>
                            : <span className="text-muted">Ingen behov</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {people.map((p) => (
                    <div key={p.id} className={`grid border-b border-line ${p.id === ctx.employeeId ? "bg-brand-soft/40" : ""}`} style={cols}>
                      <div className="px-3 py-2.5">
                        <div className="text-sm font-semibold">{p.n}{p.id === ctx.employeeId && <span className="ml-1.5 text-xs font-normal text-brand">deg</span>}</div>
                        <div className="text-xs text-muted">{formatHours(hoursOf(p.id))} denne uka</div>
                      </div>
                      {coverage.map((c) => {
                        const day = shifts.filter((s) => s.employee_id === p.id && dateOf(s) === c.date);
                        const off = absences.find((a) => a.employee_id === p.id && a.from_date <= c.date && a.to_date >= c.date);
                        return (
                          <div key={c.date} className={`flex min-h-16 flex-col gap-1 border-l border-line p-1.5 text-xs ${c.date === now ? "bg-paper/60" : ""}`}>
                            {off && <span className="badge bg-warn-soft text-warn">{off.type_name}</span>}
                            {day.map((s) => <ShiftChip key={s.id} s={s} tz={tz} role={roleById.get(roleOf(s) ?? "")} href={shiftLink?.(s)} />)}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {openShifts.length > 0 && (
                    <div className="grid" style={cols}>
                      <div className="px-3 py-2.5">
                        <div className="text-sm font-semibold">Ledige vakter</div>
                        {!ctx.canPlan && ctx.employeeId && <div className="text-xs text-muted">Meld deg på det du kan ta</div>}
                      </div>
                      {coverage.map((c) => (
                        <div key={c.date} className="flex min-h-12 flex-col gap-1 border-l border-line bg-brand-soft/40 p-1.5">
                          {openShifts.filter((s) => dateOf(s) === c.date).map((s) => (
                            <OpenShift key={s.id} s={s} tz={tz} canClaim={!ctx.canPlan && Boolean(ctx.employeeId)} requested={requested.has(s.id)} compact />
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {people.length === 0 && <p className="p-4 text-sm text-muted">Ingen vakter denne uka.</p>}
              </section>
            );
          })()}

          {/* Liste per dag: mobil, og «bare mine» */}
          <div className={`space-y-3 ${mine ? "" : "md:hidden"}`}>
            {coverage.map((c) => {
              const day = shifts.filter((s) => dateOf(s) === c.date);
              const away = awayOn(c.date);
              const open = openShifts.filter((s) => dateOf(s) === c.date);
              const isToday = c.date === now;
              if (mine && day.length === 0 && away.length === 0 && open.length === 0) {
                return (
                  <div key={c.date} className="flex items-center justify-between px-1 text-sm text-muted">
                    <span className="capitalize">{dayLabelLong(c.date)}</span>
                    <span>{c.holiday ?? (c.closed ? "Stengt" : "Fri")}</span>
                  </div>
                );
              }
              return (
                <section key={c.date} className={`card ${isToday ? "ring-2 ring-brand/40" : ""}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="h2 capitalize">{dayLabelLong(c.date)}{isToday && <span className="ml-2 text-xs font-semibold uppercase text-brand">i dag</span>}</h2>
                    {c.holiday ? <span className="text-xs text-warn">{c.holiday}</span> : c.closed ? <span className="text-xs text-muted">Stengt</span> : null}
                  </div>
                  <GroupedList shifts={day} roles={roles} roleOf={roleOf} name={name} tz={tz} highlight={ctx.employeeId} linkFor={shiftLink} focus={focusShift} />
                  {away.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {away.map((a) => <span key={a.employee_id + a.from_date} className="badge bg-warn-soft text-warn">{mine ? a.type_name : `${shortName(name(a.employee_id))}: ${a.type_name.toLowerCase()}`}</span>)}
                    </div>
                  )}
                  {open.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {open.map((s) => <OpenShift key={s.id} s={s} tz={tz} canClaim={!ctx.canPlan && Boolean(ctx.employeeId)} requested={requested.has(s.id)} />)}
                    </div>
                  )}
                  {day.length === 0 && away.length === 0 && open.length === 0 && <p className="mt-1 text-sm text-muted">Ingen vakter.</p>}
                </section>
              );
            })}
          </div>
        </>
      )}

      {/* ---------------- MÅNED ---------------- */}
      {view === "maned" && (
        <>
          <section className="card hidden p-2 md:block">
            <div className="grid grid-cols-7 text-center text-xs font-semibold uppercase text-muted">
              {WD.map((d) => <div key={d} className="py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {coverage.map((c) => {
                const inMonth = c.date.slice(0, 7) === anchor.slice(0, 7);
                const day = shifts.filter((s) => dateOf(s) === c.date).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
                const away = awayOn(c.date);
                return (
                  <Link key={c.date} href={href({ d: c.date, v: "dag" })}
                    className={`min-h-24 rounded-lg border p-1.5 text-left text-xs ${inMonth ? "bg-white" : "bg-paper text-muted"} ${c.date === now ? "border-brand ring-1 ring-brand" : "border-line"} hover:border-brand`}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold">{Number(c.date.slice(8))}</span>
                      {!mine && c.gaps.length > 0 && <span className="h-2 w-2 rounded-full bg-bad" title="Underbemanning" />}
                    </div>
                    {c.holiday && <div className="truncate text-warn">{c.holiday}</div>}
                    {day.slice(0, 4).map((s) => (
                      <div key={s.id} className={`truncate ${s.status === "draft" ? "italic text-muted" : ""}`}>
                        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: roleById.get(roleOf(s) ?? "")?.color ?? "#94a3b8" }} />
                        {mine ? shortTime(new Date(s.starts_at), new Date(s.ends_at), tz) : `${shortName(name(s.employee_id)).split(" ")[0]} ${shortTime(new Date(s.starts_at), new Date(s.ends_at), tz)}`}
                      </div>
                    ))}
                    {day.length > 4 && <div className="text-muted">+{day.length - 4} til</div>}
                    {away.slice(0, 2).map((a) => <div key={a.employee_id} className="truncate text-warn">{mine ? a.type_name : `${shortName(name(a.employee_id)).split(" ")[0]}: ${a.type_name.toLowerCase()}`}</div>)}
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Mobil: måned med prikker, og dagen du trykker på under */}
          {(() => {
            const sel = sp.valgt && /^\d{4}-\d{2}-\d{2}$/.test(sp.valgt) ? sp.valgt : anchor.slice(0, 7) === now.slice(0, 7) ? now : anchor.slice(0, 8) + "01";
            const meOn = (d: string) => ctx.employeeId ? shifts.some((s) => s.employee_id === ctx.employeeId && dateOf(s) === d) : shifts.some((s) => s.employee_id && dateOf(s) === d);
            const offOn = (d: string) => Boolean(ctx.employeeId && absences.some((a) => a.employee_id === ctx.employeeId && a.from_date <= d && a.to_date >= d));
            const openOn = (d: string) => openShifts.some((s) => dateOf(s) === d);
            const myCount = coverage.filter((c) => c.date.slice(0, 7) === anchor.slice(0, 7) && meOn(c.date)).length;
            const day = shifts.filter((s) => s.employee_id && dateOf(s) === sel)
              .sort((a, b) => (a.employee_id === ctx.employeeId ? -1 : b.employee_id === ctx.employeeId ? 1 : a.starts_at.localeCompare(b.starts_at)));
            const away = awayOn(sel);
            const open = openShifts.filter((s) => dateOf(s) === sel);
            return (
              <div className="space-y-3 md:hidden">
                <section className="card p-3">
                  <p className="pb-2 text-center text-sm text-muted">{ctx.employeeId ? `${myCount} ${myCount === 1 ? "vakt" : "vakter"} på deg denne måneden` : "Dager med vakter er merket"}</p>
                  <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-muted">
                    {["M", "T", "O", "T", "F", "L", "S"].map((d, i) => <div key={i} className="py-1">{d}</div>)}
                  </div>
                  <div className="grid grid-cols-7 gap-y-1">
                    {coverage.map((c) => {
                      const inMonth = c.date.slice(0, 7) === anchor.slice(0, 7);
                      if (!inMonth) return <div key={c.date} />;
                      const isSel = c.date === sel;
                      const dot = meOn(c.date) ? "bg-brand" : offOn(c.date) ? "bg-warn" : openOn(c.date) ? "bg-good" : "bg-transparent";
                      return (
                        <Link key={c.date} href={`${href({})}&valgt=${c.date}`} scroll={false} aria-label={dayLabelLong(c.date)} aria-current={isSel ? "date" : undefined}
                          className="flex h-12 flex-col items-center justify-center gap-1">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[15px] ${isSel ? "bg-brand font-bold text-white" : c.date === now ? "font-bold text-brand ring-2 ring-brand" : c.date < now ? "text-muted" : ""}`}>
                            {Number(c.date.slice(8))}
                          </span>
                          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                        </Link>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2 text-[11px] text-muted">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand" />{ctx.employeeId ? "Du jobber" : "Vakter"}</span>
                    {ctx.employeeId && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warn" />Fri/ferie</span>}
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-good" />Ledig vakt</span>
                  </div>
                </section>
                <section className="space-y-2">
                  <h2 className="h2 px-1 capitalize">{dayLabelLong(sel)}{c0(coverage, sel)?.holiday ? ` · ${c0(coverage, sel)!.holiday}` : ""}</h2>
                  <div className="card divide-y divide-line p-0 text-sm">
                    {day.map((s) => {
                      const meRow = s.employee_id === ctx.employeeId;
                      const role = roleById.get(roleOf(s) ?? "")?.name;
                      return (
                        <div key={s.id} className={`flex justify-between gap-3 px-3 py-2.5 ${meRow ? "bg-brand-soft" : ""}`}>
                          <span className={meRow ? "font-bold text-brand" : ""}>{meRow ? "Du" : shortName(name(s.employee_id))}{role && <span className="font-normal text-muted"> · {role}</span>}</span>
                          <span className="tabular-nums text-muted">{shortTime(new Date(s.starts_at), new Date(s.ends_at), tz)}</span>
                        </div>
                      );
                    })}
                    {away.map((a) => <div key={a.employee_id} className="px-3 py-2.5 text-warn">{a.employee_id === ctx.employeeId ? "Du" : shortName(name(a.employee_id))}: {a.type_name.toLowerCase()}</div>)}
                    {open.map((s) => <div key={s.id} className="px-3 py-2"><OpenShift s={s} tz={tz} canClaim={!ctx.canPlan && Boolean(ctx.employeeId)} requested={requested.has(s.id)} /></div>)}
                    {day.length === 0 && away.length === 0 && open.length === 0 && <p className="px-3 py-2.5 text-muted">Ingen vakter denne dagen.</p>}
                  </div>
                  <Link href={href({ v: "dag", d: sel })} className="block px-1 text-sm font-semibold text-brand">Se dagen som tidslinje</Link>
                </section>
              </div>
            );
          })()}
        </>
      )}

      {!ctx.canPlan && ctx.employeeId && (
        <details className="card">
          <summary className="h2 cursor-pointer">Tilby deg en dag</summary>
          <p className="mt-1 text-sm text-muted">Si hvilken dag og når du kan jobbe. Lederen godkjenner og setter deg opp.</p>
          <ActionForm action={proposeShift} submitLabel="Send forespørsel" className="mt-3 grid gap-3 md:grid-cols-4">
            <Field label="Dato"><input name="date" type="date" required min={now} defaultValue={anchor < now ? now : anchor} className="input" /></Field>
            <Field label="Fra"><input name="start" type="time" required defaultValue="08:00" className="input" /></Field>
            <Field label="Til"><input name="end" type="time" required defaultValue="16:00" className="input" /></Field>
            <Field label="Kommentar"><input name="comment" className="input" /></Field>
          </ActionForm>
        </details>
      )}
    </div>
  );
}

// ---------------- Deler ----------------

function c0<T extends { date: string }>(list: T[], date: string) {
  return list.find((c) => c.date === date);
}

/** «Mine vakter»: egne vakter, fri og ledige vakter fremover, uke for uke, med hvem du jobber med og når. */
function AgendaView({ me, from, days, now, tz, shifts, absences, openShifts, requested, roleName, name, calendarHref }: {
  me: string; from: string; days: number; now: string; tz: string; shifts: ShiftRow[];
  absences: { employee_id: string; from_date: string; to_date: string; type_name: string }[];
  openShifts: ShiftRow[]; requested: Set<string | null>; roleName: (s: ShiftRow) => string | null; name: (id: string | null) => string; calendarHref: string;
}) {
  const dateOf = (s: ShiftRow) => localDate(new Date(s.starts_at), tz);
  const t = (s: ShiftRow) => shortTime(new Date(s.starts_at), new Date(s.ends_at), tz);
  const first = (id: string | null) => name(id).split(" ")[0];
  const mineAll = shifts.filter((s) => s.employee_id === me && s.status === "published").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nowMs = Date.now();
  const next = mineAll.find((s) => new Date(s.ends_at).getTime() > nowMs);
  const withWhom = (s: ShiftRow) => {
    const others = shifts.filter((o) => o.employee_id && o.employee_id !== me && o.status === "published" && dateOf(o) === dateOf(s))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return others.length ? `Med ${others.map((o) => `${first(o.employee_id)} ${t(o)}`).join(" · ")}` : "Alene på jobb";
  };
  const untilNext = (s: ShiftRow) => {
    const ms = new Date(s.starts_at).getTime() - nowMs;
    if (ms <= 0) return "pågår nå";
    const h = Math.floor(ms / 3600000);
    return h < 1 ? `om ${Math.max(1, Math.round(ms / 60000))} min` : h < 24 ? `om ${h} ${h === 1 ? "time" : "timer"}` : `om ${Math.round(h / 24)} ${Math.round(h / 24) === 1 ? "dag" : "dager"}`;
  };

  // Uker fra «from»
  const weeks: { start: string; rows: { date: string; kind: "shift" | "off" | "open"; s?: ShiftRow; label?: string }[]; minutes: number }[] = [];
  for (let d = from; d < addDays(from, days); d = addDays(d, 1)) {
    const wStart = mondayOf(d);
    let w = weeks.find((x) => x.start === wStart);
    if (!w) { w = { start: wStart, rows: [], minutes: 0 }; weeks.push(w); }
    for (const s of mineAll.filter((x) => dateOf(x) === d)) {
      w.rows.push({ date: d, kind: "shift", s });
      w.minutes += workedMinutes(new Date(s.starts_at), new Date(s.ends_at), s.break_minutes);
    }
    const off = absences.find((a) => a.employee_id === me && a.from_date <= d && a.to_date >= d);
    if (off) w.rows.push({ date: d, kind: "off", label: off.type_name });
    for (const s of openShifts.filter((x) => dateOf(x) === d && new Date(x.starts_at).getTime() > nowMs)) w.rows.push({ date: d, kind: "open", s });
  }
  const weekTitle = (start: string) => start === mondayOf(now) ? `Denne uka · uke ${weekNumber(start)}`
    : start === addDays(mondayOf(now), 7) ? `Neste uke · uke ${weekNumber(start)}` : `Uke ${weekNumber(start)}`;

  return (
    <div className="space-y-4">
      {next ? (
        <section className="rounded-2xl bg-brand p-4 text-white">
          <div className="text-sm opacity-85">Neste vakt · {untilNext(next)}</div>
          <div className="mt-0.5 text-xl font-bold capitalize">{dateOf(next) === now ? "I dag" : dateOf(next) === addDays(now, 1) ? "I morgen" : dayLabelLong(dateOf(next))} {t(next)}</div>
          <div className="mt-0.5 text-sm opacity-90">{roleName(next) ? `${roleName(next)} · ` : ""}{withWhom(next)}</div>
        </section>
      ) : (
        <p className="card text-sm text-muted">Du har ingen vakter de neste ukene.</p>
      )}
      {weeks.filter((w) => w.rows.length).map((w) => (
        <section key={w.start} className="space-y-1.5">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-sm font-bold">{weekTitle(w.start)}</h2>
            <span className="text-xs text-muted">{w.minutes ? `${formatHours(w.minutes)} planlagt` : ""}</span>
          </div>
          <ul className="card divide-y divide-line p-0">
            {w.rows.map((r, i) => {
              const d = r.date;
              const bar = r.kind === "shift" ? "border-brand" : r.kind === "off" ? "border-warn" : "border-good";
              return (
                <li key={`${d}-${i}`} className={`flex items-center gap-3 px-3 py-2.5 ${r.kind === "open" ? "bg-good-soft/50" : ""}`}>
                  <div className="w-10 shrink-0 text-center">
                    <div className="text-[11px] font-semibold uppercase text-muted">{WD[isoWeekday(d) - 1]}</div>
                    <div className={`text-lg font-bold leading-tight ${d === now ? "text-brand" : ""}`}>{Number(d.slice(8))}</div>
                  </div>
                  <div className={`min-w-0 flex-1 border-l-4 pl-2.5 ${bar}`}>
                    {r.kind === "shift" && r.s && (
                      <>
                        <div className="font-semibold tabular-nums">{t(r.s)}{roleName(r.s) && <span className="font-normal text-muted"> · {roleName(r.s)}</span>}</div>
                        <div className="mt-0.5 text-xs text-muted">{withWhom(r.s)}</div>
                      </>
                    )}
                    {r.kind === "off" && <div className="font-semibold text-warn">{r.label}</div>}
                    {r.kind === "open" && r.s && (
                      <>
                        <div className="font-semibold tabular-nums">Ledig vakt {t(r.s)}{roleName(r.s) && <span className="font-normal text-muted"> · {roleName(r.s)}</span>}</div>
                        <div className="mt-0.5 text-xs text-muted">Meld deg hvis du kan ta den</div>
                      </>
                    )}
                  </div>
                  {r.kind === "open" && r.s && (requested.has(r.s.id)
                    ? <span className="badge bg-warn-soft text-warn">Påmeldt</span>
                    : <form action={requestOpenShift}><input type="hidden" name="shift_id" value={r.s.id} /><button className="min-h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">Jeg kan</button></form>)}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <Link href={calendarHref} className="card flex items-center justify-between hover:border-brand">
        <span><b className="block">Legg vaktene i kalenderen din</b><span className="text-sm text-muted">Dine vakter, fri og ferie i Apple, Google eller Outlook.</span></span>
        <span className="text-brand">›</span>
      </Link>
    </div>
  );
}

function RoleLabel({ role }: { role: RosterRole | null }) {
  return (
    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: role?.color ?? "#94a3b8" }} />
      {role?.name ?? "Andre"}
    </span>
  );
}

function ShiftChip({ s, tz, role, href }: { s: ShiftRow; tz: string; role?: RosterRole; href?: string }) {
  const cls = `block rounded-md border-l-4 px-2 py-1 text-xs leading-tight ${s.status === "draft" ? "border-dashed bg-white ring-1 ring-line" : "bg-paper"} ${href ? "hover:ring-2 hover:ring-brand/40" : ""}`;
  const body = (
    <>
      <div className="font-semibold tabular-nums">{shortTime(new Date(s.starts_at), new Date(s.ends_at), tz)}</div>
      <div className="text-xs text-muted">{role?.name ?? formatHours(workedMinutes(new Date(s.starts_at), new Date(s.ends_at), s.break_minutes))}{s.status === "draft" ? " · utkast" : ""}</div>
    </>
  );
  return href
    ? <Link href={href} className={cls} style={{ borderLeftColor: role?.color ?? "#94a3b8" }} title="Endre eller sett fraværende">{body}</Link>
    : <div className={cls} style={{ borderLeftColor: role?.color ?? "#94a3b8" }}>{body}</div>;
}

function OpenShift({ s, tz, canClaim, requested, compact }: { s: ShiftRow; tz: string; canClaim: boolean; requested: boolean; compact?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-md bg-brand-soft ${compact ? "mb-1 flex-col items-start px-2 py-1" : "px-3 py-2"}`}>
      <span className="text-sm"><span className="font-medium text-brand">Ledig</span> <span className="tabular-nums">{shortTime(new Date(s.starts_at), new Date(s.ends_at), tz)}</span></span>
      {canClaim && (requested
        ? <span className="badge bg-warn-soft text-warn">Påmeldt</span>
        : <form action={requestOpenShift}><input type="hidden" name="shift_id" value={s.id} /><button className={`rounded-md bg-brand font-semibold text-white ${compact ? "px-2 py-1 text-xs" : "min-h-10 px-3 text-sm"}`}>Jeg kan jobbe</button></form>)}
    </div>
  );
}

function GroupedList({ shifts, roles, roleOf, name, tz, highlight, linkFor, focus }: {
  shifts: ShiftRow[]; roles: RosterRole[]; roleOf: (s: ShiftRow) => string | null; name: (id: string | null) => string; tz: string; highlight: string | null; focus?: string | null;
  linkFor?: (s: ShiftRow) => string;
}) {
  const assigned = shifts.filter((s) => s.employee_id);
  if (assigned.length === 0) return null;
  const groups = groupByRole(assigned, roleOf, roles);
  return (
    <div className="mt-2 space-y-2">
      {groups.map((g) => (
        <div key={g.role?.id ?? "andre"}>
          <RoleLabel role={g.role} />
          <ul className="mt-1 divide-y divide-line">
            {g.items.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || name(a.employee_id).localeCompare(name(b.employee_id), "nb")).map((s) => (
              <li key={s.id} className={`${s.employee_id === highlight ? "font-semibold" : ""} ${s.id === focus ? "-mx-2 rounded-lg bg-brand-soft px-2" : ""}`}>
                {(() => {
                  const inner = (
                    <>
                      <span className="min-w-0 truncate">
                        {name(s.employee_id)}
                        {s.status === "draft" && <span className="ml-2 text-xs font-normal italic text-muted">utkast</span>}
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        {shortTime(new Date(s.starts_at), new Date(s.ends_at), tz)}
                        <span className="ml-2 text-xs font-normal text-muted">{formatHours(workedMinutes(new Date(s.starts_at), new Date(s.ends_at), s.break_minutes))}</span>
                        {linkFor && <span className="ml-2 text-muted" aria-hidden>›</span>}
                      </span>
                    </>
                  );
                  const cls = "flex items-center justify-between gap-3 py-2";
                  return linkFor
                    ? <Link href={linkFor(s)} className={`${cls} -mx-2 rounded-lg px-2 hover:bg-paper`}>{inner}</Link>
                    : <div className={cls}>{inner}</div>;
                })()}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** «Hvem jobber»: én dag som tidslinje (en stolpe per person), deg øverst, og samme dag som liste under. */
function DayView({ date, shifts, away, cov, roles, roleOf, name, tz, isAdmin, linkFor, canClaim, requested, me, isToday }: {
  linkFor?: (s: ShiftRow) => string; canClaim: boolean; requested: Set<string | null>; me: string | null; isToday: boolean;
  date: string; shifts: ShiftRow[]; away: { employee_id: string; type_name: string }[];
  cov: { closed: boolean; holiday: string | null; gaps: { start: Date; end: Date; missing: number }[]; peakRequired: number };
  roles: RosterRole[]; roleOf: (s: ShiftRow) => string | null; name: (id: string | null) => string; tz: string; isAdmin: boolean;
}) {
  const { start: d0 } = dayBounds(date, tz);
  const hOf = (iso: string) => (new Date(iso).getTime() - d0.getTime()) / 3600000;
  const lo = Math.max(0, Math.floor(Math.min(8, ...shifts.map((s) => hOf(s.starts_at)))));
  const hi = Math.ceil(Math.max(16, ...shifts.map((s) => hOf(s.ends_at))));
  const pct = (h: number) => `${((Math.min(Math.max(h, lo), hi) - lo) / (hi - lo)) * 100}%`;
  const step = hi - lo > 12 ? 4 : 2;
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((h) => (h - lo) % step === 0 && h < hi);
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const assigned = shifts.filter((s) => s.employee_id)
    .sort((a, b) => (a.employee_id === me ? -1 : b.employee_id === me ? 1 : a.starts_at.localeCompare(b.starts_at)));
  const open = shifts.filter((s) => !s.employee_id);
  const nowH = isToday ? (Date.now() - d0.getTime()) / 3600000 : null;
  const people = new Set(assigned.map((s) => s.employee_id)).size;

  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-muted">
        {people ? `${people} på jobb` : "Ingen på jobb"}{cov.holiday ? ` · ${cov.holiday}` : cov.closed ? " · stengt" : ""}
      </p>
      {isAdmin && cov.gaps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cov.gaps.map((g, i) => <span key={i} className="badge bg-bad-soft text-bad">Mangler {g.missing} kl. {localTime(g.start, tz)}–{localTime(g.end, tz)}</span>)}
        </div>
      )}
      {assigned.length > 0 && (
        <section className="card space-y-2 p-3">
          <div className="relative ml-[5.5rem] h-4 text-[10px] text-muted">
            {ticks.map((h) => <span key={h} className="absolute tabular-nums" style={{ left: pct(h) }}>{String(h % 24).padStart(2, "0")}</span>)}
          </div>
          <div className="relative space-y-1.5">
            {assigned.map((s) => {
              const meRow = s.employee_id === me;
              const color = roleById.get(roleOf(s) ?? "")?.color;
              const bar = (
                <div className="flex items-center gap-2">
                  <div className={`w-20 shrink-0 truncate text-sm ${meRow ? "font-bold text-brand" : "font-medium"}`}>{meRow ? "Du" : shortName(name(s.employee_id)).split(" ")[0]}</div>
                  <div className="relative h-9 flex-1 rounded-md" style={{ background: "repeating-linear-gradient(90deg, #eef1f5 0 1px, transparent 1px 12.5%)" }}>
                    <div className={`absolute inset-y-1 flex items-center overflow-hidden whitespace-nowrap rounded-md px-1.5 text-[11px] font-bold ${meRow ? "bg-brand text-white" : "bg-brand-soft text-brand"} ${s.status === "draft" ? "opacity-60" : ""}`}
                      style={{ left: pct(hOf(s.starts_at)), width: `calc(${pct(hOf(s.ends_at))} - ${pct(hOf(s.starts_at))})`, boxShadow: color && !meRow ? `inset 3px 0 0 ${color}` : undefined }}>
                      {shortTime(new Date(s.starts_at), new Date(s.ends_at), tz)}
                    </div>
                  </div>
                </div>
              );
              return linkFor ? <Link key={s.id} href={linkFor(s)} className="block rounded-md hover:bg-paper" title="Endre eller sett fraværende">{bar}</Link> : <div key={s.id}>{bar}</div>;
            })}
            {nowH !== null && nowH > lo && nowH < hi && (
              <div className="pointer-events-none absolute inset-y-0 left-[5.5rem] right-0" aria-hidden>
                <div className="absolute inset-y-0 w-0.5 bg-bad" style={{ left: pct(nowH) }} />
              </div>
            )}
          </div>
          {nowH !== null && nowH > lo && nowH < hi && <p className="text-[11px] text-muted"><span className="font-bold text-bad">|</span> nå, kl. {localTime(new Date(), tz)}</p>}
        </section>
      )}

      <section className="card divide-y divide-line p-0 text-sm">
        {assigned.map((s) => {
          const meRow = s.employee_id === me;
          const role = roleById.get(roleOf(s) ?? "")?.name;
          const row = (
            <div className={`flex justify-between gap-3 px-3 py-2.5 ${meRow ? "bg-brand-soft" : ""}`}>
              <span className={meRow ? "font-bold text-brand" : ""}>{meRow ? "Du" : shortName(name(s.employee_id))}{role && <span className="font-normal text-muted"> · {role}</span>}</span>
              <span className="tabular-nums text-muted">{shortTime(new Date(s.starts_at), new Date(s.ends_at), tz)}{s.break_minutes ? ` · pause ${s.break_minutes} min` : ""}</span>
            </div>
          );
          return linkFor ? <Link key={s.id} href={linkFor(s)} className="block hover:bg-paper">{row}</Link> : <div key={s.id}>{row}</div>;
        })}
        {away.map((a) => <div key={a.employee_id} className="px-3 py-2.5 text-warn">{a.employee_id === me ? "Du" : shortName(name(a.employee_id))}: {a.type_name.toLowerCase()}</div>)}
        {open.map((s) => <div key={s.id} className="px-3 py-2"><OpenShift s={s} tz={tz} canClaim={canClaim} requested={requested.has(s.id)} /></div>)}
        {assigned.length === 0 && away.length === 0 && open.length === 0 && <p className="px-3 py-2.5 text-muted">Ingen vakter denne dagen.</p>}
      </section>
    </div>
  );
}

