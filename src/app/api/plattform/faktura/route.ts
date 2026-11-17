import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { buildXlsx, xlsxResponseHeaders } from "@/lib/xlsx";

/** Fakturagrunnlag for én måned (?maned=2026-11) som Excel. Bare for InnSpæll. */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return NextResponse.json({ error: "Ikke tillatt" }, { status: 403 });
  const m = new URL(request.url).searchParams.get("maned") ?? "";
  if (!/^\d{4}-\d{2}$/.test(m)) return NextResponse.json({ error: "Ugyldig måned" }, { status: 400 });
  const { data, error } = await ctx.supabase.rpc("platform_invoice_basis", { p_month: `${m}-01` });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  type Row = { name: string; org_number: string | null; invoice_email: string | null; address: string | null; postal_code: string | null; city: string | null;
    active_count: number; included: number; base_price: number; per_extra: number; extra: number; amount: number; trial: boolean; final: boolean;
    price_locked_until: string | null; cancel_requested_at: string | null };
  const rows = (data ?? []) as Row[];
  const buf = buildXlsx([{
    name: `Faktura ${m}`,
    widths: [28, 12, 28, 26, 8, 16, 8, 9, 10, 10, 8, 12, 12, 14, 12],
    rows: [
      ["Bedrift", "Org.nr.", "Faktura til", "Adresse", "Postnr.", "Poststed", "Aktive", "Inkludert", "Fast pris", "Per ekstra", "Ekstra", "Beløp eks. mva.", "Status", "Fast pris til", "Sagt opp"],
      ...rows.map((r) => [
        r.name, r.org_number, r.invoice_email, r.address, r.postal_code, r.city, r.active_count, r.included,
        Number(r.base_price), Number(r.per_extra), r.extra, Number(r.amount),
        r.trial ? "Prøveperiode" : r.final ? "Låst" : "Foreløpig", r.price_locked_until, r.cancel_requested_at?.slice(0, 10) ?? null,
      ]),
      [],
      ["Sum", null, null, null, null, null, null, null, null, null, null, rows.reduce((s, r) => s + Number(r.amount), 0)],
    ],
  }]);
  return new NextResponse(new Uint8Array(buf), { headers: xlsxResponseHeaders(`fakturagrunnlag_vaktpilot_${m}.xlsx`) });
}
