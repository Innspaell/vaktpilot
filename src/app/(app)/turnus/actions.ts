"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/context";
import { addDays, isoWeekday, zonedToUtc } from "@/lib/time";
import { holidayOn } from "@/lib/holidays";
import type { ActionState } from "../actions";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export async function createRotation(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const name = text(fd, "name");
  const weeks = Math.min(12, Math.max(1, Number(text(fd, "weeks") ?? 1)));
  if (!name) return { error: "Gi turnusen et navn." };
  const { data, error } = await ctx.supabase.from("rotations").insert({ org_id: ctx.org.id, name, weeks }).select("id").single();
  if (error) return { error: error.message };
  redirect(`/turnus?id=${data.id}`);
}

export async function deleteRotation(fd: FormData) {
  const ctx = await requireAdmin();
  await ctx.supabase.from("rotations").delete().eq("id", text(fd, "id")!).eq("org_id", ctx.org.id);
  redirect("/turnus");
}

export async function addRotationShift(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const rotation = text(fd, "rotation_id")!;
  const start = text(fd, "start");
  const end = text(fd, "end");
  const weekdays = fd.getAll("weekday").map(Number).filter((n) => n >= 1 && n <= 7);
  const week = Number(text(fd, "week_index") ?? 1);
  if (!start || !end || start === end) return { error: "Velg fra og til." };
  if (!weekdays.length) return { error: "Velg minst én ukedag." };
  const { error } = await ctx.supabase.from("rotation_shifts").insert(weekdays.map((wd) => ({
    org_id: ctx.org.id, rotation_id: rotation, week_index: week, weekday: wd, start_time: start, end_time: end,
    break_minutes: Number(text(fd, "break_minutes") ?? 30), employee_id: text(fd, "employee_id"), work_role_id: text(fd, "work_role_id"),
  })));
  if (error) return { error: error.message };
  revalidatePath("/turnus");
  return { ok: "Lagt til." };
}

export async function deleteRotationShift(fd: FormData) {
  const ctx = await requireAdmin();
  await ctx.supabase.from("rotation_shifts").delete().eq("id", text(fd, "id")!).eq("org_id", ctx.org.id);
  revalidatePath("/turnus");
}

/** Legg turnusen inn i vaktplanen fra en mandag, gjentatt til en sluttdato. Lages som utkast. */
export async function applyRotation(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const tz = ctx.org.timezone;
  const rotationId = text(fd, "rotation_id")!;
  let from = text(fd, "from");
  const to = text(fd, "to");
  if (!from || !to || to < from) return { error: "Velg periode." };
  from = addDays(from, 1 - isoWeekday(from)); // turnusuke 1 starter på mandag
  if (Date.parse(to) - Date.parse(from) > 370 * 86400000) return { error: "Velg en periode på høyst ett år." };
  const skipHolidays = fd.get("skip_holidays") === "on";

  const [{ data: rot }, { data: rows }] = await Promise.all([
    ctx.supabase.from("rotations").select("name, weeks").eq("id", rotationId).single(),
    ctx.supabase.from("rotation_shifts").select("*").eq("rotation_id", rotationId),
  ]);
  if (!rot || !rows?.length) return { error: "Turnusen har ingen vakter." };

  const runId = crypto.randomUUID();
  const inserts = [];
  for (let d = from, i = 0; d <= to; d = addDays(d, 1), i++) {
    if (d < (text(fd, "from") ?? from)) continue;
    if (skipHolidays && holidayOn(d)) continue;
    const week = (Math.floor(i / 7) % rot.weeks) + 1;
    for (const r of rows.filter((x) => x.week_index === week && x.weekday === isoWeekday(d))) {
      const st = r.start_time.slice(0, 5), en = r.end_time.slice(0, 5);
      inserts.push({
        org_id: ctx.org.id, employee_id: r.employee_id, work_role_id: r.work_role_id,
        starts_at: zonedToUtc(d, st, tz).toISOString(),
        ends_at: zonedToUtc(en <= st ? addDays(d, 1) : d, en, tz).toISOString(),
        break_minutes: r.break_minutes, status: "draft", series_id: runId, note: `Turnus: ${rot.name}`,
      });
    }
  }
  let created = 0, skipped = 0;
  // Sett inn én og én, så overlapp med eksisterende vakter hoppes over i stedet for å stoppe alt
  for (const row of inserts) {
    const { error } = await ctx.supabase.from("shifts").insert(row);
    if (error) skipped++; else created++;
  }
  revalidatePath("/vaktplan", "layout");
  return skipped
    ? { error: `${created} vakter lagt inn som utkast. ${skipped} hoppet over fordi de overlapper med vakter som finnes.` }
    : { ok: `${created} vakter lagt inn som utkast. Se over og publiser i vaktplanen.` };
}
