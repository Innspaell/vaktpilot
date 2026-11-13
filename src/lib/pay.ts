// Lønnsgrunnlag og timesaldo. Ren logikk, testbar.
// Reglene (tariff eller arbeidsmiljøloven) er data: de lagres i databasen med versjoner og velges per bedrift.
import { addDays, dayBounds, isoWeekday, localDate, zonedToUtc, DEFAULT_TZ } from "./time";
import { holidayOn, type HolidayKind } from "./holidays";

export interface Supplement {
  /** Brukes i lønnskoden: supp_<key> */
  key: string;
  label: string;
  /** Kroner per time */
  ratePerHour: number;
  /** Ukedager (1 = man … 7 = søn) */
  days: number[];
  /** Fra og til klokkeslett i hele timer. fra > til betyr over midnatt (f.eks. 18–6). */
  fromHour: number;
  toHour: number;
  /** exclude = ikke på helligdager, only = bare helligdager */
  holidays: "exclude" | "only";
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
  /** Helligdagsgodtgjørelse for timelønnede. onlyKinds: bare noen helligdager (f.eks. 1. og 17. mai). null = ingen. */
  holidayPay: { minDays: number; onlyKinds?: HolidayKind[] } | null;
}

/** Hvilke regler som gjelder en bestemt dato (tariff og versjon kan endre seg over tid). */
export type RuleResolver = (date: string) => PayRules;

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
  holidayPay: { minDays: 30, onlyKinds: ["may"] },
};

