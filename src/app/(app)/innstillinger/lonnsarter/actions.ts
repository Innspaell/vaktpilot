"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/context";
import type { ActionState } from "@/app/(app)/actions";

export async function saveWageTypes(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const codes = String(fd.get("codes") ?? "").split(",").filter((c) => /^[a-z0-9_*]+$/.test(c));
  const rows = codes.map((code) => ({ code, wage_type: String(fd.get(`w_${code}`) ?? "").trim().slice(0, 40) }));
  const keep = rows.filter((r) => r.wage_type);
  const drop = rows.filter((r) => !r.wage_type).map((r) => r.code);
  if (keep.length) {
    const { error } = await ctx.supabase.from("pay_code_mappings").upsert(keep.map((r) => ({ org_id: ctx.org.id, ...r })));
    if (error) return { error: error.message };
  }
  if (drop.length) await ctx.supabase.from("pay_code_mappings").delete().eq("org_id", ctx.org.id).in("code", drop);
  revalidatePath("/innstillinger/lonnsarter");
  return { ok: `Lagret. ${keep.length} lønnsarter er koblet.` };
}
