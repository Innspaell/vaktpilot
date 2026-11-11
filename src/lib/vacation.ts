// Feriesaldo per ferieår. Ferie trekkes fra året da den faktisk tas, ikke året den søkes.
import { addDays, isoWeekday } from "./time";
import { holidayOn } from "./holidays";
import { vacationYear } from "./absence";

const r2 = (n: number) => Math.round(n * 100) / 100;

/*
 * Ferieloven regner i virkedager: alle dager unntatt søndager og helligdager (lørdag er virkedag).
 *   Lovbestemt ferie: 25 virkedager = 4 uker og 1 dag (§ 5 nr. 1).
 *   60 år: én ekstra uke = 6 virkedager (§ 5 nr. 1).
 *   Overføring etter skriftlig avtale: inntil 12 virkedager = 2 uker (§ 7 nr. 3).
 *   Forskuddsferie: inntil 12 virkedager = 2 uker (§ 7 nr. 4).
 *   Hovedferie: 18 virkedager = 3 uker mellom 1. juni og 30. september (§ 5 nr. 2).
 * Avtalefestet ferie (tariff): 4 dager, som sammen med lovens 25. dag gir den femte uka.
 *
 * Vaktpilot teller ferie i den ansattes egne arbeidsdager, slik det er vanlig og forståelig.
 * Lovens uker regnes om etter hvor mange dager i uka den ansatte jobber (d):
 *   én uke = d arbeidsdager = 6 virkedager. Ekstradagen («og 1 dag») er én fridag.
 * Slik blir 5 uker = 25 arbeidsdager for den som jobber mandag–fredag, og grensene riktige for deltid.
 */
export interface VacationRules { daysPerWeek: number; fifthWeek: boolean; age60: boolean }

export function vacationEntitlement(r: VacationRules) {
  const d = Math.min(6, Math.max(1, r.daysPerWeek));
  const statutory = 4 * d + 1;                 // 4 uker og 1 dag
  const contractual = r.fifthWeek ? Math.max(0, d - 1) : 0; // fullfører femte uke
  const senior = r.age60 ? d : 0;              // ekstra uke fra året man fyller 60
  return { statutory: r2(statutory), contractual: r2(contractual), senior: r2(senior), total: r2(statutory + contractual + senior) };
}

/** Maks som kan overføres etter avtale: 2 uker (12 virkedager), pluss avtalefestet ferie hvis tariffen tillater det. */
export function carryoverLimit(daysPerWeek: number, fifthWeek: boolean, fifthWeekTransferable: boolean) {
  const d = Math.min(6, Math.max(1, daysPerWeek));
  return r2(2 * d + (fifthWeek && fifthWeekTransferable ? Math.max(0, d - 1) : 0));
}

/** Arbeidsdager → virkedager etter loven (én uke = 6 virkedager). */
export function toWorkingDaysLaw(days: number, daysPerWeek: number) {
  return r2((days * 6) / Math.min(6, Math.max(1, daysPerWeek)));
}

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

/**
 * Ferie telt i den ansattes arbeidsdager innenfor et tidsrom.
 * Per kalenderuke: fri hele arbeidsuka (alle hverdager uten helligdager) = d dager, justert for helligdager;
 * ellers antall hverdager, men aldri mer enn d. Delvis dag telles som andel av en arbeidsdag.
 */
export function vacationDaysIn(a: VacAbsence, from: string, to: string, hoursPerDay: number, daysPerWeek = 5) {
  const s = a.from > from ? a.from : from;
  const e = a.to < to ? a.to : to;
  if (s > e) return 0;
  const d = Math.min(6, Math.max(1, daysPerWeek));
  if (a.partialHours && a.from === a.to && hoursPerDay > 0) {
    return isoWeekday(s) <= 5 && !holidayOn(s) ? r2(Math.min(1, a.partialHours / hoursPerDay)) : 0;
  }
  let total = 0;
  // gå uke for uke (mandag–søndag)
  for (let wk = addDays(s, 1 - isoWeekday(s)); wk <= e; wk = addDays(wk, 7)) {
    let off = 0, weekdays = 0;
    for (let i = 0; i < 5; i++) {
      const day = addDays(wk, i);
      if (holidayOn(day)) continue;
      weekdays++;
      if (day >= s && day <= e) off++;
    }
    if (weekdays === 0 || off === 0) continue;
    total += off === weekdays ? (d * weekdays) / 5 : Math.min(off, d);
  }
  return r2(total);
}

export function vacationForYear(input: {
  year: number;
  startMonth: number;
  today: string;
  entitlement: number;
  hoursPerWeek: number;
  daysPerWeek?: number;
  ledger: VacLedger[];
  absences: VacAbsence[];
}): VacationYear {
  const mm = String(input.startMonth).padStart(2, "0");
  const { from, to } = vacationYear(`${input.year}-${mm}-01`, input.startMonth);
  const dpw = input.daysPerWeek ?? 5;
  const hpd = input.hoursPerWeek / dpw;
  const inYear = input.ledger.filter((l) => l.date >= from && l.date <= to);
  const sum = (xs: VacLedger[]) => r2(xs.reduce((s, l) => s + l.amount, 0));
  const carriedIn = sum(inYear.filter((l) => l.source === "carryover_in"));
  const carriedOut = -sum(inYear.filter((l) => l.source === "carryover_out"));
  const adjustments = sum(inYear.filter((l) => l.source !== "carryover_in" && l.source !== "carryover_out"));
  let taken = 0, booked = 0, pending = 0;
  for (const a of input.absences) {
    if (a.status === "pending") { pending += vacationDaysIn(a, from, to, hpd, dpw); continue; }
    // Godkjent: del i tatt (til og med i dag) og planlagt (etter i dag)
    taken += vacationDaysIn(a, from, input.today < to ? input.today : to, hpd, dpw);
    if (input.today < to) booked += vacationDaysIn(a, addDays(input.today, 1) > from ? addDays(input.today, 1) : from, to, hpd, dpw);
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
  agreement: "Skriftlig avtale (ferieloven § 7 nr. 3)",
  sick: "Ikke avviklet på grunn av arbeidsuførhet (ferieloven § 9 nr. 1)",
  parental: "Ikke avviklet på grunn av foreldrepermisjon (ferieloven § 9 nr. 2)",
  employer: "Ikke avviklet av forhold arbeidsgiver har ansvaret for (ferieloven § 7 nr. 2)",
};

export const ADJUSTMENT_TYPES: Record<string, string> = {
  start_taken: "Tatt før Vaktpilot",
  start_carry: "Overført fra før Vaktpilot",
  adjustment: "Annen justering",
};
