"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireOrg } from "@/lib/context";
import { ADJUSTMENT_TYPES } from "@/lib/vacation";
import type { ActionState } from "../actions";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function num(fd: FormData, key: string) {
  const v = text(fd, key);
  return v === null ? NaN : Number(v.replace(",", "."));
}
function refresh() {
  revalidatePath("/foresporsler");
  revalidatePath("/fravaer");
  revalidatePath("/ansatte", "layout");
  revalidatePath("/ferie", "layout");
  revalidatePath("/");
}

/** Ansatt ber om å overføre ferie, eller leder foreslår / registrerer overføring. */
export async function proposeCarryover(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  const employee = text(fd, "employee_id") ?? ctx.employeeId;
  const year = Number(text(fd, "from_year"));
  const days = num(fd, "days");
  const reason = text(fd, "reason") ?? "agreement";
  if (!employee) return { error: "Du er ikke registrert som ansatt." };
  if (!Number.isFinite(days) || days <= 0) return { error: "Skriv inn antall dager." };
  const { data, error } = await ctx.supabase.rpc("propose_carryover", {
    p_employee: employee, p_from_year: year, p_days: days, p_reason: reason, p_note: text(fd, "note"),
  });
  if (error) return { error: error.message };
  refresh();
  redirect(`/ferie/overforing/${data}`);
}

export async function answerCarryover(fd: FormData) {
  const ctx = await requireOrg();
  const id = text(fd, "id")!;
  await ctx.supabase.rpc("answer_carryover", { p_id: id, p_accept: text(fd, "answer") === "yes" });
  refresh();
  redirect(`/ferie/overforing/${id}`);
}

/** Startsaldo og justeringer per ansatt og ferieår. */
export async function addVacationAdjustment(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const employee = text(fd, "employee_id");
  const year = Number(text(fd, "year"));
  const type = text(fd, "type") ?? "adjustment";
  let days = num(fd, "days");
  if (!employee || !year) return { error: "Mangler ansatt eller år." };
  if (!Number.isFinite(days) || days === 0) return { error: "Skriv inn antall dager." };
  if (!(type in ADJUSTMENT_TYPES)) return { error: "Ukjent type." };
  // «Tatt før Vaktpilot» trekkes alltid fra, «overført» legges alltid til
  if (type === "start_taken") days = -Math.abs(days);
  if (type === "start_carry") days = Math.abs(days);
  const { data: org } = await ctx.supabase.from("organizations").select("vacation_year_start_month").eq("id", ctx.org.id).single();
  const mm = String(org?.vacation_year_start_month ?? 1).padStart(2, "0");
  const { error } = await ctx.supabase.from("leave_ledger").insert({
    org_id: ctx.org.id, employee_id: employee, kind: "vacation", amount: days, source: type,
    effective_date: `${year}-${mm}-01`, note: text(fd, "note"),
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: `${ADJUSTMENT_TYPES[type]}: ${days > 0 ? "+" : ""}${days.toLocaleString("nb-NO")} dager i ${year}.` };
}

export async function deleteVacationAdjustment(fd: FormData) {
  const ctx = await requireAdmin();
  await ctx.supabase.from("leave_ledger").delete().eq("id", text(fd, "id")!).eq("org_id", ctx.org.id).eq("kind", "vacation")
    .in("source", Object.keys(ADJUSTMENT_TYPES));
  refresh();
}

export async function markIntroSeen() {
  const ctx = await requireOrg();
  await ctx.supabase.rpc("mark_intro_seen", { p_org: ctx.org.id });
  revalidatePath("/");
}