/** Les regler lagret som JSON. Manglende felt får verdien fra arbeidsmiljøloven. */
export function parseRules(json: unknown, key: string, name: string): PayRules {
  const j = (json && typeof json === "object" ? json : {}) as Partial<PayRules>;
  return { ...ARBEIDSMILJOLOVEN, ...j, key, name, supplements: Array.isArray(j.supplements) ? j.supplements : [] };
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

export type LineCode =
  | "ordinary" | "extra" | `overtime_${number}` | "holiday_pay" | `supp_${string}` | `absence_${string}`;

export interface PayLine {
  code: LineCode;
  label: string;
  hours: number;
  days?: number;
  rate?: number;
  amount?: number;
}

export interface EmployeePay {
  employee: PayEmployee;
  lines: PayLine[];
  workedHours: number;
}

const H = 3600000;
const round2 = (n: number) => Math.round(n * 100) / 100;

const inWindow = (hour: number, from: number, to: number) => (from <= to ? hour >= from && hour < to : hour >= from || hour < to);

/** Del en arbeidsøkt i minutter: ordinær tid eller utenfor (lav/100 % sats), og minutter per tillegg. */
function classifyMinutes(start: Date, end: Date, rules: PayRules, tz: string) {
  const out = { inside: 0, outsideLow: 0, outside100: 0, supp: new Map<string, number>() };
  // Steg på 5 minutter (ett minutt er for tregt over mange måneder)
  const step = 5 * 60000;
  for (let t = start.getTime(); t < end.getTime(); t += step) {
    const mins = Math.min(step, end.getTime() - t) / 60000;
    const d = new Date(t);
    const date = localDate(d, tz);
    const hour = (t - dayBounds(date, tz).start.getTime()) / H;
    const wd = isoWeekday(date);
    const isHoliday = holidayOn(date) !== null;
    const win = isHoliday && rules.sundayHoliday100 ? null : rules.ordinaryWindow[wd];
    const inside = win !== null && win !== undefined && hour >= win[0] && hour < win[1];

    if (inside) out.inside += mins;
    else {
      const hundred =
        (rules.sundayHoliday100 && (isHoliday || wd === 7)) ||
        (wd === 6 && rules.saturday100AfterHour !== null && hour >= rules.saturday100AfterHour) ||
        (wd <= 5 && rules.overtime100AfterHour !== null && hour >= rules.overtime100AfterHour);
      if (hundred) out.outside100 += mins;
      else out.outsideLow += mins;
    }
    for (const s of rules.supplements) {
      if (s.holidays === "only" ? !isHoliday : isHoliday) continue;
      if (!s.days.includes(wd) || !inWindow(hour, s.fromHour, s.toHour)) continue;
      out.supp.set(s.key, (out.supp.get(s.key) ?? 0) + mins);
    }
  }
  return out;
}

/** ISO-uke-nøkkel (mandag) for en dato. */
function weekKey(date: string) {
  return addDays(date, 1 - isoWeekday(date));
}

export function calculatePay(
  employee: PayEmployee,
  entries: PayEntry[],
  absences: PayAbsence[],
  period: { from: string; to: string },
  rulesOrResolver: PayRules | RuleResolver = ARBEIDSMILJOLOVEN,
  tz = DEFAULT_TZ,
): EmployeePay {
  const rulesAt: RuleResolver = typeof rulesOrResolver === "function" ? rulesOrResolver : () => rulesOrResolver;
  const mine = entries.filter((e) => e.employeeId === employee.id).sort((a, b) => a.start.getTime() - b.start.getTime());
  const contractMin = employee.hoursPerWeek * 60;

  let ordinary = 0, extra = 0, ot100 = 0, worked = 0;
  const otLow = new Map<number, number>(); // prosent → minutter
  const supp = new Map<string, { label: string; rate: number; minutes: number }>();
  const suppOrder = new Map<string, number>(); // samme rekkefølge som i reglene
  const addOtLow = (pct: number, m: number) => { if (m > 0) otLow.set(pct, (otLow.get(pct) ?? 0) + m); };

  // Uke for uke: ordinær tid fylles opp til avtalt tid, deretter mertid (deltid) opp til heltid, så overtid.
  const weeks = new Map<string, PayEntry[]>();
  for (const e of mine) {
    const k = weekKey(localDate(e.start, tz));
    weeks.set(k, [...(weeks.get(k) ?? []), e]);
  }

  for (const [wk, list] of weeks) {
    const weekRules = rulesAt(wk);
    const fullTimeMin = (weekRules.weeklyOvertimeAfterHours ?? employee.fullTimeHours) * 60;
    const partTime = contractMin < fullTimeMin - 1;
    let weekOrdinary = 0;
    const dayUsed = new Map<string, number>();
    for (const e of list) {
      const date = localDate(e.start, tz);
      const rules = rulesAt(date);
      const gross = (e.end.getTime() - e.start.getTime()) / 60000;
      let paid = Math.max(0, gross - e.breakMinutes);
      const c = classifyMinutes(e.start, e.end, rules, tz);
      // Pausen trekkes forholdsmessig
      const f = gross > 0 ? paid / gross : 0;
      let inside = c.inside * f;
      let outLow = c.outsideLow * f;
      let out100 = c.outside100 * f;

      if (employee.isShiftWorker && rules.shiftWorkersNoOvertime) {
        inside += outLow + out100;
        outLow = 0;
        out100 = 0;
      }
      rules.supplements.forEach((s, i) => { if (!suppOrder.has(s.key)) suppOrder.set(s.key, i); });
      for (const s of rules.supplements) {
        if (s.appliesTo === "shift_workers" && !employee.isShiftWorker) continue;
        const m = (c.supp.get(s.key) ?? 0) * f;
        if (m <= 0) continue;
        const k = `${s.key}|${s.ratePerHour}`;
        const cur = supp.get(k) ?? { label: s.label, rate: s.ratePerHour, minutes: 0 };
        cur.minutes += m;
        supp.set(k, cur);
      }

      // Dagsgrense: tid over grensen samme dag er overtid
      if (rules.dailyOvertimeAfterHours !== null) {
        const used = dayUsed.get(date) ?? 0;
        const room = Math.max(0, rules.dailyOvertimeAfterHours * 60 - used);
        const over = Math.max(0, inside - room);
        inside -= over;
        outLow += over;
        dayUsed.set(date, used + inside);
      }

      // Tilsagt overtid som ikke henger sammen med ordinær tid: minstetid
      if (e.calledOvertime && inside === 0 && paid < rules.calledOvertimeMinMinutes) {
        const add = rules.calledOvertimeMinMinutes - paid;
        outLow += add;
        paid += add;
      }
      worked += paid;

      // Ordinær til avtalt tid, mertid opp til heltid, deretter overtid
      const toContract = Math.max(0, Math.min(inside, contractMin - weekOrdinary));
      ordinary += toContract;
      weekOrdinary += toContract;
      let rest = inside - toContract;
      if (partTime && rest > 0) {
        const toFull = Math.max(0, Math.min(rest, fullTimeMin - weekOrdinary));
        extra += toFull;
        weekOrdinary += toFull;
        rest -= toFull;
      }
      addOtLow(rules.overtimePercent, rest + outLow);
      ot100 += out100;
    }
  }

  const lines: PayLine[] = [];
  const push = (code: LineCode, label: string, minutes: number, rate?: number) => {
    const hours = round2(minutes / 60);
    if (hours > 0) lines.push({ code, label, hours, rate, amount: rate !== undefined ? round2(hours * rate) : undefined });
  };
  push("ordinary", "Ordinære timer", ordinary);
  push("extra", "Mertid (deltid over avtalt tid)", extra);
  for (const [pct, m] of [...otLow].sort((a, b) => a[0] - b[0])) push(`overtime_${pct}`, `Overtid ${pct} %`, m);
  push("overtime_100", "Overtid 100 %", ot100);
  const sk = (k: string) => k.split("|")[0];
  const suppSorted = [...supp].sort((a, b) => (suppOrder.get(sk(a[0])) ?? 0) - (suppOrder.get(sk(b[0])) ?? 0) || a[1].rate - b[1].rate);
  for (const [k, v] of suppSorted) push(`supp_${sk(k)}`, v.label, v.minutes, v.rate);

  // Helligdagsgodtgjørelse: timelønnede som ikke jobber en helligdag på en hverdag
  const dayMinutes = (contractMin / 5);
  if (employee.payType === "hourly" && employee.paidHolidays) {
    let hpMin = 0;
    let hpDays = 0;
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
      hpDays++;
    }
    if (hpMin > 0) lines.push({ code: "holiday_pay", label: "Helligdagsgodtgjørelse", hours: round2(hpMin / 60), days: hpDays });
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
    lines.push({ code: `absence_${key}`, label: t.name, hours: round2(t.minutes / 60), days: t.days });
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

/** Lønnsgrunnlag som CSV (semikolon, norsk desimalkomma, BOM så Excel leser æøå riktig). */
export function payrollCsv(rows: EmployeePay[], period: { from: string; to: string }): string {
  const fmt = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", ","));
  const head = ["Ansattnummer", "Ansatt", "Periode fra", "Periode til", "Lønnstype", "Kode", "Beskrivelse", "Timer", "Dager", "Sats (kr)", "Beløp (kr)"];
  const lines = [head];
  for (const r of rows) {
    for (const l of r.lines) {
      lines.push([
        r.employee.employeeNumber ?? "", r.employee.name, period.from, period.to,
        r.employee.payType === "fixed" ? "Fastlønn" : "Timelønn",
        l.code, l.label, fmt(l.hours), l.days === undefined ? "" : String(l.days), fmt(l.rate), fmt(l.amount),
      ]);
    }
  }
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + lines.map((l) => l.map(esc).join(";")).join("\r\n") + "\r\n";
}

/** Hjelp: lokal dato + klokkeslett til Date (for tester). */
export const at = (date: string, time: string, tz = DEFAULT_TZ) => zonedToUtc(date, time, tz);
