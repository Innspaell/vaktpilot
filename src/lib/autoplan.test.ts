import { describe, expect, it } from "vitest";
import { buildPlan, needsToShifts, type DayNeeds, type PlanEmployee } from "./autoplan";
import { zonedToUtc, localTime, addDays } from "./time";

const at = (d: string, t: string) => zonedToUtc(d, t);
const hhmm = (s: { start: Date; end: Date }) => `${localTime(s.start)}-${localTime(s.end)}`;

const week = (from: string, reqs: DayNeeds["requirements"], closedWeekdays: number[] = [7]): DayNeeds[] =>
  Array.from({ length: 7 }, (_, i) => ({ date: addDays(from, i), closed: closedWeekdays.includes(i + 1), requirements: reqs }));

describe("behov til vakter", () => {
  it("deler 2-3-2 over dagen i fem vakter", () => {
    const shifts = needsToShifts(
      {
        date: "2026-11-16",
        closed: false,
        requirements: [
          { start: "08:00", end: "12:00", required: 2 },
          { start: "12:00", end: "16:00", required: 3 },
          { start: "16:00", end: "20:00", required: 2 },
        ],
      },
      [],
    );
    expect(shifts.map(hhmm).sort()).toEqual(["08:00-14:00", "08:00-14:00", "12:00-16:00", "14:00-20:00", "14:00-20:00"].sort());
  });

  it("trekker fra vakter som allerede er satt opp", () => {
    const shifts = needsToShifts(
      { date: "2026-11-16", closed: false, requirements: [{ start: "08:00", end: "16:00", required: 2 }] },
      [{ employeeId: "x", workRoleId: null, start: at("2026-11-16", "08:00"), end: at("2026-11-16", "16:00"), breakMinutes: 30 }],
    );
    expect(shifts.map(hhmm)).toEqual(["08:00-16:00"]);
  });

  it("forlenger for korte behov til minste vaktlengde", () => {
    const shifts = needsToShifts({ date: "2026-11-16", closed: false, requirements: [{ start: "11:00", end: "13:00", required: 1 }] }, []);
    expect(shifts.map(hhmm)).toEqual(["11:00-14:00"]);
  });

  it("stengte dager gir ingen vakter", () => {
    expect(needsToShifts({ date: "2026-11-22", closed: true, requirements: [{ start: "08:00", end: "16:00", required: 2 }] }, [])).toEqual([]);
  });
});

describe("fordeling på ansatte", () => {
  const monday = "2026-11-16";
  const reqs = [{ start: "08:00", end: "16:00", required: 2 }];

  it("fyller opp etter stillingsprosent og lar resten stå ledig", () => {
    const employees: PlanEmployee[] = [
      { id: "kari", name: "Kari", targetMinutes: 37.5 * 60, roleIds: [], unavailable: [] },
      { id: "ola", name: "Ola", targetMinutes: 18.75 * 60, roleIds: [], unavailable: [] },
    ];
    // Man–lør, 2 personer 8 timer = 12 vakter à 7,5 betalte timer
    const r = buildPlan(week(monday, reqs), employees, []);
    const kari = r.summary.find((s) => s.employeeId === "kari")!;
    const ola = r.summary.find((s) => s.employeeId === "ola")!;
    expect(kari.shifts).toBe(5); // 37,5 t
    expect(ola.shifts).toBe(2); // 15 t, en tredje ville gitt 22,5 t
    expect(r.openCount).toBe(12 - 7);
    // aldri to vakter samme dag
    for (const id of ["kari", "ola"]) {
      const days = r.shifts.filter((s) => s.employeeId === id).map((s) => s.date);
      expect(new Set(days).size).toBe(days.length);
    }
  });

  it("tar hensyn til fravær og arbeidsrolle", () => {
    const employees: PlanEmployee[] = [
      { id: "kari", name: "Kari", targetMinutes: 37.5 * 60, roleIds: ["kasse"], unavailable: ["2026-11-16"] },
      { id: "ola", name: "Ola", targetMinutes: 37.5 * 60, roleIds: [], unavailable: [] },
    ];
    const r = buildPlan(
      [{ date: monday, closed: false, requirements: [{ start: "08:00", end: "16:00", required: 1, workRoleId: "kasse" }] }],
      employees,
      [],
    );
    // Kari har ferie, Ola har ikke rollen: vakten blir ledig
    expect(r.shifts).toHaveLength(1);
    expect(r.shifts[0].employeeId).toBeNull();
  });

  it("holder 11 timers hvile", () => {
    const employees: PlanEmployee[] = [{ id: "kari", name: "Kari", targetMinutes: 40 * 60, roleIds: [], unavailable: [] }];
    const r = buildPlan(
      [
        { date: monday, closed: false, requirements: [{ start: "15:00", end: "23:00", required: 1 }] },
        { date: addDays(monday, 1), closed: false, requirements: [{ start: "06:00", end: "14:00", required: 1 }] },
      ],
      employees,
      [],
    );
    expect(r.shifts.filter((s) => s.employeeId === "kari")).toHaveLength(1);
    expect(r.openCount).toBe(1);
  });

  it("gir pause på lange vakter og regner betalt tid uten pause", () => {
    const r = buildPlan(
      [{ date: monday, closed: false, requirements: [{ start: "08:00", end: "16:00", required: 1 }] }],
      [{ id: "kari", name: "Kari", targetMinutes: 37.5 * 60, roleIds: [], unavailable: [] }],
      [],
    );
    expect(r.shifts[0].breakMinutes).toBe(30);
    expect(r.summary[0].plannedMinutes).toBe(450);
  });

  it("regner med vakter som allerede finnes i uka", () => {
    const existing = [0, 1, 2, 3].map((i) => ({
      employeeId: "kari", workRoleId: null,
      start: at(addDays(monday, i), "08:00"), end: at(addDays(monday, i), "16:00"), breakMinutes: 30,
    }));
    const r = buildPlan(week(monday, [{ start: "08:00", end: "16:00", required: 1 }]),
      [{ id: "kari", name: "Kari", targetMinutes: 37.5 * 60, roleIds: [], unavailable: [] }], existing);
    // 4 vakter finnes; hun får én til (fredag), lørdag blir ledig
    expect(r.shifts.filter((s) => s.employeeId === "kari")).toHaveLength(1);
    expect(r.openCount).toBe(1);
  });
});
