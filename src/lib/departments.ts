import type { AppContext } from "./context";
import type { ShiftRow } from "./data";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

export interface Department { id: string; name: string }

export interface DepartmentInfo {
  /** Aktive avdelinger. Tom = bedriften bruker ikke avdelinger. */
  departments: Department[];
  /** Avdelinger brukeren kan planlegge i (alle for administrator). */
  managed: Set<string>;
  /** Hjemmeavdeling per ansatt. */
  homeOf: Map<string, string>;
  /** Avdelinger hver ansatt kan jobbe i. */
  canWork: Map<string, Set<string>>;
  name: (id: string | null | undefined) => string | null;
}

/** Avdelinger, hvem som kan jobbe hvor, og hva innlogget leder har ansvar for. */
export async function loadDepartments(ctx: Ctx): Promise<DepartmentInfo> {
  const [{ data: deps }, { data: links }, { data: mine }] = await Promise.all([
    ctx.supabase.from("departments").select("id, name").eq("org_id", ctx.org.id).is("archived_at", null).order("sort_order").order("name"),
    ctx.supabase.from("employee_departments").select("employee_id, department_id, is_home").eq("org_id", ctx.org.id),
    ctx.isAdmin
      ? Promise.resolve({ data: null })
      : ctx.supabase.from("manager_departments").select("department_id").eq("org_id", ctx.org.id).eq("user_id", ctx.userId),
  ]);
  const departments = (deps ?? []) as Department[];
  const managed = new Set(ctx.isAdmin || departments.length === 0 ? departments.map((d) => d.id) : (mine ?? []).map((m) => m.department_id as string));
  const homeOf = new Map<string, string>();
  const canWork = new Map<string, Set<string>>();
  for (const l of links ?? []) {
    if (l.is_home) homeOf.set(l.employee_id, l.department_id);
    if (!canWork.has(l.employee_id)) canWork.set(l.employee_id, new Set());
    canWork.get(l.employee_id)!.add(l.department_id);
  }
  const byId = new Map(departments.map((d) => [d.id, d.name]));
  return { departments, managed, homeOf, canWork, name: (id) => (id ? byId.get(id) ?? null : null) };
}

/** Vakter som hører til avdelingen: lagt i avdelingen, eller uten avdeling for en ansatt som jobber der. */
export function shiftInDepartment(s: Pick<ShiftRow, "department_id" | "employee_id">, dept: string, info: DepartmentInfo) {
  if (s.department_id) return s.department_id === dept;
  return Boolean(s.employee_id && info.canWork.get(s.employee_id)?.has(dept));
}

/** Avdelingen som er valgt i adressen (?avdeling=), hvis den finnes. */
export function selectedDepartment(param: string | undefined, info: DepartmentInfo) {
  return param && info.departments.some((d) => d.id === param) ? param : null;
}
