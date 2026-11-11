import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";

/** Åpne et varsel: merk det som lest og gå videre til det varselet gjelder. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const home = new URL("/varsler", request.url);
  if (!ctx.userId || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.redirect(home, 303);
  const { data } = await ctx.supabase.from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", ctx.userId).is("read_at", null)
    .select("link, kind, ref_id").maybeSingle();
  let n = data;
  if (!n) {
    const { data: again } = await ctx.supabase.from("notifications").select("link, kind, ref_id").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
    n = again;
  }
  let link = n?.link;
  // Varsler om én bestemt vakt åpner uka der vakta ligger
  if (n?.ref_id && ["shift_changed", "shift_assigned", "open_shifts"].includes(n.kind) && link === "/vaktplan") link = `/vaktplan?vakt=${n.ref_id}`;
  // Bare lenker innenfor appen
  const target = link && link.startsWith("/") && !link.startsWith("//") ? link : "/varsler";
  return NextResponse.redirect(new URL(target, request.url), 303);
}
