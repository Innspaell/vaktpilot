import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { buildXlsx, xlsxResponseHeaders, type Cell, type Sheet } from "@/lib/xlsx";
import { groupBySite, PL_RETENTION_NOTE, rowNotes, WORKER_LABEL, type PlRow, type PlSite } from "@/lib/personnel-list";
import { localTime } from "@/lib/time";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Personallisten for en periode som fil (Excel eller CSV), i datoorden og per arbeidssted, til kontrolløren. */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx.org) return NextResponse.json({ error: "Ikke tillatt" }, { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("fra") ?? "";
  const to = url.searchParams.get("til") ?? "";
  if (!ISO.test(from) || !ISO.test(to) || to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000) {
    return NextResponse.json({ error: "Ugyldig periode" }, { status: 400 });
  }
  const org = ctx.org;
  const [{ data: header }, { data: siteData }] = await Promise.all([
    ctx.supabase.rpc("personnel_list_header", { p_org: org.id }).maybeSingle(),
    ctx.supabase.rpc("personnel_list_sites", { p_org: org.id }),
  ]);
  const sites = (siteData ?? []) as PlSite[];
  const sted = url.searchParams.get("sted");
  const site = sted && sites.some((s) => s.id === sted) ? sted : null;
  const { data, error } = await ctx.supabase.rpc("personnel_list_range", { p_org: org.id, p_from: from, p_to: to, p_site: site });
  if (error || !header) return NextResponse.json({ error: "Ingen tilgang til personallisten" }, { status: 403 });

  const h = header as { name: string; org_number: string | null };
  const tz = org.timezone;
  const t = (iso: string | null) => (iso ? localTime(new Date(iso), tz) : "");
  const groups = groupBySite((data ?? []) as PlRow[], sites, site);
  const head = ["Dato", "Arbeidssted", "Kode", "Navn", "Type", "Inn", "Ut", "Status", "Merknad"];
  const line = (r: PlRow): Cell[] => [
    r.work_date, r.site_name ?? "", r.employee_number ?? "", r.full_name, WORKER_LABEL[r.worker_type] ?? "ansatt",
    t(r.starts_at), r.ends_at ? t(r.ends_at) : r.deleted ? "" : "Inne", r.deleted ? "Slettet" : "", rowNotes(r, tz).join("; "),
  ];
  const created = `Laget ${new Date().toLocaleString("nb-NO", { timeZone: tz, dateStyle: "short", timeStyle: "short" })}`;
  const file = `personalliste_${org.name.replace(/[^\wæøåÆØÅ]+/g, "-")}_${from}_${to}`;

  if (url.searchParams.get("format") === "csv") {
    const esc = (c: Cell) => {
      const v = String(c ?? "");
      return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const lines = [
      [`Personalliste ${h.name}`, `Org.nr. ${h.org_number ?? ""}`, `${from} – ${to}`, created],
      head,
      ...groups.flatMap((g) => g.rows.map(line)),
    ];
    const body = "﻿" + lines.map((l) => l.map(esc).join(";")).join("\r\n");
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${file}.csv`)}`,
        "cache-control": "no-store",
      },
    });
  }

  const sheets: Sheet[] = groups.map((g) => ({
    name: (g.site?.name ?? (sites.length ? "Uten arbeidssted" : "Personalliste")).slice(0, 31),
    rows: [
      [h.name, `Org.nr. ${h.org_number ?? ""}`],
      [g.site ? `Arbeidssted: ${g.site.name}${g.site.address ? `, ${g.site.address}` : ""}` : "", `Periode: ${from} – ${to}`, created],
      [],
      head,
      ...g.rows.map(line),
      [],
      [PL_RETENTION_NOTE],
    ],
    widths: [11, 18, 8, 26, 9, 7, 7, 9, 70],
  }));
  return new NextResponse(new Uint8Array(buildXlsx(sheets)), { headers: xlsxResponseHeaders(`${file}.xlsx`) });
}
