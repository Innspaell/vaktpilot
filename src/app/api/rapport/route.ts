import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { loadReport } from "@/lib/report-data";
import { buildXlsx, xlsxResponseHeaders, type Cell } from "@/lib/xlsx";
import { entriesSheet, payrollSheet } from "@/lib/report-sheets";

/** Rapport som Excel-fil med flere ark. */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx.org || !ctx.isAdmin) return NextResponse.json({ error: "Ikke tillatt" }, { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("fra") ?? "";
  const to = url.searchParams.get("til") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000) {
    return NextResponse.json({ error: "Ugyldig periode" }, { status: 400 });
  }
  const grouping = url.searchParams.get("per") === "maned" ? "maned" : "uke";
  const org = ctx.org;
  const r = await loadReport({ ...ctx, org }, from, to, grouping);
  const names = new Map(r.employees.map((e) => [e.id, e.name]));

  const perEmployee: Cell[][] = [["Ansatt", "Planlagt (t)", "Registrert (t)", "Godkjent (t)", "Avvik mot plan (t)", "Overtid (t)", "Mertid (t)",
    "Jobbet på helligdag (t)", "Betalt fravær (t)", "Fraværsdager", "Forventet (t)", "Saldo (t)", "Avspaseringssaldo (t)"]];
  for (const e of r.employees) {
    perEmployee.push([e.name, e.planned, e.registered, e.approved, Math.round((e.registered - e.planned) * 100) / 100, e.overtime, e.extra,
      e.holidayWorked, e.paidAbsence, e.absenceDays, e.expected, e.balance, r.comp.balances.get(e.id)?.balance ?? 0]);
  }

  const perBucket: Cell[][] = [[grouping === "uke" ? "Uke" : "Måned", "Fra", "Ansatt", "Planlagt (t)", "Registrert (t)", "Avvik (t)"]];
  for (const b of r.buckets) {
    perBucket.push([b.label, b.key, "Alle", b.planned, b.registered, Math.round((b.registered - b.planned) * 100) / 100]);
    for (const e of r.employees) {
      const x = b.byEmployee.get(e.id);
      if (!x) continue;
      const p = Math.round(x.planned / 60 * 100) / 100, g = Math.round(x.registered / 60 * 100) / 100;
      perBucket.push([b.label, b.key, e.name, p, g, Math.round((g - p) * 100) / 100]);
    }
  }

  const coverage: Cell[][] = [["Dato", "Behov (maks)", "Planlagt (maks)", "Manglende persontimer"]];
  for (const d of r.coverage.short) coverage.push([d.date, d.required, d.planned, d.missingHours]);
  coverage.push([], ["Dager med behov", r.coverage.daysWithNeed], ["Fullt bemannet", r.coverage.daysCovered], ["Med mangel", r.coverage.daysShort]);

  const comp: Cell[][] = [["Ansatt", "Opptjent (t)", "Tatt ut (t)", "Saldo (t)"]];
  for (const e of r.employees) {
    const c = r.comp.balances.get(e.id) ?? { earned: 0, used: 0, balance: 0 };
    comp.push([e.name, c.earned, c.used, c.balance]);
  }

  const buf = buildXlsx([
    { name: "Per ansatt", rows: perEmployee, widths: [24, 11, 12, 11, 15, 10, 10, 18, 14, 12, 12, 9, 18] },
    { name: grouping === "uke" ? "Per uke" : "Per måned", rows: perBucket, widths: [20, 11, 24, 12, 13, 9] },
    payrollSheet(r.payroll.pay, r.payroll.period),
    entriesSheet(r.payroll.entries, names, org.timezone),
    { name: "Bemanning", rows: coverage, widths: [16, 13, 15, 22] },
    { name: "Avspasering", rows: comp, widths: [24, 12, 12, 10] },
  ]);
  const file = `rapport_${org.name.replace(/[^\wæøåÆØÅ]+/g, "-")}_${from}_${to}.xlsx`;
  return new NextResponse(new Uint8Array(buf), { headers: xlsxResponseHeaders(file) });
}
