import Link from "next/link";
import { requireOrg } from "@/lib/context";
import { colleagues, coverageForDays, shiftsBetween, today, type ShiftRow } from "@/lib/data";
import { addDays, dayBounds, formatHours, isoWeekday, localDate, localTime, workedMinutes } from "@/lib/time";
import { groupByRole, primaryRoles, shortName, shortTime, type RosterRole } from "@/lib/roster";
import { ActionForm, Field } from "@/components/Form";
import { proposeShift, requestOpenShift } from "./actions";

type View = "dag" | "uke" | "maned";
type Who = "alle" | "mine";

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

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ dato?: string; visning?: View; vis?: Who; vakt?: string }> }) {
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
  const view: View = sp.visning === "dag" || sp.visning === "maned" ? sp.visning : "uke";
  const who: Who = sp.vis === "alle" || sp.vis === "mine" ? sp.vis : ctx.isAdmin || !ctx.employeeId ? "alle" : "mine";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.dato ?? "") ? sp.dato! : now;

  let from: string;
  let days: number;
  if (view === "dag") {
    from = anchor;
    days = 1;
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

  const [names, allShifts, rolesRes, linksRes, absRes, reqRes] = await Promise.all([
    colleagues(ctx),
    shiftsBetween(ctx, from, addDays(from, days)),
    ctx.supabase.from("work_roles").select("id, name, color, sort_order").eq("org_id", ctx.org.id),
    ctx.supabase.from("employee_work_roles").select("employee_id, work_role_id").eq("org_id", ctx.org.id),
    ctx.supabase.rpc("org_absences", { p_org: ctx.org.id, p_from: from, p_to: to }),
    ctx.employeeId
      ? ctx.supabase.from("shift_requests").select("shift_id").eq("employee_id", ctx.employeeId).eq("status", "pending")
      : Promise.resolve({ data: [] as { shift_id: string | null }[] }),
  ]);
  const coverage = await coverageForDays(ctx, from, days, allShifts);
  const roles = (rolesRes.data ?? []) as RosterRole[];
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const primary = primaryRoles(roles, linksRes.data ?? []);
  const requested = new Set((reqRes.data ?? []).map((r) => r.shift_id));
  type Abs = { employee_id: string; from_date: string; to_date: string; type_name: string };
  const allAbsences = (absRes.data ?? []) as Abs[];

  const mine = who === "mine" && ctx.employeeId;
  // Ansatte ser bare publiserte vakter; utkast vises for administrator
  const visible = allShifts.filter((s) => s.status === "published" || ctx.isAdmin);
  const shifts = mine ? visible.filter((s) => s.employee_id === ctx.employeeId) : visible;
  const absences = mine ? allAbsences.filter((a) => a.employee_id === ctx.employeeId) : allAbsences;
  const openShifts = visible.filter((s) => !s.employee_id && s.status === "published");

  const roleOf = (s: ShiftRow) => s.work_role_id ?? (s.employee_id ? primary.get(s.employee_id) ?? null : null);
  const dateOf = (s: ShiftRow) => localDate(new Date(s.starts_at), tz);
  const awayOn = (d: string) => absences.filter((a) => a.from_date <= d && a.to_date >= d);
  const name = (id: string | null) => (id ? names.get(id) ?? "Ukjent" : "Ledig");

  // Navigasjon
  const step = view === "dag" ? 1 : view === "uke" ? 7 : 0;
  const prev = step ? addDays(anchor, -step) : addDays(anchor.slice(0, 8) + "01", -1);
  const next = step ? addDays(anchor, step) : addDays(anchor.slice(0, 8) + "01", 32);
  const href = (p: { d?: string; v?: View; w?: Who }) => `/vaktplan?visning=${p.v ?? view}&dato=${p.d ?? anchor}&vis=${p.w ?? who}`;
  // Admin trykker på en vakt for å sette personen fraværende eller endre vakten
  const shiftLink = ctx.isAdmin ? (s: ShiftRow) => `/vaktplan/vakt/${s.id}?tilbake=${encodeURIComponent(href({}))}` : undefined;
  const title =
    view === "dag" ? dayLabelLong(anchor)
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
          {ctx.isAdmin && <Link href={`/vaktplan/rediger?visning=${view === "maned" ? "uke" : view}&dato=${anchor}`} className="btn-primary">Rediger plan</Link>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented items={[["dag", "Dag"], ["uke", "Uke"], ["maned", "Måned"]]} active={view} link={(v) => href({ v: v as View })} />
          {ctx.employeeId && (
            <Segmented items={[["mine", "Bare mine"], ["alle", "Alle"]]} active={who} link={(w) => href({ w: w as Who })} />
          )}
          {ctx.employeeId && (
            <span className="ml-auto text-sm text-muted">
              Dine timer {view === "dag" ? "i dag" : view === "uke" ? "denne uka" : "denne måneden"}: <b className="text-ink">{formatHours(myMinutes)}</b>
            </span>
          )}
        </div>
      </header>

      {/* ---------------- DAG ---------------- */}
      {view === "dag" && (
        <DayView linkFor={shiftLink} date={anchor} shifts={shifts.filter((s) => dateOf(s) === anchor)} away={awayOn(anchor)}
          cov={coverage[0]} roles={roles} roleOf={roleOf} name={name} tz={tz} isAdmin={ctx.isAdmin}
          canClaim={!ctx.isAdmin && Boolean(ctx.employeeId)} requested={requested} />
      )}

      {/* ---------------- UKE ---------------- */}
      {view === "uke" && (
        <>
          {/* Tabell på PC: ansatte i rader, dager i kolonner */}
          {!mine && (
            <section className="card hidden overflow-x-auto p-0 md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="w-40 px-3 py-2 text-left font-medium text-muted">Ansatt</th>
                    {coverage.map((c) => (
                      <th key={c.date} className={`px-2 py-2 text-left font-medium ${c.date === now ? "text-brand" : "text-muted"}`}>
                        <div className="capitalize">{dayLabel(c.date)}</div>
                        {c.holiday && <div className="truncate text-xs font-normal text-warn">{c.holiday}</div>}
                        {c.closed && !c.holiday && <div className="text-xs font-normal">Stengt</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                {(() => {
                  // Én rad per ansatt som har vakt eller fravær denne uka, gruppert etter hovedrolle
                  const ids = Array.from(new Set([...shifts.filter((s) => s.employee_id).map((s) => s.employee_id!), ...absences.map((a) => a.employee_id)]));
                  const people = ids.map((id) => ({ id, n: name(id) }));
                  const groups = groupByRole(people, (p) => primary.get(p.id) ?? null, roles);
                  return groups.map((g) => (
                    <tbody key={g.role?.id ?? "andre"}>
                      <tr><td colSpan={8} className="bg-paper px-3 py-1.5"><RoleLabel role={g.role} /></td></tr>
                      {g.items.sort((a, b) => a.n.localeCompare(b.n, "nb")).map((p) => (
                        <tr key={p.id} className={`border-b border-line ${p.id === ctx.employeeId ? "bg-good-soft/40" : ""}`}>
                          <td className="px-3 py-2 font-medium">{shortName(p.n)}</td>
                          {coverage.map((c) => {
                            const day = shifts.filter((s) => s.employee_id === p.id && dateOf(s) === c.date);
                            const off = absences.find((a) => a.employee_id === p.id && a.from_date <= c.date && a.to_date >= c.date);
                            return (
                              <td key={c.date} className="px-2 py-1.5 align-top">
                                {off && <span className="badge bg-warn-soft text-warn">{off.type_name}</span>}
                                {day.map((s) => <ShiftChip key={s.id} s={s} tz={tz} role={roleById.get(roleOf(s) ?? "")} href={shiftLink?.(s)} />)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  ));
                })()}
                {openShifts.length > 0 && (
                  <tbody>
                    <tr className="border-t border-line">
                      <td className="px-3 py-2 font-medium text-brand">Ledige vakter</td>
                      {coverage.map((c) => (
                        <td key={c.date} className="px-2 py-1.5 align-top">
                          {openShifts.filter((s) => dateOf(s) === c.date).map((s) => (
                            <OpenShift key={s.id} s={s} tz={tz} canClaim={!ctx.isAdmin && Boolean(ctx.employeeId)} requested={requested.has(s.id)} compact />
                          ))}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                )}
              </table>
              {shifts.length === 0 && absences.length === 0 && <p className="p-4 text-sm text-muted">Ingen vakter denne uka.</p>}
            </section>
          )}

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
                      {open.map((s) => <OpenShift key={s.id} s={s} tz={tz} canClaim={!ctx.isAdmin && Boolean(ctx.employeeId)} requested={requested.has(s.id)} />)}
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

          {/* Mobil: bare dager med noe på */}
          <div className="space-y-2 md:hidden">
            {coverage.filter((c) => c.date.slice(0, 7) === anchor.slice(0, 7)).map((c) => {
              const day = shifts.filter((s) => dateOf(s) === c.date).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
              const away = awayOn(c.date);
              if (day.length === 0 && away.length === 0 && !c.holiday) return null;
              return (
                <Link key={c.date} href={href({ d: c.date, v: "dag" })} className={`card block py-3 ${c.date === now ? "ring-2 ring-brand/40" : ""}`}>
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold capitalize">{dayLabelLong(c.date)}</span>
                    {c.holiday && <span className="text-xs text-warn">{c.holiday}</span>}
                  </div>
                  <div className="mt-1 space-y-0.5 text-sm">
                    {day.map((s) => (
                      <div key={s.id} className="flex justify-between gap-2">
                        <span className="truncate">{mine ? "Vakt" : shortName(name(s.employee_id))}</span>
                        <span className="tabular-nums text-muted">{shortTime(new Date(s.starts_at), new Date(s.ends_at), tz)}</span>
                      </div>
                    ))}
                    {away.map((a) => <div key={a.employee_id} className="text-warn">{mine ? a.type_name : `${shortName(name(a.employee_id))}: ${a.type_name.toLowerCase()}`}</div>)}
                  </div>
                </Link>
              );
            })}
            {shifts.length === 0 && absences.length === 0 && <p className="card text-sm text-muted">Ingenting denne måneden.</p>}
          </div>
        </>
      )}

      {!ctx.isAdmin && ctx.employeeId && (
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

function Segmented({ items, active, link }: { items: [string, string][]; active: string; link: (k: string) => string }) {
  return (
    <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm">
      {items.map(([k, label]) => (
        <Link key={k} href={link(k)} className={`flex min-h-9 items-center rounded-md px-3 font-medium ${k === active ? "bg-brand text-white" : "text-muted"}`}>{label}</Link>
      ))}
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
  const cls = `mb-1 block rounded-md border-l-4 px-2 py-1 ${s.status === "draft" ? "border-dashed bg-white ring-1 ring-line" : "bg-paper"} ${href ? "hover:ring-2 hover:ring-brand/40" : ""}`;
  const body = (
    <>
      <div className="font-semibold tabular-nums">{shortTime(new Date(s.starts_at), new Date(s.ends_at), tz)}</div>
      <div className="text-xs text-muted">{formatHours(workedMinutes(new Date(s.starts_at), new Date(s.ends_at), s.break_minutes))}{s.status === "draft" ? " · utkast" : ""}</div>
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

function DayView({ date, shifts, away, cov, roles, roleOf, name, tz, isAdmin, linkFor, canClaim, requested }: {
  linkFor?: (s: ShiftRow) => string; canClaim: boolean; requested: Set<string | null>;
  date: string; shifts: ShiftRow[]; away: { employee_id: string; type_name: string }[];
  cov: { closed: boolean; holiday: string | null; gaps: { start: Date; end: Date; missing: number }[]; peakRequired: number };
  roles: RosterRole[]; roleOf: (s: ShiftRow) => string | null; name: (id: string | null) => string; tz: string; isAdmin: boolean;
}) {
  const { start: d0 } = dayBounds(date, tz);
  // Tidslinje fra første til siste vakt, minst 08–16
  const startsH = shifts.map((s) => (new Date(s.starts_at).getTime() - d0.getTime()) / 3600000);
  const endsH = shifts.map((s) => (new Date(s.ends_at).getTime() - d0.getTime()) / 3600000);
  const lo = Math.floor(Math.min(8, ...startsH));
  const hi = Math.ceil(Math.max(16, ...endsH));
  const pct = (h: number) => `${((h - lo) / (hi - lo)) * 100}%`;
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((h) => (hi - lo > 12 ? h % 2 === 0 : true));
  const assigned = shifts.filter((s) => s.employee_id);
  const open = shifts.filter((s) => !s.employee_id);
  const groups = groupByRole(assigned, roleOf, roles);
  const roleById = new Map(roles.map((r) => [r.id, r]));

  return (
    <section className="card space-y-4">
      {(cov.holiday || cov.closed) && <p className="text-sm text-warn">{cov.holiday ?? "Stengt"}</p>}
      {isAdmin && cov.gaps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cov.gaps.map((g, i) => <span key={i} className="badge bg-bad-soft text-bad">Mangler {g.missing} kl. {localTime(g.start, tz)}–{localTime(g.end, tz)}</span>)}
        </div>
      )}
      {assigned.length === 0 && open.length === 0 && <p className="text-sm text-muted">Ingen vakter denne dagen.</p>}

      {assigned.length > 0 && (
        <div className="relative ml-28 hidden h-5 text-[11px] text-muted sm:block">
          {ticks.map((h) => <span key={h} className="absolute -translate-x-1/2 tabular-nums" style={{ left: pct(h) }}>{String(h % 24).padStart(2, "0")}</span>)}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.role?.id ?? "andre"} className="space-y-1.5">
          <RoleLabel role={g.role} />
          {g.items.sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map((s) => {
            const a = (new Date(s.starts_at).getTime() - d0.getTime()) / 3600000;
            const b = (new Date(s.ends_at).getTime() - d0.getTime()) / 3600000;
            const color = roleById.get(roleOf(s) ?? "")?.color ?? "#94a3b8";
            return (
              <Row key={s.id} href={linkFor?.(s)}>
                <div className="w-28 shrink-0 truncate text-sm font-medium sm:w-24">{shortName(name(s.employee_id))}</div>
                <div className="relative hidden h-7 flex-1 rounded bg-paper sm:block">
                  <div className={`absolute inset-y-0 flex items-center rounded px-2 text-xs font-semibold text-white ${s.status === "draft" ? "opacity-60" : ""}`}
                    style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, background: color }}>
                    <span className="truncate tabular-nums">{shortTime(new Date(s.starts_at), new Date(s.ends_at), tz)}</span>
                  </div>
                </div>
                <div className="ml-auto text-right text-sm tabular-nums sm:w-16">
                  <span className="sm:hidden">{shortTime(new Date(s.starts_at), new Date(s.ends_at), tz)} · </span>
                  {formatHours(workedMinutes(new Date(s.starts_at), new Date(s.ends_at), s.break_minutes))}
                  {linkFor && <span className="ml-1 text-muted" aria-hidden>›</span>}
                </div>
              </Row>
            );
          })}
        </div>
      ))}
      {open.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-brand">Ledige vakter</span>
          {open.map((s) => <OpenShift key={s.id} s={s} tz={tz} canClaim={canClaim} requested={requested.has(s.id)} />)}
        </div>
      )}
      {away.length > 0 && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-warn">Fri / borte</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {away.map((a) => <span key={a.employee_id} className="badge bg-warn-soft text-warn">{shortName(name(a.employee_id))}: {a.type_name.toLowerCase()}</span>)}
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ href, children }: { href?: string; children: React.ReactNode }) {
  return href
    ? <Link href={href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-0.5 hover:bg-paper" title="Endre eller sett fraværende">{children}</Link>
    : <div className="flex items-center gap-3">{children}</div>;
}
