import { describe, expect, it } from "vitest";
import { buildReport, compTimeBalance, coverageSummary, isoWeek } from "./report";
import { at } from "./pay";
import { buildXlsx } from "./xlsx";
import { inflateRawSync } from "node:zlib";

describe("rapport", () => {
  it("fordeler planlagt og registrert tid per uke og ansatt, med helligdagstimer", () => {
    const r = buildReport({
      from: "2026-05-11", to: "2026-05-24", tz: "Europe/Oslo", grouping: "uke",
      employees: [{ id: "a", name: "Anne" }],
      shifts: [
        { employeeId: "a", start: at("2026-05-11", "09:00"), end: at("2026-05-11", "16:30"), breakMinutes: 30 },
        { employeeId: null, start: at("2026-05-12", "09:00"), end: at("2026-05-12", "16:00"), breakMinutes: 0 },
      ],
      entries: [
        { employeeId: "a", start: at("2026-05-11", "09:00"), end: at("2026-05-11", "17:00"), breakMinutes: 30, status: "approved" },
        { employeeId: "a", start: at("2026-05-17", "10:00"), end: at("2026-05-17", "14:00"), breakMinutes: 0, status: "submitted" },
      ],
      pay: [], balances: new Map(),
    });
    expect(r.buckets.map((b) => b.label)).toEqual(["Uke 20 (11.05.)", "Uke 21 (18.05.)"]);
    expect(r.buckets[0]).toMatchObject({ planned: 7, registered: 11.5 });
    expect(r.employees[0]).toMatchObject({ planned: 7, registered: 11.5, approved: 7.5, holidayWorked: 4 });
  });

  it("vakt over midnatt fordeles på begge dager og måneder", () => {
    const r = buildReport({
      from: "2026-01-01", to: "2026-02-28", tz: "Europe/Oslo", grouping: "maned",
      employees: [{ id: "a", name: "Anne" }],
      shifts: [{ employeeId: "a", start: at("2026-01-31", "22:00"), end: at("2026-02-01", "02:00"), breakMinutes: 0 }],
      entries: [], pay: [], balances: new Map(),
    });
    expect(r.buckets.map((b) => [b.key, b.planned])).toEqual([["2026-01", 2], ["2026-02", 2]]);
  });

  it("ukenummer etter ISO", () => {
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(isoWeek("2027-01-01")).toBe(53);
  });

  it("bemanningsdekning teller manglende persontimer", () => {
    const s = coverageSummary([
      { date: "2026-11-13", closed: false, peakRequired: 4, peakPlanned: 2,
        gaps: [{ start: at("2026-11-13", "12:00"), end: at("2026-11-13", "16:00"), required: 4, planned: 2, missing: 2, workRoleId: null }] },
      { date: "2026-11-14", closed: false, peakRequired: 2, peakPlanned: 2, gaps: [] },
      { date: "2026-11-15", closed: true, peakRequired: 0, peakPlanned: 0, gaps: [] },
    ]);
    expect(s).toMatchObject({ daysWithNeed: 2, daysShort: 1, daysCovered: 1, missingHours: 8 });
  });
});

describe("avspasering", () => {
  it("opptjent minus tatt ut, hele dager etter avtalt dagslengde", () => {
    const b = compTimeBalance("a", 37.5,
      [{ employeeId: "a", hours: 10 }, { employeeId: "a", hours: 5 }, { employeeId: "a", hours: -1 }, { employeeId: "b", hours: 99 }],
      // fre 15. mai + man 18. mai (helg i mellom), og 2 timer en annen dag
      [{ employeeId: "a", from: "2026-05-15", to: "2026-05-18", partialHours: null }, { employeeId: "a", from: "2026-06-02", to: "2026-06-02", partialHours: 2 }]);
    expect(b).toEqual({ earned: 15, used: 18, balance: -3 });
  });
});

describe("excel", () => {
  it("lager en gyldig zip med ark og æøå", () => {
    const buf = buildXlsx([{ name: "Timer/uke", rows: [["Navn", "Timer"], ["Ærlend Øy", 7.5]] }]);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    // finn sheet1 og pakk ut
    const name = "xl/worksheets/sheet1.xml";
    const i = buf.indexOf(Buffer.from(name));
    const compSize = buf.readUInt32LE(i - 30 + 18);
    const xml = inflateRawSync(buf.subarray(i + name.length, i + name.length + compSize)).toString("utf8");
    expect(xml).toContain("Ærlend Øy");
    expect(xml).toContain("<v>7.5</v>");
    expect(buf.toString("utf8")).not.toContain("Timer/uke\"");
  });
});
