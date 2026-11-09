import type { AppContext } from "./context";
import { localTime } from "./time";

/** Nåværende stemplingsstatus for innlogget ansatt. */
export async function clockState(ctx: AppContext & { org: NonNullable<AppContext["org"]> }) {
  if (!ctx.employeeId) return null;
  const { data: open } = await ctx.supabase
    .from("time_entries")
    .select("id, starts_at")
    .eq("employee_id", ctx.employeeId)
    .is("ends_at", null)
    .maybeSingle();
  if (!open) return { state: "out" as const };
  const { data: last } = await ctx.supabase
    .from("clock_events")
    .select("kind")
    .eq("time_entry_id", open.id)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    state: last?.kind === "break_start" ? ("on_break" as const) : ("working" as const),
    since: localTime(new Date(open.starts_at), ctx.org.timezone),
  };
}
