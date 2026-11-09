import Link from "next/link";
import { requireOrg } from "@/lib/context";
import { colleagues, coverageForDays, shiftsBetween, today, type ShiftRow } from "@/lib/data";
import { addDays, formatDateLong, isoWeekday, localDate, localTime, formatHours, workedMinutes } from "@/lib/time";
import { ActionForm, Field } from "@/components/Form";
import { AssignForm } from "@/components/AssignForm";
import { EmployeePicker } from "@/components/EmployeePicker";
import { AutoPlanPanel } from "@/components/AutoPlanPanel";
import { assignShift, cancelShift, copyPreviousWeek, createShift, proposeShift, publishWeek, requestOpenShift } from "./actions";

type View = "dag" | "uke" | "maned";

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

const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ dato?: string; visning?: View; tilby?: string; ny?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const tz = ctx.org.timezone;
  const view: View = sp.visning === "dag" || sp.visning === "maned" ? sp.visning : "uke";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.dato ?? "") ? sp.dato! : today(ctx);

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
    const nextMonth = addDays(first, 32).slice(0, 8) + "01";
    days = 0;
    while (addDays(from, days) < nextMonth || isoWeekday(addDays(from, days)) !== 1) days++;
  }

  const [names, shifts, rolesRes, requestsRes, absencesRes, pctRes] = await Promise.all([
    colleagues(ctx),
    shiftsBetween(ctx, from, addDays(from, days)),
    ctx.supabase.from("work_roles").select("id, name, color").eq("org_id", ctx.org.id).order("name"),
    ctx.employeeId
      ? ctx.supabase.from("shift_requests").select("shift_id").eq("employee_id", ctx.employeeId).eq("status", "pending")
      : Promise.resolve({ data: [] as { shift_id: string | null }[] }),
    ctx.supabase.rpc("org_absences", { p_org: ctx.org.id, p_from: from, p_to: addDays(from, days - 1) }),
    ctx.isAdmin
      ? ctx.supabase.from("employment_terms").select("employee_id, position_pct").eq("org_id", ctx.org.id).is("valid_to", null)
      : Promise.resolve({ data: [] as { employee_id: string; position_pct: number }[] }),
  ]);
  const absences = (absencesRes.data ?? []) as { employee_id: string; from_date: string; to_date: string; type_name: string }[];
  const pct = new Map((pctRes.data ?? []).map((t) => [t.employee_id, Number(t.position_pct)]));
  const newShiftDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.ny ?? "") ? sp.ny! : null;
  const coverage = await coverageForDays(ctx, from, days, shifts);
  const roles = new Map((rolesRes.data ?? []).map((r) => [r.id, r]));
  const requested = new Set((requestsRes.data ?? []).map((r) => r.shift_id));
  const drafts = shifts.filter((s) => s.status === "draft").length;
  const people = Array.from(names, ([id, name]) => ({ id, name, pct: pct.get(id) ?? null }));

  const step = view === "dag" ? 1 : view === "uke" ? 7 : 0;
  const prev = step ? addDays(anchor, -step) : addDays(anchor.slice(0, 8) + "01", -1);
  const next = step ? addDays(anchor, step) : addDays(anchor.slice(0, 8) + "01", 32);
  const href = (d: string, v: View = view) => `/vaktplan?visning=${v}&dato=${d}`;
  const title =
    view === "dag" ? formatDateLong(anchor)
      : view === "uke" ? `Uke ${weekNumber(from)}`
      : `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;

  const time = (s: ShiftRow) => `${localTime(new Date(s.starts_at), tz)}–${localTime(new Date(s.ends_at), tz)}`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={href(prev)} className="btn-ghost px-3" aria-label="Forrige">‹</Link>
          <h1 className="h1 min-w-0 capitalize">{title}</h1>
          <Link href={href(next)} className="btn-ghost px-3" aria-label="Neste">›</Link>
        </div>
        <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm">
          {(["dag", "uke", "maned"] as View[]).map((v) => (
            <Link key={v} href={href(anchor, v)} className={`rounded-md px-3 py-1.5 font-medium ${v === view ? "bg-brand text-white" : "text-muted"}`}>
              {v === "dag" ? "Dag" : v === "uke" ? "Uke" : "Måned"}
            </Link>
          ))}
        </div>
      </header>

      <Legend />

      {ctx.isAdmin && view !== "maned" && (
        <section className="card space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {drafts > 0 ? (
              <form action={publishWeek}>
                <input type="hidden" name="from" value={from} />
                <input type="hidden" name="days" value={days} />
                <button className="btn-primary">Publiser {drafts} {drafts === 1 ? "utkast" : "utkast"}</button>
              </form>
            ) : (
              <span className="text-sm text-muted">Alt er publisert.</span>
            )}
            {view === "uke" && (
              <ActionForm action={copyPreviousWeek} submitLabel="Kopier forrige uke" className="flex items-center gap-2">
                <input type="hidden" name="from" value={from} />
              </ActionForm>
            )}
          </div>
          {view === "uke" && (
            <AutoPlanPanel from={from} days={days} hasAutoDrafts={shifts.some((s) => s.status === "draft" && s.note === "Automatisk forslag")} />
          )}
          <details id="ny-vakt" open={Boolean(newShiftDate) || people.length === 0}>
            <summary className="cursor-pointer text-sm font-semibold text-brand">+ Ny vakt</summary>
            {people.length === 0 && (
              <p className="mt-2 text-sm text-muted">Ingen ansatte ennå. Velg «+ Ny ansatt» i listen for å legge inn den første mens du lager vakten.</p>
            )}
            <ActionForm action={createShift} submitLabel="Legg til vakt" className="mt-3 grid gap-3 md:grid-cols-4">
              <Field label="Fra dato"><input key={newShiftDate ?? from} name="date" type="date" required defaultValue={newShiftDate ?? from} className="input" /></Field>
              <Field label="Til dato" hint="Tomt = bare én dag."><input key={`t${newShiftDate ?? ""}`} name="date_to" type="date" defaultValue={newShiftDate ?? ""} className="input" /></Field>
              <Field label="Fra"><input name="start" type="time" required defaultValue="08:00" className="input" /></Field>
              <Field label="Til"><input name="end" type="time" required defaultValue="16:00" className="input" /></Field>
              <Field label="Pause (min)"><input name="break_minutes" type="number" min={0} step={5} defaultValue={30} className="input" /></Field>
              <EmployeePicker people={people} roles={Array.from(roles.values()).map((r) => ({ id: r.id, name: r.name }))} />
              <Field label="Arbeidsrolle">
                <select name="work_role_id" className="input" defaultValue="">
                  <option value="">Ingen</option>
                  {Array.from(roles.values()).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
              <fieldset className="md:col-span-4">
                <legend className="label">Ukedager i perioden</legend>
                <div className="flex flex-wrap gap-2">
                  {["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"].map((n, i) => (
                    <label key={n} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm">
                      <input type="checkbox" name="weekday" value={i + 1} defaultChecked={i < 5} className="h-4 w-4" /> {n}
                    </label>
                  ))}
                </div>
                <span className="mt-1 block text-xs text-muted">Brukes når du velger en periode, for eksempel hele uka.</span>
              </fieldset>
              <Field label="Gjenta ukentlig">
                <select name="repeat_weeks" className="input" defaultValue="1">
                  {[1, 2, 4, 8, 12, 26].map((n) => <option key={n} value={n}>{n === 1 ? "Nei" : `${n} uker`}</option>)}
                </select>
              </Field>
              <Field label="Notat"><input name="note" className="input" /></Field>
              <div className="flex flex-wrap gap-4 text-sm md:col-span-4">
                <label className="flex items-center gap-2"><input type="checkbox" name="publish" className="h-4 w-4" /> Publiser med en gang</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="auto_approve" className="h-4 w-4" /> Godkjenn påmelding automatisk</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="called_overtime" className="h-4 w-4" /> Tilsagt overtid</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="skip_holidays" defaultChecked className="h-4 w-4" /> Hopp over helligdager</label>
              </div>
            </ActionForm>
          </details>
        </section>
      )}

      {view === "maned" ? (
        <section className="card p-2">
          <div className="grid grid-cols-7 text-center text-xs font-semibold text-muted">
            {["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"].map((d) => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {coverage.map((c) => {
              const inMonth = c.date.slice(0, 7) === anchor.slice(0, 7);
              const count = shifts.filter((s) => s.employee_id && localDate(new Date(s.starts_at), tz) === c.date).length;
              const open = shifts.filter((s) => !s.employee_id && localDate(new Date(s.starts_at), tz) === c.date).length;
              const short = c.gaps.length > 0;
              return (
                <Link key={c.date} href={ctx.isAdmin ? `/vaktplan?visning=dag&dato=${c.date}&ny=${c.date}#ny-vakt` : href(c.date, "dag")}
                  className={`min-h-16 rounded-lg border p-1.5 text-left text-xs ${inMonth ? "bg-white" : "bg-paper text-muted"} ${short ? "border-bad/40" : "border-line"} ${c.date === today(ctx) ? "ring-2 ring-brand" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{Number(c.date.slice(8))}</span>
                    {short && <span className="h-2 w-2 rounded-full bg-bad" title="Underbemanning" />}
                  </div>
                  {c.holiday && <div className="truncate text-warn">{c.holiday}</div>}
                  {c.closed && !c.holiday && <div className="text-muted">Stengt</div>}
                  {count > 0 && <div>{count} på jobb</div>}
                  {open > 0 && <div className="text-brand">{open} ledig</div>}
                  {absences.some((a) => a.from_date <= c.date && a.to_date >= c.date) && (
                    <div className="text-warn">{absences.filter((a) => a.from_date <= c.date && a.to_date >= c.date).length} borte</div>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="space-y-3">
          {coverage.map((c) => {
            const dayShifts = shifts.filter((s) => localDate(new Date(s.starts_at), tz) === c.date);
            return (
              <section key={c.date} className={`card ${c.date === today(ctx) ? "ring-2 ring-brand/30" : ""}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  {ctx.isAdmin ? (
                    <Link href={`/vaktplan?visning=${view}&dato=${anchor}&ny=${c.date}#ny-vakt`} className="h2 capitalize hover:text-brand" title="Legg inn vakt denne dagen">
                      {formatDateLong(c.date)}
                    </Link>
                  ) : (
                    <h2 className="h2 capitalize">{formatDateLong(c.date)}</h2>
                  )}
                  <CoverageChip c={c} tz={tz} />
                </div>
                {c.holiday && <p className="mt-1 text-sm text-warn">{c.holiday}</p>}
                {(() => {
                  const away = absences.filter((a) => a.from_date <= c.date && a.to_date >= c.date);
                  return away.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {away.map((a) => (
                        <span key={a.employee_id + a.from_date} className="badge bg-warn-soft text-warn">
                          {names.get(a.employee_id) ?? "Ansatt"}: {a.type_name.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  );
                })()}

                {dayShifts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">{c.closed ? "Stengt." : "Ingen vakter."}</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {dayShifts.map((s) => {
                      const role = s.work_role_id ? roles.get(s.work_role_id) : null;
                      const mine = s.employee_id === ctx.employeeId;
                      return (
                        <li key={s.id}
                          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border-l-4 px-3 py-2 ${!s.employee_id ? "bg-brand-soft" : mine ? "bg-good-soft" : "bg-paper"}`}
                          style={{ borderLeftColor: role?.color ?? (s.employee_id ? "#94a3b8" : "#1f5fbf") }}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 font-medium">
                              {s.employee_id ? names.get(s.employee_id) ?? "Ukjent" : "Ledig vakt"}
                              {s.status === "draft" && (
                                <span className="badge bg-white text-muted ring-1 ring-line">{s.note === "Automatisk forslag" ? "forslag" : "utkast"}</span>
                              )}
                            </div>
                            <div className="text-sm tabular-nums text-muted">
                              {time(s)} · {formatHours(workedMinutes(new Date(s.starts_at), new Date(s.ends_at), s.break_minutes))}
                              {role && ` · ${role.name}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {!ctx.isAdmin && !s.employee_id && ctx.employeeId && (
                              requested.has(s.id)
                                ? <span className="badge bg-warn-soft text-warn">Påmeldt, venter</span>
                                : <form action={requestOpenShift}><input type="hidden" name="shift_id" value={s.id} /><button className="btn-primary">Jeg kan jobbe</button></form>
                            )}
                            {ctx.isAdmin && (
                              <>
                                <AssignForm action={assignShift} shiftId={s.id} current={s.employee_id} people={people} />
                                <form action={cancelShift}>
                                  <input type="hidden" name="id" value={s.id} />
                                  <button className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-white hover:text-bad" aria-label="Fjern vakt">Fjern</button>
                                </form>
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {ctx.isAdmin && !c.closed && (
                  <Link href={`/vaktplan?visning=${view}&dato=${anchor}&ny=${c.date}#ny-vakt`} className="mt-3 inline-block text-sm font-semibold text-brand">
                    + Vakt denne dagen
                  </Link>
                )}
                {!ctx.isAdmin && ctx.employeeId && c.gaps.length > 0 && (
                  <Link href={`/vaktplan?visning=${view}&dato=${anchor}&tilby=${c.date}#tilby`} className="mt-3 inline-block text-sm font-semibold text-brand">
                    Jeg kan jobbe denne dagen →
                  </Link>
                )}
              </section>
            );
          })}
        </div>
      )}

      {!ctx.isAdmin && ctx.employeeId && (
        <section id="tilby" className="card">
          <h2 className="h2">Tilby deg en dag</h2>
          <p className="mt-1 text-sm text-muted">Si hvilken dag og når du kan jobbe. Lederen godkjenner og setter deg opp.</p>
          <ActionForm action={proposeShift} submitLabel="Send forespørsel" className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Dato"><input name="date" type="date" required defaultValue={sp.tilby ?? from} className="input" /></Field>
            <Field label="Fra"><input name="start" type="time" required defaultValue={firstGapStart(coverage, sp.tilby, tz) ?? "12:00"} className="input" /></Field>
            <Field label="Til"><input name="end" type="time" required defaultValue={firstGapEnd(coverage, sp.tilby, tz) ?? "16:00"} className="input" /></Field>
            <Field label="Kommentar"><input name="comment" className="input" /></Field>
          </ActionForm>
        </section>
      )}
    </div>
  );
}

