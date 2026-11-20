// Arbeidsgiverperioden ved sykdom (folketrygdloven § 8-19). Ren logikk.
//
// - Arbeidsgiveren betaler de første 16 kalenderdagene med sykefravær (egenmelding og sykmelding).
// - Flere korte fravær slås sammen til én periode når det er mindre enn 16 dager mellom dem.
// - Når 16 dager er brukt, betaler NAV videre. Blir den ansatte syk igjen innen 16 dager,
//   regnes det ikke ny arbeidsgiverperiode.
// - Dagen den ansatte går hjem syk i løpet av arbeidsdagen, kan regnes med, så delvise dager teller.
import { addDays } from "./time";

export const EMPLOYER_DAYS = 16;

export interface SickSpell { from: string; to: string }

export interface EmployerPeriod {
  /** Første sykedag i perioden */
  start: string;
  /** Sykedager telt i arbeidsgiverperioden (høyst 16) */
  days: number;
  /** Dagen da 16 dager var brukt, ellers null */
  completedOn: string | null;
  /** Siste sykedag i perioden (også dager NAV betaler) */
  lastSickDay: string;
  /** Sykedager etter arbeidsgiverperioden (NAV betaler) */
  navDays: number;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Alle arbeidsgiverperioder for én ansatt, eldste først. */
export function employerPeriods(spells: SickSpell[]): EmployerPeriod[] {
  const days = new Set<string>();
  for (const s of spells) for (let d = s.from; d <= s.to; d = addDays(d, 1)) days.add(d);
  const sorted = [...days].sort();
  const out: EmployerPeriod[] = [];
  let cur: EmployerPeriod | null = null;
  for (const d of sorted) {
    // Ny periode når den ansatte har vært tilbake i minst 16 dager siden forrige sykedag
    if (!cur || dayDiff(cur.lastSickDay, d) - 1 >= EMPLOYER_DAYS) {
      cur = { start: d, days: 0, completedOn: null, lastSickDay: d, navDays: 0 };
      out.push(cur);
    }
    if (cur.days < EMPLOYER_DAYS) {
      cur.days++;
      if (cur.days === EMPLOYER_DAYS) cur.completedOn = d;
    } else cur.navDays++;
    cur.lastSickDay = d;
  }
  return out;
}

export type EmployerStatus =
  | { kind: "running"; period: EmployerPeriod; daysLeft: number; navFrom: string }
  | { kind: "completed"; period: EmployerPeriod; navFrom: string };

/**
 * Status i dag: en periode som pågår (eller kan fortsette hvis den ansatte blir syk igjen innen 16 dager),
 * eller en som er brukt opp den siste tiden. null når ingenting er aktuelt.
 */
export function employerStatus(spells: SickSpell[], today: string, completedWithinDays = 30): EmployerStatus | null {
  // Bare dager til og med i dag: et registrert fravær fram i tid kan bli forkortet
  const periods = employerPeriods(spells.filter((x) => x.from <= today).map((x) => ({ from: x.from, to: x.to < today ? x.to : today })));
  const p = periods[periods.length - 1];
  if (!p) return null;
  if (p.completedOn) {
    const navFrom = addDays(p.completedOn, 1);
    return dayDiff(p.completedOn, today) <= completedWithinDays || p.lastSickDay >= today ? { kind: "completed", period: p, navFrom } : null;
  }
  // Ikke brukt opp: aktuell så lenge den kan fortsette (mindre enn 16 dager siden siste sykedag)
  if (dayDiff(p.lastSickDay, today) - 1 >= EMPLOYER_DAYS) return null;
  return { kind: "running", period: p, daysLeft: EMPLOYER_DAYS - p.days, navFrom: addDays(p.lastSickDay, EMPLOYER_DAYS - p.days + 1) };
}
