"use client";

import { useState } from "react";

/**
 * Legg vaktene i telefonens kalender. Valgene ligger i lenken, så hver kalender kan ha sine egne.
 * `url` er uten protokoll, f.eks. vaktpilot.no/api/kalender/<token>.ics
 */
export function CalendarSubscribe({ url }: { url: string }) {
  const [opt, setOpt] = useState({ k: true, f: true, l: false });
  const q = `k=${opt.k ? 1 : 0}&f=${opt.f ? 1 : 0}&l=${opt.l ? 1 : 0}`;
  const full = `${url}?${q}`;
  const webcal = `webcal://${full}`;
  const row = "flex min-h-12 items-center justify-between rounded-xl border border-line bg-white px-4 font-semibold hover:bg-paper";
  const box = (key: keyof typeof opt, label: string, hint?: string) => (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" checked={opt[key]} onChange={(e) => setOpt({ ...opt, [key]: e.target.checked })} className="mt-0.5 h-5 w-5" />
      <span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  );
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2.5 rounded-xl border border-line bg-white p-3">
        <legend className="px-1 text-sm font-semibold">Hva skal med</legend>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked disabled className="mt-0.5 h-5 w-5" /> Mine vakter</label>
        {box("k", "Hvem jeg jobber med, og når", "Står i beskrivelsen til vakten")}
        {box("f", "Godkjent fri og ferie")}
        {box("l", "Ledige vakter", "Vises som ledig tid, så de ikke opptar kalenderen")}
      </fieldset>
      <div className="space-y-2">
        <a href={webcal} className={row}>Apple Kalender (iPhone og Mac)<span className="text-muted">›</span></a>
        <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer" className={row}>Google Kalender (Android)<span className="text-muted">›</span></a>
        <a href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(`https://${full}`)}&name=${encodeURIComponent("Vakter")}`} target="_blank" rel="noreferrer" className={row}>Outlook<span className="text-muted">›</span></a>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-brand">Vis lenken (andre kalendere)</summary>
        <p className="mt-2 break-all rounded-lg bg-paper p-2 font-mono text-xs">https://{full}</p>
      </details>
      <p className="text-xs text-muted">Kalenderen oppdateres av seg selv, vanligvis hver time. Endrer du valgene, legg til kalenderen på nytt og fjern den gamle.</p>
    </div>
  );
}
