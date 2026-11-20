/**
 * Legg egne vakter, fri og ferie i telefonens kalender.
 * `url` er uten protokoll, f.eks. vaktpilot.no/api/kalender/<token>.ics
 */
export function CalendarSubscribe({ url }: { url: string }) {
  const webcal = `webcal://${url}`;
  const row = "flex min-h-12 items-center justify-between rounded-xl border border-line bg-white px-4 font-semibold hover:bg-paper";
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <a href={webcal} className={row}>Apple Kalender (iPhone og Mac)<span className="text-muted">›</span></a>
        <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer" className={row}>Google Kalender (Android)<span className="text-muted">›</span></a>
        <a href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(`https://${url}`)}&name=${encodeURIComponent("Vakter")}`} target="_blank" rel="noreferrer" className={row}>Outlook<span className="text-muted">›</span></a>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-brand">Vis lenken (andre kalendere)</summary>
        <p className="mt-2 break-all rounded-lg bg-paper p-2 font-mono text-xs">https://{url}</p>
      </details>
    </div>
  );
}
