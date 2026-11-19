"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "./context";
import type { ActionState } from "@/app/(app)/actions";

const clean = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** Den ansatte legger inn en pårørende. Administrator kan også legge inn for en ansatt. */
export async function addEmergencyContact(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  const employeeId = ctx.isAdmin && clean(fd, "employee_id") ? clean(fd, "employee_id")! : ctx.employeeId;
  if (!employeeId) return { error: "Du har ikke noe ansattkort i denne bedriften." };
  const name = clean(fd, "name");
  const phone = clean(fd, "phone");
  if (!name) return { error: "Skriv inn navnet." };
  if (!phone || phone.replace(/\D/g, "").length < 3) return { error: "Skriv inn et telefonnummer." };
  const { error } = await ctx.supabase.from("emergency_contacts").insert({
    org_id: ctx.org.id, employee_id: employeeId, name: name.slice(0, 120), phone: phone.slice(0, 40), relation: clean(fd, "relation")?.slice(0, 60) ?? null,
  });
  if (error) return { error: "Kunne ikke lagre pårørende." };
  revalidatePath("/", "layout");
  return { ok: `${name} er lagt til.` };
}

export async function removeEmergencyContact(fd: FormData) {
  const ctx = await requireOrg();
  const id = clean(fd, "id");
  if (!id) return;
  await ctx.supabase.from("emergency_contacts").delete().eq("id", id).eq("org_id", ctx.org.id);
  revalidatePath("/", "layout");
}
