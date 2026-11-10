"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOrg } from "@/lib/context";
import type { ActionState } from "../actions";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function refresh() {
  revalidatePath("/tavle");
  revalidatePath("/");
}

export async function addPost(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  const body = text(fd, "body");
  if (!body) return { error: "Skriv noe først." };
  if (body.length > 4000) return { error: "Innlegget er for langt (maks 4000 tegn)." };
  let author = ctx.email.split("@")[0];
  if (ctx.employeeId) {
    const { data } = await ctx.supabase.from("employees").select("full_name").eq("id", ctx.employeeId).single();
    if (data) author = data.full_name;
  }
  const pinned = ctx.isAdmin && fd.get("pinned") === "on";
  const { error } = await ctx.supabase.from("board_posts").insert({
    org_id: ctx.org.id, author_user: ctx.userId, author_name: author, title: text(fd, "title"), body, pinned,
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: "Publisert." };
}

export async function deletePost(fd: FormData) {
  const ctx = await requireOrg();
  await ctx.supabase.from("board_posts").delete().eq("id", text(fd, "id")!).eq("org_id", ctx.org.id);
  refresh();
}

export async function togglePin(fd: FormData) {
  const ctx = await requireAdmin();
  await ctx.supabase.from("board_posts").update({ pinned: fd.get("pinned") === "1" }).eq("id", text(fd, "id")!).eq("org_id", ctx.org.id);
  refresh();
}
