// Automatisk vaktplan for en periode (typisk én uke).
// 1) Bemanningsbehovet per dag deles opp i konkrete vakter.
// 2) Vaktene fordeles på ansatte etter stillingsprosent, arbeidsrolle, fravær,
//    tilgjengelighet og hviletid. Vakter ingen kan ta, blir ledige.
// Ren logikk uten database, så den kan testes.
import { zonedToUtc, addDays, dayBounds, DEFAULT_TZ } from "./time";
import type { Requirement } from "./staffing";

export interface DayNeeds {
  date: string;
  closed: boolean;
  requirements: Requirement[];
}

export interface PlanEmployee {
  id: string;
  name: string;
  /** Avtalt arbeidstid per uke i minutter (fra stillingsprosent). */
  targetMinutes: number;
  roleIds: string[];
  /** Datoer der den ansatte ikke kan jobbe (fravær, «kan ikke»). */
  unavailable: string[];
  /** Ønsker ekstravakter: kan få litt mer enn avtalt tid. */
  wantsExtra?: boolean;
}

export interface ExistingShift {
  employeeId: string | null;
  workRoleId: string | null;
  start: Date;
  end: Date;
  breakMinutes: number;
}

export interface PlannedShift {
  date: string;
  start: Date;
  end: Date;
  breakMinutes: number;
  workRoleId: string | null;
  employeeId: string | null;
}

export interface PlanOptions {
  tz?: string;
  slotMinutes?: number;
  minShiftMinutes?: number; // korteste vakt
  maxShiftMinutes?: number; // lengste vakt før den deles
  minRestHours?: number; // daglig hvile
  breakAfterMinutes?: number; // pause når vakten er lengre enn dette
  breakMinutes?: number;
  extraToleranceMinutes?: number; // hvor mye over avtalt tid som er greit
}

const DEFAULTS: Required<Omit<PlanOptions, "tz">> = {
  slotMinutes: 15,
  minShiftMinutes: 180,
  maxShiftMinutes: 510,
  minRestHours: 11,
  breakAfterMinutes: 330,
  breakMinutes: 30,
  extraToleranceMinutes: 60,
};

const MIN = 60000;

function paidMinutes(start: Date, end: Date, breakMin: number) {
  return Math.round((end.getTime() - start.getTime()) / MIN) - breakMin;
}

