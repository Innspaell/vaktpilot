// Bemanning per tidsrom. Teller hvor mange som faktisk er på jobb i hvert intervall,
// så fire ansatte på ulike tidspunkt ikke regnes som fire hele dagen.
import { dayBounds, zonedToUtc, addDays, isoWeekday, DEFAULT_TZ } from "./time";

export interface Requirement {
  start: string; // "HH:MM"
  end: string; // "HH:MM", "00:00" = midnatt
  required: number;
  workRoleId?: string | null;
}

export interface StaffingTemplateRow extends Requirement {
  weekday: number; // 1 = mandag
}

export interface StaffingOverrideRow {
  date: string;
  closed: boolean;
  start?: string | null;
  end?: string | null;
  required?: number | null;
  workRoleId?: string | null;
}

export interface PlannedShift {
  startsAt: Date;
  endsAt: Date;
  employeeId: string | null;
  workRoleId?: string | null;
}

export interface Gap {
  start: Date;
  end: Date;
  required: number;
  planned: number;
  missing: number;
  workRoleId: string | null;
}

export interface DayCoverage {
  date: string;
  closed: boolean;
  peakRequired: number;
  peakPlanned: number;
  gaps: Gap[];
}

/** Behov for en dato: avvik på datoen erstatter malen for ukedagen. */
export function requirementsFor(
  date: string,
  templates: StaffingTemplateRow[],
  overrides: StaffingOverrideRow[],
): { closed: boolean; requirements: Requirement[] } {
  const forDate = overrides.filter((o) => o.date === date);
  if (forDate.some((o) => o.closed)) return { closed: true, requirements: [] };
  if (forDate.length > 0) {
    return {
      closed: false,
      requirements: forDate.map((o) => ({
        start: o.start!,
        end: o.end!,
        required: o.required ?? 0,
        workRoleId: o.workRoleId ?? null,
      })),
    };
  }
  const wd = isoWeekday(date);
  return { closed: false, requirements: templates.filter((t) => t.weekday === wd) };
}

function reqInterval(date: string, r: Requirement, tz: string) {
  const start = zonedToUtc(date, r.start, tz);
  const endDate = r.end === "00:00" || r.end <= r.start ? addDays(date, 1) : date;
  return { start, end: zonedToUtc(endDate, r.end, tz) };
}

export function dayCoverage(
  date: string,
  requirements: Requirement[],
  shifts: PlannedShift[],
  opts: { slotMinutes?: number; tz?: string; closed?: boolean } = {},
): DayCoverage {
  const tz = opts.tz ?? DEFAULT_TZ;
  const slot = (opts.slotMinutes ?? 15) * 60000;
  const { start: dayStart, end: dayEnd } = dayBounds(date, tz);
  if (opts.closed) return { date, closed: true, peakRequired: 0, peakPlanned: 0, gaps: [] };

  const roleKeys = Array.from(new Set(requirements.map((r) => r.workRoleId ?? null)));
  const assigned = shifts.filter((s) => s.employeeId);
  const gaps: Gap[] = [];
  let peakRequired = 0;
  let peakPlanned = 0;

  for (const role of roleKeys) {
    const reqs = requirements.filter((r) => (r.workRoleId ?? null) === role).map((r) => ({ ...r, ...reqInterval(date, r, tz) }));
    const relevant = role === null ? assigned : assigned.filter((s) => s.workRoleId === role);
    let open: Gap | null = null;

    for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += slot) {
      const a = t;
      const b = t + slot;
      const required = reqs.filter((r) => r.start.getTime() < b && r.end.getTime() > a).reduce((s, r) => Math.max(s, r.required), 0);
      // Telles bare som på jobb hvis vakten dekker hele intervallet
      const planned = relevant.filter((s) => s.startsAt.getTime() <= a && s.endsAt.getTime() >= b).length;
      peakRequired = Math.max(peakRequired, required);
      if (required > 0) peakPlanned = Math.max(peakPlanned, planned);
      const missing = Math.max(0, required - planned);

      if (missing > 0 && open && open.missing === missing && open.required === required && open.end.getTime() === a) {
        open.end = new Date(b);
      } else {
        if (open) gaps.push(open);
        open = missing > 0 ? { start: new Date(a), end: new Date(b), required, planned, missing, workRoleId: role } : null;
      }
    }
    if (open) gaps.push(open);
  }

  gaps.sort((x, y) => x.start.getTime() - y.start.getTime());
  return { date, closed: false, peakRequired, peakPlanned, gaps };
}
