// Gruppering av vakter etter arbeidsrolle for visning (Ledelse øverst osv.).
import { localTime } from "./time";

export interface RosterRole {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface RosterGroup<T> {
  role: RosterRole | null; // null = uten rolle
  items: T[];
}

/** Hovedrolle for en ansatt: rollen med lavest sorteringsnummer. */
export function primaryRoles(roles: RosterRole[], links: { employee_id: string; work_role_id: string }[]) {
  const order = new Map(roles.map((r) => [r.id, r]));
  const out = new Map<string, string>();
  for (const l of links) {
    const r = order.get(l.work_role_id);
    if (!r) continue;
    const cur = out.get(l.employee_id);
    if (!cur || (order.get(cur)!.sort_order ?? 0) > r.sort_order) out.set(l.employee_id, r.id);
  }
  return out;
}

export function sortRoles(roles: RosterRole[]) {
  return [...roles].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "nb"));
}

/** Del elementer i grupper etter rolle, i rollenes rekkefølge. Uten rolle kommer sist. */
export function groupByRole<T>(items: T[], roleOf: (t: T) => string | null, roles: RosterRole[]): RosterGroup<T>[] {
  const sorted = sortRoles(roles);
  const groups: RosterGroup<T>[] = sorted.map((r) => ({ role: r, items: items.filter((i) => roleOf(i) === r.id) }));
  const known = new Set(sorted.map((r) => r.id));
  const rest = items.filter((i) => !known.has(roleOf(i) ?? ""));
  if (rest.length) groups.push({ role: null, items: rest });
  return groups.filter((g) => g.items.length > 0);
}

/** "08–16" eller "08:30–16:15". */
export function shortTime(start: Date, end: Date, tz?: string) {
  const f = (d: Date) => {
    const t = localTime(d, tz);
    return t.endsWith(":00") ? t.slice(0, 2) : t;
  };
  return `${f(start)}–${f(end)}`;
}

/** Fornavn + første bokstav i etternavn når navnet er langt: "Kari N." */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2 || name.length <= 12) return name;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
