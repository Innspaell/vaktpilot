"use client";

import Link from "next/link";
import { useState } from "react";
import type { ImportRow } from "@/lib/employee-import";
import { previewImport, runImport } from "./actions";

const PAY: Record<string, string> = { hourly: "Timelønn", fixed: "Fastlønn" };

export function ImportEmployees({ today }: { today: string }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; invited: number; errors: string[] } | null>(null);
  const [defaults, setDefaults] = useState({ start_date: today, position_pct: 100, pay_type: "hourly", invite: false });

  async function read(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await previewImport(new FormData(e.currentTarget));
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setRows(res.rows ?? []); setColumns(res.columns ?? []);
  }

  async function save() {
    if (!rows) return;
    setBusy(true);
    setDone(await runImport(rows, defaults));
    setBusy(false);
  }

  if (done) {
    return (
      <section className="card space-y-2">
        <p className="font-semibold text-good">{done.created} ansatte er lagt inn.{done.invited ? ` ${done.invited} har fått invitasjon på e-post.` : ""}</p>
        {done.errors.length > 0 && <ul className="list-disc pl-5 text-sm text-bad">{done.errors.map((x) => <li key={x}>{x}</li>)}</ul>}
        <Link href="/ansatte" className="btn-primary inline-flex">Se de ansatte</Link>
      </section>
    );
  }

  if (!rows) {
    return (
      <form onSubmit={read} className="card space-y-4">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-paper px-3 py-2 text-sm">
          <span>Usikker på oppsettet? Start med eksempelfila og skriv over med dine egne.</span>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/ansatte/eksempelfil" download className="font-semibold text-brand">Last ned eksempelfil (Excel)</a>
        </p>
        <label className="block">
          <span className="label">Excel- eller CSV-fil</span>
          <input type="file" name="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="input" />
        </label>
        <div className="text-center text-sm text-muted">eller</div>
        <label className="block">
          <span className="label">Lim inn fra Excel</span>
          <textarea name="pasted" rows={6} className="input font-mono text-xs" placeholder={"Navn\tE-post\tMobil\tStilling %\nKari Nordmann\tkari@eksempel.no\t900 00 000\t80"} />
          <span className="mt-1 block text-xs text-muted">Marker cellene i Excel (med overskriftene), kopier og lim inn her.</span>
        </label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? "Leser …" : "Les inn"}</button>
      </form>
    );
  }

  const ok = rows.filter((r) => r.problems.length === 0);
  const needs = (k: keyof ImportRow) => rows.some((r) => r.problems.length === 0 && (r[k] === null || r[k] === undefined));
  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <p className="text-sm">
          Fant <b>{rows.length}</b> rader. <b>{ok.length}</b> kan legges inn{rows.length - ok.length > 0 ? `, ${rows.length - ok.length} har feil og hoppes over` : ""}.
          <span className="block text-muted">Kolonner vi kjente igjen: {columns.join(", ")}.</span>
        </p>
        {(needs("start_date") || needs("position_pct") || needs("pay_type")) && (
          <div className="grid gap-3 sm:grid-cols-3">
            <p className="text-sm text-muted sm:col-span-3">For dem der det mangler i fila:</p>
            {needs("start_date") && <label className="block"><span className="label">Startdato</span>
              <input type="date" value={defaults.start_date} onChange={(e) => setDefaults({ ...defaults, start_date: e.target.value })} className="input" /></label>}
            {needs("position_pct") && <label className="block"><span className="label">Stillingsprosent</span>
              <input type="number" min={1} max={100} value={defaults.position_pct} onChange={(e) => setDefaults({ ...defaults, position_pct: Number(e.target.value) || 100 })} className="input" /></label>}
            {needs("pay_type") && <label className="block"><span className="label">Lønnstype</span>
              <select value={defaults.pay_type} onChange={(e) => setDefaults({ ...defaults, pay_type: e.target.value })} className="input">
                <option value="hourly">Timelønn</option><option value="fixed">Fastlønn</option></select></label>}
          </div>
        )}
        {ok.some((r) => r.email) && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={defaults.invite} onChange={(e) => setDefaults({ ...defaults, invite: e.target.checked })} className="mt-1 h-4 w-4" />
            <span>Send invitasjon på e-post til dem som har e-post ({ok.filter((r) => r.email).length} stk). Du kan også gjøre det senere, én og én.</span>
          </label>
        )}
      </section>

      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-4 py-2 font-medium">Navn</th><th className="px-2 py-2 font-medium">E-post</th><th className="px-2 py-2 font-medium">Mobil</th>
            <th className="px-2 py-2 font-medium">Start</th><th className="px-2 py-2 text-right font-medium">Stilling</th><th className="px-2 py-2 font-medium">Lønn</th>
            <th className="px-4 py-2 font-medium" />
          </tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i} className={r.problems.length ? "bg-bad-soft/50 text-muted" : ""}>
                <td className="px-4 py-2 font-medium">{r.full_name || "–"}</td>
                <td className="px-2 py-2">{r.email ?? <span className="text-muted">–</span>}</td>
                <td className="px-2 py-2">{r.phone ?? ""}</td>
                <td className="px-2 py-2">{(r.start_date ?? defaults.start_date).split("-").reverse().join(".")}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.position_pct ?? defaults.position_pct} %</td>
                <td className="px-2 py-2">{PAY[r.pay_type ?? defaults.pay_type]}{r.is_shift_worker ? ", turnus" : ""}</td>
                <td className="px-4 py-2 text-xs text-bad">{r.problems.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={busy || ok.length === 0} className="btn-primary">{busy ? "Legger inn …" : `Legg inn ${ok.length} ansatte`}</button>
        <button onClick={() => { setRows(null); setError(null); }} className="btn-ghost">Velg en annen fil</button>
      </div>
    </div>
  );
}
