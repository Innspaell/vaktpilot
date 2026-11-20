import { describe, expect, it } from "vitest";
import { employerPeriods, employerStatus } from "./employer-period";

describe("arbeidsgiverperioden", () => {
  it("16 kalenderdager, deretter NAV", () => {
    const [p] = employerPeriods([{ from: "2026-11-02", to: "2026-11-25" }]);
    expect(p.days).toBe(16);
    expect(p.completedOn).toBe("2026-11-17");
    expect(p.navDays).toBe(8);
  });

  it("korte fravær med under 16 dager mellom slås sammen", () => {
    const ps = employerPeriods([
      { from: "2026-01-05", to: "2026-01-07" }, // 3 dager
      { from: "2026-01-20", to: "2026-01-23" }, // 12 dager mellom → samme periode, 7 dager
    ]);
    expect(ps).toHaveLength(1);
    expect(ps[0].days).toBe(7);
  });

  it("16 dager eller mer tilbake i jobb gir ny periode", () => {
    const ps = employerPeriods([
      { from: "2026-01-05", to: "2026-01-07" },
      { from: "2026-01-24", to: "2026-01-25" }, // 16 dager mellom (8.–23.)
    ]);
    expect(ps).toHaveLength(2);
    expect(ps[1].start).toBe("2026-01-24");
  });

  it("syk igjen innen 16 dager etter brukt periode: NAV fortsetter", () => {
    const ps = employerPeriods([{ from: "2026-03-02", to: "2026-03-20" }, { from: "2026-03-30", to: "2026-04-01" }]);
    expect(ps).toHaveLength(1);
    expect(ps[0].navDays).toBe(3 + 3);
  });

  it("status: dag 10 av 16, og når NAV tar over hvis fraværet fortsetter", () => {
    const s = employerStatus([{ from: "2026-11-11", to: "2026-11-20" }], "2026-11-20");
    expect(s?.kind).toBe("running");
    if (s?.kind !== "running") return;
    expect(s.period.days).toBe(10);
    expect(s.daysLeft).toBe(6);
    expect(s.navFrom).toBe("2026-11-27");
    expect(employerStatus([{ from: "2026-09-01", to: "2026-09-03" }], "2026-11-20")).toBeNull();
  });
});
