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
    .select("link").maybeSingle();
  let link = data?.link;
  if (!data) {
    const { data: n } = await ctx.supabase.from("notifications").select("link").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
    link = n?.link;
  }
  // Bare lenker innenfor appen
  const target = link && link.startsWith("/") && !link.startsWith("//") ? link : "/varsler";
  return NextResponse.redirect(new URL(target, request.url), 303);
}
