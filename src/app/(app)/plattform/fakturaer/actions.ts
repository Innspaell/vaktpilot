"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { fikenConfigured, runBilling, testFiken } from "@/lib/fiken";
import type { ActionState } from "@/app/(app)/actions";


async function platform() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) throw new Error("Ikke tillatt.");
  return ctx;
}

export async function saveBillingSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await platform();
  const n = (k: string, d: number) => Math.round(Number(fd.get(k) ?? d) || d);
  const { error } = await ctx.supabase.rpc("platform_billing_settings", {
    p_mode: String(fd.get("mode") ?? "manual"), p_company: String(fd.get("company") ?? ""), p_bank: String(fd.get("bank") ?? ""),
    p_payment_days: n("payment", 14), p_reminder_days: n("reminder", 14), p_block_days: n("block", 30),
  });
  revalidatePath("/plattform/fakturaer");
  return error ? { error: error.message } : { ok: "Lagret." };
}

export async function testFikenConnection(_: ActionState, _fd: FormData): Promise<ActionState> {
  const ctx = await platform();
  if (!fikenConfigured()) return { error: "FIKEN_API_TOKEN mangler i Vercel." };
  const { data } = await ctx.supabase.from("platform_settings").select("fiken_company").eq("id", 1).maybeSingle();
  if (!data?.fiken_company) return { error: "Skriv inn firma-ID fra Fiken og lagre først." };
  try {
    return { ok: `Koblet til ${await testFiken(data.fiken_company)}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runBillingNow(_: ActionState, _fd: FormData): Promise<ActionState> {
  const ctx = await platform();
  try {
    const s = await runBilling(ctx.supabase, null);
    revalidatePath("/plattform/fakturaer");
    const parts = [`${s.created} nye`, `${s.sent} sendt`, `${s.paid} betalt`, s.failed ? `${s.failed} feilet` : "", s.dunning ? `${s.dunning} purresteg` : ""].filter(Boolean);
    return s.errors.length || s.skipped
      ? { error: [parts.join(", ") + ".", s.skipped, ...s.errors].filter(Boolean).join(" ") }
      : { ok: parts.join(", ") + "." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function invoiceAction(fd: FormData) {
  const ctx = await platform();
  const ids = fd.getAll("id").map(String);
  for (const id of ids) await ctx.supabase.rpc("platform_invoice_action", { p_invoice: id, p_action: String(fd.get("action")) });
  revalidatePath("/plattform/fakturaer");
}

export async function setOrgBilling(fd: FormData) {
  const ctx = await platform();
  await ctx.supabase.rpc("platform_set_org_billing", { p_org: String(fd.get("org")), p_enabled: fd.get("enabled") === "1" });
  revalidatePath("/plattform/fakturaer");
}

export async function deleteOrgData(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await platform();
  const { error } = await ctx.supabase.rpc("platform_delete_org_data", { p_org: String(fd.get("org")), p_confirm_name: String(fd.get("name") ?? "") });
  revalidatePath("/plattform/fakturaer");
  return error ? { error: error.message } : { ok: "Slettet." };
}

export async function blockAction(fd: FormData) {
  const ctx = await platform();
  await ctx.supabase.rpc("platform_block_action", { p_org: String(fd.get("org")), p_action: String(fd.get("action")) });
  revalidatePath("/plattform/fakturaer");
}