/** Del et dagsbehov opp i vakter, etter at eksisterende vakter er trukket fra. */
export function needsToShifts(
  day: DayNeeds,
  existing: ExistingShift[],
  opts: PlanOptions = {},
): { start: Date; end: Date; workRoleId: string | null }[] {
  if (day.closed || day.requirements.length === 0) return [];
  const o = { ...DEFAULTS, ...opts };
  const tz = opts.tz ?? DEFAULT_TZ;
  const slot = o.slotMinutes * MIN;
  const { start: d0, end: d1 } = dayBounds(day.date, tz);
  // Behov kan gå over midnatt; ta med neste døgn
  const horizonEnd = d1.getTime() + 24 * 3600000;
  const out: { start: Date; end: Date; workRoleId: string | null }[] = [];

  const roles = Array.from(new Set(day.requirements.map((r) => r.workRoleId ?? null)));
  for (const role of roles) {
    const reqs = day.requirements
      .filter((r) => (r.workRoleId ?? null) === role)
      .map((r) => {
        const s = zonedToUtc(day.date, r.start, tz);
        const endDate = r.end === "00:00" || r.end <= r.start ? addDays(day.date, 1) : day.date;
        return { s: s.getTime(), e: zonedToUtc(endDate, r.end, tz).getTime(), n: r.required };
      });
    const covering = existing.filter((x) => x.employeeId && (role === null || x.workRoleId === role));

    // Restbehov per tidsluke
    const slots: { t: number; need: number }[] = [];
    for (let t = d0.getTime(); t < horizonEnd; t += slot) {
      const need = reqs.filter((r) => r.s < t + slot && r.e > t).reduce((m, r) => Math.max(m, r.n), 0);
      if (need === 0 && t >= d1.getTime()) continue;
      const have = covering.filter((x) => x.start.getTime() <= t && x.end.getTime() >= t + slot).length;
      slots.push({ t, need: Math.max(0, need - have) });
    }
    const maxNeed = slots.reduce((m, s) => Math.max(m, s.need), 0);

    // Lag for lag: nivå 1 er «minst én», nivå 2 «minst to» osv.
    for (let k = 1; k <= maxNeed; k++) {
      let runStart: number | null = null;
      const flush = (endT: number) => {
        if (runStart === null) return;
        out.push(...splitRun(runStart, endT, role, o, slot));
        runStart = null;
      };
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const contiguous = i > 0 && slots[i - 1].t + slot === s.t;
        if (s.need >= k) {
          if (runStart !== null && !contiguous) flush(slots[i - 1].t + slot);
          if (runStart === null) runStart = s.t;
        } else if (runStart !== null) {
          flush(s.t);
        }
      }
      if (runStart !== null) flush(slots[slots.length - 1].t + slot);
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Del lange perioder i like store vakter og forleng for korte. */
function splitRun(s: number, e: number, role: string | null, o: typeof DEFAULTS, slot: number) {
  const len = (e - s) / MIN;
  if (len < o.minShiftMinutes) {
    // Forleng til korteste vakt (litt overbemanning er bedre enn en for kort vakt)
    return [{ start: new Date(s), end: new Date(s + o.minShiftMinutes * MIN), workRoleId: role }];
  }
  const parts = Math.ceil(len / o.maxShiftMinutes);
  const each = Math.round((e - s) / parts / slot) * slot;
  const res = [];
  for (let i = 0; i < parts; i++) {
    const a = s + i * each;
    const b = i === parts - 1 ? e : a + each;
    res.push({ start: new Date(a), end: new Date(b), workRoleId: role });
  }
  return res;
}

export interface PlanResult {
  shifts: PlannedShift[];
  summary: { employeeId: string; name: string; targetMinutes: number; plannedMinutes: number; shifts: number }[];
  openCount: number;
}

/** Lag forslag til vaktplan. Eksisterende vakter beholdes og regnes med. */
export function buildPlan(
  days: DayNeeds[],
  employees: PlanEmployee[],
  existing: ExistingShift[],
  opts: PlanOptions = {},
): PlanResult {
  const o = { ...DEFAULTS, ...opts };
  const tz = opts.tz ?? DEFAULT_TZ;
  const restMs = o.minRestHours * 3600000;

  // Hver ansatts vakter (eksisterende + nye), og timer i perioden
  const busy = new Map<string, { start: Date; end: Date }[]>();
  const planned = new Map<string, number>();
  const firstDay = days[0]?.date;
  const lastDay = days[days.length - 1]?.date;
  const periodStart = firstDay ? dayBounds(firstDay, tz).start.getTime() : 0;
  const periodEnd = lastDay ? dayBounds(lastDay, tz).end.getTime() : 0;
  for (const e of employees) {
    busy.set(e.id, []);
    planned.set(e.id, 0);
  }
  for (const x of existing) {
    if (!x.employeeId || !busy.has(x.employeeId)) continue;
    busy.get(x.employeeId)!.push({ start: x.start, end: x.end });
    if (x.start.getTime() >= periodStart && x.start.getTime() < periodEnd) {
      planned.set(x.employeeId, planned.get(x.employeeId)! + paidMinutes(x.start, x.end, x.breakMinutes));
    }
  }

  const localDay = (d: Date) => {
    // dato i tidssonen, uten å importere mer
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  };

  const result: PlannedShift[] = [];
  for (const day of days) {
    const needs = needsToShifts(day, existing.filter((x) => localDay(x.start) === day.date), opts)
      // lengste vakter først, så de kortere fyller inn
      .sort((a, b) => b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime()));

    for (const n of needs) {
      const durMin = Math.round((n.end.getTime() - n.start.getTime()) / MIN);
      const brk = durMin > o.breakAfterMinutes ? o.breakMinutes : 0;
      const paid = durMin - brk;

      const candidates = employees.filter((e) => {
        if (e.unavailable.includes(day.date)) return false;
        if (n.workRoleId && !e.roleIds.includes(n.workRoleId)) return false;
        const limit = e.targetMinutes + (e.wantsExtra ? o.extraToleranceMinutes * 4 : o.extraToleranceMinutes);
        if (planned.get(e.id)! + paid > limit) return false;
        const mine = busy.get(e.id)!;
        // én vakt per dag, ingen overlapp, nok hvile før og etter
        if (mine.some((m) => localDay(m.start) === day.date)) return false;
        return mine.every(
          (m) => m.end.getTime() + restMs <= n.start.getTime() || n.end.getTime() + restMs <= m.start.getTime(),
        );
      });

      // Den som har mest igjen av avtalt tid, får vakten. Likt = færrest vakter, så navn.
      candidates.sort((a, b) => {
        const ra = a.targetMinutes - planned.get(a.id)!;
        const rb = b.targetMinutes - planned.get(b.id)!;
        if (rb !== ra) return rb - ra;
        const sa = busy.get(a.id)!.length;
        const sb = busy.get(b.id)!.length;
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name, "nb");
      });

      const pick = candidates[0] ?? null;
      if (pick) {
        busy.get(pick.id)!.push({ start: n.start, end: n.end });
        planned.set(pick.id, planned.get(pick.id)! + paid);
      }
      result.push({ date: day.date, start: n.start, end: n.end, breakMinutes: brk, workRoleId: n.workRoleId, employeeId: pick?.id ?? null });
    }
  }

  result.sort((a, b) => a.start.getTime() - b.start.getTime());
  return {
    shifts: result,
    summary: employees.map((e) => ({
      employeeId: e.id,
      name: e.name,
      targetMinutes: e.targetMinutes,
      plannedMinutes: planned.get(e.id)!,
      shifts: result.filter((s) => s.employeeId === e.id).length,
    })),
    openCount: result.filter((s) => !s.employeeId).length,
  };
}
