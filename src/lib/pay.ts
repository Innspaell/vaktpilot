// Lønnsgrunnlag og timesaldo. Ren logikk, testbar.
// Reglene (tariff eller arbeidsmiljøloven) er data: de lagres i databasen med versjoner og velges per bedrift.
import { addDays, isoWeekday, localDate, localParts, zonedToUtc, DEFAULT_TZ } from "./time";
import { holidayOn, type HolidayKind } from "./holidays";

export interface Supplement {
  /** Brukes i lønnskoden: supp_<key> */
  key: string;
  label: string;
  /** Kroner per time (brukes når percent ikke er satt) */
  ratePerHour: number;
  /** Tillegg i prosent av timelønnen. Vaktpilot regner bare timer: linjen får prosenten, lønnssystemet regner beløpet. */
  percent?: number | null;
  /** Ukedager (1 = man … 7 = søn) */
  days: number[];
  /** Fra og til klokkeslett i hele timer. fra > til betyr over midnatt (f.eks. 18–6). */
  fromHour: number;
  toHour: number;
  /** exclude = ikke på helligdager, only = bare helligdager */
  holidays: "exclude" | "only";
  appliesTo: "all" | "shift_workers";
  /** Tillegg i samme gruppe kombineres ikke: bare det første i listen som gjelder, blir gitt. */
  group?: string | null;
  /** Gis ikke for tid som er overtid (utenfor ordinær arbeidstid) */
  notOnOvertime?: boolean;
}

/** Fast beløp per hendelse, f.eks. per utlevering av leiebil utenfor ordinær tid. */
export interface EventSupplement {
  key: string;
  label: string;
  ratePerEvent: number;
  /** Annen sats på helligdager (null = samme) */
  holidayRatePerEvent?: number | null;
  appliesTo: "all" | "shift_workers";
}

export interface PayRules {
  key: string;
  name: string;
  /** Ordinær arbeidstid: [fra, til] i hele timer per ukedag (1 = man). null = ingen ordinær tid den dagen. */
  ordinaryWindow: Record<number, [number, number] | null>;
  /** Laveste overtidssats i prosent (50 i mange tariffer, minst 40 etter arbeidsmiljøloven) */
  overtimePercent: number;
  /** Overtid 100 % etter dette klokkeslettet på hverdager (null = ingen slik regel) */
  overtime100AfterHour: number | null;
  /** Overtid 100 % etter dette klokkeslettet på lørdag (null = ingen slik regel) */
  saturday100AfterHour: number | null;
  /** Tid utenfor ordinær tid på søndag og helligdag er overtid 100 % */
  sundayHoliday100: boolean;
  /** Overtid etter så mange timer per dag (null = ingen dagsgrense) */
  dailyOvertimeAfterHours: number | null;
  /** Overtid etter så mange timer per uke. null = bedriftens heltid. */
  weeklyOvertimeAfterHours: number | null;
  /** Minste betalte tid ved tilsagt overtid som ikke henger sammen med ordinær tid (minutter) */
  calledOvertimeMinMinutes: number;
  /** Turnus-/skiftarbeidere: tid utenfor ordinær tid er ordinær tid med tillegg, ikke overtid */
  shiftWorkersNoOvertime: boolean;
  supplements: Supplement[];
  eventSupplements: EventSupplement[];
  /** Helligdagsgodtgjørelse for timelønnede. onlyKinds: bare noen helligdager (f.eks. 1. og 17. mai). null = ingen. */
  holidayPay: { minDays: number; onlyKinds?: HolidayKind[] } | null;
}

