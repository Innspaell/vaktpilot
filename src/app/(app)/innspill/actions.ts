"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import type { ActionState } from "@/app/(app)/actions";

export async function sendFeedback(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("submit_feedback", {
    p_org: ctx.org?.id ?? null,
    p_kind: String(fd.get("kind") ?? "idea"),
    p_body: String(fd.get("body") ?? ""),
    p_page: String(fd.get("page") ?? "") || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/innspill");
  return { ok: "Takk! Vi leser alt, og du får beskjed her når vi har svart." };
}
