import { describe, expect, it } from "vitest";
import { monthHours, workdaysIn } from "./month-hours";

const d = (s: string) => new Date(s);
describe("timer i måneden", () => {
  it("skiller jobbet hittil fra planlagt resten, og regner avtalt tid", () => {
    const [r] = monthHours({
      now: d("2026-11-19T12:00:00Z"), monthFrom: "2026-11-01", monthTo: "2026-11-30",
      employees: [{ id: "a", name: "A", terms: [{ from: "2026-01-01", to: null, hoursPerWeek: 37.5, onCall: false }] }],
      entries: [{ employeeId: "a", start: d("2026-11-18T07:00:00Z"), end: d("2026-11-18T15:00:00Z"), breakMinutes: 30 }],
      shifts: [
        { employeeId: "a", start: d("2026-11-18T07:00:00Z"), end: d("2026-11-18T15:00:00Z"), breakMinutes: 30 },
        { employeeId: "a", start: d("2026-11-20T07:00:00Z"), end: d("2026-11-20T15:00:00Z"), breakMinutes: 30 },
      ],
    });
    expect(r.done).toBe(7.5);
    expect(r.plannedRest).toBe(7.5);
    expect(r.agreed).toBe(7.5 * workdaysIn("2026-11-01", "2026-11-30"));
  });
  it("tilkalling har ingen avtalt tid", () => {
    const [r] = monthHours({ now: new Date(), monthFrom: "2026-11-01", monthTo: "2026-11-30",
      employees: [{ id: "a", name: "A", terms: [{ from: "2026-01-01", to: null, hoursPerWeek: 0, onCall: true }] }], entries: [], shifts: [] });
    expect(r.agreed).toBeNull();
  });
  it("timebasis før fast avtale: bare dagene med fast avtale teller", () => {
    const [r] = monthHours({ now: new Date(), monthFrom: "2026-11-01", monthTo: "2026-11-30",
      employees: [{ id: "a", name: "A", terms: [
        { from: "2026-11-01", to: "2026-11-15", hoursPerWeek: 0, onCall: false },
        { from: "2026-11-16", to: null, hoursPerWeek: 37.5, onCall: false },
      ] }], entries: [], shifts: [] });
    expect(r.agreed).toBe(7.5 * workdaysIn("2026-11-16", "2026-11-30"));
  });
});