/** Hvilke regler som gjelder en dato for en ansatt (tariff og versjon kan endre seg over tid). */
export type RuleResolver = (date: string, employeeId?: string) => PayRules;

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/** Overenskomsten for bilutleie (NHO Reiseliv / Fellesforbundet) 2024–2026, forenklet. */
export const BILUTLEIE_2024: PayRules = {
  key: "bilutleie",
  name: "Overenskomsten for bilutleie 2024–2026 (forenklet)",
  ordinaryWindow: { 1: [6, 21], 2: [6, 21], 3: [6, 21], 4: [6, 21], 5: [6, 21], 6: [6, 15], 7: null },
  overtimePercent: 50,
  overtime100AfterHour: 21,
  saturday100AfterHour: 12,
  sundayHoliday100: true,
  dailyOvertimeAfterHours: null,
  weeklyOvertimeAfterHours: null,
  calledOvertimeMinMinutes: 120,
  shiftWorkersNoOvertime: true,
  supplements: [
    { key: "evening", label: "Kvelds-/nattillegg (kl. 18–06)", ratePerHour: 21.5, days: ALL_DAYS, fromHour: 18, toHour: 6, holidays: "exclude", appliesTo: "shift_workers" },
    { key: "saturday", label: "Lørdagstillegg (etter kl. 12)", ratePerHour: 31, days: [6], fromHour: 12, toHour: 24, holidays: "exclude", appliesTo: "shift_workers" },
    { key: "holiday", label: "Helligdagstillegg", ratePerHour: 33, days: ALL_DAYS, fromHour: 0, toHour: 24, holidays: "only", appliesTo: "shift_workers" },
  ],
  eventSupplements: [],
  holidayPay: { minDays: 30 },
};

/**
 * Uten tariffavtale: arbeidsmiljølovens minstekrav. Overtid over 9 timer per dag eller 40 timer per uke, med minst 40 % tillegg.
 * Ingen faste tillegg. Lønn for 1. og 17. mai etter egne lover (ansatt i minst 30 dager).
 */
export const ARBEIDSMILJOLOVEN: PayRules = {
  key: "aml",
  name: "Uten tariff (arbeidsmiljøloven)",
  ordinaryWindow: { 1: [0, 24], 2: [0, 24], 3: [0, 24], 4: [0, 24], 5: [0, 24], 6: [0, 24], 7: [0, 24] },
  overtimePercent: 40,
  overtime100AfterHour: null,
  saturday100AfterHour: null,
  sundayHoliday100: false,
  dailyOvertimeAfterHours: 9,
  weeklyOvertimeAfterHours: 40,
  calledOvertimeMinMinutes: 0,
  shiftWorkersNoOvertime: false,
  supplements: [],
  eventSupplements: [],
  holidayPay: { minDays: 30, onlyKinds: ["may"] },
};

/** Les regler lagret som JSON. Manglende felt får verdien fra arbeidsmiljøloven. Overtid aldri under 40 %. */
export function parseRules(json: unknown, key: string, name: string): PayRules {
  const j = (json && typeof json === "object" ? json : {}) as Partial<PayRules>;
  const r = {
    ...ARBEIDSMILJOLOVEN, ...j, key, name,
    supplements: Array.isArray(j.supplements) ? j.supplements : [],
    eventSupplements: Array.isArray(j.eventSupplements) ? j.eventSupplements : [],
  };
  r.overtimePercent = Math.max(40, Number(r.overtimePercent) || 40);
  return r;
}

export interface PayEmployee {
  id: string;
  name: string;
  employeeNumber?: string | null;
  payType: "fixed" | "hourly";
  hoursPerWeek: number;
  fullTimeHours: number;
  isShiftWorker: boolean;
  paidHolidays: boolean;
  startDate: string;
  /** Gjennomsnittsberegning av arbeidstid (aml. § 10-5): grensene gjelder i snitt over blokker på så mange uker fra en startdato. */
  averaging?: { from: string; weeks: number; dailyHours?: number } | null;
}

export interface PayEntry {
  employeeId: string;
  start: Date;
  end: Date;
  breakMinutes: number;
  calledOvertime?: boolean;
  plannedStart?: Date | null;
  plannedEnd?: Date | null;
}

export interface PayAbsence {
  employeeId: string;
  from: string;
  to: string;
  typeKey: string;
  typeName: string;
  paid: boolean;
  countsAsWork: boolean;
  partialHours: number | null;
}

