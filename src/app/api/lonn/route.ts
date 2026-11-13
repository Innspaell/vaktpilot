import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { loadPayroll } from "@/lib/payroll-data";
import { diffPay, payrollCsv } from "@/lib/pay";
import { localDate, localTime } from "@/lib/time";
import { buildXlsx, xlsxResponseHeaders } from "@/lib/xlsx";
import { entriesSheet, explanationSheet, payrollSheet } from "@/lib/report-sheets";

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
  if (url.searchParams.get("format") === "xlsx") {
    const names = new Map(data.pay.map((p) => [p.employee.id, p.employee.name]));
    const buf = buildXlsx(type === "dager"
      ? [entriesSheet(data.entries, names, org.timezone)]
      : [payrollSheet(pay, data.period, data.wageTypes, type === "diff" ? "Etterbetaling" : "Lønnsgrunnlag"), explanationSheet(pay), entriesSheet(data.entries, names, org.timezone)]);
    const xfile = `${fileBase}_${org.name.replace(/[^\wæøåÆØÅ]+/g, "-")}_${from}_${to}.xlsx`;
    return new NextResponse(new Uint8Array(buf), { headers: xlsxResponseHeaders(xfile) });
  }
  let body: string;
  if (type !== "dager") {
    body = payrollCsv(pay, data.period, data.wageTypes);
  } else {
    const names = new Map(data.pay.map((p) => [p.employee.id, p.employee.name]));
    const head = ["Ansatt", "Dato", "Fra", "Til", "Pause (min)", "Timer", "Planlagt", "Status"];
    const rows = data.entries
      .slice()
      .sort((a, b) => (names.get(a.employee_id) ?? "").localeCompare(names.get(b.employee_id) ?? "", "nb") || a.starts_at.localeCompare(b.starts_at))
      .map((r) => {
        const s = new Date(r.starts_at), e = new Date(r.ends_at);
        const h = Math.round(((e.getTime() - s.getTime()) / 60000 - r.break_minutes) / 60 * 100) / 100;
        const planned = r.shifts ? `${localTime(new Date(r.shifts.starts_at), org.timezone)}–${localTime(new Date(r.shifts.ends_at), org.timezone)}` : "";
        return [names.get(r.employee_id) ?? "", localDate(s, org.timezone), localTime(s, org.timezone), localTime(e, org.timezone),
          String(r.break_minutes), String(h).replace(".", ","), planned,
          { draft: "Utkast", submitted: "Venter", approved: "Godkjent", locked: "Låst" }[r.status] ?? r.status];
      });
    body = "﻿" + [head, ...rows].map((l) => l.join(";")).join("\r\n") + "\r\n";
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
