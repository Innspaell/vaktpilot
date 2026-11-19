"use server";

import { revalidatePath } from "next/cache";
import { requireOrg, requirePlanner } from "@/lib/context";
import { addDays, zonedToUtc } from "@/lib/time";

/**
 * Handlingene i «Å gjøre». Hver tar skjulte felt fra listen; avgjørelsen ligger i handlingen,
 * ikke i hvilken knapp som ble trykket.
 */
const all = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);
const one = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v ? v : null;
};
function refresh() {
  revalidatePath("/", "layout");
}

export async function todoAbsence(fd: FormData) {
  const ctx = await requirePlanner();
  const id = one(fd, "id");
  const approve = one(fd, "decision") === "approve";
  if (!id || !["approve", "reject"].includes(one(fd, "decision") ?? "")) return;
  await ctx.supabase.rpc("decide_absence", { p_id: id, p_approve: approve, p_release_shifts: false });
  refresh();
}

export async function todoSwap(fd: FormData) {
  const ctx = await requirePlanner();
  const id = one(fd, "id");
  if (!id || !["approve", "reject"].includes(one(fd, "decision") ?? "")) return;
  await ctx.supabase.rpc("decide_swap", { p_swap: id, p_approve: one(fd, "decision") === "approve" });
  refresh();
}

export async function todoRequest(fd: FormData) {
  const ctx = await requirePlanner();
  const id = one(fd, "id");
  const d = one(fd, "decision");
  if (!id || (d !== "approve" && d !== "reject")) return;
  if (d === "approve") await ctx.supabase.rpc("approve_shift_request", { p_request: id });
  else await ctx.supabase.rpc("reject_shift_request", { p_request: id, p_comment: null });
  refresh();
}

export async function todoApproveEntries(fd: FormData) {
  const ctx = await requirePlanner();
  const ids = all(fd, "ids");
  if (ids.length) await ctx.supabase.rpc("approve_time_entries", { p_ids: ids });
  refresh();
}

/** Vakter uten timer godkjennes som planlagt; utkast (stemplet) godkjennes som de er. */
export async function todoApprovePlanned(fd: FormData) {
  const ctx = await requirePlanner();
  const drafts = all(fd, "ids");
  if (drafts.length) await ctx.supabase.rpc("approve_time_entries", { p_ids: drafts });
  const ids = all(fd, "shift_ids");
  if (ids.length) {
    const [{ data: shifts }, { data: taken }] = await Promise.all([
      ctx.supabase.from("shifts").select("id, employee_id, starts_at, ends_at, break_minutes").eq("org_id", ctx.org.id)
        .in("id", ids).eq("status", "published").not("employee_id", "is", null).lte("ends_at", new Date().toISOString()),
      ctx.supabase.from("time_entries").select("shift_id").in("shift_id", ids),
    ]);
    const done = new Set((taken ?? []).map((t) => t.shift_id));
    const now = new Date().toISOString();
    const rows = (shifts ?? []).filter((s) => !done.has(s.id)).map((s) => ({
      org_id: ctx.org.id, employee_id: s.employee_id!, shift_id: s.id, starts_at: s.starts_at, ends_at: s.ends_at,
      break_minutes: s.break_minutes, source: "admin", status: "approved", approved_by: ctx.userId, approved_at: now,
      comment: "Godkjent av leder uten bekreftelse fra den ansatte",
    }));
    if (rows.length) await ctx.supabase.from("time_entries").insert(rows);
  }
  refresh();
}

export async function todoPublish(fd: FormData) {
  const ctx = await requirePlanner();
  const from = one(fd, "from");
  const days = Math.min(60, Math.max(1, Number(one(fd, "days") ?? 28)));
  if (!from) return;
  await ctx.supabase.rpc("publish_shifts", {
    p_org: ctx.org.id,
    p_from: zonedToUtc(from, "00:00", ctx.org.timezone).toISOString(),
    p_to: zonedToUtc(addDays(from, days), "00:00", ctx.org.timezone).toISOString(),
  });
  refresh();
}

/** Ansatt bekrefter en vakt som planlagt. Ledere får egne timer godkjent med en gang. */
export async function todoConfirmShift(fd: FormData) {
  const ctx = await requireOrg();
  const id = one(fd, "shift_id");
  if (!id || !ctx.employeeId) return;
  await ctx.supabase.rpc("confirm_shift", { p_shift: id, p_comment: "Bekreftet som planlagt" });
  if (ctx.canPlan) {
    const { data } = await ctx.supabase.from("time_entries").select("id").eq("shift_id", id).eq("employee_id", ctx.employeeId).in("status", ["draft", "submitted"]);
    if (data?.length) await ctx.supabase.rpc("approve_time_entries", { p_ids: data.map((r) => r.id) });
  }
  refresh();
}

/** Ansatt svarer på et bytte en kollega har foreslått. */
export async function todoAnswerSwap(fd: FormData) {
  const ctx = await requireOrg();
  const id = one(fd, "id");
  const d = one(fd, "decision");
  if (!id || (d !== "approve" && d !== "reject")) return;
  await ctx.supabase.rpc("respond_swap", { p_swap: id, p_accept: d === "approve" });
  refresh();
}

/** Morgenliste på e-post, per bruker. */
export async function setTodoDigest(fd: FormData) {
  const ctx = await requireOrg();
  await ctx.supabase.rpc("set_my_todo_digest", { p_org: ctx.org.id, p_on: one(fd, "on") === "1" });
  revalidatePath("/profil");
}
