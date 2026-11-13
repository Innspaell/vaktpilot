import { describe, expect, it } from "vitest";
import { ARBEIDSMILJOLOVEN, BILUTLEIE_2024, at, calculatePay as calc, diffPay, parseRules, payrollCsv, timeBalance, type PayEmployee } from "./pay";

// Testene under er skrevet for Bilutleieoverenskomsten
const calculatePay = (...a: Parameters<typeof calc>) => calc(a[0], a[1], a[2], a[3], a[4] ?? BILUTLEIE_2024, a[5]);

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
    expect(csv).toContain("3;Kari;2026-11-01;2026-11-30;Timelønn;;ordinary;Ordinære timer;7,5");
    const mapped = payrollCsv([r], { from: "2026-11-01", to: "2026-11-30" }, new Map([["ordinary", "100"]]));
    expect(mapped).toContain("Timelønn;100;ordinary;");
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

describe("lønnsregler som data", () => {
  it("bilutleie lagret som JSON gir samme resultat", () => {
    const json = JSON.parse(JSON.stringify(BILUTLEIE_2024));
    const r = parseRules(json, "bilutleie", "Bilutleie");
    const e = [entry("2026-11-16", "16:00", "23:00", 0), entry("2026-11-21", "10:00", "16:00", 0), entry("2026-11-22", "10:00", "14:00", 0)];
    const a = calc({ ...kari, isShiftWorker: true }, e, [], { from: "2026-11-16", to: "2026-11-22" }, BILUTLEIE_2024);
    const b = calc({ ...kari, isShiftWorker: true }, e, [], { from: "2026-11-16", to: "2026-11-22" }, r);
    expect(b.lines).toEqual(a.lines);
  });

  it("uten tariff: overtid 40 % over 9 timer om dagen, ingen søndagsovertid", () => {
    const r = calc(kari, [entry("2026-11-16", "07:00", "18:00", 0), entry("2026-11-22", "10:00", "14:00", 0)], [], { from: "2026-11-16", to: "2026-11-22" }, ARBEIDSMILJOLOVEN);
    expect(line(r, "overtime_40")).toBe(2);
    expect(line(r, "overtime_100")).toBe(0);
    expect(line(r, "ordinary") + line(r, "extra")).toBe(13);
  });

  it("uten tariff: overtid over 40 timer i uka", () => {
    const full = { ...kari, hoursPerWeek: 37.5 };
    const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((d) => entry(d, "08:00", "17:00", 0)); // 5 × 9 = 45
    const r = calc(full, days, [], { from: "2026-11-16", to: "2026-11-22" }, ARBEIDSMILJOLOVEN);
    expect(line(r, "ordinary")).toBe(37.5);
    expect(line(r, "extra")).toBe(2.5);
    expect(line(r, "overtime_40")).toBe(5);
  });

  it("uten tariff: helligdagslønn bare for 1. og 17. mai", () => {
    const dec = calc(kari, [], [], { from: "2026-12-01", to: "2026-12-31" }, ARBEIDSMILJOLOVEN);
    expect(dec.lines.find((l) => l.code === "holiday_pay")).toBeUndefined();
    const may = calc(kari, [], [], { from: "2026-05-01", to: "2026-05-31" }, ARBEIDSMILJOLOVEN);
    // 1. mai fredag, 17. mai søndag (ikke hverdag); Kristi himmelfart og 2. pinsedag teller ikke
    expect(may.lines.find((l) => l.code === "holiday_pay")?.days).toBe(1);
  });

  it("ny versjon midt i perioden gir egne linjer per sats", () => {
    const cheap = BILUTLEIE_2024;
    const dear = { ...BILUTLEIE_2024, supplements: BILUTLEIE_2024.supplements.map((s) => ({ ...s, ratePerHour: s.ratePerHour + 10 })) };
    const resolver = (d: string) => (d >= "2026-11-19" ? dear : cheap);
    const r = calc({ ...kari, isShiftWorker: true }, [entry("2026-11-16", "18:00", "20:00", 0), entry("2026-11-19", "18:00", "20:00", 0)], [], { from: "2026-11-16", to: "2026-11-22" }, resolver);
    const ev = r.lines.filter((l) => l.code === "supp_evening");
    expect(ev.map((l) => l.rate)).toEqual([21.5, 31.5]);
  });
});

