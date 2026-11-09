import { addDays, isoWeekday } from "./time";
import { holidayOn } from "./holidays";

/** Arbeidsdager mandag–fredag i perioden, uten helligdager. Slik telles ferie. */
export function workdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isoWeekday(d) <= 5 && !holidayOn(d)) n++;
  }
  return n;
}

/** Ferieåret som inneholder datoen, gitt måneden ferieåret starter. */
export function vacationYear(date: string, startMonth = 1) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const startYear = m >= startMonth ? y : y - 1;
  const mm = String(startMonth).padStart(2, "0");
  const from = `${startYear}-${mm}-01`;
  const to = addDays(`${startYear + 1}-${mm}-01`, -1);
  return { from, to };
}

/** Dager av en periode som faller innenfor et annet tidsrom. */
export function overlapDays(from: string, to: string, rangeFrom: string, rangeTo: string) {
  const a = from > rangeFrom ? from : rangeFrom;
  const b = to < rangeTo ? to : rangeTo;
  return a <= b ? workdaysBetween(a, b) : 0;
}
