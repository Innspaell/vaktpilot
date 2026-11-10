"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/context";
import { loadPayroll } from "@/lib/payroll-data";
import { payrollCsv } from "@/lib/pay";
import type { ActionState } from "../actions";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Lås perioden: godkjente timer kan ikke endres før perioden åpnes igjen. */
export async function lockPeriod(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const from = text(fd, "fra");
  const to = text(fd, "til");
  if (!from || !to) return { error: "Velg periode." };
  const data = await loadPayroll(ctx, from, to);
  const checksum = createHash("sha256").update(payrollCsv(data.pay, data.period)).digest("hex");
  const { error } = await ctx.supabase.rpc("lock_pay_period", { p_org: ctx.org.id, p_from: from, p_to: to, p_format: "csv", p_checksum: checksum });
  if (error) return { error: error.message };
  revalidatePath("/lonn");
  revalidatePath("/timer");
  return { ok: "Perioden er låst. Last ned lønnsgrunnlaget og legg det inn i Fiken." };
}

export async function reopenPeriod(fd: FormData) {
  const ctx = await requireAdmin();
  const id = text(fd, "period_id");
  if (id) await ctx.supabase.rpc("reopen_pay_period", { p_period: id });
  revalidatePath("/lonn");
  revalidatePath("/timer");
}
