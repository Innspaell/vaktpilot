import { describe, expect, it } from "vitest";
import { checkWorkPeriods } from "./worktime";
import { at } from "./pay";

const p = (d: string, s: string, e: string, d2 = d) => ({ start: at(d, s), end: at(d2, e) });
const rules = (w: ReturnType<typeof checkWorkPeriods>) => w.map((x) => x.rule);

describe("arbeidstidskontroll", () => {
  it("vanlig uke gir ingen brudd", () => {
    const w = checkWorkPeriods(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((d) => p(d, "08:00", "16:00")), "2026-11-16", "2026-11-22");
    expect(w.filter((x) => x.severity === "brudd")).toEqual([]);
  });
  it("for kort hvile mellom kveld og morgen", () => {
    const w = checkWorkPeriods([p("2026-11-16", "14:00", "23:00"), p("2026-11-17", "07:00", "15:00")], "2026-11-16", "2026-11-22");
    expect(rules(w)).toContain("hvile_dag");
  });
  it("over 13 timer på et døgn", () => {
    expect(rules(checkWorkPeriods([p("2026-11-16", "06:00", "20:30")], "2026-11-16", "2026-11-22"))).toContain("maks_dag");
  });
  it("over 48 timer og over 10 timer overtid i uka", () => {
    const w = checkWorkPeriods(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((d) => p(d, "07:00", "17:30")), "2026-11-16", "2026-11-22");
    expect(rules(w)).toContain("maks_uke");
    expect(rules(w)).toContain("ot_uke");
  });
  it("ingen 35 timer fri i uka", () => {
    const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((d) => p(d, "10:00", "14:00"));
    expect(rules(checkWorkPeriods(days, "2026-11-16", "2026-11-22"))).toContain("hvile_uke");
  });
  it("natt- og søndagsarbeid gir informasjon", () => {
    const w = checkWorkPeriods([p("2026-11-21", "20:00", "02:00", "2026-11-22")], "2026-11-16", "2026-11-22");
    expect(w.filter((x) => x.severity === "info").map((x) => x.rule).sort()).toEqual(["natt", "sondag"]);
  });
});
