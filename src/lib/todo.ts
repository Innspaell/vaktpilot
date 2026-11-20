import "server-only";
import { cache } from "react";
import type { AppContext } from "./context";
import { colleagues, coverageForDays, shiftsBetween } from "./data";
import { addDays, dayBounds, formatDateLong, localDate, localTime, workedMinutes } from "./time";
import { loadDepartments, managesEmployee } from "./departments";
import { loadEmployerPeriods } from "./employer-period-data";
import { checkPlannedShifts, checkWorkTime } from "./worktime-check";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

/** Rødt haster (i dag/i morgen, frist passert), gult har frist, blått vanlig, grått oppfølging. */
export type TodoLevel = "red" | "amber" | "blue" | "grey";

/** En knapp: lenke, eller et skjema som kjører en kjent handling med skjulte felt. */
export type TodoAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "form"; label: string; action: TodoActionKey; fields: Record<string, string | string[]>; confirm?: string };

export type TodoActionKey =
  | "approveAbsence" | "rejectAbsence" | "approveSwap" | "rejectSwap" | "approveRequest" | "rejectRequest"
  | "approveEntries" | "approvePlanned" | "publish" | "confirmShift" | "acceptSwap" | "declineSwap" | "resolveNote";

export interface TodoItem {
  key: string;
  level: TodoLevel;
  title: string;
  detail?: string;
  due?: string;
  primary: TodoAction;
  secondary?: TodoAction;
}

const ORDER: Record<TodoLevel, number> = { red: 0, amber: 1, blue: 2, grey: 3 };
const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const short = (d: string) => `${Number(d.slice(8))}. ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}`;
const nameList = (names: string[], max = 3) => {
  const u = [...new Set(names)];
  return u.length <= max ? u.join(", ") : `${u.slice(0, max).join(", ")} og ${u.length - max} til`;
};

/** Fristen for å godkjenne timer i en måned: dag X i måneden etter. */
export function approvalDeadline(month: string, approveDay: number) {
  const next = addDays(`${month}-01`, 32).slice(0, 7);
  return `${next}-${String(approveDay).padStart(2, "0")}`;
}

