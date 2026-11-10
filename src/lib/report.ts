// Rene beregninger for rapporter og avspasering. Ingen databasekall her, så alt kan testes.
import { addDays, isoWeekday, minutesPerLocalDay } from "./time";
import { holidayOn } from "./holidays";
import type { EmployeePay, Balance } from "./pay";
import type { DayCoverage } from "./staffing";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ReportShift { employeeId: string | null; start: Date; end: Date; breakMinutes: number }
export interface ReportEntry { employeeId: string; start: Date; end: Date; breakMinutes: number; status: string }
export type Grouping = "uke" | "maned";

export interface EmployeeRow {
  id: string;
  name: string;
  planned: number;
  registered: number;
  approved: number;
  overtime: number;
  extra: number;
  holidayWorked: number;
  paidAbsence: number;
  absenceDays: number;
  expected: number;
  balance: number;
}

export interface BucketRow {
  key: string;
  label: string;
  planned: number;
  registered: number;
  byEmployee: Map<string, { planned: number; registered: number }>;
}

/** Mandag i ISO-uka. */
export function weekStart(date: string) {
  return addDays(date, 1 - isoWeekday(date));
}

/** ISO-ukenummer. */
export function isoWeek(date: string) {
  const thursday = addDays(date, 4 - isoWeekday(date));
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor((Date.parse(thursday) - Date.parse(yearStart)) / 86400000 / 7) + 1;
}

const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

function bucketOf(date: string, g: Grouping) {
  if (g === "maned") return { key: date.slice(0, 7), label: `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` };
  const ws = weekStart(date);
  return { key: ws, label: `Uke ${isoWeek(date)} (${ws.slice(8)}.${ws.slice(5, 7)}.)` };
}

/** Fordel minutter på lokale datoer, så vakter over midnatt havner på riktig dag. */
function eachDay(start: Date, end: Date, breakMin: number, tz: string): [string, number][] {
  return minutesPerLocalDay(start, end, breakMin, tz).map((r) => [r.date, r.minutes]);
}

export function buildReport(input: {
  from: string;
  to: string;
  tz: string;
  grouping: Grouping;
  employees: { id: string; name: string }[];
  shifts: ReportShift[];
  entries: ReportEntry[];
  pay: EmployeePay[];
  balances: Map<string, Balance>;
}) {
  const { from, to, tz, grouping } = input;
  const inPeriod = (d: string) => d >= from && d <= to;
  const buckets = new Map<string, BucketRow>();
  const bucket = (d: string) => {
    const b = bucketOf(d, grouping);
    let row = buckets.get(b.key);
    if (!row) buckets.set(b.key, (row = { ...b, planned: 0, registered: 0, byEmployee: new Map() }));
    return row;
  };
  // Lag alle bøtter i perioden, også tomme
  for (let d = from; d <= to; d = addDays(d, 1)) bucket(d);

  const planned = new Map<string, number>();
  const registered = new Map<string, number>();
  const approved = new Map<string, number>();
  const holiday = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const s of input.shifts) {
    if (!s.employeeId) continue;
    for (const [d, min] of eachDay(s.start, s.end, s.breakMinutes, tz)) {
      if (!inPeriod(d)) continue;
      add(planned, s.employeeId, min);
      const b = bucket(d);
      b.planned += min;
      const e = b.byEmployee.get(s.employeeId) ?? { planned: 0, registered: 0 };
      e.planned += min;
      b.byEmployee.set(s.employeeId, e);
    }
  }
  for (const t of input.entries) {
    for (const [d, min] of eachDay(t.start, t.end, t.breakMinutes, tz)) {
      if (!inPeriod(d)) continue;
      add(registered, t.employeeId, min);
      if (t.status === "approved" || t.status === "locked") add(approved, t.employeeId, min);
      if (holidayOn(d)) add(holiday, t.employeeId, min);
      const b = bucket(d);
      b.registered += min;
      const e = b.byEmployee.get(t.employeeId) ?? { planned: 0, registered: 0 };
      e.registered += min;
      b.byEmployee.set(t.employeeId, e);
    }
  }

  const h = (m: Map<string, number>, k: string) => round2((m.get(k) ?? 0) / 60);
  const rows: EmployeeRow[] = input.employees.map((emp) => {
    const p = input.pay.find((x) => x.employee.id === emp.id);
    const line = (pred: (code: string) => boolean) => round2((p?.lines ?? []).filter((l) => pred(l.code)).reduce((s, l) => s + l.hours, 0));
    const b = input.balances.get(emp.id);
    return {
      id: emp.id,
      name: emp.name,
      planned: h(planned, emp.id),
      registered: h(registered, emp.id),
      approved: h(approved, emp.id),
      overtime: line((c) => c.startsWith("overtime_")),
      extra: line((c) => c === "extra"),
      holidayWorked: h(holiday, emp.id),
      paidAbsence: b?.paidAbsenceHours ?? 0,
      absenceDays: (p?.lines ?? []).filter((l) => l.code.startsWith("absence_")).reduce((s, l) => s + (l.days ?? 0), 0),
      expected: b?.expectedHours ?? 0,
      balance: b?.diffHours ?? 0,
    };
  });

  const bucketRows = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key)).map((b) => ({
    ...b, planned: round2(b.planned / 60), registered: round2(b.registered / 60),
  }));

  return { employees: rows, buckets: bucketRows };
}

/** Oppsummering av bemanningsdekning: dager med behov, dager med mangel og manglende persontimer. */
export function coverageSummary(days: (DayCoverage & { holiday?: unknown })[]) {
  const withNeed = days.filter((d) => !d.closed && d.peakRequired > 0);
  const short = withNeed
    .map((d) => ({
      date: d.date,
      required: d.peakRequired,
      planned: d.peakPlanned,
      missingHours: round2(d.gaps.reduce((s, g) => s + (g.missing * (g.end.getTime() - g.start.getTime())) / 3600000, 0)),
    }))
    .filter((d) => d.missingHours > 0);
  return {
    daysWithNeed: withNeed.length,
    daysCovered: withNeed.length - short.length,
    daysShort: short.length,
    missingHours: round2(short.reduce((s, d) => s + d.missingHours, 0)),
    short,
  };
}

// --- Avspasering -------------------------------------------------------------

export interface CompCredit { employeeId: string; hours: number }
export interface CompAbsence { employeeId: string; from: string; to: string; partialHours: number | null }

/**
 * Avspaseringssaldo: opptjent (registrert av leder, f.eks. overtid tatt som avspasering)
 * minus godkjent avspasering. Hele dager trekkes med avtalt dagslengde, delvise dager med oppgitte timer.
 */
export function compTimeBalance(
  employeeId: string,
  hoursPerWeek: number,
  credits: CompCredit[],
  taken: CompAbsence[],
) {
  const mineCredits = credits.filter((c) => c.employeeId === employeeId);
  const earned = mineCredits.filter((c) => c.hours > 0).reduce((s, c) => s + c.hours, 0);
  const corrections = mineCredits.filter((c) => c.hours < 0).reduce((s, c) => s + c.hours, 0);
  const day = hoursPerWeek / 5;
  let used = 0;
  for (const a of taken.filter((x) => x.employeeId === employeeId)) {
    for (let d = a.from; d <= a.to; d = addDays(d, 1)) {
      if (isoWeekday(d) > 5 || holidayOn(d)) continue;
      used += a.partialHours ? a.partialHours : day;
    }
  }
  used -= corrections;
  return { earned: round2(earned), used: round2(used), balance: round2(earned - used) };
}

