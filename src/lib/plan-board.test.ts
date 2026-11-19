import { describe, expect, it } from "vitest";
import { buildBoard } from "./plan-board";
import { zonedToUtc } from "./time";

const tz = "Europe/Oslo";
const at = (d: string, t: string) => zonedToUtc(d, t, tz);
const base = {
  from: "2026-11-30", days: 7, tz,
  employees: [{ id: "s", name: "Sigrid Sodd", hoursPerWeek: 22.5, onCall: false }],
  availability: [] as { employeeId: string; kind: "available" | "unavailable" | "wants_extra"; date: string | null; weekday: number | null }[],
};
const cov = (date: string, gaps: [string, string][] = [], peak = 1) => ({ date, closed: false, peakRequired: peak, gaps: gaps.map(([a, b]) => ({ start: at(date, a), end: at(date, b), missing: 1 })) });

describe("planen som tabell", () => {
  it("farger dagene etter fravær, vakt, hvile og behov", () => {
    const b = buildBoard({
      ...base,
      coverage: [cov("2026-11-30"), cov("2026-12-01"), cov("2026-12-02", [["08:00", "16:00"]]), cov("2026-12-03"), cov("2026-12-04", [["15:00", "22:00"]]), cov("2026-12-05", [], 0), cov("2026-12-06", [], 0)],
      shifts: [{ id: "x", employeeId: "s", start: at("2026-12-01", "15:00"), end: at("2026-12-01", "23:00"), breakMinutes: 30, draft: false, roleColor: null, roleName: null }],
      absences: [{ employeeId: "s", from: "2026-11-30", to: "2026-11-30", typeName: "Ferie" }],
    });
    const c = b.rows[0].cells;
    expect(c[0]).toMatchObject({ fit: "bad", note: "Ferie" });
    expect(c[1]).toMatchObject({ fit: "bad", note: "På jobb" });
    expect(c[2]).toMatchObject({ fit: "maybe", note: "Kort hvile" }); // 23:00 → 08:00 = 9 t
    expect(c[4]).toMatchObject({ fit: "good" });
    expect(b.days[2].gaps).toEqual(["1 · 08:00–16:00"]);
    expect(b.days[5].noNeed).toBe(true);
    expect(b.rows[0].hours).toBe("7,5 av 22,5 t");
  });
  it("kan ikke og timebasis", () => {
    const b = buildBoard({
      ...base,
      employees: [{ id: "s", name: "S", hoursPerWeek: 0, onCall: false }],
      availability: [{ employeeId: "s", kind: "unavailable", date: null, weekday: 3 }],
      coverage: [cov("2026-12-02", [["08:00", "16:00"]])], shifts: [], absences: [],
    });
    expect(b.rows[0].cells[2]).toMatchObject({ fit: "bad", note: "Kan ikke" });
    expect(b.rows[0].hours).toBe("0 t · timebasis");
  });
});