describe("tariffmotor: kombinasjon, hendelser, forklaring og snitt", () => {
  const base = { ...ARBEIDSMILJOLOVEN, key: "t", name: "Test" };
  const P = { from: "2026-11-16", to: "2026-11-22" };

  it("tillegg i samme gruppe kombineres ikke (første i listen gjelder)", () => {
    const rules = { ...base, supplements: [
      { key: "sun", label: "Søndag", ratePerHour: 50, days: [7], fromHour: 0, toHour: 24, holidays: "exclude" as const, appliesTo: "all" as const, group: "helg" },
      { key: "eve", label: "Kveld", ratePerHour: 20, days: [1, 2, 3, 4, 5, 6, 7], fromHour: 18, toHour: 24, holidays: "exclude" as const, appliesTo: "all" as const, group: "helg" },
      { key: "night", label: "Natt", ratePerHour: 30, days: [1, 2, 3, 4, 5, 6, 7], fromHour: 21, toHour: 6, holidays: "exclude" as const, appliesTo: "all" as const },
    ] };
    const r = calc(kari, [entry("2026-11-22", "17:00", "22:00", 0)], [], P, rules);
    expect(line(r, "supp_sun")).toBe(5);
    expect(line(r, "supp_eve")).toBe(0); // samme gruppe som søndag
    expect(line(r, "supp_night")).toBe(1); // egen gruppe, kombineres
  });

  it("tillegg som ikke gis på overtid", () => {
    const rules = { ...BILUTLEIE_2024, supplements: [{ key: "eve", label: "Kveld", ratePerHour: 20, days: [1, 2, 3, 4, 5, 6, 7], fromHour: 18, toHour: 24, holidays: "exclude" as const, appliesTo: "all" as const, notOnOvertime: true }] };
    const r = calc(kari, [entry("2026-11-16", "17:00", "23:00", 0)], [], P, rules);
    expect(line(r, "supp_eve")).toBe(3); // 18–21 innenfor ordinær tid; 21–23 er overtid
  });

  it("prosenttillegg gir timer og prosent, uten beløp", () => {
    const rules = { ...base, supplements: [{ key: "sun", label: "Søndag 50 %", ratePerHour: 0, percent: 50, days: [7], fromHour: 0, toHour: 24, holidays: "exclude" as const, appliesTo: "all" as const }] };
    const l = calc(kari, [entry("2026-11-22", "10:00", "14:00", 0)], [], P, rules).lines.find((x) => x.code === "supp_sun")!;
    expect(l.hours).toBe(4);
    expect(l.percent).toBe(50);
    expect(l.amount).toBeUndefined();
  });

  it("hendelser per gang, med egen sats på helligdag", () => {
    const rules = { ...base, eventSupplements: [{ key: "utlevering", label: "Utlevering", ratePerEvent: 150, holidayRatePerEvent: 300, appliesTo: "all" as const }] };
    const r = calc(kari, [], [], { from: "2026-12-20", to: "2026-12-27" }, rules, undefined, [
      { employeeId: "k", date: "2026-12-21", key: "utlevering", count: 2 },
      { employeeId: "k", date: "2026-12-25", key: "utlevering", count: 1 },
      { employeeId: "k", date: "2026-12-29", key: "utlevering", count: 5 }, // utenfor perioden
    ]);
    const ev = r.lines.filter((l) => l.code === "event_utlevering");
    expect(ev.map((l) => [l.quantity, l.rate, l.amount])).toEqual([[2, 150, 300], [1, 300, 300]]);
  });

  it("forklaring per dag med grunn", () => {
    const l = calc(kari, [entry("2026-11-16", "17:00", "23:00", 0)], [], P, BILUTLEIE_2024).lines.find((x) => x.code === "overtime_100")!;
    expect(l.details).toEqual(["man 16.11: 2 t (etter kl. 21)"]);
    expect(l.why).toBeTruthy();
  });

  it("timer før perioden i samme uke teller mot ukegrensen, men gir ikke linjer", () => {
    const full = { ...kari, hoursPerWeek: 37.5 };
    // Uke 30.11–6.12: man–tor 4 × 9 = 36 t i november, fredag 4.12 9 t i desember
    const days = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"].map((d) => entry(d, "08:00", "17:00", 0));
    const r = calc(full, [...days, entry("2026-12-04", "08:00", "17:00", 0)], [], { from: "2026-12-04", to: "2026-12-31" }, ARBEIDSMILJOLOVEN);
    // 45 t i uka: fredag gir 1,5 t ordinært (opp til 37,5), 2,5 t mertid, 5 t overtid
    expect(line(r, "ordinary")).toBe(1.5);
    expect(line(r, "extra")).toBe(2.5);
    expect(line(r, "overtime_40")).toBe(5);
    expect(r.workedHours).toBe(9);
  });

  it("gjennomsnittsberegning: lang uke og kort uke gir ikke overtid", () => {
    const full = { ...kari, hoursPerWeek: 37.5, averaging: { from: "2026-11-16", weeks: 2 } };
    const long = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((d) => entry(d, "07:00", "16:00", 0)); // 45 t
    const short = ["2026-11-23", "2026-11-24", "2026-11-25"].map((d) => entry(d, "07:00", "17:00", 0)); // 30 t
    const r = calc(full, [...long, ...short], [], { from: "2026-11-16", to: "2026-11-29" }, ARBEIDSMILJOLOVEN);
    expect(line(r, "overtime_40")).toBe(0);
    expect(line(r, "ordinary")).toBe(75);
    // Uten snitt blir den lange uka overtid
    const plain = calc({ ...full, averaging: null }, [...long, ...short], [], { from: "2026-11-16", to: "2026-11-29" }, ARBEIDSMILJOLOVEN);
    expect(line(plain, "overtime_40")).toBe(8); // 5 t over 40 i den lange uka + 3 × 1 t over 9 t/dag i den korte
  });

  it("vakt over midnatt og overgang til vintertid", () => {
    // Natt til 25.10.2026: klokka stilles fra 03 til 02. 22:00–06:00 er 9 timer.
    const start = at("2026-10-24", "22:00"), end = at("2026-10-25", "06:00");
    const r = calc({ ...kari, isShiftWorker: true }, [{ employeeId: "k", start, end, breakMinutes: 0 }], [], { from: "2026-10-19", to: "2026-10-25" }, BILUTLEIE_2024);
    expect(r.workedHours).toBe(9);
    expect(line(r, "supp_evening")).toBe(9);
  });

  it("overtid aldri under 40 % selv om regelsettet sier lavere", () => {
    expect(parseRules({ overtimePercent: 25 }, "x", "X").overtimePercent).toBe(40);
  });
});

describe("etterbetaling", () => {
  it("differanse når satsene øker med tilbakevirkning", () => {
    const P = { from: "2026-11-16", to: "2026-11-22" };
    const e = [entry("2026-11-16", "18:00", "22:00", 0)];
    const before = [calc({ ...kari, isShiftWorker: true }, e, [], P, BILUTLEIE_2024)];
    const higher = { ...BILUTLEIE_2024, supplements: BILUTLEIE_2024.supplements.map((s) => ({ ...s, ratePerHour: s.ratePerHour + 2 })) };
    const after = [calc({ ...kari, isShiftWorker: true }, e, [], P, higher)];
    const d = diffPay(before, after);
    // Gammel sats-linje forsvinner (−4 t à 21,50), ny kommer (+4 t à 23,50) → netto +8 kr
    const sum = d[0].lines.reduce((s, l) => s + (l.amount ?? 0), 0);
    expect(Math.round(sum * 100) / 100).toBe(8);
    expect(diffPay(before, before)).toEqual([]);
  });
});
