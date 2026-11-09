// Norske helligdager og høytidsaftener, beregnet per år.
import { addDays } from "./time";

export type HolidayKind = "public" | "may"; // "may" = 1. og 17. mai (egne lover)

export interface Holiday {
  key: string;
  date: string;
  name: string;
  kind: HolidayKind;
}

export interface HolidayEve {
  key: string;
  date: string;
  name: string;
}

/** 1. påskedag (gregoriansk, Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function norwegianHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const y = String(year);
  const list: Holiday[] = [
    { key: "nyttarsdag", date: `${y}-01-01`, name: "1. nyttårsdag", kind: "public" },
    { key: "skjaertorsdag", date: addDays(easter, -3), name: "Skjærtorsdag", kind: "public" },
    { key: "langfredag", date: addDays(easter, -2), name: "Langfredag", kind: "public" },
    { key: "paaskedag1", date: easter, name: "1. påskedag", kind: "public" },
    { key: "paaskedag2", date: addDays(easter, 1), name: "2. påskedag", kind: "public" },
    { key: "1mai", date: `${y}-05-01`, name: "Offentlig høytidsdag (1. mai)", kind: "may" },
    { key: "17mai", date: `${y}-05-17`, name: "Grunnlovsdag (17. mai)", kind: "may" },
    { key: "kristihimmelfart", date: addDays(easter, 39), name: "Kristi himmelfartsdag", kind: "public" },
    { key: "pinsedag1", date: addDays(easter, 49), name: "1. pinsedag", kind: "public" },
    { key: "pinsedag2", date: addDays(easter, 50), name: "2. pinsedag", kind: "public" },
    { key: "juledag1", date: `${y}-12-25`, name: "1. juledag", kind: "public" },
    { key: "juledag2", date: `${y}-12-26`, name: "2. juledag", kind: "public" },
  ];
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Aftener der ordinær arbeidstid ofte slutter tidligere (f.eks. kl. 15 i Overenskomsten for bilutleie). */
export function holidayEves(year: number): HolidayEve[] {
  const easter = easterSunday(year);
  return [
    { key: "paaskeaften", date: addDays(easter, -1), name: "Påskeaften" },
    { key: "pinseaften", date: addDays(easter, 48), name: "Pinseaften" },
    { key: "julaften", date: `${year}-12-24`, name: "Julaften" },
    { key: "nyttarsaften", date: `${year}-12-31`, name: "Nyttårsaften" },
  ];
}

const cache = new Map<number, Map<string, Holiday>>();
/** Helligdag på en dato, eller null. */
export function holidayOn(date: string): Holiday | null {
  const year = Number(date.slice(0, 4));
  let map = cache.get(year);
  if (!map) {
    map = new Map(norwegianHolidays(year).map((h) => [h.date, h]));
    cache.set(year, map);
  }
  return map.get(date) ?? null;
}

export function holidaysBetween(from: string, to: string): Holiday[] {
  const out: Holiday[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const h of norwegianHolidays(y)) if (h.date >= from && h.date <= to) out.push(h);
  }
  return out;
}
