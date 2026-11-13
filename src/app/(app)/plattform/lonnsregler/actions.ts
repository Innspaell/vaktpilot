"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { rulesFromForm } from "@/lib/pay-rules-form";
import type { ActionState } from "@/app/(app)/actions";

async function platform() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) throw new Error("Ikke tillatt.");
  return ctx;
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Nytt regelsett, eventuelt kopiert fra et annet (siste versjon). */
export async function createRuleSet(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await platform();
  const name = s(fd, "name");
  if (!name) return { error: "Skriv inn et navn." };
  const key = (s(fd, "key") || name).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  const org = s(fd, "org_id") || null;
  const { data: set, error } = await ctx.supabase.from("pay_rule_sets")
    .insert({ key, name, description: s(fd, "description") || null, kind: s(fd, "kind") === "law" ? "law" : "tariff", org_id: org, area: s(fd, "area") || "ingen" })
    .select("id").single();
  if (error) return { error: error.code === "23505" ? "Det finnes allerede et regelsett med denne nøkkelen." : error.message };
  const copy = s(fd, "copy_from");
  if (copy) {
    const { data: v } = await ctx.supabase.from("pay_rule_versions").select("rules").eq("rule_set_id", copy)
      .order("valid_from", { ascending: false }).limit(1).maybeSingle();
    const from = s(fd, "valid_from");
    if (v) {
      const { error: e2 } = await ctx.supabase.from("pay_rule_versions")
        .insert({ rule_set_id: set.id, valid_from: isDate(from) ? from : "2000-01-01", rules: v.rules, note: "Kopiert, må kontrolleres", status: "draft" });
      if (e2) return { error: e2.message };
    }
  }
  redirect(`/plattform/lonnsregler/${set.id}`);
}

export async function updateRuleSet(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await platform();
  const id = s(fd, "id");
  const { error } = await ctx.supabase.from("pay_rule_sets")
    .update({ name: s(fd, "name"), description: s(fd, "description") || null, area: s(fd, "area") || "ingen" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/plattform/lonnsregler/${id}`);
  return { ok: "Lagret." };
}

/** Lagre satser: ny versjon fra en dato, eller endre en eksisterende versjon. */
export async function saveVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await platform();
  const setId = s(fd, "rule_set_id");
  const versionId = s(fd, "version_id");
  const from = s(fd, "valid_from");
  if (!isDate(from)) return { error: "Velg datoen satsene gjelder fra." };
  const { rules, error } = rulesFromForm(fd);
  if (error || !rules) return { error };
  const status = ["draft", "review", "published"].includes(s(fd, "status")) ? s(fd, "status") : "draft";
  const row = {
    rule_set_id: setId, valid_from: from, rules, note: s(fd, "note") || null, status,
    source_text: s(fd, "source_text") || null, source_url: s(fd, "source_url") || null,
    ...(status === "published" ? { published_at: new Date().toISOString(), published_by: ctx.userId } : {}),
  };
  if (status === "published" && !row.source_text) return { error: "Skriv inn kilden før satsene publiseres." };
  const res = versionId
    ? await ctx.supabase.from("pay_rule_versions").update(row).eq("id", versionId)
    : await ctx.supabase.from("pay_rule_versions").insert(row);
  if (res.error) return { error: res.error.code === "23505" ? "Det finnes allerede satser fra denne datoen. Endre dem i stedet." : res.error.message };
  revalidatePath(`/plattform/lonnsregler/${setId}`);
  revalidatePath("/plattform/lonnsregler");
  return { ok: status === "published" ? "Lagret og publisert. Bedriftene som bruker tariffen får beskjed." : "Lagret som " + (status === "review" ? "under revisjon" : "utkast") + ". Ikke synlig for kundene ennå." };
}

export async function deleteVersion(fd: FormData) {
  const ctx = await platform();
  const setId = s(fd, "rule_set_id");
  const { count } = await ctx.supabase.from("pay_rule_versions").select("id", { count: "exact", head: true }).eq("rule_set_id", setId);
  if ((count ?? 0) > 1) await ctx.supabase.from("pay_rule_versions").delete().eq("id", s(fd, "version_id"));
  revalidatePath(`/plattform/lonnsregler/${setId}`);
}

export async function markChecked(fd: FormData) {
  const ctx = await platform();
  await ctx.supabase.from("pay_rule_sets").update({ checked_year: Number(s(fd, "year")) }).eq("id", s(fd, "id"));
  revalidatePath("/plattform/lonnsregler");
}

export async function handleRequest(fd: FormData) {
  const ctx = await platform();
  await ctx.supabase.from("pay_rule_requests")
    .update({ status: "done", reply: s(fd, "reply") || null, handled_at: new Date().toISOString() }).eq("id", s(fd, "id"));
  revalidatePath("/plattform/lonnsregler");
}

/** Last ned vedlegg (midlertidig lenke) */
export async function openAttachment(fd: FormData) {
  const ctx = await platform();
  const { data } = await ctx.supabase.storage.from("tariffavtaler").createSignedUrl(s(fd, "path"), 300);
  if (data?.signedUrl) redirect(data.signedUrl);
}
