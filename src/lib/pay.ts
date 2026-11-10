// Lønnsgrunnlag og timesaldo. Ren logikk, testbar.
// Standardreglene følger Overenskomsten for bilutleie (NHO Reiseliv / Fellesforbundet) slik den
// står i utgaven 2024–2026, forenklet der det er nødvendig. Satser må holdes oppdatert.
import { addDays, dayBounds, isoWeekday, localDate, zonedToUtc, DEFAULT_TZ } from "./time";
import { holidayOn } from "./holidays";

export interface PayRules {
  name: string;
  /** Ordinær arbeidstid: [fra, til] i hele timer per ukedag (1 = man). Tom = ingen ordinær tid. */
  ordinaryWindow: Record<number, [number, number] | null>;
  /** Overtid 100 % etter dette klokkeslettet på hverdager */
  overtime100AfterHour: number;
  /** Overtid 100 % etter dette klokkeslettet på lørdag */
  saturday100AfterHour: number;
  /** Minste betalte tid ved tilsagt overtid som ikke henger sammen med ordinær tid (minutter) */
  calledOvertimeMinMinutes: number;
  /** Turnus-/skifttillegg i kroner per time */
  shiftSupplements: { evening: number; eveningFrom: number; eveningTo: number; saturday: number; saturdayFrom: number; holiday: number };
  /** Helligdagsgodtgjørelse for timelønnede: minst så mange dagers ansettelse */
  holidayPayMinDays: number;
}

export const BILUTLEIE_2024: PayRules = {
  name: "Overenskomsten for bilutleie 2024–2026 (forenklet)",
  ordinaryWindow: { 1: [6, 21], 2: [6, 21], 3: [6, 21], 4: [6, 21], 5: [6, 21], 6: [6, 15], 7: null },
  overtime100AfterHour: 21,
  saturday100AfterHour: 12,
  calledOvertimeMinMinutes: 120,
  shiftSupplements: { evening: 21.5, eveningFrom: 18, eveningTo: 6, saturday: 31, saturdayFrom: 12, holiday: 33 },
  holidayPayMinDays: 30,
};

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
  | "ordinary" | "extra" | "overtime_50" | "overtime_100"
  | "holiday_pay" | "supp_evening" | "supp_saturday" | "supp_holiday" | `absence_${string}`;

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

/** Del en arbeidsøkt i minutter per «klasse»: ordinær tid eller utenfor, og 50/100 % hvis overtid. */
function classifyMinutes(start: Date, end: Date, rules: PayRules, tz: string) {
  const out = { inside: 0, outside50: 0, outside100: 0, evening: 0, saturday: 0, holiday: 0, sunday100: 0 };
  // Gå i steg på ett minutt er for tregt over mange måneder; bruk 5-minutters steg.
  const step = 5 * 60000;
  for (let t = start.getTime(); t < end.getTime(); t += step) {
    const mins = Math.min(step, end.getTime() - t) / 60000;
    const d = new Date(t);
    const date = localDate(d, tz);
    const hour = (t - dayBounds(date, tz).start.getTime()) / H;
    const wd = isoWeekday(date);
    const isHoliday = holidayOn(date) !== null;
    const win = isHoliday ? null : rules.ordinaryWindow[wd];
    const inside = win !== null && win !== undefined && hour >= win[0] && hour < win[1];

    if (inside) out.inside += mins;
    else {
      const hundred =
        isHoliday || wd === 7 || (wd === 6 && hour >= rules.saturday100AfterHour) || (wd <= 5 && hour >= rules.overtime100AfterHour);
      if (hundred) out.outside100 += mins;
      else out.outside50 += mins;
    }
    const s = rules.shiftSupplements;
    if (isHoliday) out.holiday += mins;
    else if (wd === 6 && hour >= s.saturdayFrom) out.saturday += mins;
    if (!isHoliday && (hour >= s.eveningFrom || hour < s.eveningTo)) out.evening += mins;
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
  rules: PayRules = BILUTLEIE_2024,
  tz = DEFAULT_TZ,
): EmployeePay {
  const mine = entries.filter((e) => e.employeeId === employee.id).sort((a, b) => a.start.getTime() - b.start.getTime());
  const fullTimeMin = employee.fullTimeHours * 60;
  const contractMin = employee.hoursPerWeek * 60;
  const partTime = contractMin < fullTimeMin - 1;

  let ordinary = 0, extra = 0, ot50 = 0, ot100 = 0, worked = 0;
  let suppEvening = 0, suppSaturday = 0, suppHoliday = 0;

  // Uke for uke: ordinær tid fylles opp til avtalt tid, deretter mertid (deltid) opp til heltid, så overtid.
  const weeks = new Map<string, PayEntry[]>();
  for (const e of mine) {
    const k = weekKey(localDate(e.start, tz));
    weeks.set(k, [...(weeks.get(k) ?? []), e]);
  }

  for (const list of weeks.values()) {
    let weekOrdinary = 0;
    for (const e of list) {
      const gross = (e.end.getTime() - e.start.getTime()) / 60000;
      let paid = Math.max(0, gross - e.breakMinutes);
      const c = classifyMinutes(e.start, e.end, rules, tz);
      // Pausen trekkes forholdsmessig
      const f = gross > 0 ? paid / gross : 0;
      let inside = c.inside * f;
      let out50 = c.outside50 * f;
      let out100 = c.outside100 * f;

      // Skiftarbeidere: tid utenfor vinduet er ordinær tid med tillegg, ikke overtid
      if (employee.isShiftWorker) {
        inside += out50 + out100;
        out50 = 0;
        out100 = 0;
        suppEvening += c.evening * f;
        suppSaturday += c.saturday * f;
        suppHoliday += c.holiday * f;
      }

      // Tilsagt overtid som ikke henger sammen med ordinær tid: minst 2 timer
      if (e.calledOvertime && inside === 0 && paid < rules.calledOvertimeMinMinutes) {
        const add = rules.calledOvertimeMinMinutes - paid;
        out50 += add;
        paid += add;
      }
      worked += paid;

      // Tid innenfor vinduet: ordinær til avtalt tid, mertid opp til heltid, deretter overtid 50 %
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
      ot50 += rest + out50;
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
  push("overtime_50", "Overtid 50 %", ot50);
  push("overtime_100", "Overtid 100 %", ot100);
  const s = rules.shiftSupplements;
  push("supp_evening", `Kvelds-/nattillegg (kl. ${s.eveningFrom}–${String(s.eveningTo).padStart(2, "0")})`, suppEvening, s.evening);
  push("supp_saturday", `Lørdagstillegg (etter kl. ${s.saturdayFrom})`, suppSaturday, s.saturday);
  push("supp_holiday", "Helligdagstillegg", suppHoliday, s.holiday);

  // Helligdagsgodtgjørelse: timelønnede som ikke jobber en helligdag på en hverdag
  const dayMinutes = (contractMin / 5);
  if (employee.payType === "hourly" && employee.paidHolidays) {
    let hpMin = 0;
    let hpDays = 0;
    for (let d = period.from; d <= period.to; d = addDays(d, 1)) {
      const h = holidayOn(d);
      if (!h || isoWeekday(d) > 5) continue;
      const employedDays = (Date.parse(d) - Date.parse(employee.startDate)) / 86400000;
      if (employedDays < rules.holidayPayMinDays) continue;
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
