import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { loadPayroll } from "@/lib/payroll-data";
import { payrollCsv } from "@/lib/pay";
import { localDate, localTime } from "@/lib/time";
import { buildXlsx, xlsxResponseHeaders } from "@/lib/xlsx";
import { entriesSheet, payrollSheet } from "@/lib/report-sheets";

/** Last ned lønnsgrunnlag (?type=lonn) eller kontrollark per dag (?type=dager) som CSV, eller som Excel med &format=xlsx. */
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
  const type = url.searchParams.get("type") === "dager" ? "dager" : "lonn";
  if (url.searchParams.get("format") === "xlsx") {
    const names = new Map(data.pay.map((p) => [p.employee.id, p.employee.name]));
    const buf = buildXlsx(type === "lonn"
      ? [payrollSheet(data.pay, data.period), entriesSheet(data.entries, names, org.timezone)]
      : [entriesSheet(data.entries, names, org.timezone)]);
    const xfile = `${type === "lonn" ? "lonnsgrunnlag" : "timer-per-dag"}_${org.name.replace(/[^\wæøåÆØÅ]+/g, "-")}_${from}_${to}.xlsx`;
    return new NextResponse(new Uint8Array(buf), { headers: xlsxResponseHeaders(xfile) });
  }
  let body: string;
  if (type === "lonn") {
    body = payrollCsv(data.pay, data.period);
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
  const file = `${type === "lonn" ? "lonnsgrunnlag" : "timer-per-dag"}_${org.name.replace(/[^\wæøåÆØÅ]+/g, "-")}_${from}_${to}.csv`;
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file)}`,
      "cache-control": "no-store",
    },
  });
}
