import { describe, expect, it } from "vitest";
import { zonedToUtc, workedMinutes, minutesPerLocalDay, localDate, localTime, dayBounds, isoWeekday } from "./time";
import { easterSunday, norwegianHolidays, holidayOn, holidayEves } from "./holidays";
import { dayCoverage, requirementsFor } from "./staffing";
import { checkShift } from "./warnings";

const at = (d: string, t: string) => zonedToUtc(d, t);

describe("tid i Europe/Oslo", () => {
  it("tolker vinter- og sommertid riktig", () => {
    expect(at("2026-01-15", "08:00").toISOString()).toBe("2026-01-15T07:00:00.000Z");
    expect(at("2026-07-15", "08:00").toISOString()).toBe("2026-07-15T06:00:00.000Z");
  });

  it("vakt over midnatt gir riktige timer", () => {
    const m = workedMinutes(at("2026-11-13", "22:00"), at("2026-11-14", "06:00"), 30);
    expect(m).toBe(450);
  });

  it("natt til sommertid er én time kortere", () => {
    expect(workedMinutes(at("2026-03-28", "22:00"), at("2026-03-29", "06:00"))).toBe(7 * 60);
  });

  it("natt til vintertid er én time lengre", () => {
    expect(workedMinutes(at("2026-10-24", "22:00"), at("2026-10-25", "06:00"))).toBe(9 * 60);
  });

  it("dager med tidsskifte har 23 og 25 timer", () => {
    const len = (d: string) => {
      const b = dayBounds(d);
      return (b.end.getTime() - b.start.getTime()) / 3600000;
    };
    expect(len("2026-03-29")).toBe(23);
    expect(len("2026-10-25")).toBe(25);
    expect(len("2026-11-13")).toBe(24);
  });

  it("fordeler timer på riktig dato over midnatt", () => {
    const r = minutesPerLocalDay(at("2026-11-13", "22:00"), at("2026-11-14", "06:00"), 30);
    expect(r).toEqual([
      { date: "2026-11-13", minutes: 90 },
      { date: "2026-11-14", minutes: 360 },
    ]);
  });

  it("viser lokal dato og klokkeslett", () => {
    const d = new Date("2026-11-13T23:30:00Z");
    expect(localDate(d)).toBe("2026-11-14");
    expect(localTime(d)).toBe("00:30");
    expect(isoWeekday("2026-11-13")).toBe(5);
  });
});

describe("helligdager", () => {
  it("finner påske", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2025)).toBe("2025-04-20");
  });

  it("har alle 12 helligdager i 2026", () => {
    const h = norwegianHolidays(2026);
    expect(h).toHaveLength(12);
    const d = Object.fromEntries(h.map((x) => [x.key, x.date]));
    expect(d.skjaertorsdag).toBe("2026-04-02");
    expect(d.langfredag).toBe("2026-04-03");
    expect(d.paaskedag2).toBe("2026-04-06");
    expect(d.kristihimmelfart).toBe("2026-05-14");
    expect(d.pinsedag1).toBe("2026-05-24");
    expect(d.pinsedag2).toBe("2026-05-25");
  });

  it("merker 1. og 17. mai for seg", () => {
    expect(holidayOn("2026-05-17")?.kind).toBe("may");
    expect(holidayOn("2026-12-25")?.kind).toBe("public");
    expect(holidayOn("2026-11-13")).toBeNull();
  });

  it("har høytidsaftener", () => {
    const e = Object.fromEntries(holidayEves(2026).map((x) => [x.key, x.date]));
    expect(e.paaskeaften).toBe("2026-04-04");
    expect(e.pinseaften).toBe("2026-05-23");
  });
});

