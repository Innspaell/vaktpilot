// Personallisten (bokføringsforskriften § 8-5-6): felles for skjerm, utskrift og fil.
import { localDate, localTime } from "./time";

export type PlChange = { at: string; by: string; action: "UPDATE" | "DELETE"; from_start: string | null; from_end: string | null; to_start: string | null; to_end: string | null };
export type PlRow = {
  work_date: string; site_id: string | null; site_name: string | null;
  entry_id: string; employee_id: string; employee_number: string | null; full_name: string; worker_type: "employee" | "hired" | "unpaid";
  starts_at: string; ends_at: string | null; source: "clock" | "manual" | "admin"; deleted: boolean;
  registered_at: string; registered_by: string; changes: PlChange[];
};
export type PlSite = { id: string; name: string; address: string | null };

export const WORKER_LABEL: Record<string, string> = { hired: "innleid", unpaid: "ulønnet" };

/** Rettelser, slettinger og etterføringer som tekst, med hvem og når. */
export function rowNotes(r: PlRow, tz: string): string[] {
  const t = (iso: string | null) => (iso ? localTime(new Date(iso), tz) : "");
  const dt = (iso: string) => {
    const d = localDate(new Date(iso), tz);
    return `${d === r.work_date ? "" : d.split("-").reverse().slice(0, 2).join(".") + ". "}kl. ${localTime(new Date(iso), tz)}`;
  };
  const notes: string[] = [];
  if (r.source !== "clock") notes.push(`Ført i etterkant av ${r.registered_by}, ${dt(r.registered_at)}`);
  for (const c of r.changes) {
    if (c.action === "DELETE") { notes.push(`Slettet av ${c.by}, ${dt(c.at)}`); continue; }
    const parts: string[] = [];
    if (c.from_start !== c.to_start) parts.push(`inn ${t(c.from_start)} → ${t(c.to_start)}`);
    if (c.from_end !== c.to_end) parts.push(c.from_end ? `ut ${t(c.from_end)} → ${t(c.to_end) || "fjernet"}` : `ut satt til ${t(c.to_end)}`);
    notes.push(`Rettet av ${c.by}, ${dt(c.at)}${parts.length ? `: ${parts.join(", ")}` : ""}`);
  }
  return notes;
}

/** Del listen per arbeidssted. Uten arbeidssteder blir det én liste. */
export function groupBySite(rows: PlRow[], sites: PlSite[], only: string | null) {
  if (!sites.length) return [{ site: null as PlSite | null, rows }];
  const groups: { site: PlSite | null; rows: PlRow[] }[] = [];
  const list = only ? sites.filter((s) => s.id === only) : sites;
  for (const s of list) groups.push({ site: s, rows: rows.filter((r) => r.site_id === s.id) });
  if (!only) {
    const rest = rows.filter((r) => !r.site_id);
    if (rest.length) groups.push({ site: null, rows: rest });
  }
  return groups;
}

export const PL_RETENTION_NOTE =
  "Kode = ansattnummer. Kodeoversikten med fødselsnummer eller D-nummer ligger i lønnssystemet og vises ved kontroll. " +
  "Listen bygger på stemplingene. Rettelser og slettinger står med hvem som gjorde dem og når. Ingen registreringer kan fjernes fra listen. " +
  "Listen oppbevares i 3,5 år etter regnskapsårets slutt.";
