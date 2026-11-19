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

/** Timer hittil i måneden og planlagt resten, per ansatt. */
export function monthHours(input: {
  now: Date;
  monthFrom: string;
  monthTo: string;
  startDates?: Map<string, string>;
  employees: { id: string; name: string; hoursPerWeek: number | null; onCall: boolean }[];
  entries: { employeeId: string; start: Date; end: Date; breakMinutes: number }[];
  shifts: { employeeId: string | null; start: Date; end: Date; breakMinutes: number }[];
}): MonthHoursRow[] {
  const h = (min: number) => Math.round((min / 60) * 100) / 100;
  return input.employees.map((e) => {
    const done = input.entries.filter((x) => x.employeeId === e.id && x.end <= input.now)
      .reduce((s, x) => s + workedMinutes(x.start, x.end, x.breakMinutes), 0);
    const rest = input.shifts.filter((x) => x.employeeId === e.id && x.start >= input.now)
      .reduce((s, x) => s + workedMinutes(x.start, x.end, x.breakMinutes), 0);
    const start = input.startDates?.get(e.id);
    const from = start && start > input.monthFrom ? start : input.monthFrom;
    const agreed = e.onCall || e.hoursPerWeek === null ? null : Math.round((e.hoursPerWeek / 5) * workdaysIn(from, input.monthTo) * 100) / 100;
    return { id: e.id, name: e.name, done: h(done), plannedRest: h(rest), agreed };
  });
}
