"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/context";
import type { ActionState } from "../actions";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function refresh() {
  revalidatePath("/bemanning");
  revalidatePath("/vaktplan");
  revalidatePath("/");
}

function validTimes(start: string | null, end: string | null) {
  return start && end && start !== end;
}

export async function addTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const start = text(fd, "start");
  const end = text(fd, "end");
  if (!validTimes(start, end)) return { error: "Velg fra- og til-klokkeslett." };
  const weekdays = fd.getAll("weekday").map(Number).filter((n) => n >= 1 && n <= 7);
  if (!weekdays.length) return { error: "Velg minst én ukedag." };
  const required = Number(text(fd, "required") ?? 0);
  const { error } = await ctx.supabase.from("staffing_templates").insert(
    weekdays.map((weekday) => ({
      org_id: ctx.org.id, weekday, start_time: start, end_time: end, required, work_role_id: text(fd, "work_role_id"),
    })),
  );
  if (error) return { error: error.message };
  refresh();
  return { ok: "Lagt til." };
}

export async function deleteTemplate(fd: FormData) {
  const ctx = await requireAdmin();
  await ctx.supabase.from("staffing_templates").delete().eq("id", text(fd, "id")!).eq("org_id", ctx.org.id);
  refresh();
}

export async function addOverride(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const date = text(fd, "date");
  if (!date) return { error: "Velg dato." };
  const closed = fd.get("closed") === "on";
  const start = text(fd, "start");
  const end = text(fd, "end");
  if (!closed && !validTimes(start, end)) return { error: "Velg klokkeslett, eller kryss av for stengt." };
  const { error } = await ctx.supabase.from("staffing_overrides").insert({
    org_id: ctx.org.id,
    date,
    closed,
    start_time: closed ? null : start,
    end_time: closed ? null : end,
    required: closed ? null : Number(text(fd, "required") ?? 0),
    work_role_id: closed ? null : text(fd, "work_role_id"),
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: "Lagret." };
}

export async function deleteOverride(fd: FormData) {
  const ctx = await requireAdmin();
  await ctx.supabase.from("staffing_overrides").delete().eq("id", text(fd, "id")!).eq("org_id", ctx.org.id);
  refresh();
}

export async function setHolidayOpen(fd: FormData) {
  const ctx = await requireAdmin();
  const key = text(fd, "key")!;
  const open = fd.get("open") === "1";
  await ctx.supabase.from("holiday_rules").upsert({ org_id: ctx.org.id, holiday_key: key, is_open: open });
  refresh();
}

export async function addShiftTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const name = text(fd, "name");
  const start = text(fd, "start");
  const end = text(fd, "end");
  if (!name || !validTimes(start, end)) return { error: "Fyll inn navn og klokkeslett." };
  const { error } = await ctx.supabase.from("shift_templates").insert({
    org_id: ctx.org.id, name, start_time: start, end_time: end,
    break_minutes: Number(text(fd, "break_minutes") ?? 0), work_role_id: text(fd, "work_role_id"),
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: "Lagt til." };
}

export async function deleteShiftTemplate(fd: FormData) {
  const ctx = await requireAdmin();
  await ctx.supabase.from("shift_templates").delete().eq("id", text(fd, "id")!).eq("org_id", ctx.org.id);
  refresh();
}
