import { addDays, isoWeekday, localDate, localTime, workedMinutes, zonedToUtc } from "./time";

/** Hvordan en dag passer for en ansatt når lederen drar vedkommende inn i planen. */
export type Fit = "good" | "maybe" | "bad" | "none";

export interface BoardShift { id: string; employeeId: string | null; start: Date; end: Date; breakMinutes: number; draft: boolean; roleColor: string | null; roleName: string | null }
export interface BoardCell { date: string; shifts: { id: string; time: string; label: string; draft: boolean; color: string }[]; fit: Fit; note: string | null }
export interface BoardRow { id: string; name: string; hours: string; cells: BoardCell[] }
export interface BoardDay { date: string; label: string; closed: boolean; holiday: string | null; gaps: string[]; full: boolean; noNeed: boolean; open: { id: string; time: string; label: string; color: string }[] }

const WD = ["", "Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const num = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 1 });

export function buildBoard(input: {
  from: string;
  days: number;
  tz: string;
  now?: Date;
  coverage: { date: string; closed: boolean; holiday?: string | null; peakRequired: number; gaps: { start: Date; end: Date; missing: number }[] }[];
  employees: { id: string; name: string; hoursPerWeek: number | null; onCall: boolean }[];
  shifts: BoardShift[];
  absences: { employeeId: string; from: string; to: string; typeName: string }[];
  availability: { employeeId: string; kind: "available" | "unavailable" | "wants_extra"; date: string | null; weekday: number | null }[];
  minRestHours?: number;
}): { days: BoardDay[]; rows: BoardRow[] } {
  const { tz } = input;
  const minRest = input.minRestHours ?? 11;
  const dates = Array.from({ length: input.days }, (_, i) => addDays(input.from, i));
  const dateOf = (d: Date) => localDate(d, tz);
  const time = (s: BoardShift) => `${localTime(s.start, tz)}–${localTime(s.end, tz)}`;
  const color = (s: BoardShift) => s.roleColor ?? "#1f5fbf";

  const days: BoardDay[] = dates.map((date) => {
    const c = input.coverage.find((x) => x.date === date);
    const gaps = (c?.gaps ?? []).map((g) => `${g.missing} · ${localTime(g.start, tz)}–${localTime(g.end, tz)}`);
    return {
      date, label: `${WD[isoWeekday(date)]} ${Number(date.slice(8))}.${Number(date.slice(5, 7))}`,
      closed: Boolean(c?.closed), holiday: c?.holiday ?? null, gaps,
      full: Boolean(c && !c.closed && c.peakRequired > 0 && gaps.length === 0),
      noNeed: !c || (!c.closed && c.peakRequired === 0),
      open: input.shifts.filter((s) => !s.employeeId && dateOf(s.start) === date)
        .map((s) => ({ id: s.id, time: time(s), label: s.roleName ?? "Ledig", color: color(s) })),
    };
  });

  const rows: BoardRow[] = input.employees.map((e) => {
    const mine = input.shifts.filter((s) => s.employeeId === e.id).sort((a, b) => a.start.getTime() - b.start.getTime());
    const weekMin = mine.filter((s) => dates.includes(dateOf(s.start))).reduce((t, s) => t + workedMinutes(s.start, s.end, s.breakMinutes), 0);
    const agreed = e.onCall || !e.hoursPerWeek ? null : e.hoursPerWeek * (input.days / 7);
    const over = agreed !== null && weekMin / 60 >= agreed - 0.01;
    const hours = agreed === null ? `${num(weekMin / 60)} t · timebasis` : `${num(weekMin / 60)} av ${num(agreed)} t`;

    const cells = dates.map((date): BoardCell => {
      const here = mine.filter((s) => dateOf(s.start) === date);
      const shifts = here.map((s) => ({ id: s.id, time: time(s), label: s.roleName ?? (s.draft ? "utkast" : ""), draft: s.draft, color: color(s) }));
      const day = days.find((d) => d.date === date)!;
      const away = input.absences.find((a) => a.employeeId === e.id && a.from <= date && a.to >= date);
      const av = input.availability.filter((a) => a.employeeId === e.id);
      const said = av.find((a) => a.date === date && a.kind !== "wants_extra")?.kind ?? av.find((a) => !a.date && a.weekday === isoWeekday(date) && a.kind !== "wants_extra")?.kind;
      const wantsExtra = av.some((a) => a.kind === "wants_extra");
      let fit: Fit = "none";
      let note: string | null = null;
      if (away) { fit = "bad"; note = away.typeName; }
      else if (here.length) { fit = "bad"; note = "På jobb"; }
      else if (said === "unavailable") { fit = "bad"; note = "Kan ikke"; }
      else if (day.closed) { fit = "none"; note = "Stengt"; }
      else {
        // Hvile: mot tidsrommet som mangler folk den dagen (ellers 08–16)
        const g = input.coverage.find((x) => x.date === date)?.gaps ?? [];
        const cs = g.length ? Math.min(...g.map((x) => x.start.getTime())) : zonedToUtc(date, "08:00", tz).getTime();
        const ce = g.length ? Math.max(...g.map((x) => x.end.getTime())) : zonedToUtc(date, "16:00", tz).getTime();
        const prev = mine.filter((s) => s.end.getTime() <= cs).pop();
        const next = mine.find((s) => s.start.getTime() >= ce);
        const shortBefore = prev && (cs - prev.end.getTime()) / 3600000 < minRest;
        const shortAfter = next && (next.start.getTime() - ce) / 3600000 < minRest;
        if (shortBefore || shortAfter) { fit = "maybe"; note = "Kort hvile"; }
        else if (over) { fit = "maybe"; note = "Fullt opp mot avtalt"; }
        else if (day.gaps.length || day.open.length) { fit = "good"; note = said === "available" || wantsExtra ? "Kan jobbe" : "Mangler folk"; }
        else if (said === "available") { fit = "good"; note = "Kan jobbe"; }
      }
      return { date, shifts, fit, note };
    });
    return { id: e.id, name: e.name, hours, cells };
  });
  return { days, rows };
}
