"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext, requireAdmin, requireOrg, ORG_COOKIE } from "@/lib/context";
import { insertEmployee } from "@/lib/employees";

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

/** Orgnr uten mellomrom; tomt felt blir null. */
function orgNumber(fd: FormData) {
  const v = text(fd, "org_number")?.replace(/\D/g, "");
  return v ? v : null;
}

// ---------- Bedrift ----------

export async function createOrganization(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return { error: "Bare InnSpæll kan opprette bedrifter." };
  const name = text(fd, "name");
  if (!name) return { error: "Skriv inn navnet på bedriften." };
  const { data, error } = await ctx.supabase.rpc("create_organization", {
    p_name: name,
    p_org_number: orgNumber(fd),
    p_address: text(fd, "address"),
    p_postal_code: text(fd, "postal_code"),
    p_city: text(fd, "city"),
  });
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
      org_number: orgNumber(fd),
      address: text(fd, "address"),
      postal_code: text(fd, "postal_code"),
      city: text(fd, "city"),
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

// ---------- Logo ----------

const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };

export async function uploadLogo(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const file = fd.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "Velg en bildefil." };
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { error: "Bruk PNG, JPG, WebP eller SVG." };
  if (file.size > 2 * 1024 * 1024) return { error: "Filen er for stor. Maks 2 MB." };

  const path = `${ctx.org.id}/logo-${Date.now()}.${ext}`;
  const { error } = await ctx.supabase.storage.from("logos").upload(path, file, { contentType: file.type, upsert: true });
  if (error) return { error: `Kunne ikke laste opp: ${error.message}` };
  const { data } = ctx.supabase.storage.from("logos").getPublicUrl(path);
  const { error: uErr } = await ctx.supabase.from("organizations").update({ logo_url: data.publicUrl }).eq("id", ctx.org.id);
  if (uErr) return { error: uErr.message };
  revalidatePath("/", "layout");
  return { ok: "Logoen er lagret." };
}

export async function removeLogo() {
  const ctx = await requireAdmin();
  await ctx.supabase.from("organizations").update({ logo_url: null }).eq("id", ctx.org.id);
  revalidatePath("/", "layout");
}

// ---------- Arbeidsroller ----------

export async function addWorkRole(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const name = text(fd, "name");
  if (!name) return { error: "Skriv inn et navn." };
  const { data: last } = await ctx.supabase.from("work_roles").select("sort_order").eq("org_id", ctx.org.id).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await ctx.supabase.from("work_roles").insert({
    org_id: ctx.org.id, name, color: text(fd, "color") ?? "#1f5fbf", sort_order: (last?.sort_order ?? 0) + 10,
  });
  if (error) return { error: error.code === "23505" ? "Rollen finnes allerede." : error.message };
  revalidatePath("/innstillinger");
  return { ok: "Lagt til." };
}

/** Flytt en rolle opp eller ned i rekkefølgen. Nummererer alle på nytt. */
export async function moveWorkRole(fd: FormData) {
  const ctx = await requireAdmin();
  const id = text(fd, "id");
  const dir = text(fd, "dir");
  const { data } = await ctx.supabase.from("work_roles").select("id, sort_order, name").eq("org_id", ctx.org.id).order("sort_order").order("name");
  const list = (data ?? []).map((r) => r.id);
  const i = list.indexOf(id ?? "");
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await Promise.all(list.map((rid, k) => ctx.supabase.from("work_roles").update({ sort_order: (k + 1) * 10 }).eq("id", rid).eq("org_id", ctx.org.id)));
  revalidatePath("/innstillinger");
  revalidatePath("/vaktplan", "layout");
}

export async function deleteWorkRole(fd: FormData) {
  const ctx = await requireAdmin();
  await ctx.supabase.from("work_roles").delete().eq("id", text(fd, "id")!).eq("org_id", ctx.org.id);
  revalidatePath("/innstillinger");
}

// ---------- Ansatte ----------

export async function addEmployee(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const r = await insertEmployee(ctx, fd);
  if (r.error) return { error: r.error };
  redirect(`/ansatte/${r.id}?ny=1`);
}

/** Administrator legger seg selv inn som ansatt, så hen kan få vakter, stemple og søke fri. */
export async function addSelfAsEmployee(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  if (ctx.employeeId) return { ok: "Du er allerede registrert som ansatt." };
  fd.set("email", ctx.email);
  const r = await insertEmployee(ctx, fd);
  if (r.error) return { error: r.error };
  const { error } = await ctx.supabase.from("employees").update({ user_id: ctx.userId }).eq("id", r.id!).eq("org_id", ctx.org.id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Du er nå registrert som ansatt. Du beholder administratortilgangen." };
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
      auto_plan: fd.get("auto_plan") === "on",
    })
    .eq("id", id)
    .eq("org_id", ctx.org.id);
  if (error) return { error: error.message };

  // Stillingsprosent og lønnstype rettes på gjeldende avtale. Endringer fra en dato lages som ny avtale.
  if (text(fd, "position_pct")) {
    const pct = Math.min(100, Math.max(1, num(fd, "position_pct", 100)));
    const { data: org } = await ctx.supabase.from("organizations").select("full_time_hours_week").eq("id", ctx.org.id).single();
    const hours = text(fd, "hours_per_week") ? num(fd, "hours_per_week", 37.5) : Math.round(Number(org?.full_time_hours_week ?? 37.5) * pct) / 100;
    const { error: tErr } = await ctx.supabase
      .from("employment_terms")
      .update({ position_pct: pct, hours_per_week: hours, pay_type: text(fd, "pay_type") === "fixed" ? "fixed" : "hourly" })
      .eq("employee_id", id)
      .is("valid_to", null);
    if (tErr) return { error: tErr.message };
  }

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