/** Alt som venter på brukeren: ledersaker (for ledere) og egne saker. Mest haster først. */
export const loadTodo = cache(async (ctx: Ctx): Promise<{ items: TodoItem[]; waiting: string[] }> => {
  const tz = ctx.org.timezone;
  const today = localDate(new Date(), tz);
  const now = new Date();
  const items: TodoItem[] = [];
  const waiting: string[] = [];
  const sb = ctx.supabase;
  const org = ctx.org.id;

  const [{ data: orgRow }, names] = await Promise.all([
    sb.from("organizations").select("payroll_approve_day, payroll_pay_day").eq("id", org).single(),
    colleagues(ctx),
  ]);
  const approveDay = orgRow?.payroll_approve_day ?? 1;
  const payDay = orgRow?.payroll_pay_day ?? 10;
  const nm = (id: string | null | undefined) => (id ? names.get(id) ?? "Ukjent" : "Ukjent");
  const first = (id: string | null | undefined) => nm(id).split(" ")[0];

  // ---------------- Leder ----------------
  if (ctx.canPlan) {
    const deps = await loadDepartments(ctx);
    const mine = (id: string | null) => !id || managesEmployee(ctx.isAdmin, deps, id);
    const since = addDays(today, -45);
    const [shifts, { data: abs }, { data: entries }, { data: past }, { data: swaps }, { data: reqs }, { data: carry }, { data: emps }, { data: kin }, { data: periods }] = await Promise.all([
      shiftsBetween(ctx, today, addDays(today, 28)),
      sb.from("absence_requests").select("id, employee_id, from_date, to_date, from_time, to_time, partial_hours, comment, absence_types(name, is_sick)")
        .eq("org_id", org).eq("status", "pending").order("from_date"),
      sb.from("time_entries").select("id, employee_id, shift_id, starts_at, ends_at, break_minutes, status, shifts!time_entries_shift_id_fkey(starts_at, ends_at, break_minutes)")
        .eq("org_id", org).in("status", ["submitted", "draft"]).not("ends_at", "is", null).gte("starts_at", dayBounds(since, tz).start.toISOString()),
      sb.from("shifts").select("id, employee_id, starts_at, ends_at").eq("org_id", org).eq("status", "published").not("employee_id", "is", null)
        .gte("starts_at", dayBounds(since, tz).start.toISOString()).lte("ends_at", now.toISOString()).order("starts_at"),
      sb.from("shift_swaps").select("id, from_employee_id, to_employee_id, to_accepted, shifts(starts_at, ends_at)")
        .eq("org_id", org).eq("status", "pending").or("to_employee_id.is.null,to_accepted.eq.true"),
      sb.from("shift_requests").select("id, employee_id, kind, requested_start, requested_end, shifts(starts_at, ends_at)").eq("org_id", org).eq("status", "pending"),
      sb.from("vacation_carryovers").select("id, employee_id, days, from_year").eq("org_id", org).eq("status", "pending").is("employer_accepted_at", null),
      sb.from("employees").select("id, user_id, start_date, end_date").eq("org_id", org),
      sb.from("emergency_contacts").select("employee_id").eq("org_id", org),
      ctx.isAdmin ? sb.from("pay_periods").select("starts_on, ends_on, status").eq("org_id", org).eq("status", "exported") : Promise.resolve({ data: [] }),
    ]);
    const { data: notes } = await sb.from("entry_notes").select("id, employee_id, date, body, created_at").eq("org_id", org).eq("status", "open").order("created_at");

    // Arbeidsgiverperioden: varsel når den nærmer seg slutten, og når NAV har tatt over
    const [agp, plannedBreaches, workedBreaches] = await Promise.all([
      loadEmployerPeriods(ctx),
      checkPlannedShifts(ctx, today, addDays(today, 28)),
      checkWorkTime(ctx, addDays(today, -14), addDays(today, -1)),
    ]);
    for (const [emp, st] of agp) {
      if (!mine(emp)) continue;
      if (st.kind === "running" && st.period.days >= 12) {
        items.push({
          key: `agp-${emp}-${st.period.start}`, level: "amber",
          title: `Arbeidsgiverperioden for ${first(emp)}: dag ${st.period.days} av 16`,
          detail: `Syk fra ${formatDateLong(st.period.start)}. Fortsetter fraværet, betaler NAV sykepenger fra ${formatDateLong(st.navFrom)}. Etter egenmeldingsdagene trengs sykmelding fra lege.`,
          primary: { kind: "link", label: "Se fravær", href: "/fravaer#arbeidsgiverperiode" },
        });
      } else if (st.kind === "completed" && st.period.completedOn! <= today) {
        items.push({
          key: `agp-${emp}-${st.period.start}`, level: "blue",
          title: `Krev refusjon fra NAV for ${first(emp)}`,
          detail: `Arbeidsgiverperioden ble brukt opp ${formatDateLong(st.period.completedOn!)}. NAV betaler sykepenger fra ${formatDateLong(st.navFrom)}: send inntektsmelding, og trekk refusjonen i lønnen hvis dere betaler full lønn under sykdom.`,
          primary: { kind: "link", label: "Se fravær", href: "/fravaer#arbeidsgiverperiode" },
        });
      }
    }

    // Brudd på arbeidstidsreglene: i planen fram i tid (kan rettes), og i registrerte timer siste to uker
    for (const [emp, ws] of plannedBreaches) {
      if (!mine(emp)) continue;
      const w = ws[0];
      items.push({
        key: `brudd-plan-${emp}`, level: w.date <= addDays(today, 7) ? "red" : "amber",
        title: `Planen bryter arbeidstidsreglene for ${first(emp)}`,
        detail: ws.length > 1 ? `${w.text} (og ${ws.length - 1} til)` : w.text,
        primary: { kind: "link", label: "Åpne planen", href: `/vaktplan/rediger?visning=uke&dato=${w.date}` },
      });
    }
    for (const [emp, ws] of workedBreaches) {
      const br = ws.filter((w) => w.severity === "brudd");
      if (!br.length || !mine(emp)) continue;
      items.push({
        key: `brudd-timer-${emp}`, level: "grey",
        title: `${first(emp)} har jobbet utover arbeidstidsreglene`,
        detail: br.length > 1 ? `${br[0].text} (og ${br.length - 1} til)` : br[0].text,
        primary: { kind: "link", label: "Se rapporten", href: "/rapporter#arbeidstid-og-fravaer" },
      });
    }

    // Merknader fra ansatte: lederen tar stilling
    const myNotes = (notes ?? []).filter((n) => mine(n.employee_id));
    for (const n of myNotes.slice(0, 5)) {
      items.push({
        key: `note-${n.id}`, level: "amber",
        title: `${first(n.employee_id)} har en merknad til ${formatDateLong(n.date)}`,
        detail: `«${n.body.length > 160 ? `${n.body.slice(0, 160)} …` : n.body}»`,
        primary: { kind: "link", label: "Se og svar", href: "/timer?vis=alle#merknader" },
        secondary: { kind: "form", label: "Behandlet", action: "resolveNote", fields: { id: n.id } },
      });
    }
    if (myNotes.length > 5) items.push({ key: "note-more", level: "amber", title: `${myNotes.length - 5} merknader til fra ansatte`, primary: { kind: "link", label: "Se alle", href: "/timer?vis=alle#merknader" } });

    // Underbemanning de neste 7 dagene
    const cov = await coverageForDays(ctx, today, 7, shifts.filter((s) => localDate(new Date(s.starts_at), tz) < addDays(today, 7)));
    for (const c of cov.filter((x) => x.gaps.length).slice(0, 4)) {
      const soon = c.date <= addDays(today, 1);
      const missing = Math.max(...c.gaps.map((g) => g.missing));
      items.push({
        key: `gap-${c.date}`, level: soon ? "red" : "amber",
        title: `Mangler ${missing} på jobb ${c.date === today ? "i dag" : c.date === addDays(today, 1) ? "i morgen" : formatDateLong(c.date)}`,
        detail: c.gaps.map((g) => `${localTime(g.start, tz)}–${localTime(g.end, tz)}`).join(", "),
        due: c.date === today ? "I dag" : c.date === addDays(today, 1) ? "I morgen" : short(c.date),
        primary: { kind: "link", label: "Åpne planen", href: `/vaktplan/rediger?visning=uke&dato=${c.date}` },
      });
    }

    // Fravær: sykdom haster, andre søknader per stykk
    type Abs = { id: string; employee_id: string; from_date: string; to_date: string; from_time: string | null; to_time: string | null; comment: string | null; absence_types: { name: string; is_sick: boolean } | null };
    const absList = ((abs ?? []) as unknown as Abs[]).filter((a) => mine(a.employee_id));
    const when = (a: Abs) => a.from_time && a.to_time
      ? `${formatDateLong(a.from_date)} kl. ${a.from_time.slice(0, 5)}–${a.to_time.slice(0, 5)}`
      : a.from_date === a.to_date ? formatDateLong(a.from_date) : `${short(a.from_date)}–${short(a.to_date)}`;
    for (const a of absList.slice(0, 8)) {
      const sick = a.absence_types?.is_sick;
      items.push({
        key: `abs-${a.id}`, level: sick ? "red" : a.from_date <= addDays(today, 3) ? "amber" : "blue",
        title: sick ? `${first(a.employee_id)} har meldt seg syk` : `${first(a.employee_id)} søker om ${a.absence_types?.name.toLowerCase() ?? "fri"}`,
        detail: `${when(a)}${a.comment ? ` · «${a.comment}»` : ""}`,
        due: sick ? (a.from_date <= today ? "I dag" : undefined) : a.from_date <= addDays(today, 3) ? short(a.from_date) : undefined,
        primary: { kind: "form", label: sick ? "Godkjenn sykefravær" : "Godkjenn", action: "approveAbsence", fields: { id: a.id } },
        secondary: sick ? { kind: "link", label: "Se vaktene", href: `/foresporsler` } : { kind: "form", label: "Avslå", action: "rejectAbsence", fields: { id: a.id } },
      });
    }
    if (absList.length > 8) items.push({ key: "abs-more", level: "amber", title: `${absList.length - 8} søknader til om fri`, primary: { kind: "link", label: "Se alle", href: "/foresporsler" } });

    // Timer som venter, samlet. «Som planlagt» kan godkjennes med ett trykk.
    type Ent = { id: string; employee_id: string; shift_id: string | null; starts_at: string; ends_at: string; break_minutes: number; status: string; shifts: { starts_at: string; ends_at: string; break_minutes: number } | null };
    const ents = ((entries ?? []) as unknown as Ent[]).filter((e) => mine(e.employee_id));
    const submitted = ents.filter((e) => e.status === "submitted");
    const drafts = ents.filter((e) => e.status === "draft");
    const asPlanned = submitted.filter((e) => e.shifts && workedMinutes(new Date(e.starts_at), new Date(e.ends_at), e.break_minutes)
      === workedMinutes(new Date(e.shifts.starts_at), new Date(e.shifts.ends_at), e.shifts.break_minutes));
    const deadlineFor = (iso: string) => approvalDeadline(localDate(new Date(iso), tz).slice(0, 7), approveDay);
    const dueLevel = (deadline: string): TodoLevel => (deadline <= addDays(today, 2) ? "red" : "amber");
    if (submitted.length) {
      const deadline = submitted.map((e) => deadlineFor(e.starts_at)).sort()[0];
      const off = submitted.length - asPlanned.length;
      items.push({
        key: "entries", level: dueLevel(deadline),
        title: `${submitted.length} ${submitted.length === 1 ? "timeregistrering venter" : "timeregistreringer venter"} på godkjenning`,
        detail: `${nameList(submitted.map((e) => first(e.employee_id)))} · ${asPlanned.length} som planlagt${off ? `, ${off} avviker eller er uten vakt` : ""}`,
        due: `Frist ${short(deadline)}`,
        primary: asPlanned.length
          ? { kind: "form", label: asPlanned.length === submitted.length ? "Godkjenn alle" : `Godkjenn de ${asPlanned.length} som planlagt`, action: "approveEntries", fields: { ids: asPlanned.map((e) => e.id) } }
          : { kind: "link", label: "Se gjennom", href: "/timer?vis=alle" },
        secondary: asPlanned.length ? { kind: "link", label: off ? "Se avvikene" : "Se dem", href: "/timer?vis=alle" } : undefined,
      });
    }

    // Vakter uten timer og utkast (stemplet uten innsending): ikke bekreftet av den ansatte
    const withEntry = new Set(ents.map((e) => e.shift_id).filter(Boolean));
    const { data: anyEntry } = (past ?? []).length
      ? await sb.from("time_entries").select("shift_id").in("shift_id", (past ?? []).map((s) => s.id))
      : { data: [] as { shift_id: string | null }[] };
    for (const e of anyEntry ?? []) if (e.shift_id) withEntry.add(e.shift_id);
    const unconfirmed = (past ?? []).filter((s) => !withEntry.has(s.id) && mine(s.employee_id) && s.employee_id !== ctx.employeeId);
    if (unconfirmed.length || drafts.length) {
      const all = [...unconfirmed.map((s) => s.starts_at), ...drafts.map((d) => d.starts_at)];
      const deadline = all.map(deadlineFor).sort()[0];
      const n = unconfirmed.length + drafts.length;
      items.push({
        key: "unconfirmed", level: dueLevel(deadline),
        title: `${n} ${n === 1 ? "vakt er" : "vakter er"} ikke bekreftet av den ansatte`,
        detail: nameList([...unconfirmed.map((s) => `${first(s.employee_id)} ${short(localDate(new Date(s.starts_at), tz))}`), ...drafts.map((d) => `${first(d.employee_id)} ${short(localDate(new Date(d.starts_at), tz))}`)], 4),
        due: `Frist ${short(deadline)}`,
        primary: { kind: "form", label: "Godkjenn som planlagt", action: "approvePlanned",
          fields: { shift_ids: unconfirmed.map((s) => s.id), ids: drafts.map((d) => d.id) },
          confirm: "Den ansatte har ikke bekreftet timene for disse dagene. Timene merkes som ført av leder, og den ansatte får beskjed og kan melde fra hvis noe er feil. Vil du godkjenne likevel?" },
        secondary: { kind: "link", label: "Se dem", href: "/timer?vis=alle" },
      });
    }

    // Bytter og påmeldinger
    type Sw = { id: string; from_employee_id: string; to_employee_id: string | null; shifts: { starts_at: string; ends_at: string } | null };
    for (const w of ((swaps ?? []) as unknown as Sw[]).filter((x) => mine(x.from_employee_id))) {
      const d = w.shifts ? `${formatDateLong(localDate(new Date(w.shifts.starts_at), tz))} ${localTime(new Date(w.shifts.starts_at), tz)}–${localTime(new Date(w.shifts.ends_at), tz)}` : "";
      items.push({
        key: `swap-${w.id}`, level: "blue",
        title: w.to_employee_id ? `${first(w.from_employee_id)} vil bytte vakt med ${first(w.to_employee_id)}` : `${first(w.from_employee_id)} vil gi bort en vakt`,
        detail: d + (w.to_employee_id ? ` · ${first(w.to_employee_id)} har sagt ja` : " · vakten blir ledig"),
        primary: { kind: "form", label: w.to_employee_id ? "Godkjenn bytte" : "Godkjenn", action: "approveSwap", fields: { id: w.id } },
        secondary: { kind: "form", label: "Avslå", action: "rejectSwap", fields: { id: w.id } },
      });
    }
    type Rq = { id: string; employee_id: string; kind: string; requested_start: string | null; requested_end: string | null; shifts: { starts_at: string; ends_at: string } | null };
    for (const r of ((reqs ?? []) as unknown as Rq[]).filter((x) => mine(x.employee_id))) {
      const s = r.shifts?.starts_at ?? r.requested_start;
      const e = r.shifts?.ends_at ?? r.requested_end;
      items.push({
        key: `req-${r.id}`, level: "blue",
        title: r.kind === "open_shift" ? `${first(r.employee_id)} vil ta en ledig vakt` : `${first(r.employee_id)} tilbyr seg å jobbe`,
        detail: s && e ? `${formatDateLong(localDate(new Date(s), tz))} ${localTime(new Date(s), tz)}–${localTime(new Date(e), tz)}` : undefined,
        primary: { kind: "form", label: "Godkjenn", action: "approveRequest", fields: { id: r.id } },
        secondary: { kind: "form", label: "Avslå", action: "rejectRequest", fields: { id: r.id } },
      });
    }

    for (const c of (carry ?? []).filter((x) => mine(x.employee_id))) {
      items.push({ key: `carry-${c.id}`, level: "blue", title: `Ferieoverføring for ${first(c.employee_id)} venter på signatur`,
        detail: `${Number(c.days).toLocaleString("nb-NO")} dager fra ${c.from_year} til ${c.from_year + 1}`,
        primary: { kind: "link", label: "Åpne avtalen", href: `/ferie/overforing/${c.id}` } });
    }

    // Upubliserte vakter de neste fire ukene
    const draftsAhead = shifts.filter((s) => s.status === "draft" && new Date(s.starts_at) >= now && mine(s.employee_id));
    if (draftsAhead.length) {
      const firstDate = localDate(new Date(draftsAhead[0].starts_at), tz);
      items.push({
        key: "drafts", level: firstDate <= addDays(today, 7) ? "amber" : "blue",
        title: `${draftsAhead.length} ${draftsAhead.length === 1 ? "vakt er" : "vakter er"} ikke publisert`,
        detail: `Første ${formatDateLong(firstDate)} · de ansatte ser dem ikke før du publiserer`,
        due: firstDate <= addDays(today, 7) ? short(firstDate) : undefined,
        primary: { kind: "form", label: "Publiser", action: "publish", fields: { from: today, days: "28" } },
        secondary: { kind: "link", label: "Åpne planen", href: `/vaktplan/rediger?visning=uke&dato=${firstDate}` },
      });
    }

    // Lønn: forrige måned må låses før lønnskjøringen
    if (ctx.isAdmin) {
      const prevStart = addDays(today.slice(0, 8) + "01", -1).slice(0, 8) + "01";
      const prevEnd = addDays(today.slice(0, 8) + "01", -1);
      const payDate = `${today.slice(0, 8)}${String(payDay).padStart(2, "0")}`;
      const locked = (periods ?? []).some((p) => p.starts_on <= prevStart && p.ends_on >= prevEnd);
      const hadWork = (emps ?? []).some((e) => e.start_date <= prevEnd);
      if (!locked && hadWork && today <= payDate) {
        const m = MONTHS[Number(prevStart.slice(5, 7)) - 1];
        items.push({
          key: "payroll", level: today >= addDays(payDate, -2) ? "red" : "amber",
          title: `Lås lønnsgrunnlaget for ${m}`,
          detail: `Timene skal være godkjent ${approveDay}. ${MONTHS[Number(today.slice(5, 7)) - 1]}. Last ned filen til lønnssystemet og lås perioden.`,
          due: `Lønn ${short(payDate)}`,
          primary: { kind: "link", label: "Åpne lønn", href: `/lonn?fra=${prevStart}&til=${prevEnd}` },
        });
      }
    }

    // Oppfølging: pårørende og innlogging
    const active = (emps ?? []).filter((e) => (!e.end_date || e.end_date >= today) && mine(e.id));
    const withKin = new Set((kin ?? []).map((k) => k.employee_id));
    const noKin = active.filter((e) => e.user_id && !withKin.has(e.id));
    if (noKin.length) items.push({ key: "kin", level: "grey", title: `${noKin.length} ${noKin.length === 1 ? "ansatt mangler" : "ansatte mangler"} nærmeste pårørende`,
      detail: `${nameList(noKin.map((e) => first(e.id)))} · de får varsel i appen til det er lagt inn`, primary: { kind: "link", label: "Se ansatte", href: "/ansatte" } });
    const noLogin = active.filter((e) => !e.user_id);
    if (noLogin.length) items.push({ key: "login", level: "grey", title: `${noLogin.length} ${noLogin.length === 1 ? "ansatt har" : "ansatte har"} ikke innlogging`,
      detail: nameList(noLogin.map((e) => first(e.id))), primary: { kind: "link", label: "Se ansatte", href: "/ansatte" } });
  }

  // ---------------- Egne saker ----------------
  if (ctx.employeeId) {
    const me = ctx.employeeId;
    const [{ data: myShifts }, { data: myEntries }, { data: asks }, { data: myCarry }, { count: kinCount }, { data: myPending }] = await Promise.all([
      sb.from("shifts").select("id, starts_at, ends_at, break_minutes").eq("employee_id", me).eq("status", "published")
        .gte("starts_at", dayBounds(addDays(today, -14), tz).start.toISOString()).lte("starts_at", now.toISOString()).order("starts_at"),
      sb.from("time_entries").select("shift_id").eq("employee_id", me).gte("starts_at", dayBounds(addDays(today, -15), tz).start.toISOString()),
      sb.from("shift_swaps").select("id, from_employee_id, shifts(starts_at, ends_at)").eq("to_employee_id", me).eq("status", "pending").eq("to_accepted", false),
      sb.from("vacation_carryovers").select("id, days, from_year").eq("employee_id", me).eq("status", "pending").is("employee_accepted_at", null),
      sb.from("emergency_contacts").select("id", { count: "exact", head: true }).eq("employee_id", me),
      sb.from("absence_requests").select("from_date, to_date, absence_types(name)").eq("employee_id", me).eq("status", "pending"),
    ]);
    const done = new Set((myEntries ?? []).map((e) => e.shift_id));
    const open = (myShifts ?? []).filter((s) => !done.has(s.id));
    for (const s of open.slice(0, 5)) {
      const d = localDate(new Date(s.starts_at), tz);
      const ended = new Date(s.ends_at) <= now;
      items.push({
        key: `confirm-${s.id}`, level: d < addDays(today, -3) ? "amber" : "blue",
        title: ended ? `Bekreft timene for ${d === today ? "i dag" : d === addDays(today, -1) ? "i går" : formatDateLong(d)}` : "Bekreft dagens vakt når du er ferdig",
        detail: `Planlagt ${localTime(new Date(s.starts_at), tz)}–${localTime(new Date(s.ends_at), tz)}${s.break_minutes ? `, pause ${s.break_minutes} min` : ""}`,
        primary: { kind: "form", label: "Jobbet som planlagt", action: "confirmShift", fields: { shift_id: s.id } },
        secondary: { kind: "link", label: "Endre", href: "/timer#bekreft" },
      });
    }
    if (open.length > 5) items.push({ key: "confirm-more", level: "amber", title: `${open.length - 5} vakter til mangler bekreftede timer`, primary: { kind: "link", label: "Åpne timer", href: "/timer#bekreft" } });

    type Ask = { id: string; from_employee_id: string; shifts: { starts_at: string; ends_at: string } | null };
    for (const a of (asks ?? []) as unknown as Ask[]) {
      items.push({
        key: `ask-${a.id}`, level: "blue",
        title: `${first(a.from_employee_id)} spør om du kan ta en vakt`,
        detail: a.shifts ? `${formatDateLong(localDate(new Date(a.shifts.starts_at), tz))} ${localTime(new Date(a.shifts.starts_at), tz)}–${localTime(new Date(a.shifts.ends_at), tz)} · lederen godkjenner byttet` : undefined,
        primary: { kind: "form", label: "Ja, jeg tar den", action: "acceptSwap", fields: { id: a.id } },
        secondary: { kind: "form", label: "Nei", action: "declineSwap", fields: { id: a.id } },
      });
    }
    for (const c of myCarry ?? []) {
      items.push({ key: `mycarry-${c.id}`, level: "amber", title: "Signer avtalen om ferieoverføring",
        detail: `${Number(c.days).toLocaleString("nb-NO")} dager fra ${c.from_year} til ${c.from_year + 1}`,
        primary: { kind: "link", label: "Les og signer", href: `/ferie/overforing/${c.id}` } });
    }
    if (!kinCount) items.push({ key: "mykin", level: "amber", title: "Legg inn nærmeste pårørende", detail: "Hvem skal kontaktes hvis noe skjer med deg på jobb?",
      primary: { kind: "link", label: "Legg inn", href: "/profil#parorende" } });

    type P = { from_date: string; to_date: string; absence_types: { name: string } | null };
    for (const p of (myPending ?? []) as unknown as P[]) waiting.push(`${p.absence_types?.name ?? "Fri"} ${p.from_date === p.to_date ? short(p.from_date) : `${short(p.from_date)}–${short(p.to_date)}`}`);
  }

  items.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  return { items, waiting };
});

/** Antallet i menyen: saker som krever handling (ikke grå oppfølging). */
export async function todoCount(ctx: Ctx) {
  const { items } = await loadTodo(ctx);
  return items.filter((i) => i.level !== "grey").length;
}