describe("bemanning per tidsrom", () => {
  const reqs = [
    { start: "08:00", end: "12:00", required: 2 },
    { start: "12:00", end: "16:00", required: 3 },
    { start: "16:00", end: "20:00", required: 2 },
  ];

  it("fire ansatte på ulike tider er ikke fire hele dagen", () => {
    const shifts = [
      { startsAt: at("2026-11-13", "08:00"), endsAt: at("2026-11-13", "12:00"), employeeId: "a" },
      { startsAt: at("2026-11-13", "08:00"), endsAt: at("2026-11-13", "12:00"), employeeId: "b" },
      { startsAt: at("2026-11-13", "12:00"), endsAt: at("2026-11-13", "20:00"), employeeId: "c" },
      { startsAt: at("2026-11-13", "12:00"), endsAt: at("2026-11-13", "20:00"), employeeId: "d" },
    ];
    const c = dayCoverage("2026-11-13", reqs, shifts);
    expect(c.gaps).toHaveLength(1);
    expect(c.gaps[0].missing).toBe(1);
    expect(localTime(c.gaps[0].start)).toBe("12:00");
    expect(localTime(c.gaps[0].end)).toBe("16:00");
  });

  it("ledige vakter teller ikke som bemannet", () => {
    const shifts = [{ startsAt: at("2026-11-13", "08:00"), endsAt: at("2026-11-13", "20:00"), employeeId: null }];
    const c = dayCoverage("2026-11-13", [{ start: "08:00", end: "20:00", required: 1 }], shifts);
    expect(c.gaps[0].missing).toBe(1);
  });

  it("avvik på dato erstatter malen, og stengt gir ingen behov", () => {
    const templates = [{ weekday: 5, start: "08:00", end: "16:00", required: 4 }];
    expect(requirementsFor("2026-11-13", templates, []).requirements[0].required).toBe(4);
    expect(requirementsFor("2026-11-13", templates, [{ date: "2026-11-13", closed: true }]).closed).toBe(true);
    const o = requirementsFor("2026-11-13", templates, [{ date: "2026-11-13", closed: false, start: "10:00", end: "14:00", required: 1 }]);
    expect(o.requirements).toEqual([{ start: "10:00", end: "14:00", required: 1, workRoleId: null }]);
  });

  it("teller per arbeidsrolle", () => {
    const shifts = [{ startsAt: at("2026-11-13", "08:00"), endsAt: at("2026-11-13", "16:00"), employeeId: "a", workRoleId: "kasse" }];
    const c = dayCoverage("2026-11-13", [
      { start: "08:00", end: "16:00", required: 1, workRoleId: "kasse" },
      { start: "08:00", end: "16:00", required: 1, workRoleId: "lager" },
    ], shifts);
    expect(c.gaps).toHaveLength(1);
    expect(c.gaps[0].workRoleId).toBe("lager");
  });
});

describe("advarsler", () => {
  it("varsler kort hvile og fravær, men stopper ikke", () => {
    const w = checkShift(
      { start: at("2026-11-14", "06:00"), end: at("2026-11-14", "14:00") },
      [{ start: at("2026-11-13", "14:00"), end: at("2026-11-13", "23:00") }],
      ["2026-11-14"],
      ["2026-11-14"],
    );
    expect(w.map((x) => x.code).sort()).toEqual(["absence", "short_rest"]);
  });

  it("ingen advarsler for en vanlig vakt", () => {
    const w = checkShift({ start: at("2026-11-13", "08:00"), end: at("2026-11-13", "16:00"), breakMinutes: 30 }, [], [], ["2026-11-13"]);
    expect(w).toEqual([]);
  });
});

import { workdaysBetween, vacationYear, overlapDays } from "./absence";

describe("ferie og fravær", () => {
  it("teller arbeidsdager uten helg og helligdager", () => {
    // Påskeuka 2026: man 30.3 – fre 3.4, der skjærtorsdag og langfredag er fri
    expect(workdaysBetween("2026-03-30", "2026-04-03")).toBe(3);
    // To hele uker i november
    expect(workdaysBetween("2026-11-16", "2026-11-29")).toBe(10);
    // 2. påskedag regnes ikke
    expect(workdaysBetween("2026-04-06", "2026-04-06")).toBe(0);
  });

  it("finner ferieåret", () => {
    expect(vacationYear("2026-11-09")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(vacationYear("2026-03-01", 5)).toEqual({ from: "2025-05-01", to: "2026-04-30" });
  });

  it("teller bare dagene innenfor året", () => {
    expect(overlapDays("2026-12-28", "2027-01-08", "2026-01-01", "2026-12-31")).toBe(4);
  });
});
