// Fraværsstatistikk: sykefraværsprosent og egenmeldinger. Ren logikk.
import { addDays, isoWeekday } from "./time";
import { holidayOn } from "./holidays";

export interface StatEmployee { id: string; name: string; positionPct: number; startDate: string; endDate: string | null }
export interface StatAbsence { employeeId: string; from: string; to: string; typeKey: string; partialHours: number | null }

const isWorkday = (d: string) => isoWeekday(d) <= 5 && !holidayOn(d);

/** Antall arbeidsdager (man–fre uten helligdager) i [from, to] der den ansatte var ansatt. */
export function employedWorkdays(e: StatEmployee, from: string, to: string) {
  let n = 0;
  const a = from > e.startDate ? from : e.startDate;
  const b = e.endDate && e.endDate < to ? e.endDate : to;
  for (let d = a; d <= b; d = addDays(d, 1)) if (isWorkday(d)) n++;
  return n;
}

/** Arbeidsdager med fravær av gitte typer i perioden. Deler av dag telles ikke som hel dag. */
export function absenceWorkdays(list: StatAbsence[], employeeId: string, keys: string[], from: string, to: string) {
  const days = new Set<string>();
  for (const a of list) {
    if (a.employeeId !== employeeId || !keys.includes(a.typeKey) || a.partialHours) continue;
    for (let d = a.from > from ? a.from : from; d <= (a.to < to ? a.to : to); d = addDays(d, 1)) if (isWorkday(d)) days.add(d);
  }
  return days.size;
}

/**
 * Sykefraværsprosent = tapte dagsverk / avtalte dagsverk × 100 (som SSB).
 * Et dagsverk vektes med stillingsprosenten, så deltid teller riktig.
 */
export function sickLeavePercent(employees: StatEmployee[], absences: StatAbsence[], from: string, to: string, keys = ["syk", "sykmelding"]) {
  let agreed = 0;
  let lost = 0;
  for (const e of employees) {
    const w = e.positionPct / 100;
    agreed += employedWorkdays(e, from, to) * w;
    lost += absenceWorkdays(absences, e.id, keys, from, to) * w;
  }
  return agreed > 0 ? Math.round((lost / agreed) * 1000) / 10 : 0;
}

/** Egenmeldinger siste 12 måneder: antall perioder og dager. */
export function selfCertification(absences: StatAbsence[], employeeId: string, today: string) {
  const since = addDays(today, -365);
  const periods = absences.filter((a) => a.employeeId === employeeId && a.typeKey === "syk" && a.to >= since);
  return { periods: periods.length, days: absenceWorkdays(absences, employeeId, ["syk"], since, today) };
}
