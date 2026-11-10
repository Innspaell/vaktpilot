import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { DPA_SECTIONS, DPA_VERSION, VENDOR } from "@/lib/legal";

const TABLES = [
  "employees", "employment_terms", "work_roles", "employee_work_roles", "staffing_templates", "staffing_overrides",
  "shift_templates", "shifts", "shift_requests", "shift_swaps", "availability", "clock_events", "time_entries",
  "absence_types", "absence_requests", "holiday_rules", "pay_periods", "payroll_exports", "rotations", "rotation_shifts",
  "board_posts", "dpa_acceptances", "audit_log",
];

/** Alle bedriftens data (administrator). ?dpa=1 gir bare databehandleravtalen med godkjenning. */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx.org || !ctx.isAdmin) return NextResponse.json({ error: "Ikke tillatt" }, { status: 403 });
  const org = ctx.org;
  const date = new Date().toISOString().slice(0, 10);
  const safe = org.name.replace(/[^\wæøåÆØÅ]+/g, "-");

  if (new URL(request.url).searchParams.get("dpa") === "1") {
    const { data: acc } = await ctx.supabase.from("dpa_acceptances").select("*").eq("org_id", org.id).order("accepted_at");
    const text = [
      `Databehandleravtale – ${org.name} (behandlingsansvarlig) og ${VENDOR.name}, org.nr. ${VENDOR.orgNumber} (databehandler)`,
      `Versjon ${DPA_VERSION}`, "",
      ...DPA_SECTIONS.flatMap((s) => [s.title, ...s.body, ""]),
      "Godkjenninger:",
      ...(acc ?? []).map((a) => `- Versjon ${a.version}: ${a.accepted_name} <${a.accepted_email}>, ${a.accepted_at}`),
    ].join("\n");
    return new NextResponse(text, {
      headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="databehandleravtale-${safe}.txt"` },
    });
  }

  const results = await Promise.all(TABLES.map((t) => ctx.supabase.from(t).select("*").eq("org_id", org.id).limit(100000)));
  const { data: orgRow } = await ctx.supabase.from("organizations").select("*").eq("id", org.id).single();
  const body: Record<string, unknown> = { eksportert: new Date().toISOString(), av: ctx.email, bedrift: orgRow };
  TABLES.forEach((t, i) => (body[t] = results[i].data ?? []));
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="vaktpilot-${safe}-${date}.json"`,
      "cache-control": "no-store",
    },
  });
}