/** Registrert hendelse som gir et fast beløp, f.eks. en utlevering. */
export interface PayEvent {
  employeeId: string;
  date: string;
  key: string;
  count: number;
}

export type LineCode =
  | "ordinary" | "extra" | `overtime_${number}` | "holiday_pay" | `supp_${string}` | `event_${string}` | `absence_${string}`;

export interface PayLine {
  code: LineCode;
  label: string;
  hours: number;
  days?: number;
  /** Antall hendelser */
  quantity?: number;
  rate?: number;
  /** Tillegg i prosent av timelønnen (beløpet regnes i lønnssystemet) */
  percent?: number;
  amount?: number;
  /** Hvorfor linjen er der: regelen som er brukt */
  why?: string;
  /** Per dag: «man 16.11: 3 t (etter kl. 21)» */
  details?: string[];
}

export interface EmployeePay {
  employee: PayEmployee;
  lines: PayLine[];
  workedHours: number;
}

const H = 3600000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const WD = ["", "man", "tir", "ons", "tor", "fre", "lør", "søn"];
const dayLabel = (d: string) => `${WD[isoWeekday(d)]} ${d.slice(8)}.${d.slice(5, 7)}`;
const hh = (n: number) => String(n).padStart(2, "0");
const fmtH = (min: number) => `${round2(min / 60).toLocaleString("nb-NO")} t`;

const inWindow = (hour: number, from: number, to: number) => (from <= to ? hour >= from && hour < to : hour >= from || hour < to);

/** Del en arbeidsøkt i minutter: ordinær tid eller utenfor (lav/100 % sats), og minutter per tillegg. */
function classifyMinutes(start: Date, end: Date, rules: PayRules, tz: string, outsideIsOvertime: boolean) {
  const out = { inside: 0, outsideLow: 0, outside100: 0, supp: new Map<string, number>(), reason100: new Set<string>() };
  // Steg på 5 minutter (ett minutt er for tregt over mange måneder)
  const step = 5 * 60000;
  for (let t = start.getTime(); t < end.getTime(); t += step) {
    const mins = Math.min(step, end.getTime() - t) / 60000;
    // Lokal klokketid (riktig også når klokka stilles om sommer-/vintertid)
    const p = localParts(new Date(t), tz);
    const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    const hour = p.hour + p.minute / 60;
    const wd = isoWeekday(date);
    const isHoliday = holidayOn(date) !== null;
    const win = isHoliday && rules.sundayHoliday100 ? null : rules.ordinaryWindow[wd];
    const inside = win !== null && win !== undefined && hour >= win[0] && hour < win[1];

    if (inside) out.inside += mins;
    else {
      const r =
        rules.sundayHoliday100 && isHoliday ? "helligdag"
        : rules.sundayHoliday100 && wd === 7 ? "søndag"
        : wd === 6 && rules.saturday100AfterHour !== null && hour >= rules.saturday100AfterHour ? `lørdag etter kl. ${rules.saturday100AfterHour}`
        : wd <= 5 && rules.overtime100AfterHour !== null && hour >= rules.overtime100AfterHour ? `etter kl. ${rules.overtime100AfterHour}`
        : null;
      if (r) { out.outside100 += mins; out.reason100.add(r); }
      else out.outsideLow += mins;
    }
    const groups = new Set<string>();
    for (const s of rules.supplements) {
      if (s.holidays === "only" ? !isHoliday : isHoliday) continue;
      if (!s.days.includes(wd) || !inWindow(hour, s.fromHour, s.toHour)) continue;
      if (s.notOnOvertime && !inside && outsideIsOvertime) continue;
      if (s.group) { if (groups.has(s.group)) continue; groups.add(s.group); }
      out.supp.set(s.key, (out.supp.get(s.key) ?? 0) + mins);
    }
  }
  return out;
}

