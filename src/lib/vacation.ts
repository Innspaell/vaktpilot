// Feriesaldo per ferieår. Ferie trekkes fra året da den faktisk tas, ikke året den søkes.
import { addDays, isoWeekday } from "./time";
import { holidayOn } from "./holidays";
import { vacationYear } from "./absence";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface VacLedger { amount: number; date: string; source: string; note?: string | null; id?: string }
export interface VacAbsence { from: string; to: string; status: "approved" | "pending"; partialHours: number | null }

export interface VacationYear {
  year: number;            // året ferieåret starter i
  from: string;
  to: string;
  entitlement: number;     // rett etter avtalen
  adjustments: number;     // startsaldo og justeringer
  carriedIn: number;       // overført fra året før
  carriedOut: number;      // overført til året etter
  taken: number;           // godkjent og passert
  booked: number;          // godkjent, ikke tatt ennå
  pending: number;         // venter på svar
  remaining: number;       // rett + justering + inn − ut − tatt − godkjent
  remainingIfApproved: number;
  ledger: VacLedger[];
}

/** Ferie telt i arbeidsdager (man–fre uten helligdager) innenfor et tidsrom. Delvise dager telles som andel av en dag. */
export function vacationDaysIn(a: VacAbsence, from: string, to: string, hoursPerDay: number) {
  const s = a.from > from ? a.from : from;
  const e = a.to < to ? a.to : to;
  if (s > e) return 0;
  let n = 0;
  for (let d = s; d <= e; d = addDays(d, 1)) if (isoWeekday(d) <= 5 && !holidayOn(d)) n++;
  if (a.partialHours && a.from === a.to && hoursPerDay > 0) return n ? r2(Math.min(1, a.partialHours / hoursPerDay)) : 0;
  return n;
}

export function vacationForYear(input: {
  year: number;
  startMonth: number;
  today: string;
  entitlement: number;
  hoursPerWeek: number;
  ledger: VacLedger[];
  absences: VacAbsence[];
}): VacationYear {
  const mm = String(input.startMonth).padStart(2, "0");
  const { from, to } = vacationYear(`${input.year}-${mm}-01`, input.startMonth);
  const hpd = input.hoursPerWeek / 5;
  const inYear = input.ledger.filter((l) => l.date >= from && l.date <= to);
  const sum = (xs: VacLedger[]) => r2(xs.reduce((s, l) => s + l.amount, 0));
  const carriedIn = sum(inYear.filter((l) => l.source === "carryover_in"));
  const carriedOut = -sum(inYear.filter((l) => l.source === "carryover_out"));
  const adjustments = sum(inYear.filter((l) => l.source !== "carryover_in" && l.source !== "carryover_out"));
  let taken = 0, booked = 0, pending = 0;
  for (const a of input.absences) {
    if (a.status === "pending") { pending += vacationDaysIn(a, from, to, hpd); continue; }
    // Godkjent: del i tatt (til og med i dag) og planlagt (etter i dag)
    taken += vacationDaysIn(a, from, input.today < to ? input.today : to, hpd);
    if (input.today < to) booked += vacationDaysIn(a, addDays(input.today, 1) > from ? addDays(input.today, 1) : from, to, hpd);
  }
  const remaining = r2(input.entitlement + adjustments + carriedIn - carriedOut - taken - booked);
  return {
    year: input.year, from, to, entitlement: input.entitlement, adjustments, carriedIn, carriedOut,
    taken: r2(taken), booked: r2(booked), pending: r2(pending),
    remaining, remainingIfApproved: r2(remaining - pending), ledger: inYear,
  };
}

/** Ferieåret (startåret) for en dato. */
export function vacationYearOf(date: string, startMonth: number) {
  return Number(vacationYear(date, startMonth).from.slice(0, 4));
}

export const CARRYOVER_REASONS: Record<string, string> = {
  agreement: "Skriftlig avtale (ferieloven § 7 tredje ledd)",
  sick: "Ikke avviklet på grunn av arbeidsuførhet (ferieloven § 9)",
  parental: "Ikke avviklet på grunn av foreldrepermisjon (ferieloven § 9)",
  employer: "Ikke avviklet av forhold arbeidsgiver har ansvaret for (ferieloven § 7 andre ledd)",
};

export const ADJUSTMENT_TYPES: Record<string, string> = {
  start_taken: "Tatt før Vaktpilot",
  start_carry: "Overført fra før Vaktpilot",
  adjustment: "Annen justering",
};
