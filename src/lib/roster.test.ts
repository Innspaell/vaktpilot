import { describe, expect, it } from "vitest";
import { groupByRole, primaryRoles, shortName, shortTime, personOrder } from "./roster";
import { zonedToUtc } from "./time";

const roles = [
  { id: "k", name: "Kundebehandler", color: "#00f", sort_order: 20 },
  { id: "l", name: "Ledelse", color: "#f00", sort_order: 10 },
];

describe("vaktplanvisning", () => {
  it("setter Ledelse øverst og uten rolle sist", () => {
    const items = [{ n: "a", r: "k" }, { n: "b", r: null }, { n: "c", r: "l" }];
    const g = groupByRole(items, (i) => i.r, roles);
    expect(g.map((x) => x.role?.name ?? "Andre")).toEqual(["Ledelse", "Kundebehandler", "Andre"]);
  });

  it("velger hovedrollen med lavest sortering", () => {
    const p = primaryRoles(roles, [{ employee_id: "erlend", work_role_id: "k" }, { employee_id: "erlend", work_role_id: "l" }, { employee_id: "kari", work_role_id: "k" }]);
    expect(p.get("erlend")).toBe("l");
    expect(p.get("kari")).toBe("k");
  });

  it("korte tider og navn", () => {
    expect(shortTime(zonedToUtc("2026-11-16", "08:00"), zonedToUtc("2026-11-16", "16:00"))).toBe("08–16");
    expect(shortTime(zonedToUtc("2026-11-16", "08:30"), zonedToUtc("2026-11-16", "16:00"))).toBe("08:30–16");
    expect(shortName("Christian Andreassen")).toBe("Christian A.");
    expect(shortName("Kari Lie")).toBe("Kari Lie");
  });
  it("sorterer etter rolle, så etternavn", () => {
    const roles = [
      { id: "k", name: "Kundebehandler", color: "", sort_order: 10 },
      { id: "l", name: "Ledelse", color: "", sort_order: 20 },
    ];
    const primary = new Map([["e", "l"], ["c", "k"], ["j", "k"]]);
    const people = [
      { id: "e", name: "Erlend Engan" }, { id: "x", name: "Uten Rolle" },
      { id: "c", name: "Christian Marthinsen" }, { id: "j", name: "Joakim Knutsen" },
    ];
    expect(people.sort(personOrder(roles, primary)).map((p) => p.id)).toEqual(["j", "c", "e", "x"]);
  });
});