/** ISO-uke-nøkkel (mandag) for en dato. */
function weekKey(date: string) {
  return addDays(date, 1 - isoWeekday(date));
}

/** Nøkkel for uka eller gjennomsnittsblokka en dato hører til. */
function blockKey(date: string, avg: PayEmployee["averaging"]) {
  const wk = weekKey(date);
  if (!avg || avg.weeks <= 1 || date < avg.from) return { key: wk, weeks: 1 };
  const start = weekKey(avg.from);
  const weeksSince = Math.floor((Date.parse(wk) - Date.parse(start)) / (7 * 86400000));
  return { key: addDays(start, Math.floor(weeksSince / avg.weeks) * avg.weeks * 7), weeks: avg.weeks };
}

function describeSupplement(s: Supplement) {
  const when = s.holidays === "only" ? "på helligdager" : `kl. ${hh(s.fromHour)}–${hh(s.toHour)} ${s.days.length === 7 ? "alle dager" : s.days.map((d) => WD[d]).join(", ")}`;
  const extra = [s.appliesTo === "shift_workers" ? "for turnus og skift" : "", s.notOnOvertime ? "ikke på overtid" : "", s.group ? `kombineres ikke med andre i gruppen «${s.group}»` : ""].filter(Boolean);
  return `${s.percent ? `${s.percent} %` : `${s.ratePerHour.toLocaleString("nb-NO")} kr per time`}, ${when}${extra.length ? ` (${extra.join(", ")})` : ""}.`;
}

