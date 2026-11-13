import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Helsesjekk for oppetidsovervåking: 200 når appen og databasen svarer, ellers 503. */
export async function GET() {
  const started = Date.now();
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/ping`, {
      method: "POST",
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const ok = res.ok && (await res.json()) === true;
    return NextResponse.json({ ok, database: ok, ms: Date.now() - started }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, database: false, ms: Date.now() - started }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
