"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import type { ActionState } from "@/app/(app)/actions";

const SLOTS = ["hero", "tavle", "syk"];
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function platform() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) throw new Error("Ikke tillatt.");
  return ctx;
}

/** Last opp nytt bilde til en plass på nettsiden, og/eller endre bildeteksten (alt-tekst). */
export async function saveSiteImage(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await platform();
  const slot = String(fd.get("slot") ?? "");
  if (!SLOTS.includes(slot)) return { error: "Ukjent plass." };
  const alt = String(fd.get("alt") ?? "").trim().slice(0, 300);
  const file = fd.get("file");
  const hasFile = file instanceof File && file.size > 0;
  let url: string | null = null;
  if (hasFile) {
    const ext = TYPES[file.type];
    if (!ext) return { error: "Bruk JPG, PNG eller WebP." };
    if (file.size > 4 * 1024 * 1024) return { error: "Bildet er for stort (maks 4 MB). Lagre det mindre, for eksempel 1600 piksler bredt." };
    const path = `${slot}-${Date.now()}.${ext}`;
    const { error } = await ctx.supabase.storage.from("nettside").upload(path, file, { contentType: file.type, cacheControl: "31536000" });
    if (error) return { error: `Kunne ikke laste opp: ${error.message}` };
    url = ctx.supabase.storage.from("nettside").getPublicUrl(path).data.publicUrl;
  }
  if (url) {
    const { error } = await ctx.supabase.from("site_images").upsert({ slot, url, alt, updated_at: new Date().toISOString(), updated_by: ctx.userId });
    if (error) return { error: error.message };
  } else {
    const { data, error } = await ctx.supabase.from("site_images").update({ alt, updated_at: new Date().toISOString(), updated_by: ctx.userId }).eq("slot", slot).select("slot");
    if (error) return { error: error.message };
    if (!data?.length) return { error: "Velg et bilde først. Standardbildet har fast tekst." };
  }
  revalidatePath("/start");
  revalidatePath("/plattform/nettside");
  return { ok: url ? "Bildet er byttet. Det vises på vaktpilot.no innen noen minutter." : "Bildeteksten er lagret." };
}

export async function resetSiteImage(fd: FormData) {
  const ctx = await platform();
  await ctx.supabase.from("site_images").delete().eq("slot", String(fd.get("slot") ?? ""));
  revalidatePath("/start");
  revalidatePath("/plattform/nettside");
}
