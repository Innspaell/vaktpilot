import { describe, expect, it } from "vitest";
import { at, calculatePay, payrollCsv, timeBalance, type PayEmployee } from "./pay";

const kari: PayEmployee = {
  id: "k", name: "Kari", payType: "hourly", hoursPerWeek: 22.5, fullTimeHours: 37.5,
  isShiftWorker: false, paidHolidays: true, startDate: "2025-01-01",
};
const line = (r: ReturnType<typeof calculatePay>, code: string) => r.lines.find((l) => l.code === code)?.hours ?? 0;
const entry = (d: string, s: string, e: string, b = 30, extra = {}) => ({ employeeId: "k", start: at(d, s), end: at(d, e), breakMinutes: b, ...extra });

describe("lønnsgrunnlag", () => {
  it("vanlige dager innenfor avtalt tid er ordinære timer", () => {
    const r = calculatePay(kari, [entry("2026-11-16", "08:00", "16:00"), entry("2026-11-17", "08:00", "16:00")], [], { from: "2026-11-16", to: "2026-11-22" });
    expect(line(r, "ordinary")).toBe(15);
    expect(line(r, "extra")).toBe(0);
  });

  it("deltid over avtalt tid blir mertid, og over heltid overtid", () => {
    const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((d) => entry(d, "08:00", "16:00"));
    // 5 × 7,5 = 37,5 t: 22,5 ordinært, 15 mertid
    const r = calculatePay(kari, days, [], { from: "2026-11-16", to: "2026-11-22" });
    expect(line(r, "ordinary")).toBe(22.5);
    expect(line(r, "extra")).toBe(15);
    const more = calculatePay(kari, [...days, entry("2026-11-21", "08:00", "12:00", 0)], [], { from: "2026-11-16", to: "2026-11-22" });
    expect(line(more, "overtime_50")).toBe(4); // lørdag 08–12 er innenfor vinduet, men over heltid
  });

  it("arbeid etter kl. 21 og på søndag er overtid 100 %", () => {
    const r = calculatePay(kari, [entry("2026-11-16", "17:00", "23:00", 0), entry("2026-11-22", "10:00", "14:00", 0)], [], { from: "2026-11-16", to: "2026-11-22" });
    expect(line(r, "ordinary")).toBe(4); // 17–21
    expect(line(r, "overtime_100")).toBe(6); // 21–23 + søndag 4 t
  });

  it("tilsagt overtid gir minst 2 timer", () => {
    const r = calculatePay(kari, [entry("2026-11-16", "21:30", "22:30", 0, { calledOvertime: true })], [], { from: "2026-11-16", to: "2026-11-22" });
    expect(line(r, "overtime_100") + line(r, "overtime_50")).toBe(2);
  });

  it("skiftarbeider får tillegg i stedet for overtid", () => {
    const r = calculatePay({ ...kari, isShiftWorker: true }, [entry("2026-11-16", "16:00", "23:00", 0)], [], { from: "2026-11-16", to: "2026-11-22" });
    expect(line(r, "overtime_100")).toBe(0);
    expect(line(r, "ordinary")).toBe(7);
    expect(line(r, "supp_evening")).toBe(5);
  });

  it("timelønnet får helligdagsgodtgjørelse når hen ikke jobber", () => {
    // Desember 2026: 1. juledag fredag 25.12 og 2. juledag lørdag (ikke hverdag)
    const r = calculatePay(kari, [], [], { from: "2026-12-01", to: "2026-12-31" });
    const hp = r.lines.find((l) => l.code === "holiday_pay");
    expect(hp?.days).toBe(1);
    expect(hp?.hours).toBe(4.5); // 22,5 / 5
    // Fastlønnet får ikke egen linje
    expect(calculatePay({ ...kari, payType: "fixed" }, [], [], { from: "2026-12-01", to: "2026-12-31" }).lines.find((l) => l.code === "holiday_pay")).toBeUndefined();
  });

  it("fravær telles i arbeidsdager", () => {
    const r = calculatePay(kari, [], [{ employeeId: "k", from: "2026-11-16", to: "2026-11-22", typeKey: "syk", typeName: "Egenmelding", paid: true, countsAsWork: true, partialHours: null }], { from: "2026-11-01", to: "2026-11-30" });
    const l = r.lines.find((x) => x.code === "absence_syk")!;
    expect(l.days).toBe(5);
    expect(l.hours).toBe(22.5);
  });

  it("lager CSV som Excel kan åpne", () => {
    const r = calculatePay({ ...kari, employeeNumber: "3" }, [entry("2026-11-16", "08:00", "16:00")], [], { from: "2026-11-01", to: "2026-11-30" });
    const csv = payrollCsv([r], { from: "2026-11-01", to: "2026-11-30" });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("3;Kari;2026-11-01;2026-11-30;Timelønn;ordinary;Ordinære timer;7,5");
  });
});

describe("timesaldo", () => {
  it("regner forventet tid uten helligdager og legger til betalt fravær", () => {
    const b = timeBalance(kari, [entry("2026-11-16", "08:00", "16:00")], [
      { employeeId: "k", from: "2026-11-17", to: "2026-11-17", typeKey: "ferie", typeName: "Ferie", paid: true, countsAsWork: true, partialHours: null },
    ], { from: "2026-11-16", to: "2026-11-20" });
    expect(b.expectedHours).toBe(22.5); // 5 × 4,5
    expect(b.workedHours).toBe(7.5);
    expect(b.paidAbsenceHours).toBe(4.5);
    expect(b.diffHours).toBe(-10.5);
  });
});
