"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin, requirePlanner } from "@/lib/context";
import { loadDepartments } from "@/lib/departments";
import type { ActionState } from "../../actions";

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const done = () => {
  revalidatePath("/ansatte/avdelinger");
  revalidatePath("/vaktplan", "layout");
  revalidatePath("/bemanning");
};

export async function addDepartment(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const name = text(fd, "name")?.slice(0, 60);
  if (!name) return { error: "Skriv inn et navn." };
  const { count } = await ctx.supabase.from("departments").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id);
  const { error } = await ctx.supabase.from("departments").insert({ org_id: ctx.org.id, name, sort_order: count ?? 0 });
  if (error) return { error: error.code === "23505" ? `Det finnes allerede en avdeling som heter ${name}.` : "Kunne ikke lagre avdelingen." };
  done();
  return { ok: `${name} er lagt til.` };
}

export async function renameDepartment(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const id = text(fd, "id");
  const name = text(fd, "name")?.slice(0, 60);
  if (!id || !name) return { error: "Skriv inn et navn." };
  const { error } = await ctx.supabase.from("departments").update({ name }).eq("id", id).eq("org_id", ctx.org.id);
  if (error) return { error: error.code === "23505" ? `Det finnes allerede en avdeling som heter ${name}.` : "Kunne ikke lagre." };
  done();
  return { ok: "Lagret." };
}

/** Arkiver eller hent fram igjen. Vakter og historikk beholder avdelingen. */
export async function setDepartmentArchived(fd: FormData) {
  const ctx = await requireAdmin();
  const id = text(fd, "id");
  if (!id) return;
  await ctx.supabase.from("departments").update({ archived_at: fd.get("archive") === "1" ? new Date().toISOString() : null })
    .eq("id", id).eq("org_id", ctx.org.id);
  done();
}

/** Hvilke ledere som har ansvar for avdelingen. */
export async function setDepartmentLeaders(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const id = text(fd, "department_id");
  if (!id) return { error: "Mangler avdeling." };
  const users = fd.getAll("leader").map(String).filter(Boolean);
  const del = await ctx.supabase.from("manager_departments").delete().eq("org_id", ctx.org.id).eq("department_id", id);
  if (del.error) return { error: "Kunne ikke lagre." };
  if (users.length) {
    const { error } = await ctx.supabase.from("manager_departments").insert(users.map((u) => ({ org_id: ctx.org.id, user_id: u, department_id: id })));
    if (error) return { error: "Kunne ikke lagre lederne." };
  }
  done();
  return { ok: "Ledere lagret." };
}

/**
 * Hvem som kan jobbe hvor, og hjemmeavdeling. Lederen lagrer bare kolonnene for avdelingene vedkommende har ansvar for.
 * Feltene heter work:<ansatt>:<avdeling> (avkrysning) og home:<ansatt> (avdeling).
 */
export async function saveDepartmentMatrix(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requirePlanner();
  const deps = await loadDepartments(ctx);
  const editable = deps.departments.map((d) => d.id).filter((id) => deps.managed.has(id));
  if (!editable.length) return { error: "Du har ikke ansvar for noen avdelinger." };
  const employees = fd.getAll("employee").map(String);
  if (!employees.length) return { ok: "Ingenting å lagre." };

  const rows: { org_id: string; employee_id: string; department_id: string; is_home: boolean }[] = [];
  for (const emp of employees) {
    const home = text(fd, `home:${emp}`);
    const currentHome = deps.homeOf.get(emp);
    // Hjemmeavdeling i en avdeling lederen ikke styrer, blir stående
    const homeLocked = Boolean(currentHome && !editable.includes(currentHome));
    for (const dep of editable) {
      const isHome = !homeLocked && home === dep;
      if (fd.get(`work:${emp}:${dep}`) === "on" || isHome) rows.push({ org_id: ctx.org.id, employee_id: emp, department_id: dep, is_home: isHome });
    }
  }
  const del = await ctx.supabase.from("employee_departments").delete().eq("org_id", ctx.org.id).in("employee_id", employees).in("department_id", editable);
  if (del.error) return { error: "Kunne ikke lagre." };
  if (rows.length) {
    const { error } = await ctx.supabase.from("employee_departments").insert(rows);
    if (error) return { error: "Kunne ikke lagre alt. Prøv igjen." };
  }
  done();
  revalidatePath("/ansatte");
  return { ok: "Lagret." };
}