export function calculatePay(
  employee: PayEmployee,
  entries: PayEntry[],
  absences: PayAbsence[],
  period: { from: string; to: string },
  rulesOrResolver: PayRules | RuleResolver = ARBEIDSMILJOLOVEN,
  tz = DEFAULT_TZ,
  events: PayEvent[] = [],
): EmployeePay {
  const rulesAt = (date: string) => (typeof rulesOrResolver === "function" ? rulesOrResolver(date, employee.id) : rulesOrResolver);
  // Timer før perioden kan være med (samme uke/blokk) for å telle grensene riktig, men gir ikke linjer.
  const mine = entries.filter((e) => e.employeeId === employee.id && localDate(e.start, tz) <= period.to)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const contractMin = employee.hoursPerWeek * 60;
  const inPeriod = (d: string) => d >= period.from && d <= period.to;

  // Linjer med detaljer per dag
  type Acc = { label: string; minutes: number; rate?: number; percent?: number; why?: string; days: Map<string, { min: number; reasons: Set<string> }> };
  const acc = new Map<string, Acc>();
  const order: string[] = [];
  const add = (code: string, label: string, date: string, min: number, opts: { rate?: number; percent?: number; why?: string; reason?: string } = {}) => {
    if (min <= 0) return;
    const k = `${code}|${opts.rate ?? ""}|${opts.percent ?? ""}`;
    let a = acc.get(k);
    if (!a) { a = { label, minutes: 0, rate: opts.rate, percent: opts.percent, why: opts.why, days: new Map() }; acc.set(k, a); order.push(k); }
    a.minutes += min;
    const d = a.days.get(date) ?? { min: 0, reasons: new Set<string>() };
    d.min += min;
    if (opts.reason) d.reasons.add(opts.reason);
    a.days.set(date, d);
  };
  let worked = 0;
  const suppOrder = new Map<string, number>();

  const blocks = new Map<string, { weeks: number; list: PayEntry[] }>();
  for (const e of mine) {
    const b = blockKey(localDate(e.start, tz), employee.averaging);
    const cur = blocks.get(b.key) ?? { weeks: b.weeks, list: [] };
    cur.list.push(e);
    blocks.set(b.key, cur);
  }

  for (const [bk, { weeks, list }] of blocks) {
    const blockRules = rulesAt(bk);
    const fullTimeMin = (blockRules.weeklyOvertimeAfterHours ?? employee.fullTimeHours) * 60 * weeks;
    const contractBlock = contractMin * weeks;
    const partTime = contractMin * weeks < fullTimeMin - 1;
    let blockOrdinary = 0;
    const dayUsed = new Map<string, number>();
    for (const e of list) {
      const date = localDate(e.start, tz);
      const count = inPeriod(date);
      const rules = rulesAt(date);
      const outsideIsOvertime = !(employee.isShiftWorker && rules.shiftWorkersNoOvertime);
      const gross = (e.end.getTime() - e.start.getTime()) / 60000;
      let paid = Math.max(0, gross - e.breakMinutes);
      const c = classifyMinutes(e.start, e.end, rules, tz, outsideIsOvertime);
      // Pausen trekkes forholdsmessig
      const f = gross > 0 ? paid / gross : 0;
      let inside = c.inside * f;
      let outLow = c.outsideLow * f;
      let out100 = c.outside100 * f;
      const lowReasons: string[] = [];
      if (outLow > 0) lowReasons.push("utenfor ordinær arbeidstid");

      if (!outsideIsOvertime) {
        inside += outLow + out100;
        outLow = 0;
        out100 = 0;
        lowReasons.length = 0;
      }
      if (count) {
        rules.supplements.forEach((s, i) => { if (!suppOrder.has(s.key)) suppOrder.set(s.key, i); });
        for (const s of rules.supplements) {
          if (s.appliesTo === "shift_workers" && !employee.isShiftWorker) continue;
          const m = (c.supp.get(s.key) ?? 0) * f;
          add(`supp_${s.key}`, s.label, date, m, s.percent ? { percent: s.percent, why: describeSupplement(s) } : { rate: s.ratePerHour, why: describeSupplement(s) });
        }
      }

      // Dagsgrense: tid over grensen samme dag er overtid
      const dailyLimit = employee.averaging && employee.averaging.weeks > 1 && date >= employee.averaging.from
        ? (employee.averaging.dailyHours ?? Math.max(rules.dailyOvertimeAfterHours ?? 10, 10))
        : rules.dailyOvertimeAfterHours;
      if (dailyLimit !== null) {
        const used = dayUsed.get(date) ?? 0;
        const room = Math.max(0, dailyLimit * 60 - used);
        const over = Math.max(0, inside - room);
        if (over > 0) lowReasons.push(`over ${dailyLimit} t samme dag`);
        inside -= over;
        outLow += over;
        dayUsed.set(date, used + inside);
      }

      // Tilsagt overtid som ikke henger sammen med ordinær tid: minstetid
      if (e.calledOvertime && inside === 0 && paid < rules.calledOvertimeMinMinutes) {
        const extraMin = rules.calledOvertimeMinMinutes - paid;
        outLow += extraMin;
        paid += extraMin;
        lowReasons.push(`minstetid ${rules.calledOvertimeMinMinutes / 60} t ved utkalling`);
      }
      if (count) worked += paid;

      // Ordinær til avtalt tid, mertid opp til heltid, deretter overtid
      const toContract = Math.max(0, Math.min(inside, contractBlock - blockOrdinary));
      blockOrdinary += toContract;
      let rest = inside - toContract;
      let toFull = 0;
      if (partTime && rest > 0) {
        toFull = Math.max(0, Math.min(rest, fullTimeMin - blockOrdinary));
        blockOrdinary += toFull;
        rest -= toFull;
      }
      if (rest > 0) lowReasons.push(weeks > 1 ? `over ${round2(fullTimeMin / 60 / weeks)} t/uke i snitt over ${weeks} uker` : `over ${round2(fullTimeMin / 60)} t i uka`);
      if (!count) continue;
      const per = weeks > 1 ? ` i snitt over ${weeks} uker` : " per uke";
      add("ordinary", "Ordinære timer", date, toContract, { why: `Arbeid innenfor ordinær arbeidstid, opp til avtalt tid (${employee.hoursPerWeek.toLocaleString("nb-NO")} t${per}).` });
      add("extra", "Mertid (deltid over avtalt tid)", date, toFull, { why: `Over avtalt tid, men ikke over heltid (${round2(fullTimeMin / 60 / weeks).toLocaleString("nb-NO")} t${per}).` });
      add(`overtime_${rules.overtimePercent}`, `Overtid ${rules.overtimePercent} %`, date, rest + outLow, { reason: lowReasons.join(", "), why: "Arbeid utover grensene for ordinær tid og heltid." });
      add("overtime_100", "Overtid 100 %", date, out100, { reason: [...c.reason100].join(", "), why: "Arbeid på tidspunkter som gir 100 % etter reglene." });
    }
  }

  // Hendelser med fast beløp (f.eks. utlevering)
  for (const ev of events.filter((x) => x.employeeId === employee.id && inPeriod(x.date) && x.count > 0)) {
    const rules = rulesAt(ev.date);
    const def = rules.eventSupplements.find((d) => d.key === ev.key);
    if (!def || (def.appliesTo === "shift_workers" && !employee.isShiftWorker)) continue;
    const holiday = holidayOn(ev.date) !== null;
    const rate = holiday && def.holidayRatePerEvent != null ? def.holidayRatePerEvent : def.ratePerEvent;
    const k = `event_${def.key}|${rate}|`;
    let a = acc.get(k);
    if (!a) {
      a = { label: def.label, minutes: 0, rate, why: `${def.ratePerEvent.toLocaleString("nb-NO")} kr per gang${def.holidayRatePerEvent != null ? `, ${def.holidayRatePerEvent.toLocaleString("nb-NO")} kr på helligdager` : ""}.`, days: new Map() };
      acc.set(k, a); order.push(k);
    }
    const d = a.days.get(ev.date) ?? { min: 0, reasons: new Set<string>() };
    d.min += ev.count; // antall, ikke minutter
    a.days.set(ev.date, d);
    a.minutes += ev.count;
  }

  const lines: PayLine[] = [];
  const codeOf = (k: string) => k.split("|")[0];
  const rank = (k: string) => {
    const c = codeOf(k);
    if (c === "ordinary") return 0;
    if (c === "extra") return 1;
    if (c.startsWith("overtime_")) return c === "overtime_100" ? 3 : 2 + Number(c.slice(9)) / 1000;
    if (c.startsWith("supp_")) return 10 + (suppOrder.get(c.slice(5)) ?? 50) + (acc.get(k)?.rate ?? 0) / 1e6;
    return 100;
  };
  for (const k of [...order].sort((a, b) => rank(a) - rank(b))) {
    const a = acc.get(k)!;
    const code = codeOf(k) as LineCode;
    const details = [...a.days].sort((x, y) => x[0].localeCompare(y[0]))
      .map(([d, v]) => `${dayLabel(d)}: ${code.startsWith("event_") ? `${v.min} stk` : fmtH(v.min)}${v.reasons.size ? ` (${[...v.reasons].filter(Boolean).join(", ")})` : ""}`);
    if (code.startsWith("event_")) {
      lines.push({ code, label: a.label, hours: 0, quantity: a.minutes, rate: a.rate, amount: a.rate !== undefined ? round2(a.minutes * a.rate) : undefined, why: a.why, details });
      continue;
    }
    const hours = round2(a.minutes / 60);
    if (hours <= 0) continue;
    lines.push({
      code, label: a.label, hours, rate: a.rate, percent: a.percent,
      amount: a.rate !== undefined ? round2(hours * a.rate) : undefined, why: a.why, details,
    });
  }

  // Helligdagsgodtgjørelse: timelønnede som ikke jobber en helligdag på en hverdag
  const dayMinutes = (contractMin / 5);
  if (employee.payType === "hourly" && employee.paidHolidays) {
    let hpMin = 0;
    const hpDates: string[] = [];
    for (let d = period.from; d <= period.to; d = addDays(d, 1)) {
      const h = holidayOn(d);
      if (!h || isoWeekday(d) > 5) continue;
      const hp = rulesAt(d).holidayPay;
      if (!hp || (hp.onlyKinds && !hp.onlyKinds.includes(h.kind))) continue;
      const employedDays = (Date.parse(d) - Date.parse(employee.startDate)) / 86400000;
      if (employedDays < hp.minDays) continue;
      const workedThatDay = mine.some((e) => localDate(e.start, tz) === d);
      if (workedThatDay) continue;
      hpMin += dayMinutes;
      hpDates.push(`${dayLabel(d)}: ${h.name}`);
    }
    if (hpMin > 0) lines.push({
      code: "holiday_pay", label: "Helligdagsgodtgjørelse", hours: round2(hpMin / 60), days: hpDates.length,
      why: "Helligdag på en hverdag uten arbeid. Avtalt tid per dag (avtalt tid per uke delt på 5).", details: hpDates,
    });
  }

  // Fravær per type: dager (man–fre uten helligdager) og timer
  const byType = new Map<string, { name: string; days: number; minutes: number }>();
  for (const a of absences.filter((x) => x.employeeId === employee.id)) {
    for (let d = a.from > period.from ? a.from : period.from; d <= (a.to < period.to ? a.to : period.to); d = addDays(d, 1)) {
      if (isoWeekday(d) > 5 || holidayOn(d)) continue;
      const t = byType.get(a.typeKey) ?? { name: a.typeName, days: 0, minutes: 0 };
      t.days += a.partialHours ? 0 : 1;
      t.minutes += a.partialHours ? a.partialHours * 60 : a.paid ? dayMinutes : 0;
      byType.set(a.typeKey, t);
    }
  }
  for (const [key, t] of byType) {
    lines.push({ code: `absence_${key}`, label: t.name, hours: round2(t.minutes / 60), days: t.days, why: "Godkjent fravær, telt i arbeidsdager (man–fre uten helligdager)." });
  }

  return { employee, lines, workedHours: round2(worked / 60) };
}

