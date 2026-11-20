import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { loadPayroll } from "@/lib/payroll-data";
import { diffPay, payrollCsv } from "@/lib/pay";
import { buildXlsx, xlsxResponseHeaders } from "@/lib/xlsx";
import { entriesRows, entriesSheet, explanationSheet, payrollSheet } from "@/lib/report-sheets";

/**
 * Last ned lønnsgrunnlag (?type=lonn), differanse/etterbetaling for en låst periode (?type=diff)
 * eller kontrollark per dag (?type=dager) som CSV, eller som Excel med &format=xlsx.
 * En låst periode gir alltid det lagrede grunnlaget fra låsingen.
 */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx.org || !ctx.isAdmin) return NextResponse.json({ error: "Ikke tillatt" }, { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("fra") ?? "";
  const to = url.searchParams.get("til") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return NextResponse.json({ error: "Ugyldig periode" }, { status: 400 });
  }
  const org = ctx.org;
  const data = await loadPayroll({ ...ctx, org }, from, to);
  const t = url.searchParams.get("type");
  const type = t === "dager" ? "dager" : t === "diff" ? "diff" : "lonn";
  if (type === "diff" && !data.snapshot) return NextResponse.json({ error: "Perioden er ikke låst" }, { status: 400 });
  const pay = type === "diff" ? diffPay(data.snapshot!.pay, data.pay) : data.snapshot ? data.snapshot.pay : data.pay;
  const fileBase = type === "lonn" ? "lonnsgrunnlag" : type === "diff" ? "etterbetaling" : "timer-per-dag";
  const names = new Map(data.pay.map((p) => [p.employee.id, p.employee.name]));
  const sheetOpts = () => ({ clocks: data.entryClocks(), paidBreaks: data.paidBreaks });
  if (url.searchParams.get("format") === "xlsx") {
    const buf = buildXlsx(type === "dager"
      ? [entriesSheet(data.entries, names, org.timezone, sheetOpts())]
      : [payrollSheet(pay, data.period, data.wageTypes, type === "diff" ? "Etterbetaling" : "Lønnsgrunnlag"), explanationSheet(pay), entriesSheet(data.entries, names, org.timezone, sheetOpts())]);
    const xfile = `${fileBase}_${org.name.replace(/[^\wæøåÆØÅ]+/g, "-")}_${from}_${to}.xlsx`;
    return new NextResponse(new Uint8Array(buf), { headers: xlsxResponseHeaders(xfile) });
  }
  let body: string;
  if (type !== "dager") {
    body = payrollCsv(pay, data.period, data.wageTypes);
  } else {
    const rows = entriesRows(data.entries, names, org.timezone, sheetOpts())
      .map((l) => l.map((c) => (typeof c === "number" ? String(c).replace(".", ",") : String(c ?? "").replace(/[;\r\n]+/g, " "))));
    body = "﻿" + rows.map((l) => l.join(";")).join("\r\n") + "\r\n";
  }
  const file = `${fileBase}_${org.name.replace(/[^\wæøåÆØÅ]+/g, "-")}_${from}_${to}.csv`;
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file)}`,
      "cache-control": "no-store",
    },
  });
}
