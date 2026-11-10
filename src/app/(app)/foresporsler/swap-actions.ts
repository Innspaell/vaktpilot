"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireOrg } from "@/lib/context";
import type { ActionState } from "../actions";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function refresh() {
  revalidatePath("/foresporsler");
  revalidatePath("/vaktplan", "layout");
  revalidatePath("/");
}

export async function proposeSwap(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  const shift = text(fd, "shift_id");
  if (!shift) return { error: "Velg en vakt." };
  const to = text(fd, "to_employee_id");
  const { error } = await ctx.supabase.rpc("propose_swap", { p_shift: shift, p_to: to === "bort" ? null : to, p_comment: text(fd, "comment") });
  if (error) return { error: error.message };
  refresh();
  return { ok: to === "bort" ? "Sendt til leder. Vakten blir ledig når den er godkjent." : "Sendt. Kollegaen må svare, deretter godkjenner leder." };
}

export async function respondSwap(fd: FormData) {
  const ctx = await requireOrg();
  const { error } = await ctx.supabase.rpc("respond_swap", { p_swap: text(fd, "id")!, p_accept: fd.get("answer") === "yes" });
  refresh();
  if (error) redirect(`/foresporsler?vis=bytte&feil=${encodeURIComponent(error.message)}`);
}

export async function cancelSwap(fd: FormData) {
  const ctx = await requireOrg();
  await ctx.supabase.from("shift_swaps").update({ status: "cancelled" }).eq("id", text(fd, "id")!).eq("status", "pending");
  refresh();
}

export async function decideSwap(fd: FormData) {
  const ctx = await requireAdmin();
  const { error } = await ctx.supabase.rpc("decide_swap", { p_swap: text(fd, "id")!, p_approve: fd.get("decision") === "approve" });
  refresh();
  if (error) redirect(`/foresporsler?vis=bytte&feil=${encodeURIComponent(error.message)}`);
}