export interface Balance {
  expectedHours: number;
  workedHours: number;
  paidAbsenceHours: number;
  diffHours: number;
}

/**
 * Timesaldo i perioden: forventet tid (avtalt tid fordelt på hverdager, uten helligdager)
 * mot arbeidet tid pluss betalt fravær som teller som arbeidstid.
 */
export function timeBalance(
  employee: PayEmployee,
  entries: PayEntry[],
  absences: PayAbsence[],
  period: { from: string; to: string },
  tz = DEFAULT_TZ,
): Balance {
  const dayMin = (employee.hoursPerWeek * 60) / 5;
  let expected = 0;
  const from = period.from > employee.startDate ? period.from : employee.startDate;
  for (let d = from; d <= period.to; d = addDays(d, 1)) {
    if (isoWeekday(d) <= 5 && !holidayOn(d)) expected += dayMin;
  }
  const worked = entries
    .filter((e) => e.employeeId === employee.id && localDate(e.start, tz) >= period.from && localDate(e.start, tz) <= period.to)
    .reduce((s, e) => s + Math.max(0, (e.end.getTime() - e.start.getTime()) / 60000 - e.breakMinutes), 0);
  let absence = 0;
  for (const a of absences.filter((x) => x.employeeId === employee.id && x.countsAsWork)) {
    for (let d = a.from > from ? a.from : from; d <= (a.to < period.to ? a.to : period.to); d = addDays(d, 1)) {
      if (isoWeekday(d) > 5 || holidayOn(d)) continue;
      absence += a.partialHours ? a.partialHours * 60 : dayMin;
    }
  }
  return {
    expectedHours: round2(expected / 60),
    workedHours: round2(worked / 60),
    paidAbsenceHours: round2(absence / 60),
    diffHours: round2((worked + absence - expected) / 60),
  };
}