type Cov = Awaited<ReturnType<typeof coverageForDays>>[number];

function firstGapStart(cov: Cov[], date: string | undefined, tz: string) {
  const g = cov.find((c) => c.date === date)?.gaps[0];
  return g ? localTime(g.start, tz) : null;
}
function firstGapEnd(cov: Cov[], date: string | undefined, tz: string) {
  const g = cov.find((c) => c.date === date)?.gaps[0];
  return g ? localTime(g.end, tz) : null;
}

function CoverageChip({ c, tz }: { c: Cov; tz: string }) {
  if (c.closed) return <span className="badge bg-paper text-muted">Stengt</span>;
  if (c.peakRequired === 0) return <span className="badge bg-paper text-muted">Ingen behov satt</span>;
  if (c.gaps.length === 0) return <span className="badge bg-good-soft text-good">Fullt bemannet · {c.peakRequired}</span>;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {c.gaps.map((g, i) => (
        <span key={i} className="badge bg-bad-soft text-bad">
          Mangler {g.missing} kl. {localTime(g.start, tz)}–{localTime(g.end, tz)}
        </span>
      ))}
    </span>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-good-soft ring-1 ring-good/30" /> Din vakt</span>
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-brand-soft ring-1 ring-brand/30" /> Ledig vakt</span>
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-bad-soft ring-1 ring-bad/30" /> Mangler folk</span>
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-warn-soft ring-1 ring-warn/30" /> Fravær / helligdag</span>
    </div>
  );
}
