// Kontroll mot arbeidsmiljølovens arbeidstidsregler. Ren logikk, testbar.
// Gir advarsler, ikke stopp: noen unntak kan være avtalt (f.eks. tariff eller gjennomsnittsberegning).
import { addDays, isoWeekday, localDate, localParts, dayBounds, DEFAULT_TZ } from "./time";

export interface WorkPeriod { start: Date; end: Date }
export interface WorkWarning {
  date: string;
  severity: "brudd" | "info";
  rule: string;
  text: string;
}

const H = 3600000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const nb = (n: number) => r1(n).toLocaleString("nb-NO");
const dl = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}`;

/** Slå sammen økter som overlapper eller har under 1 time mellom seg (pause). */
function merge(periods: WorkPeriod[]) {
  const s = [...periods].filter((p) => p.end > p.start).sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: { start: number; end: number; work: number }[] = [];
  for (const p of s) {
    const st = p.start.getTime(), en = p.end.getTime();
    const last = out[out.length - 1];
    if (last && st - last.end < H) { last.end = Math.max(last.end, en); last.work += en - st; }
    else out.push({ start: st, end: en, work: en - st });
  }
  return out;
}

/** Arbeidstid innenfor et tidsrom (ms). */
function workIn(blocks: { start: number; end: number }[], a: number, b: number) {
  let sum = 0;
  for (const x of blocks) sum += Math.max(0, Math.min(b, x.end) - Math.max(a, x.start));
  return sum;
}

/** Lengste friperiode innenfor [a, b]. */
function longestRest(blocks: { start: number; end: number }[], a: number, b: number) {
  let cursor = a, best = 0;
  for (const x of blocks) {
    if (x.end <= a) continue;
    if (x.start >= b) break;
    best = Math.max(best, Math.max(0, x.start - cursor));
    cursor = Math.max(cursor, x.end);
  }
  return Math.max(best, b - cursor);
}

/**
 * Sjekk arbeidstid for én ansatt. «periods» bør gå 52 uker bakover for å kunne telle overtid over året.
 * Bare advarsler med dato i [from, to] returneres.
 */
export function checkWorkPeriods(periods: WorkPeriod[], from: string, to: string, tz = DEFAULT_TZ): WorkWarning[] {
  const blocks = merge(periods);
  const out: WorkWarning[] = [];
  const inRange = (d: string) => d >= from && d <= to;
  const seen = new Set<string>();
  const push = (w: WorkWarning) => { const k = `${w.rule}|${w.date}`; if (!seen.has(k) && inRange(w.date)) { seen.add(k); out.push(w); } };

  // Daglig hvile (§ 10-8 (1)) og maks 13 timer per 24 timer (§ 10-6 (8))
  for (const b of blocks) {
    const date = localDate(new Date(b.start), tz);
    if (!inRange(date)) continue;
    const rest = longestRest(blocks, b.start, b.start + 24 * H);
    if (rest < 11 * H) push({ date, severity: "brudd", rule: "hvile_dag", text: `${dl(date)}: bare ${nb(rest / H)} timer sammenhengende fri i løpet av 24 timer. Loven krever minst 11 timer (§ 10-8).` });
    const work = workIn(blocks, b.start, b.start + 24 * H);
    if (work > 13 * H) push({ date, severity: "brudd", rule: "maks_dag", text: `${dl(date)}: ${nb(work / H)} timer arbeid i løpet av 24 timer. Grensen er 13 timer, også med overtid (§ 10-6).` });
  }

  // Uke for uke (mandag–søndag)
  const firstWeek = addDays(from, 1 - isoWeekday(from));
  const weekStarts: string[] = [];
  const earliest = blocks.length ? localDate(new Date(blocks[0].start), tz) : from;
  for (let w = addDays(earliest, 1 - isoWeekday(earliest)); w <= to; w = addDays(w, 7)) weekStarts.push(w);
  const weekOT = new Map<string, number>();
  for (const w of weekStarts) {
    const a = dayBounds(w, tz).start.getTime(), b = dayBounds(addDays(w, 7), tz).start.getTime();
    const total = workIn(blocks, a, b);
    let dailyOver = 0;
    for (let d = 0; d < 7; d++) {
      const da = dayBounds(addDays(w, d), tz).start.getTime(), db = dayBounds(addDays(w, d + 1), tz).start.getTime();
      dailyOver += Math.max(0, workIn(blocks, da, db) - 9 * H);
    }
    const ot = Math.max(dailyOver, total - 40 * H);
    weekOT.set(w, ot);
    if (w < firstWeek) continue;
    const wd = w < from ? from : w;
    if (total > 48 * H) push({ date: wd, severity: "brudd", rule: "maks_uke", text: `Uka fra ${dl(w)}: ${nb(total / H)} timer. Grensen er 48 timer per uke, også med overtid (§ 10-6).` });
    if (ot > 10 * H) push({ date: wd, severity: "brudd", rule: "ot_uke", text: `Uka fra ${dl(w)}: ca. ${nb(ot / H)} timer overtid. Grensen er 10 timer per uke (§ 10-6).` });
    // Ukentlig hvile: minst 35 timer sammenhengende fri innenfor uka (§ 10-8 (2))
    if (total > 0 && longestRest(blocks, a, b) < 35 * H) {
      push({ date: wd, severity: "brudd", rule: "hvile_uke", text: `Uka fra ${dl(w)}: ingen sammenhengende fri på 35 timer. Loven krever det hver uke (§ 10-8).` });
    }
  }
  // Overtid over 4 uker og 52 uker (§ 10-6)
  const keys = [...weekOT.keys()].sort();
  keys.forEach((w, i) => {
    if (w < firstWeek) return;
    const wd = w < from ? from : w;
    const four = keys.slice(Math.max(0, i - 3), i + 1).reduce((s, k) => s + (weekOT.get(k) ?? 0), 0);
    const year = keys.slice(Math.max(0, i - 51), i + 1).reduce((s, k) => s + (weekOT.get(k) ?? 0), 0);
    if (four > 25 * H) push({ date: wd, severity: "brudd", rule: "ot_4uker", text: `Fire uker til og med uka fra ${dl(w)}: ca. ${nb(four / H)} timer overtid. Grensen er 25 timer (§ 10-6).` });
    if (year > 200 * H) push({ date: wd, severity: "brudd", rule: "ot_aar", text: `Siste 52 uker til og med uka fra ${dl(w)}: ca. ${nb(year / H)} timer overtid. Grensen er 200 timer (§ 10-6).` });
  });

  // Natt- og søndagsarbeid: bare tillatt når arbeidets art gjør det nødvendig (§§ 10-10, 10-11)
  const nights = new Set<string>(), sundays = new Set<string>();
  for (const b of blocks) {
    for (let t = b.start; t < b.end; t += 15 * 60000) {
      const p = localParts(new Date(t), tz);
      const d = localDate(new Date(t), tz);
      if (!inRange(d)) continue;
      const wd = isoWeekday(d);
      if (p.hour >= 21 || p.hour < 6) nights.add(d);
      if ((wd === 6 && p.hour >= 18) || (wd === 7 && p.hour < 22)) sundays.add(d);
    }
  }
  if (nights.size) out.push({ date: [...nights].sort()[0], severity: "info", rule: "natt", text: `Nattarbeid (kl. 21–06) ${nights.size} ${nights.size === 1 ? "dag" : "dager"}. Det er bare tillatt når arbeidets art gjør det nødvendig (§ 10-11).` });
  if (sundays.size) out.push({ date: [...sundays].sort()[0], severity: "info", rule: "sondag", text: `Søndagsarbeid (lørdag kl. 18 – søndag kl. 22) ${sundays.size} ${sundays.size === 1 ? "dag" : "dager"}. Det er bare tillatt når arbeidets art gjør det nødvendig (§ 10-10).` });

  return out.sort((a, b) => (a.severity === b.severity ? a.date.localeCompare(b.date) : a.severity === "brudd" ? -1 : 1));
}
