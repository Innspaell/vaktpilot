import { inflateRawSync } from "node:zlib";

/**
 * Leser ansatte fra Excel (.xlsx), CSV eller tekst limt inn fra Excel, uten eksterne pakker.
 * Første rad er overskrifter; kolonnene kjennes igjen på navnet («Navn», «E-post», «Mobil» …).
 */

export type ImportRow = {
  full_name: string;
  email: string | null;
  phone: string | null;
  employee_number: string | null;
  start_date: string | null;
  position_pct: number | null;
  pay_type: "hourly" | "fixed" | null;
  is_shift_worker: boolean | null;
  /** Hva som er galt med raden. Tom = kan importeres. */
  problems: string[];
};

// ── Filformat ────────────────────────────────────────────────────────────

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");

/** Pakker ut filene i en .xlsx (zip). */
function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Filen ser ikke ut som en Excel-fil.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    if (/^xl\/(sharedStrings|workbook|worksheets\/sheet\d+)\.xml$/.test(name) || name === "xl/_rels/workbook.xml.rels") {
      files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  const strings: string[] = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8");
  if (ss) {
    for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      strings.push(decodeXml((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
    }
  }
  // Første ark i arbeidsboka
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = files.get("xl/workbook.xml")?.toString("utf8");
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  const firstRid = wb?.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const target = firstRid
    ? rels?.match(new RegExp(`<Relationship\\b[^>]*Id="${firstRid}"[^>]*Target="([^"]+)"`))?.[1]
      ?? rels?.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstRid}"`))?.[1]
    : undefined;
  if (target) sheetPath = "xl/" + target.replace(/^\/?xl\//, "").replace(/^\//, "");
  const sheet = (files.get(sheetPath) ?? [...files.entries()].find(([k]) => k.startsWith("xl/worksheets/"))?.[1])?.toString("utf8");
  if (!sheet) throw new Error("Fant ikke noe ark i Excel-fila.");

  const rows: string[][] = [];
  for (const row of sheet.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = c.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = c.match(/\bt="([^"]+)"/)?.[1];
      const style = c.match(/\bs="(\d+)"/)?.[1];
      const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s" && v !== undefined) value = strings[Number(v)] ?? "";
      else if (type === "inlineStr") value = decodeXml((c.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? ""));
      else if (v !== undefined) value = decodeXml(v);
      // Tall med format (stil) kan være datoer; merkes så kolonnen kan tolkes som dato
      if (!type && style && v !== undefined && /^\d{4,5}(\.\d+)?$/.test(v)) value = `#serial:${v}`;
      cells[ref ? colIndex(ref) : cells.length] = value;
    }
    rows.push(Array.from(cells, (x) => x ?? ""));
  }
  return rows;
}

/** CSV eller tekst limt inn fra Excel (tab, semikolon eller komma). */
export function readDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];
  const first = clean.split("\n")[0];
  const sep = first.includes("\t") ? "\t" : (first.split(";").length >= first.split(",").length ? ";" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

export function readSpreadsheet(buf: Buffer, filename: string): string[][] {
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (isZip || /\.xlsx$/i.test(filename)) return readXlsx(buf);
  if (/\.xls$/i.test(filename)) throw new Error("Gamle .xls-filer støttes ikke. Lagre som .xlsx eller CSV i Excel og prøv igjen.");
  const utf8 = buf.toString("utf8");
  // Excel på Windows lagrer CSV som Windows-1252
  return readDelimited(utf8.includes("�") ? buf.toString("latin1") : utf8);
}

// ── Kolonner og verdier ──────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-zæøå0-9%]/g, "");
const HEADERS: Record<string, string[]> = {
  full_name: ["navn", "fulltnavn", "name", "ansatt", "ansattnavn", "fullname"],
  first_name: ["fornavn", "firstname"],
  last_name: ["etternavn", "lastname", "surname"],
  email: ["epost", "epostadresse", "email", "mail"],
  phone: ["telefon", "mobil", "tlf", "mobilnummer", "telefonnummer", "phone", "mobile"],
  employee_number: ["ansattnummer", "ansattnr", "nr", "nummer", "employeenumber", "id"],
  start_date: ["startdato", "start", "ansattdato", "ansattfra", "fra", "tiltredelse", "startdate"],
  position_pct: ["stillingsprosent", "stilling", "stilling%", "prosent", "%", "stillingsandel"],
  pay_type: ["lønnstype", "lonnstype", "lønn", "lønnsform"],
  is_shift_worker: ["turnus", "skift", "turnusskift", "jobberturnus"],
};

export function detectColumns(header: string[]) {
  const map: Partial<Record<keyof typeof HEADERS, number>> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [key, names] of Object.entries(HEADERS)) {
      if (map[key as keyof typeof HEADERS] === undefined && names.includes(n)) map[key as keyof typeof HEADERS] = i;
    }
  });
  return map;
}

function toDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const serial = s.match(/^#serial:(\d+(?:\.\d+)?)$/) ?? (/^\d{5}$/.test(s) ? [s, s] : null);
  if (serial) {
    const d = new Date(Math.round((Number(serial[1]) - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return "invalid";
}

const plain = (v: string | undefined) => (v ?? "").replace(/^#serial:/, "").trim();

export function parseEmployees(rows: string[][], existingEmails: string[] = []): { rows: ImportRow[]; columns: string[]; missingName: boolean } {
  const nonEmpty = rows.filter((r) => r.some((c) => plain(c) !== ""));
  if (nonEmpty.length === 0) return { rows: [], columns: [], missingName: true };
  const [header, ...body] = nonEmpty;
  const col = detectColumns(header);
  const missingName = col.full_name === undefined && col.first_name === undefined;
  const found = Object.keys(col).map((k) => ({ full_name: "Navn", first_name: "Fornavn", last_name: "Etternavn", email: "E-post", phone: "Telefon",
    employee_number: "Ansattnummer", start_date: "Startdato", position_pct: "Stillingsprosent", pay_type: "Lønnstype", is_shift_worker: "Turnus" })[k]!);
  const taken = new Set(existingEmails.map((e) => e.toLowerCase()));
  const seen = new Set<string>();
  const get = (r: string[], k: keyof typeof HEADERS) => (col[k] === undefined ? "" : plain(r[col[k]!]));

  const out = body.slice(0, 500).map((r): ImportRow => {
    const problems: string[] = [];
    const full = get(r, "full_name") || [get(r, "first_name"), get(r, "last_name")].filter(Boolean).join(" ");
    if (!full) problems.push("Mangler navn");
    const email = get(r, "email").toLowerCase() || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) problems.push("Ugyldig e-post");
    else if (email && taken.has(email)) problems.push("Finnes allerede");
    else if (email && seen.has(email)) problems.push("Samme e-post to ganger");
    if (email) seen.add(email);
    const start = col.start_date === undefined ? null : toDate(col.start_date === undefined ? "" : (r[col.start_date] ?? ""));
    if (start === "invalid") problems.push("Ukjent dato");
    const pctRaw = get(r, "position_pct").replace("%", "").replace(",", ".");
    let pct = pctRaw ? (/tilkall|ekstra|vikar/i.test(pctRaw) ? 0 : Number(pctRaw)) : null;
    if (pct !== null && pct > 0 && pct <= 1) pct = Math.round(pct * 1000) / 10; // 0,8 = 80 %
    if (pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) { problems.push("Ugyldig stillingsprosent"); pct = null; }
    const payRaw = norm(get(r, "pay_type"));
    const pay = !payRaw ? null : /fast|mnd|månedslønn|maned/.test(payRaw) ? "fixed" : /time/.test(payRaw) ? "hourly" : null;
    const shiftRaw = norm(get(r, "is_shift_worker"));
    const shift = !shiftRaw ? null : ["ja", "j", "x", "yes", "1", "true", "turnus", "skift"].includes(shiftRaw);
    const phone = get(r, "phone").replace(/\s+/g, " ") || null;
    return {
      full_name: full, email, phone, employee_number: get(r, "employee_number") || null,
      start_date: start === "invalid" ? null : start, position_pct: pct, pay_type: pay, is_shift_worker: shift, problems,
    };
  });
  return { rows: out, columns: found, missingName };
}
