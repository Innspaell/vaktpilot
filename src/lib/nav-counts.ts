import "server-only";
import type { getContext } from "./context";
import type { NavCounts } from "./nav-items";

/** Tall i menyen: det som venter på lederen, og det som venter på den ansatte selv. */
export async function navCounts(ctx: Awaited<ReturnType<typeof getContext>>): Promise<NavCounts> {
  const org = ctx.org!.id;
  const sb = ctx.supabase;
  const head = { count: "exact" as const, head: true };
  const mineQ = ctx.employeeId
    ? Promise.all([
        sb.from("shift_swaps").select("id", head).eq("org_id", org).eq("status", "pending").eq("to_employee_id", ctx.employeeId).eq("to_accepted", false),
        sb.from("vacation_carryovers").select("id", head).eq("org_id", org).eq("status", "pending").eq("employee_id", ctx.employeeId).is("employee_accepted_at", null),
      ]).then((r) => r.reduce((s, x) => s + (x.count ?? 0), 0))
    : Promise.resolve(0);
  const adminQ = ctx.isAdmin
    ? Promise.all([
        sb.from("absence_requests").select("id", head).eq("org_id", org).eq("status", "pending"),
        sb.from("shift_requests").select("id", head).eq("org_id", org).eq("status", "pending"),
        sb.from("shift_swaps").select("id", head).eq("org_id", org).eq("status", "pending").or("to_employee_id.is.null,to_accepted.eq.true"),
        sb.from("vacation_carryovers").select("id", head).eq("org_id", org).eq("status", "pending").is("employer_accepted_at", null),
      ]).then((r) => r.reduce((s, x) => s + (x.count ?? 0), 0))
    : Promise.resolve(0);
  const [mine, approvals] = await Promise.all([mineQ, adminQ]);
  return { mine, approvals };
}
