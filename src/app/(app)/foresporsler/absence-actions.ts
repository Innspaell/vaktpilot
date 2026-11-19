"use server";

import { revalidatePath } from "next/cache";
import { requirePlanner, requireOrg } from "@/lib/context";
import { addDays, localDate } from "@/lib/time";
import type { ActionState } from "../actions";
import { loadVacation } from "@/lib/vacation-data";

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
  if (!from || !to) return { error: "Velg fra- og til-dato." };
  if (to < from) return { error: "Til-dato kan ikke være før fra-dato." };
  // Deler av dagen: fra og til klokkeslett (f.eks. legetime). Timene regnes ut av dem.
  const ft = text(fd, "from_time");
  const tt = text(fd, "to_time");
  if (ft || tt) {
    if (!ft || !tt) return { error: "Fyll inn både fra og til klokkeslett, eller la begge stå tomme for hele dager." };
    if (from !== to) return { error: "Klokkeslett gjelder bare én dato. Sett samme fra- og til-dato." };
    const [h1, m1] = ft.split(":").map(Number);
    const [h2, m2] = tt.split(":").map(Number);
    const hours = Math.round(((h2 * 60 + m2) - (h1 * 60 + m1)) / 60 * 100) / 100;
    if (!(hours > 0)) return { error: "Til-klokkeslett må være etter fra-klokkeslett." };
    return { from, to, partial: hours, fromTime: ft, toTime: tt };
  }
  return { from, to, partial: null, fromTime: null, toTime: null };
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
    from_date: p.from, to_date: p.to, partial_hours: p.partial, from_time: p.fromTime, to_time: p.toTime, comment: text(fd, "comment"),
  }).select("status").single();
  if (error) return { error: error.message };
  refresh();
  let note = "";
  const { data: t } = await ctx.supabase.from("absence_types").select("key, is_sick").eq("id", typeId).single();
  if (t?.is_sick) return { ok: "Lederen din har fått beskjed om at du er syk, og godkjenner fraværet. God bedring!" };
  if (t?.key === "ferie") {
    const startYear = Number(p.from.slice(0, 4)), endYear = Number(p.to.slice(0, 4));
    const v = await loadVacation(ctx, Array.from(new Set([startYear - 1, startYear, endYear])), ctx.employeeId);
    const over = (v.byEmployee.get(ctx.employeeId) ?? []).filter((y) => y.from <= p.to && y.to >= p.from && y.remainingIfApproved < 0);
    if (over.length) note = ` Obs: Dette er mer ferie enn du har igjen i ${over.map((y) => y.year).join(" og ")} (${over.map((y) => y.remainingIfApproved.toLocaleString("nb-NO")).join(" / ")} dager). Lederen ser det når søknaden behandles.`;
  }
  return { ok: (data.status === "approved" ? "Registrert. Lederen har fått beskjed." : "Søknaden er sendt. Du får beskjed når den er behandlet.") + note };
}

export async function cancelAbsence(fd: FormData) {
  const ctx = await requireOrg();
  await ctx.supabase.from("absence_requests").update({ status: "cancelled" }).eq("id", text(fd, "id")!).eq("status", "pending");
  refresh();
}

/** Administrator registrerer fravær for en ansatt. Godkjent med en gang. */
export async function registerAbsence(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requirePlanner();
  const p = period(fd);
  if ("error" in p) return { error: p.error };
  const employeeId = text(fd, "employee_id");
  const typeId = text(fd, "absence_type_id");
  if (!employeeId || !typeId) return { error: "Velg ansatt og type fravær." };

  const { error } = await ctx.supabase.from("absence_requests").insert({
    org_id: ctx.org.id, employee_id: employeeId, absence_type_id: typeId,
    from_date: p.from, to_date: p.to, partial_hours: p.partial, from_time: p.fromTime, to_time: p.toTime, comment: text(fd, "comment"),
    status: "approved", decided_by: ctx.userId, decided_at: new Date().toISOString(), created_by_admin: true,
  });
  if (error) return { error: error.message };

  let released = 0;
  if (fd.get("release_shifts") === "on") released = await releaseShifts(ctx, employeeId, p.from, p.to);
  refresh();
  return { ok: released ? `Registrert. ${released} ${released === 1 ? "vakt er" : "vakter er"} gjort ledige.` : "Registrert." };
}

async function releaseShifts(ctx: Awaited<ReturnType<typeof requirePlanner>>, employeeId: string, from: string, to: string) {
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
  const ctx = await requirePlanner();
  // Avgjørelsen må være uttrykkelig: mangler den, gjøres ingenting (aldri avslag ved en feil)
  const decision = fd.get("decision");
  if (decision !== "approve" && decision !== "reject") return;
  await ctx.supabase.rpc("decide_absence", {
    p_id: text(fd, "id")!,
    p_approve: decision === "approve",
    p_release_shifts: fd.get("release_shifts") === "on",
  });
  refresh();
}
