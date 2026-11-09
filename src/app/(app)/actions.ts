"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext, requireAdmin, requireOrg, ORG_COOKIE } from "@/lib/context";

export type ActionState = { error?: string; ok?: string } | undefined;

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function num(fd: FormData, key: string, fallback: number) {
  const v = text(fd, key);
  const n = v === null ? NaN : Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

// ---------- Bedrift ----------

export async function createOrganization(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return { error: "Bare InnSpæll kan opprette bedrifter." };
  const name = text(fd, "name");
  if (!name) return { error: "Skriv inn navnet på bedriften." };
  const { data, error } = await ctx.supabase.rpc("create_organization", { p_name: name, p_org_number: text(fd, "org_number") });
  if (error) return { error: error.message };
  (await cookies()).set(ORG_COOKIE, data as string, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/innstillinger");
}

export async function switchOrganization(fd: FormData) {
  const id = text(fd, "org");
  if (id) (await cookies()).set(ORG_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/");
}

export async function updateOrganization(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const { error } = await ctx.supabase
    .from("organizations")
    .update({
      name: text(fd, "name") ?? ctx.org.name,
      org_number: text(fd, "org_number"),
      full_time_hours_week: num(fd, "full_time_hours_week", 37.5),
      vacation_days_year: num(fd, "vacation_days_year", 25),
      staffing_slot_minutes: num(fd, "staffing_slot_minutes", 15),
      auto_submit_clock_entries: fd.get("auto_submit_clock_entries") === "on",
    })
    .eq("id", ctx.org.id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Lagret." };
}

// ---------- Arbeidsroller ----------

export async function addWorkRole(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const name = text(fd, "name");
  if (!name) return { error: "Skriv inn et navn." };
  const { error } = await ctx.supabase.from("work_roles").insert({ org_id: ctx.org.id, name, color: text(fd, "color") ?? "#1f5fbf" });
  if (error) return { error: error.code === "23505" ? "Rollen finnes allerede." : error.message };
  revalidatePath("/innstillinger");
  return { ok: "Lagt til." };
}

export async function deleteWorkRole(fd: FormData) {
  const ctx = await requireAdmin();
  await ctx.supabase.from("work_roles").delete().eq("id", text(fd, "id")!).eq("org_id", ctx.org.id);
  revalidatePath("/innstillinger");
}

// ---------- Ansatte ----------

export async function addEmployee(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const fullName = text(fd, "full_name");
  const email = text(fd, "email")?.toLowerCase() ?? null;
  if (!fullName) return { error: "Skriv inn navn." };
  const startDate = text(fd, "start_date") ?? new Date().toISOString().slice(0, 10);

  const { data: emp, error } = await ctx.supabase
    .from("employees")
    .insert({
      org_id: ctx.org.id,
      full_name: fullName,
      email,
      phone: text(fd, "phone"),
      employee_number: text(fd, "employee_number"),
      start_date: startDate,
      is_shift_worker: fd.get("is_shift_worker") === "on",
    })
    .select("id")
    .single();
  if (error) return { error: error.code === "23505" ? "Det finnes allerede en ansatt med denne e-posten." : error.message };

  const pct = num(fd, "position_pct", 100);
  const { data: org } = await ctx.supabase.from("organizations").select("full_time_hours_week, vacation_days_year").eq("id", ctx.org.id).single();
  const fullTime = Number(org?.full_time_hours_week ?? 37.5);
  const { error: termsError } = await ctx.supabase.from("employment_terms").insert({
    org_id: ctx.org.id,
    employee_id: emp.id,
    valid_from: startDate,
    position_pct: pct,
    hours_per_week: Math.round(fullTime * pct) / 100,
    pay_type: text(fd, "pay_type") === "fixed" ? "fixed" : "hourly",
    paid_holidays: true,
    vacation_days: Number(org?.vacation_days_year ?? 25),
  });
  if (termsError) return { error: termsError.message };

  revalidatePath("/ansatte");
  redirect(`/ansatte/${emp.id}?ny=1`);
}

export async function updateEmployee(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const id = text(fd, "id")!;
  const { error } = await ctx.supabase
    .from("employees")
    .update({
      full_name: text(fd, "full_name") ?? undefined,
      email: text(fd, "email")?.toLowerCase() ?? null,
      phone: text(fd, "phone"),
      employee_number: text(fd, "employee_number"),
      start_date: text(fd, "start_date") ?? undefined,
      end_date: text(fd, "end_date"),
      is_shift_worker: fd.get("is_shift_worker") === "on",
    })
    .eq("id", id)
    .eq("org_id", ctx.org.id);
  if (error) return { error: error.message };

  const roles = fd.getAll("work_roles").map(String);
  await ctx.supabase.from("employee_work_roles").delete().eq("employee_id", id);
  if (roles.length) {
    const { error: rErr } = await ctx.supabase
      .from("employee_work_roles")
      .insert(roles.map((r) => ({ org_id: ctx.org.id, employee_id: id, work_role_id: r })));
    if (rErr) return { error: rErr.message };
  }
  revalidatePath(`/ansatte/${id}`);
  revalidatePath("/ansatte");
  return { ok: "Lagret." };
}

/** Ny avtale fra en dato. Forrige avtale avsluttes dagen før, så historikken beholdes. */
export async function addTerms(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const employeeId = text(fd, "employee_id")!;
  const validFrom = text(fd, "valid_from");
  if (!validFrom) return { error: "Velg fra-dato." };

  const { data: current } = await ctx.supabase
    .from("employment_terms")
    .select("id, valid_from")
    .eq("employee_id", employeeId)
    .is("valid_to", null)
    .maybeSingle();
  if (current) {
    if (current.valid_from >= validFrom) return { error: "Ny avtale må starte etter at gjeldende avtale startet." };
    const dayBefore = new Date(Date.parse(validFrom) - 86400000).toISOString().slice(0, 10);
    const { error } = await ctx.supabase.from("employment_terms").update({ valid_to: dayBefore }).eq("id", current.id);
    if (error) return { error: error.message };
  }
  const { error } = await ctx.supabase.from("employment_terms").insert({
    org_id: ctx.org.id,
    employee_id: employeeId,
    valid_from: validFrom,
    position_pct: num(fd, "position_pct", 100),
    hours_per_week: num(fd, "hours_per_week", 37.5),
    pay_type: text(fd, "pay_type") === "fixed" ? "fixed" : "hourly",
    paid_holidays: fd.get("paid_holidays") === "on",
    vacation_days: num(fd, "vacation_days", 25),
  });
  if (error) return { error: error.message };
  revalidatePath(`/ansatte/${employeeId}`);
  return { ok: "Ny avtale lagret." };
}

export async function setMemberRole(fd: FormData) {
  const ctx = await requireAdmin();
  const userId = text(fd, "user_id")!;
  const role = text(fd, "role") === "admin" ? "admin" : "employee";
  if (userId === ctx.userId) return;
  await ctx.supabase.from("memberships").update({ role }).eq("org_id", ctx.org.id).eq("user_id", userId).neq("role", "owner");
  revalidatePath(`/ansatte`, "layout");
}

// ---------- Stempling ----------

export async function clockAction(fd: FormData) {
  const ctx = await requireOrg();
  const kind = text(fd, "kind");
  if (!kind || !["in", "break_start", "break_end", "out"].includes(kind)) return;
  await ctx.supabase.rpc("clock", { p_org: ctx.org.id, p_kind: kind });
  revalidatePath("/");
  revalidatePath("/timer");
}

export async function signOut() {
  const ctx = await getContext();
  await ctx.supabase.auth.signOut();
  redirect("/login");
}
