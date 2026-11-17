"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ORG_COOKIE } from "@/lib/context";
import { DPA_VERSION, TERMS_VERSION } from "@/lib/legal";

export type SignupResult = { ok?: boolean; error?: string; hasUser?: boolean };

const FIELDS = ["name", "org_number", "address", "postal_code", "city", "full_name", "phone", "invoice_email", "rule_set"] as const;

function data(fd: FormData) {
  const d: Record<string, string> = {};
  for (const f of FIELDS) d[f] = String(fd.get(f) ?? "").trim().slice(0, 200);
  d.accept = fd.get("accept") === "on" ? "true" : "false";
  d.terms_version = TERMS_VERSION;
  d.dpa_version = DPA_VERSION;
  return d;
}

async function chooseOrg(id: string) {
  (await cookies()).set(ORG_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

/** Ny bruker, steg 1: sjekk skjemaet og send kode til e-posten. */
export async function requestSignupCode(fd: FormData): Promise<SignupResult> {
  const supabase = await createClient();
  const { data: res, error } = await supabase.rpc("signup_request_code", { p_email: String(fd.get("email") ?? ""), p_data: data(fd) });
  if (error) return { error: "Noe gikk galt. Prøv igjen om litt." };
  const r = res as { ok?: boolean; error?: string; has_user?: boolean };
  return { ok: r.ok, error: r.error, hasUser: r.has_user };
}

/** Ny bruker, steg 2: riktig kode oppretter bruker og bedrift, og logger inn. */
export async function completeSignup(fd: FormData): Promise<SignupResult> {
  const supabase = await createClient();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const { data: res, error } = await supabase.rpc("signup_complete", {
    p_email: email, p_code: String(fd.get("code") ?? ""), p_password: password, p_data: data(fd),
  });
  if (error) return { error: "Noe gikk galt. Prøv igjen om litt." };
  const r = res as { ok?: boolean; error?: string; org?: string; has_user?: boolean };
  if (!r.ok) return { error: r.error, hasUser: r.has_user };
  const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
  if (r.org) await chooseOrg(r.org);
  if (loginError) return { ok: true, error: "Bedriften er registrert. Logg inn med e-posten og passordet du valgte." };
  return { ok: true };
}

/** Innlogget bruker registrerer en ny bedrift. */
export async function createSignupForMe(fd: FormData): Promise<SignupResult> {
  const supabase = await createClient();
  const { data: org, error } = await supabase.rpc("signup_create", { p_data: data(fd) });
  if (error) return { error: error.message };
  await chooseOrg(org as string);
  return { ok: true };
}
