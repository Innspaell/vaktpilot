import "server-only";
import { wageTypeFor, type EmployeePay } from "./pay";
import type { Cell, Sheet } from "./xlsx";
import { localDate, localTime } from "./time";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Lønnsgrunnlag: én rad per ansatt og lønnsart. Samme innhold som CSV-filen. */
export function payrollSheet(pay: EmployeePay[], period: { from: string; to: string }, wageTypes?: Map<string, string>, name = "Lønnsgrunnlag"): Sheet {
  const rows: Cell[][] = [["Ansattnummer", "Ansatt", "Periode fra", "Periode til", "Lønnstype", "Lønnsart", "Kode", "Beskrivelse", "Timer", "Dager", "Antall", "Sats (kr)", "Prosent", "Beløp (kr)"]];
  for (const p of pay) for (const l of p.lines) {
    rows.push([p.employee.employeeNumber ?? "", p.employee.name, period.from, period.to, p.employee.payType === "fixed" ? "Fastlønn" : "Timelønn",
      wageTypeFor(l.code, wageTypes) ?? "", l.code, l.label, l.hours, l.days ?? null, l.quantity ?? null, l.rate ?? null, l.percent ?? null, l.amount ?? null]);
  }
  return { name, rows, widths: [13, 24, 12, 12, 11, 10, 16, 34, 8, 7, 7, 10, 8, 11] };
}

/** Forklaring: hvorfor hver linje er der, og hvilke dager den gjelder. */
export function explanationSheet(pay: EmployeePay[]): Sheet {
  const rows: Cell[][] = [["Ansatt", "Beskrivelse", "Timer/antall", "Regel", "Dager"]];
  for (const p of pay) for (const l of p.lines) {
    rows.push([p.employee.name, l.label, l.quantity ?? l.hours, l.why ?? "", (l.details ?? []).join("; ")]);
  }
  return { name: "Forklaring", rows, widths: [24, 34, 11, 60, 80] };
}

type EntryRow = { employee_id: string; starts_at: string; ends_at: string; break_minutes: number; status: string;
  shifts: { starts_at: string; ends_at: string } | null };

/** Kontrollark: hver registrering, med planlagt tid ved siden av. */
export function entriesSheet(entries: EntryRow[], names: Map<string, string>, tz: string): Sheet {
  const status: Record<string, string> = { draft: "Utkast", submitted: "Venter", approved: "Godkjent", locked: "Låst" };
  const rows: Cell[][] = [["Ansatt", "Dato", "Fra", "Til", "Pause (min)", "Timer", "Planlagt", "Status"]];
  for (const r of entries.slice().sort((a, b) => (names.get(a.employee_id) ?? "").localeCompare(names.get(b.employee_id) ?? "", "nb") || a.starts_at.localeCompare(b.starts_at))) {
    const s = new Date(r.starts_at), e = new Date(r.ends_at);
    rows.push([names.get(r.employee_id) ?? "", localDate(s, tz), localTime(s, tz), localTime(e, tz), r.break_minutes,
      r2(((e.getTime() - s.getTime()) / 60000 - r.break_minutes) / 60),
      r.shifts ? `${localTime(new Date(r.shifts.starts_at), tz)}–${localTime(new Date(r.shifts.ends_at), tz)}` : "",
      status[r.status] ?? r.status]);
  }
  return { name: "Timer per dag", rows, widths: [24, 12, 7, 7, 11, 8, 13, 10] };
}
