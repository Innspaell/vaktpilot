import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runBilling } from "@/lib/fiken";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Den daglige fakturajobben. Databasen kaller hit med sin egen hemmelighet, som databasen også sjekker. */
export async function POST(request: Request) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (secret.length < 32) return NextResponse.json({ error: "Ikke tillatt" }, { status: 401 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const summary = await runBilling(supabase, secret);
    return NextResponse.json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: msg.includes("Ikke tillatt") ? 401 : 500 });
  }
}
