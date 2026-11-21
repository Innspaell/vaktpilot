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

/**
 * Stillingsprosent og timer fra skjemaet. Tilkalling (avkrysset, eller 0 %) gir 0 % og 0 t/uke:
 * da finnes ingen avtalt tid som må fylles, og alle timer opp til heltid er ordinære.
 */
export function termsHours(fd: FormData, fullTime: number, fallbackHours?: number) {
  const onCall = fd.get("on_call") === "on" || num(fd, "position_pct", 100) === 0;
  if (onCall) return { on_call: true, position_pct: 0, hours_per_week: 0 };
  const pct = Math.min(100, Math.max(1, num(fd, "position_pct", 100)));
  const hours = text(fd, "hours_per_week") ? Math.max(0, num(fd, "hours_per_week", 37.5)) : fallbackHours ?? Math.round(fullTime * pct) / 100;
  return { on_call: false, position_pct: pct, hours_per_week: hours };
}

export type WorkerType = "employee" | "hired" | "unpaid";
export const WORKER_TYPES: { value: WorkerType; label: string; hint: string }[] = [
  { value: "employee", label: "Ansatt", hint: "Vanlig ansatt med lønn fra bedriften." },
  { value: "hired", label: "Innleid", hint: "Leid inn fra et bemanningsbyrå eller annen bedrift. Står i personallisten, men får ikke lønn her." },
  { value: "unpaid", label: "Ulønnet", hint: "Eier, familie eller frivillig som hjelper til uten lønn. Står i personallisten, men får ikke lønn." },
];
export function workerTypeOf(fd: FormData): WorkerType {
  const v = text(fd, "worker_type");
  return v === "hired" || v === "unpaid" ? v : "employee";
}

/** Lager ansattkort og første avtale. Brukes fra ansattsiden og fra vaktplanen. */
export async function insertEmployee(ctx: AdminCtx, fd: FormData): Promise<{ id?: string; error?: string }> {
  const fullName = text(fd, "full_name");
  const email = text(fd, "email")?.toLowerCase() ?? null;
  if (!fullName) return { error: "Skriv inn navn." };
  const startDate = text(fd, "start_date") ?? new Date().toISOString().slice(0, 10);
  const workerType = workerTypeOf(fd);
  // Innleide og ulønnede har ingen avtalt tid eller lønn hos oss
  if (workerType !== "employee") fd.set("on_call", "on");

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
      worker_type: workerType,
    })
    .select("id")
    .single();
  if (error) return { error: error.code === "23505" ? "Det finnes allerede en ansatt med denne e-posten." : error.message };

  const { data: org } = await ctx.supabase.from("organizations").select("full_time_hours_week, vacation_days_year").eq("id", ctx.org.id).single();
  const fullTime = Number(org?.full_time_hours_week ?? 37.5);
  const { error: termsError } = await ctx.supabase.from("employment_terms").insert({
    org_id: ctx.org.id,
    employee_id: emp.id,
    valid_from: startDate,
    ...termsHours(fd, fullTime, undefined),
    pay_type: text(fd, "pay_type") === "fixed" ? "fixed" : "hourly",
    paid_holidays: false,
    vacation_days: Number(org?.vacation_days_year ?? 25),
  });
  if (termsError) return { error: termsError.message };

  const role = text(fd, "new_work_role_id");
  if (role) await ctx.supabase.from("employee_work_roles").insert({ org_id: ctx.org.id, employee_id: emp.id, work_role_id: role });

  revalidatePath("/ansatte");
  return { id: emp.id };
}

