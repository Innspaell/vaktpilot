import { describe, expect, it } from "vitest";
import { vacationForYear, vacationYearOf } from "./vacation";

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
