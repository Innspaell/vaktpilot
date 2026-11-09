// Advarsler om arbeidstid. Gir beskjed, stopper ikke. Administrator avgjør.
import { workedMinutes } from "./time";

export interface Interval {
  start: Date;
  end: Date;
  breakMinutes?: number;
}

export interface WarningLimits {
  minDailyRestHours: number; // 11 etter arbeidsmiljøloven
  maxHoursPerDay: number; // advarsel ved lange vakter
  maxHoursPer7Days: number;
}

export const DEFAULT_LIMITS: WarningLimits = { minDailyRestHours: 11, maxHoursPerDay: 13, maxHoursPer7Days: 48 };

export type WarningCode = "overlap" | "absence" | "short_rest" | "long_day" | "long_week";

export interface Warning {
  code: WarningCode;
  message: string;
}

const H = 3600000;

/** Sjekker en ny vakt mot den ansattes øvrige vakter og fravær. */
export function checkShift(
  candidate: Interval,
  existing: Interval[],
  absenceDates: string[],
  candidateDates: string[],
  limits: WarningLimits = DEFAULT_LIMITS,
): Warning[] {
  const out: Warning[] = [];
  const c0 = candidate.start.getTime();
  const c1 = candidate.end.getTime();

  if (existing.some((e) => e.start.getTime() < c1 && e.end.getTime() > c0)) {
    out.push({ code: "overlap", message: "Overlapper med en annen vakt." });
  }
  if (candidateDates.some((d) => absenceDates.includes(d))) {
    out.push({ code: "absence", message: "Den ansatte har godkjent fravær denne dagen." });
  }

  const before = existing.filter((e) => e.end.getTime() <= c0).sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  const after = existing.filter((e) => e.start.getTime() >= c1).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const restBefore = before ? (c0 - before.end.getTime()) / H : Infinity;
  const restAfter = after ? (after.start.getTime() - c1) / H : Infinity;
  const minRest = Math.min(restBefore, restAfter);
  if (minRest < limits.minDailyRestHours) {
    out.push({
      code: "short_rest",
      message: `Bare ${fmt(minRest)} timer hvile mellom vaktene (grense ${limits.minDailyRestHours}).`,
    });
  }

  const hours = workedMinutes(candidate.start, candidate.end, candidate.breakMinutes ?? 0) / 60;
  if (hours > limits.maxHoursPerDay) {
    out.push({ code: "long_day", message: `Vakten er ${fmt(hours)} timer (grense ${limits.maxHoursPerDay}).` });
  }

  // Sum i 7-dagersvinduer som inneholder vakten
  let worstWeek = 0;
  const all = [...existing, candidate];
  for (let s = c0 - 6 * 24 * H; s <= c0; s += 24 * H) {
    const e = s + 7 * 24 * H;
    const sum = all
      .filter((i) => i.start.getTime() < e && i.end.getTime() > s)
      .reduce((acc, i) => acc + workedMinutes(i.start, i.end, i.breakMinutes ?? 0) / 60, 0);
    worstWeek = Math.max(worstWeek, sum);
  }
  if (worstWeek > limits.maxHoursPer7Days) {
    out.push({ code: "long_week", message: `${fmt(worstWeek)} timer i løpet av 7 dager (grense ${limits.maxHoursPer7Days}).` });
  }
  return out;
}

function fmt(n: number) {
  return (Math.round(n * 10) / 10).toLocaleString("nb-NO");
}
