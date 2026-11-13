"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/context";
import { loadPayroll } from "@/lib/payroll-data";
import { diffPay, payrollCsv } from "@/lib/pay";
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
  const csv = payrollCsv(data.pay, data.period, data.wageTypes);
  const checksum = createHash("sha256").update(csv).digest("hex");
  // Lagre grunnlaget slik det er nå, så senere endringer i satser ikke endrer en låst periode
  const snapshot = { computedAt: new Date().toISOString(), rulesName: data.rulesName, pay: data.pay };
  const { error } = await ctx.supabase.rpc("lock_pay_period", {
    p_org: ctx.org.id, p_from: from, p_to: to, p_format: "csv", p_checksum: checksum, p_result: snapshot,
  });
  if (error) return { error: error.message };
  revalidatePath("/lonn");
  revalidatePath("/timer");
  return { ok: "Perioden er låst. Last ned lønnsgrunnlaget og legg det inn i regnskaps- eller lønnsprogrammet." };
}

/** Etterbetaling er tatt ut: den nye beregningen blir utgangspunktet for neste sammenligning. */
export async function recordDifference(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const from = text(fd, "fra");
  const to = text(fd, "til");
  const period = text(fd, "period_id");
  if (!from || !to || !period) return { error: "Velg periode." };
  const data = await loadPayroll(ctx, from, to);
  if (!data.snapshot) return { error: "Perioden har ikke lagret grunnlag." };
  const diff = diffPay(data.snapshot.pay, data.pay);
  if (!diff.length) return { error: "Ingen differanse å registrere." };
  const checksum = createHash("sha256").update(payrollCsv(diff, data.period, data.wageTypes)).digest("hex");
  const snapshot = { computedAt: new Date().toISOString(), rulesName: data.rulesName, pay: data.pay };
  const { error } = await ctx.supabase.rpc("record_pay_difference", { p_period: period, p_checksum: checksum, p_result: snapshot });
  if (error) return { error: error.message };
  revalidatePath("/lonn");
  return { ok: "Registrert. Differansen er tatt med, og den nye beregningen er nå det lagrede grunnlaget for perioden." };
}

export async function reopenPeriod(fd: FormData) {
  const ctx = await requireAdmin();
  const id = text(fd, "period_id");
  if (id) await ctx.supabase.rpc("reopen_pay_period", { p_period: id });
  revalidatePath("/lonn");
  revalidatePath("/timer");
}

/** Registrer opptjent avspasering (f.eks. overtid tatt ut som fri), eller en korreksjon med minus. */
export async function addCompTime(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const employee = text(fd, "employee_id");
  const hours = Number(String(fd.get("hours") ?? "").replace(",", "."));
  const comment = text(fd, "comment");
  const date = text(fd, "date");
  if (!employee || !Number.isFinite(hours) || hours === 0 || Math.abs(hours) > 500) return { error: "Skriv inn antall timer (bruk minus for å trekke fra)." };
  if (!comment) return { error: "Skriv en kort forklaring, f.eks. «Overtid oktober tatt som avspasering»." };
  const { error } = await ctx.supabase.from("leave_ledger").insert({
    org_id: ctx.org.id, employee_id: employee, kind: "time_off", amount: hours, source: comment.slice(0, 200),
    effective_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10),
  });
  if (error) return { error: error.message };
  revalidatePath("/lonn");
  revalidatePath("/timer");
  revalidatePath("/rapporter");
  return { ok: `${hours > 0 ? "La til" : "Trakk fra"} ${Math.abs(hours).toLocaleString("nb-NO")} t avspasering.` };
}
