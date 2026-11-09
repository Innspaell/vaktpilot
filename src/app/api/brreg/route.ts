import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchCompanies } from "@/lib/brreg";

export async function GET(request: Request) {
  // Bare innloggede brukere kan søke
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Ikke innlogget" }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ results: await searchCompanies(q.slice(0, 100)) });
  } catch {
    return NextResponse.json({ results: [], error: "Brønnøysundregistrene svarer ikke akkurat nå." }, { status: 502 });
  }
}
