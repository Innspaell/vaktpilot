import { describe, expect, it } from "vitest";
import { gradedSickRows } from "./graded-sick";

const day = (d: string, h: number) => ({ employeeId: "k", start: new Date(`${d}T07:00:00Z`), end: new Date(Date.parse(`${d}T07:00:00Z`) + h * 3600000), breakMinutes: 0 });

describe("gradert sykmelding på tid", () => {
  it("50 % sykmeldt og halv tid på jobb gir 25 % innsats, tilsvarer 75 % sykmelding", () => {
    const worked = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((d) => day(d, 3.75));
    const [r] = gradedSickRows([{ employeeId: "k", name: "Kari", hoursPerWeek: 37.5 }], [{ employeeId: "k", from: "2026-11-16", to: "2026-11-20", percent: 50 }],
      worked, [], { from: "2026-11-01", to: "2026-11-30" }, "Europe/Oslo");
    expect(r.timePct).toBe(50);
    expect(r.effortPct).toBe(25);
    expect(r.effectivePct).toBe(75);
  });

  it("full tid på jobb: tilsvarer graden; timebasis bruker planlagte vakter", () => {
    const worked = [day("2026-11-16", 6)];
    const [r] = gradedSickRows([{ employeeId: "k", name: "Kari", hoursPerWeek: 0 }], [{ employeeId: "k", from: "2026-11-16", to: "2026-11-16", percent: 40 }],
      worked, [day("2026-11-16", 6)], { from: "2026-11-01", to: "2026-11-30" }, "Europe/Oslo");
    expect(r.basis).toBe("planlagt");
    expect(r.effectivePct).toBe(40);
  });
});