/** Lønnsgrunnlag som CSV (semikolon, norsk desimalkomma, BOM så Excel leser æøå riktig). Lønnsart fra bedriftens kobling. */
export function payrollCsv(rows: EmployeePay[], period: { from: string; to: string }, wageTypes?: Map<string, string>): string {
  const fmt = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", ","));
  const head = ["Ansattnummer", "Ansatt", "Periode fra", "Periode til", "Lønnstype", "Lønnsart", "Kode", "Beskrivelse", "Timer", "Dager", "Antall", "Sats (kr)", "Prosent", "Beløp (kr)"];
  const lines = [head];
  for (const r of rows) {
    for (const l of r.lines) {
      lines.push([
        r.employee.employeeNumber ?? "", r.employee.name, period.from, period.to,
        r.employee.payType === "fixed" ? "Fastlønn" : "Timelønn",
        wageTypeFor(l.code, wageTypes) ?? "", l.code, l.label, fmt(l.hours), l.days === undefined ? "" : String(l.days),
        fmt(l.quantity), fmt(l.rate), fmt(l.percent), fmt(l.amount),
      ]);
    }
  }
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "\uFEFF" + lines.map((l) => l.map(esc).join(";")).join("\r\n") + "\r\n";
}

/** Lønnsart for en kode: eksakt kode, ellers gruppen (f.eks. «absence_*»). */
export function wageTypeFor(code: string, map?: Map<string, string>) {
  if (!map) return undefined;
  return map.get(code) ?? map.get(code.split("_")[0] + "_*");
}

