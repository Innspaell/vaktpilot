import { describe, expect, it } from "vitest";
import { selfCertification, sickLeavePercent } from "./absence-stats";

const kari = { id: "k", name: "Kari", positionPct: 100, startDate: "2020-01-01", endDate: null };
const ola = { id: "o", name: "Ola", positionPct: 50, startDate: "2020-01-01", endDate: null };

describe("sykefravær", () => {
  it("regner prosent vektet med stillingsprosent", () => {
    // November 2026 har 21 arbeidsdager. Kari syk 2 dager, Ola syk 2 dager.
    const abs = [
      { employeeId: "k", from: "2026-11-16", to: "2026-11-17", typeKey: "syk", partialHours: null },
      { employeeId: "o", from: "2026-11-16", to: "2026-11-17", typeKey: "sykmelding", partialHours: null },
    ];
    // tapt: 2×1 + 2×0,5 = 3; avtalt: 21×1 + 21×0,5 = 31,5 → 9,5 %
    expect(sickLeavePercent([kari, ola], abs, "2026-11-01", "2026-11-30")).toBe(9.5);
  });

  it("teller egenmeldingsperioder siste 12 måneder", () => {
    const abs = [
      { employeeId: "k", from: "2026-03-02", to: "2026-03-03", typeKey: "syk", partialHours: null },
      { employeeId: "k", from: "2026-09-07", to: "2026-09-07", typeKey: "syk", partialHours: null },
      { employeeId: "k", from: "2025-01-06", to: "2025-01-06", typeKey: "syk", partialHours: null },
    ];
    expect(selfCertification(abs, "k", "2026-11-10")).toEqual({ periods: 2, days: 3 });
  });
});
