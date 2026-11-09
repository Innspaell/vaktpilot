import "server-only";
import { revalidatePath } from "next/cache";
import type { requireAdmin } from "./context";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function num(fd: FormData, key: string, fallback: number) {
  const v = text(fd, key);
  const n = v === null ? NaN : Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

type AdminCtx = Awaited<ReturnType<typeof requireAdmin>>;

/** Lager ansattkort og første avtale. Brukes fra ansattsiden og fra vaktplanen. */
export async function insertEmployee(ctx: AdminCtx, fd: FormData): Promise<{ id?: string; error?: string }> {
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

  const pct = Math.min(100, Math.max(1, num(fd, "position_pct", 100)));
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

  const role = text(fd, "new_work_role_id");
  if (role) await ctx.supabase.from("employee_work_roles").insert({ org_id: ctx.org.id, employee_id: emp.id, work_role_id: role });

  revalidatePath("/ansatte");
  return { id: emp.id };
}

