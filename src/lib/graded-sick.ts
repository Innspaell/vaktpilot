// Gradert sykmelding regnet på både arbeidsevne og tid. Ren logikk.
//
// Graden på sykmeldingen gjelder arbeidsevnen. Er den ansatte 50 % sykmeldt og bare på jobb halve
// avtalte tiden, er arbeidsinnsatsen 50 % av tiden × 50 % arbeidsevne = 25 %, som tilsvarer 75 % sykmelding.
import { addDays, isoWeekday, localDate } from "./time";
import { holidayOn } from "./holidays";

export interface GradedInput {
  employeeId: string;
  name: string;
  /** Avtalt tid per uke (0 for timebasis/tilkalling: da brukes planlagte vakter) */
  hoursPerWeek: number;
}
export interface GradedAbsence { employeeId: string; from: string; to: string; percent: number }
export interface Span { employeeId: string; start: Date; end: Date; breakMinutes: number }

export interface GradedRow {
  employeeId: string;
  name: string;
  from: string;
  to: string;
  /** Sykmeldingsgrad (arbeidsevne borte), f.eks. 50 */
  grade: number;
  /** Grunnlag: avtalt tid, eller planlagte vakter når det ikke er avtalt tid */
  basis: "avtalt" | "planlagt";
  basisHours: number;
  workedHours: number;
  /** Andel av grunnlaget den ansatte var på jobb (høyst 100 %) */
  timePct: number;
  /** Arbeidsinnsats = tidsandel × arbeidsevne */
  effortPct: number;
  /** Tilsvarende sykmeldingsgrad når tiden også regnes med */
  effectivePct: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const minutes = (s: Span) => Math.max(0, (s.end.getTime() - s.start.getTime()) / 60000 - s.breakMinutes);

export function gradedSickRows(
  people: GradedInput[], absences: GradedAbsence[], worked: Span[], planned: Span[],
  period: { from: string; to: string }, tz: string,
): GradedRow[] {
  const perDay = (list: Span[]) => {
    const m = new Map<string, number>();
    for (const s of list) {
      const k = `${s.employeeId}|${localDate(s.start, tz)}`;
      m.set(k, (m.get(k) ?? 0) + minutes(s));
    }
    return m;
  };
  const w = perDay(worked), p = perDay(planned);
  const byId = new Map(people.map((x) => [x.employeeId, x]));
  const rows: GradedRow[] = [];
  for (const a of absences) {
    const who = byId.get(a.employeeId);
    if (!who || a.percent >= 100) continue;
    const from = a.from > period.from ? a.from : period.from;
    const to = a.to < period.to ? a.to : period.to;
    if (from > to) continue;
    const dayMin = (who.hoursPerWeek * 60) / 5;
    let basis = 0, done = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const k = `${a.employeeId}|${d}`;
      done += w.get(k) ?? 0;
      basis += dayMin > 0 ? (isoWeekday(d) <= 5 && !holidayOn(d) ? dayMin : 0) : p.get(k) ?? 0;
    }
    const timeShare = basis > 0 ? Math.min(1, done / basis) : 0;
    const effort = timeShare * (1 - a.percent / 100);
    rows.push({
      employeeId: a.employeeId, name: who.name, from, to, grade: a.percent, basis: dayMin > 0 ? "avtalt" : "planlagt",
      basisHours: r1(basis / 60), workedHours: r1(done / 60), timePct: r1(timeShare * 100), effortPct: r1(effort * 100), effectivePct: r1((1 - effort) * 100),
    });
  }
  return rows.sort((x, y) => x.name.localeCompare(y.name, "nb") || x.from.localeCompare(y.from));
}
