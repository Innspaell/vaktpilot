// Tid i Europe/Oslo uten eksterne biblioteker.
// Alt lagres som UTC-tidspunkt. Datoer ("YYYY-MM-DD") og klokkeslett ("HH:MM") tolkes i bedriftens tidssone.

export const DEFAULT_TZ = "Europe/Oslo";

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Lokale felter for et tidspunkt i gitt tidssone. */
export function localParts(d: Date, tz = DEFAULT_TZ) {
  const p: Record<string, number> = {};
  for (const { type, value } of fmt(tz).formatToParts(d)) {
    if (type !== "literal") p[type] = Number(value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** Forskjell mellom lokal tid og UTC i minutter (60 om vinteren, 120 om sommeren i Norge). */
export function offsetMinutes(d: Date, tz = DEFAULT_TZ): number {
  const p = localParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** Lokal dato + klokkeslett → UTC-tidspunkt. Klokkeslett som ikke finnes (sommertid) flyttes fram. */
export function zonedToUtc(date: string, time: string, tz = DEFAULT_TZ): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let guess = naive - offsetMinutes(new Date(naive), tz) * 60000;
  guess = naive - offsetMinutes(new Date(guess), tz) * 60000;
  return new Date(guess);
}

/** Lokal dato ("YYYY-MM-DD") for et tidspunkt. */
export function localDate(d: Date, tz = DEFAULT_TZ): string {
  const p = localParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Lokalt klokkeslett ("HH:MM"). */
export function localTime(d: Date, tz = DEFAULT_TZ): string {
  const p = localParts(d, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Legg til dager på en dato-streng. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Ukedag 1 = mandag … 7 = søndag. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Start og slutt på en lokal dag som UTC-tidspunkt. Lengden er 23, 24 eller 25 timer. */
export function dayBounds(date: string, tz = DEFAULT_TZ) {
  return { start: zonedToUtc(date, "00:00", tz), end: zonedToUtc(addDays(date, 1), "00:00", tz) };
}

/** Arbeidsminutter: faktisk varighet (riktig over sommertid) minus pause. */
export function workedMinutes(start: Date, end: Date, breakMinutes = 0): number {
  const total = Math.round((end.getTime() - start.getTime()) / 60000);
  return Math.max(0, total - breakMinutes);
}

/**
 * Fordel en arbeidsøkt på lokale datoer.
 * Pausen trekkes fra dagen der økten startet (der pauser normalt tas).
 */
export function minutesPerLocalDay(start: Date, end: Date, breakMinutes = 0, tz = DEFAULT_TZ) {
  const result: { date: string; minutes: number }[] = [];
  let cursor = start;
  while (cursor < end) {
    const date = localDate(cursor, tz);
    const dayEnd = dayBounds(date, tz).end;
    const segEnd = dayEnd < end ? dayEnd : end;
    result.push({ date, minutes: Math.round((segEnd.getTime() - cursor.getTime()) / 60000) });
    cursor = segEnd;
  }
  let rest = breakMinutes;
  for (const r of result) {
    const take = Math.min(rest, r.minutes);
    r.minutes -= take;
    rest -= take;
  }
  return result;
}

/** Timer med to desimaler, norsk visning: 7,5 t */
export function formatHours(minutes: number): string {
  const h = Math.round((minutes / 60) * 100) / 100;
  return `${h.toLocaleString("nb-NO", { maximumFractionDigits: 2 })} t`;
}

const DATE_FMT = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
/** "fredag 13. november" */
export function formatDateLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DATE_FMT.format(new Date(Date.UTC(y, m - 1, d)));
}
