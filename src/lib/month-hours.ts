import { addDays, isoWeekday, workedMinutes } from "./time";
import { holidayOn } from "./holidays";

export interface MonthHoursRow {
  id: string;
  name: string;
  /** Registrerte timer som er ferdige (til og med nå). */
  done: number;
  /** Publiserte vakter som ikke har startet ennå. */
  plannedRest: number;
  /** Avtalt tid i måneden (timer per uke fordelt på hverdager uten helligdager). Null ved tilkalling. */
  agreed: number | null;
}

/** Hverdager uten helligdager i perioden. */
export function workdaysIn(from: string, to: string) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isoWeekday(d) <= 5 && !holidayOn(d)) n++;
  return n;
}

export interface MonthTerm { from: string; to: string | null; hoursPerWeek: number; onCall: boolean }

/**
 * Avtalt tid i perioden ut fra avtalene som gjaldt hver dag (timer per uke fordelt på hverdager uten helligdager).
 * Null når ingen dag har avtalt tid (tilkalling eller timebasis uten fast tid).
 */
export function agreedHours(terms: MonthTerm[], from: string, to: string): number | null {
  let min = 0;
  let any = false;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isoWeekday(d) > 5 || holidayOn(d)) continue;
    const t = terms.find((x) => x.from <= d && (!x.to || x.to >= d));
    if (!t || t.onCall || t.hoursPerWeek <= 0) continue;
    any = true;
    min += (t.hoursPerWeek * 60) / 5;
  }
  return any ? Math.round((min / 60) * 100) / 100 : null;
}

/** Timer hittil i måneden og planlagt resten, per ansatt. */
export function monthHours(input: {
  now: Date;
  monthFrom: string;
  monthTo: string;
  employees: { id: string; name: string; terms: MonthTerm[] }[];
  entries: { employeeId: string; start: Date; end: Date; breakMinutes: number }[];
  shifts: { employeeId: string | null; start: Date; end: Date; breakMinutes: number }[];
}): MonthHoursRow[] {
  const h = (min: number) => Math.round((min / 60) * 100) / 100;
  return input.employees.map((e) => {
    const done = input.entries.filter((x) => x.employeeId === e.id && x.end <= input.now)
      .reduce((s, x) => s + workedMinutes(x.start, x.end, x.breakMinutes), 0);
    const rest = input.shifts.filter((x) => x.employeeId === e.id && x.start >= input.now)
      .reduce((s, x) => s + workedMinutes(x.start, x.end, x.breakMinutes), 0);
    return { id: e.id, name: e.name, done: h(done), plannedRest: h(rest), agreed: agreedHours(e.terms, input.monthFrom, input.monthTo) };
  });
}
