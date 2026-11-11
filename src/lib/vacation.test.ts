import { describe, expect, it } from "vitest";
import { carryoverLimit, toWorkingDaysLaw, vacationDaysIn, vacationEntitlement, vacationForYear, vacationYearOf } from "./vacation";

describe("feriesaldo per år", () => {
  const base = { startMonth: 1, entitlement: 25, hoursPerWeek: 37.5 };

  it("ferie i 2027 som søkes i 2026 trekkes fra 2027", () => {
    const abs = [{ from: "2027-07-05", to: "2027-07-16", status: "approved" as const, partialHours: null }];
    const y26 = vacationForYear({ ...base, year: 2026, today: "2026-11-11", ledger: [], absences: abs });
    const y27 = vacationForYear({ ...base, year: 2027, today: "2026-11-11", ledger: [], absences: abs });
    expect(y26.remaining).toBe(25);
    expect(y27).toMatchObject({ booked: 10, taken: 0, remaining: 15 });
  });

  it("startsaldo, overføring og tatt/planlagt/venter", () => {
    const ledger = [
      { amount: -14, date: "2026-01-01", source: "start_taken" },
      { amount: -3, date: "2026-01-01", source: "carryover_out" },
      { amount: 3, date: "2027-01-01", source: "carryover_in" },
    ];
    const abs = [
      { from: "2026-10-05", to: "2026-10-09", status: "approved" as const, partialHours: null }, // 5 tatt
      { from: "2026-12-21", to: "2026-12-23", status: "approved" as const, partialHours: null }, // 3 planlagt
      { from: "2026-12-28", to: "2026-12-31", status: "pending" as const, partialHours: null },  // 4 venter
    ];
    const y = vacationForYear({ ...base, year: 2026, today: "2026-11-11", ledger, absences: abs });
    expect(y).toMatchObject({ adjustments: -14, carriedOut: 3, taken: 5, booked: 3, pending: 4, remaining: 0, remainingIfApproved: -4 });
    const n = vacationForYear({ ...base, year: 2027, today: "2026-11-11", ledger, absences: abs });
    expect(n).toMatchObject({ carriedIn: 3, remaining: 28 });
  });

  it("helligdager og helg telles ikke, delvis dag telles som andel", () => {
    const y = vacationForYear({ ...base, year: 2026, today: "2026-01-01", ledger: [], absences: [
      { from: "2026-12-24", to: "2026-12-27", status: "approved", partialHours: null }, // 24. tor (ikke helligdag), 25.–26. helligdag, 27. søn
      { from: "2026-06-03", to: "2026-06-03", status: "approved", partialHours: 3.75 },
    ] });
    expect(y.booked).toBe(1.5);
  });

  it("ferieår som starter i mai", () => {
    expect(vacationYearOf("2027-03-01", 5)).toBe(2026);
    expect(vacationYearOf("2027-05-01", 5)).toBe(2027);
  });
});

describe("ferieloven omregnet til arbeidsdager", () => {
  it("heltid mandag–fredag: 21 lovbestemt + 4 avtalefestet = 25 (5 uker), 60 år +5", () => {
    expect(vacationEntitlement({ daysPerWeek: 5, fifthWeek: true, age60: false })).toEqual({ statutory: 21, contractual: 4, senior: 0, total: 25 });
    expect(vacationEntitlement({ daysPerWeek: 5, fifthWeek: true, age60: true }).total).toBe(30);
    expect(vacationEntitlement({ daysPerWeek: 5, fifthWeek: false, age60: false }).total).toBe(21);
  });
  it("deltid 3 dager i uka: 4 uker og 1 dag = 13, femte uke +2", () => {
    expect(vacationEntitlement({ daysPerWeek: 3, fifthWeek: true, age60: false })).toEqual({ statutory: 13, contractual: 2, senior: 0, total: 15 });
  });
  it("overføring: 2 uker = 12 virkedager", () => {
    expect(carryoverLimit(5, true, false)).toBe(10);
    expect(carryoverLimit(3, true, false)).toBe(6);
    expect(carryoverLimit(5, true, true)).toBe(14);
    expect(toWorkingDaysLaw(10, 5)).toBe(12);
  });
  it("hel uke teller arbeidsdagene i uka, enkeltdager maks d per uke", () => {
    const week = { from: "2026-11-16", to: "2026-11-22", status: "approved" as const, partialHours: null };
    expect(vacationDaysIn(week, "2026-01-01", "2026-12-31", 7.5, 5)).toBe(5);
    expect(vacationDaysIn(week, "2026-01-01", "2026-12-31", 7.5, 3)).toBe(3);
    const twoDays = { from: "2026-11-16", to: "2026-11-17", status: "approved" as const, partialHours: null };
    expect(vacationDaysIn(twoDays, "2026-01-01", "2026-12-31", 7.5, 3)).toBe(2);
    // uka etter påske 2027: 2. påskedag 29.3 er helligdag, så hel uke = 4 dager for heltid
    const easter = { from: "2027-03-29", to: "2027-04-04", status: "approved" as const, partialHours: null };
    expect(vacationDaysIn(easter, "2027-01-01", "2027-12-31", 7.5, 5)).toBe(4);
  });
});
