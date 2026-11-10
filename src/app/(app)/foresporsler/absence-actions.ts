"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOrg } from "@/lib/context";
import { addDays, localDate } from "@/lib/time";
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

function period(fd: FormData) {
  const from = text(fd, "from_date");
  const to = text(fd, "to_date") ?? from;
  const partial = text(fd, "partial_hours");
  if (!from || !to) return { error: "Velg fra- og til-dato." };
  if (to < from) return { error: "Til-dato kan ikke være før fra-dato." };
  if (partial && from !== to) return { error: "Deler av dag gjelder bare én dato." };
  return { from, to, partial: partial ? Number(partial.replace(",", ".")) : null };
}

/** Ansatt søker om fri, eller registrerer sykefravær. */
export async function requestAbsence(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  if (!ctx.employeeId) return { error: "Du er ikke registrert som ansatt." };
  const p = period(fd);
  if ("error" in p) return { error: p.error };
  const typeId = text(fd, "absence_type_id");
  if (!typeId) return { error: "Velg type fravær." };

  const { data: overlap } = await ctx.supabase.from("absence_requests").select("id")
    .eq("employee_id", ctx.employeeId).in("status", ["pending", "approved"])
    .lte("from_date", p.to).gte("to_date", p.from).limit(1);
  if (overlap?.length) return { error: "Du har allerede fravær eller en søknad i denne perioden." };

  const { data, error } = await ctx.supabase.from("absence_requests").insert({
    org_id: ctx.org.id, employee_id: ctx.employeeId, absence_type_id: typeId,
    from_date: p.from, to_date: p.to, partial_hours: p.partial, comment: text(fd, "comment"),
  }).select("status").single();
  if (error) return { error: error.message };
  refresh();
  return { ok: data.status === "approved" ? "Registrert. Lederen har fått beskjed." : "Søknaden er sendt. Du får beskjed når den er behandlet." };
}

export async function cancelAbsence(fd: FormData) {
  const ctx = await requireOrg();
  await ctx.supabase.from("absence_requests").update({ status: "cancelled" }).eq("id", text(fd, "id")!).eq("status", "pending");
  refresh();
}

/** Administrator registrerer fravær for en ansatt. Godkjent med en gang. */
export async function registerAbsence(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const p = period(fd);
  if ("error" in p) return { error: p.error };
  const employeeId = text(fd, "employee_id");
  const typeId = text(fd, "absence_type_id");
  if (!employeeId || !typeId) return { error: "Velg ansatt og type fravær." };

  const { error } = await ctx.supabase.from("absence_requests").insert({
    org_id: ctx.org.id, employee_id: employeeId, absence_type_id: typeId,
    from_date: p.from, to_date: p.to, partial_hours: p.partial, comment: text(fd, "comment"),
    status: "approved", decided_by: ctx.userId, decided_at: new Date().toISOString(), created_by_admin: true,
  });
  if (error) return { error: error.message };

  let released = 0;
  if (fd.get("release_shifts") === "on") released = await releaseShifts(ctx, employeeId, p.from, p.to);
  refresh();
  return { ok: released ? `Registrert. ${released} ${released === 1 ? "vakt er" : "vakter er"} gjort ledige.` : "Registrert." };
}

async function releaseShifts(ctx: Awaited<ReturnType<typeof requireAdmin>>, employeeId: string, from: string, to: string) {
  const { data } = await ctx.supabase.from("shifts").select("id, starts_at")
    .eq("employee_id", employeeId).neq("status", "cancelled")
    .gte("starts_at", new Date(Date.parse(from) - 86400000).toISOString())
    .lt("starts_at", new Date(Date.parse(addDays(to, 2))).toISOString());
  const ids = (data ?? []).filter((s) => {
    const d = localDate(new Date(s.starts_at), ctx.org.timezone);
    return d >= from && d <= to;
  }).map((s) => s.id);
  if (!ids.length) return 0;
  await ctx.supabase.from("shifts").update({ employee_id: null }).in("id", ids);
  return ids.length;
}

export async function decideAbsence(fd: FormData) {
  const ctx = await requireAdmin();
  await ctx.supabase.rpc("decide_absence", {
    p_id: text(fd, "id")!,
    p_approve: fd.get("decision") === "approve",
    p_release_shifts: fd.get("release_shifts") === "on",
  });
  refresh();
}
