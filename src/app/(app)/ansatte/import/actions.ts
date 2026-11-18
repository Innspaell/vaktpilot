"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/context";
import { insertEmployee } from "@/lib/employees";
import { parseEmployees, readDelimited, readSpreadsheet, type ImportRow } from "@/lib/employee-import";
import { inviteEmail, sendEmail } from "@/lib/email";

export type Preview = { rows?: ImportRow[]; columns?: string[]; error?: string };

/** Les fila (eller teksten som er limt inn) og vis hva som blir importert. Ingenting lagres her. */
export async function previewImport(fd: FormData): Promise<Preview> {
  const ctx = await requireAdmin();
  const file = fd.get("file");
  const pasted = String(fd.get("pasted") ?? "");
  let table: string[][];
  try {
    if (file instanceof File && file.size > 0) {
      if (file.size > 4 * 1024 * 1024) return { error: "Fila er for stor (maks 4 MB)." };
      table = readSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name);
    } else if (pasted.trim()) {
      table = readDelimited(pasted);
    } else {
      return { error: "Velg en fil eller lim inn fra Excel." };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Klarte ikke å lese fila." };
  }
  const { data: existing } = await ctx.supabase.from("employees").select("email").eq("org_id", ctx.org.id).not("email", "is", null);
  const parsed = parseEmployees(table, (existing ?? []).map((e) => e.email as string));
  if (parsed.missingName) return { error: "Fant ingen kolonne med navn. Første rad må være overskrifter, for eksempel «Navn», «E-post», «Mobil»." };
  if (parsed.rows.length === 0) return { error: "Fant ingen ansatte under overskriftene." };
  return { rows: parsed.rows, columns: parsed.columns };
}

/** Lag ansattkortene. Eventuelt send invitasjon til dem som har e-post. */
export async function runImport(rows: ImportRow[], defaults: { start_date: string; position_pct: number; pay_type: string; invite: boolean })
  : Promise<{ created: number; invited: number; errors: string[] }> {
  const ctx = await requireAdmin();
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  let created = 0, invited = 0;
  const errors: string[] = [];
  for (const r of rows.slice(0, 500)) {
    if (!r.full_name?.trim() || r.problems?.length) continue;
    const fd = new FormData();
    fd.set("full_name", r.full_name);
    if (r.email) fd.set("email", r.email);
    if (r.phone) fd.set("phone", r.phone);
    if (r.employee_number) fd.set("employee_number", r.employee_number);
    fd.set("start_date", r.start_date ?? defaults.start_date);
    fd.set("position_pct", String(r.position_pct ?? defaults.position_pct));
    fd.set("pay_type", r.pay_type ?? defaults.pay_type);
    if (r.is_shift_worker) fd.set("is_shift_worker", "on");
    const res = await insertEmployee(ctx, fd);
    if (res.error) { errors.push(`${r.full_name}: ${res.error}`); continue; }
    created++;
    if (defaults.invite && r.email && res.id) {
      const { data: token, error } = await ctx.supabase.rpc("admin_create_invite", { p_employee: res.id, p_email: r.email });
      if (error) { errors.push(`${r.full_name}: invitasjon ble ikke laget (${error.message})`); continue; }
      const sent = await sendEmail(inviteEmail({ name: r.full_name, org: ctx.org.name, email: r.email, link: `${base}/velkommen/${token}`, logoUrl: null }));
      if (sent.sent) invited++;
    }
  }
  revalidatePath("/ansatte");
  return { created, invited, errors };
}