/** Hjelp: lokal dato + klokkeslett til Date (for tester). */
export const at = (date: string, time: string, tz = DEFAULT_TZ) => zonedToUtc(date, time, tz);

/**
 * Differanse mellom to lønnsgrunnlag for samme periode (f.eks. etter nye satser med tilbakevirkning).
 * Én linje per ansatt, kode og sats der timer, antall eller beløp er endret. Negative tall = trekk.
 */
export function diffPay(before: EmployeePay[], after: EmployeePay[]): EmployeePay[] {
  const key = (l: PayLine) => `${l.code}|${l.rate ?? ""}|${l.percent ?? ""}`;
  const ids = [...new Set([...before.map((p) => p.employee.id), ...after.map((p) => p.employee.id)])];
  const out: EmployeePay[] = [];
  for (const id of ids) {
    const b = before.find((p) => p.employee.id === id);
    const a = after.find((p) => p.employee.id === id);
    const emp = (a ?? b)!.employee;
    const map = new Map<string, { old?: PayLine; now?: PayLine }>();
    for (const l of b?.lines ?? []) map.set(key(l), { ...map.get(key(l)), old: l });
    for (const l of a?.lines ?? []) map.set(key(l), { ...map.get(key(l)), now: l });
    const lines: PayLine[] = [];
    for (const { old, now } of map.values()) {
      const ref = (now ?? old)!;
      const d = (x?: number, y?: number) => round2((y ?? 0) - (x ?? 0));
      const hours = d(old?.hours, now?.hours);
      const quantity = old?.quantity !== undefined || now?.quantity !== undefined ? d(old?.quantity, now?.quantity) : undefined;
      const amount = old?.amount !== undefined || now?.amount !== undefined ? d(old?.amount, now?.amount) : undefined;
      const days = old?.days !== undefined || now?.days !== undefined ? d(old?.days, now?.days) : undefined;
      if (!hours && !quantity && !amount && !days) continue;
      lines.push({ code: ref.code, label: `${ref.label} (differanse)`, hours, quantity, days, rate: ref.rate, percent: ref.percent, amount,
        why: `Før: ${old ? `${old.hours} t${old.amount !== undefined ? `, ${old.amount} kr` : ""}` : "ingen"}. Nå: ${now ? `${now.hours} t${now.amount !== undefined ? `, ${now.amount} kr` : ""}` : "ingen"}.` });
    }
    if (lines.length) out.push({ employee: emp, lines, workedHours: round2((a?.workedHours ?? 0) - (b?.workedHours ?? 0)) });
  }
  return out;
}
