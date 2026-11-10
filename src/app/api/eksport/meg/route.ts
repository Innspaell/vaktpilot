import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";

/** Alle opplysninger om innlogget bruker, på tvers av bedrifter (dataportabilitet). */
export async function GET() {
  const ctx = await getContext();
  const s = ctx.supabase;
  const { data: employees } = await s.from("employees").select("*").eq("user_id", ctx.userId);
  const ids = (employees ?? []).map((e) => e.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const q = (t: string, col = "employee_id") => s.from(t).select("*").in(col, ids.length ? ids : none);
  const [terms, shifts, entries, clock, absences, requests, swaps, availability, notifications, posts] = await Promise.all([
    q("employment_terms"), q("shifts"), q("time_entries"), q("clock_events"), q("absence_requests"), q("shift_requests"),
    s.from("shift_swaps").select("*").or(`from_employee_id.in.(${(ids.length ? ids : none).join(",")}),to_employee_id.in.(${(ids.length ? ids : none).join(",")})`),
    q("availability"),
    s.from("notifications").select("*").eq("user_id", ctx.userId),
    s.from("board_posts").select("*").eq("author_user", ctx.userId),
  ]);
  const body = {
    eksportert: new Date().toISOString(), bruker: { id: ctx.userId, epost: ctx.email },
    ansattforhold: employees ?? [], avtaler: terms.data ?? [], vakter: shifts.data ?? [], timer: entries.data ?? [],
    stempling: clock.data ?? [], fravaer: absences.data ?? [], vaktforesporsler: requests.data ?? [], vaktbytter: swaps.data ?? [],
    tilgjengelighet: availability.data ?? [], varsler: notifications.data ?? [], tavleinnlegg: posts.data ?? [],
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="mine-data-vaktpilot-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
