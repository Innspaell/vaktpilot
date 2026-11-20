import Link from "next/link";
import { requireOrg } from "@/lib/context";
import { addDays, dayBounds, formatDateLong, localDate, localTime } from "@/lib/time";
import { PrintButton } from "@/components/PrintButton";

type Change = { at: string; by: string; action: "UPDATE" | "DELETE"; from_start: string | null; from_end: string | null; to_start: string | null; to_end: string | null };
type Row = {
  entry_id: string; employee_id: string; employee_number: string | null; full_name: string;
  starts_at: string; ends_at: string | null; source: "clock" | "manual" | "admin"; deleted: boolean;
  registered_at: string; registered_by: string; changes: Change[];
};

/**
 * Personalliste etter bokføringsforskriften: hvem som har jobbet, med inn- og utstempling, og alle rettelser.
 * Kan vises og skrives ut av ledere, og av alle ansatte når bedriften har slått det på (kontroll når leder ikke er der).
 */
export default async function PersonnelListPage({ searchParams }: { searchParams: Promise<{ dato?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const tz = ctx.org.timezone;
  const today = localDate(new Date(), tz);
  const date = sp.dato && /^\d{4}-\d{2}-\d{2}$/.test(sp.dato) && sp.dato <= today ? sp.dato : today;

  const [{ data: header }, { data, error }] = await Promise.all([
    ctx.supabase.rpc("personnel_list_header", { p_org: ctx.org.id }).maybeSingle(),
    ctx.supabase.rpc("personnel_list", { p_org: ctx.org.id, p_date: date }),
  ]);

  if (error || !header) {
    return (
      <div className="card max-w-lg">
        <h1 className="h1">Personalliste</h1>
        <p className="mt-2 text-muted">
          {ctx.isAdmin
            ? "Personallisten er ikke slått på for bedriften. Slå den på under Innstillinger › Personalliste."
            : "Du har ikke tilgang til personallisten. Spør en leder."}
        </p>
        {ctx.isAdmin && <Link href="/innstillinger" className="btn-primary mt-4">Til innstillinger</Link>}
      </div>
    );
  }
  const h = header as { name: string; org_number: string | null; address: string | null; postal_code: string | null; city: string | null; enabled: boolean };
  const rows = (data ?? []) as Row[];
  const t = (iso: string | null) => (iso ? localTime(new Date(iso), tz) : "");
  const dt = (iso: string) => {
    const d = localDate(new Date(iso), tz);
    return `${d === date ? "" : d.split("-").reverse().slice(0, 2).join(".") + ". "}kl. ${localTime(new Date(iso), tz)}`;
  };
  const active = rows.filter((r) => !r.deleted);
  const inside = active.filter((r) => !r.ends_at).length;
  const people = new Set(active.map((r) => r.employee_id)).size;

  // For ledere: hjelp til å fange opp det som mangler
  let missingCode: string[] = [];
  let notRegistered: string[] = [];
  if (ctx.isAdmin) {
    const { start, end } = dayBounds(date, tz);
    const [{ data: emps }, { data: shifts }] = await Promise.all([
      ctx.supabase.from("employees").select("id, full_name, employee_number, end_date").eq("org_id", ctx.org.id),
      ctx.supabase.from("shifts").select("employee_id, starts_at").eq("org_id", ctx.org.id).eq("status", "published")
        .not("employee_id", "is", null).gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString()),
    ]);
    const current = (emps ?? []).filter((e) => !e.end_date || e.end_date >= date);
    missingCode = current.filter((e) => !e.employee_number?.trim()).map((e) => e.full_name);
    const registered = new Set(active.map((r) => r.employee_id));
    const started = (shifts ?? []).filter((s) => new Date(s.starts_at) <= new Date());
    notRegistered = [...new Set(started.filter((s) => !registered.has(s.employee_id!)).map((s) => s.employee_id!))]
      .map((id) => (emps ?? []).find((e) => e.id === id)?.full_name ?? "Ukjent");
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="h1">Personalliste</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/personalliste?dato=${addDays(date, -1)}`} className="btn-ghost" aria-label="Forrige dag">‹</Link>
          <form action="/personalliste" className="flex items-center gap-2">
            <input name="dato" type="date" defaultValue={date} max={today} className="input" aria-label="Dato" />
            <button className="btn-ghost">Vis</button>
          </form>
          {date < today && <Link href={`/personalliste?dato=${addDays(date, 1)}`} className="btn-ghost" aria-label="Neste dag">›</Link>}
          {date !== today && <Link href="/personalliste" className="btn-ghost">I dag</Link>}
          <PrintButton />
        </div>
      </header>

      {!h.enabled && ctx.isAdmin && (
        <div className="card bg-warn-soft text-sm text-warn print:hidden">
          Personallisten er ikke slått på. Du ser stemplingene, men ansatte kan ikke vise listen. Slå den på under <Link href="/innstillinger" className="font-semibold">Innstillinger</Link>.
        </div>
      )}
      {ctx.isAdmin && (missingCode.length > 0 || notRegistered.length > 0) && (
        <div className="card bg-warn-soft text-sm print:hidden" role="status">
          {notRegistered.length > 0 && (
            <p className="text-warn"><b>På vakt, men ikke registrert:</b> {notRegistered.join(", ")}. Alle som jobber, må stemple inn.</p>
          )}
          {missingCode.length > 0 && (
            <p className="mt-1 text-warn"><b>Mangler ansattnummer:</b> {missingCode.join(", ")}. Ansattnummeret er koden i personallisten. Legg det inn på ansattkortet.</p>
          )}
        </div>
      )}

      <article className="card print:border-0 print:p-0" aria-label={`Personalliste ${date}`}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
          <div>
            <div className="text-lg font-bold">{h.name}</div>
            <div className="text-sm">Org.nr. {h.org_number ? h.org_number.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3") : "–"}</div>
            {(h.address || h.city) && <div className="text-sm text-muted">{[h.address, [h.postal_code, h.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</div>}
          </div>
          <div className="text-right">
            <div className="text-lg font-bold first-letter:uppercase">Personalliste {formatDateLong(date)} {date.slice(0, 4)}</div>
            <div className="text-sm text-muted">
              {people} {people === 1 ? "person" : "personer"}{date === today ? ` · ${inside} inne nå` : ""}
            </div>
            <div className="text-xs text-muted">Vist {new Date().toLocaleString("nb-NO", { timeZone: tz, dateStyle: "short", timeStyle: "short" })}</div>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Ingen har registrert arbeidstid denne dagen.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">Kode</th>
                  <th className="py-2 pr-3">Navn</th>
                  <th className="py-2 pr-3">Inn</th>
                  <th className="py-2 pr-3">Ut</th>
                  <th className="py-2">Merknad</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const notes: string[] = [];
                  if (r.source !== "clock") notes.push(`Ført i etterkant av ${r.registered_by}, ${dt(r.registered_at)}`);
                  for (const c of r.changes) {
                    if (c.action === "DELETE") { notes.push(`Slettet av ${c.by}, ${dt(c.at)}`); continue; }
                    const parts: string[] = [];
                    if (c.from_start !== c.to_start) parts.push(`inn ${t(c.from_start)} → ${t(c.to_start)}`);
                    if (c.from_end !== c.to_end) parts.push(c.from_end ? `ut ${t(c.from_end)} → ${t(c.to_end) || "fjernet"}` : `ut satt til ${t(c.to_end)}`);
                    notes.push(`Rettet av ${c.by}, ${dt(c.at)}${parts.length ? `: ${parts.join(", ")}` : ""}`);
                  }
                  return (
                    <tr key={r.entry_id} className={`border-b border-line align-top ${r.deleted ? "text-muted" : ""}`}>
                      <td className="py-2 pr-3 font-mono">{r.employee_number ?? "–"}</td>
                      <td className={`py-2 pr-3 font-medium ${r.deleted ? "line-through" : ""}`}>{r.full_name}</td>
                      <td className={`py-2 pr-3 tabular-nums ${r.deleted ? "line-through" : ""}`}>{t(r.starts_at)}</td>
                      <td className={`py-2 pr-3 tabular-nums ${r.deleted ? "line-through" : ""}`}>
                        {r.ends_at ? t(r.ends_at) : r.deleted ? "" : <span className="rounded bg-good-soft px-1.5 py-0.5 text-xs font-semibold text-good">Inne</span>}
                      </td>
                      <td className="py-2 text-xs">
                        {notes.length === 0 ? <span className="text-muted">Stemplet</span> : (
                          <ul className="space-y-0.5">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-muted">
          Kode = ansattnummer. Kodeoversikten med fødselsnummer eller D-nummer ligger i lønnssystemet og vises ved kontroll.
          Listen bygger på stemplingene. Rettelser og slettinger står med hvem som gjorde dem og når. Ingen registreringer kan fjernes fra listen. Listen oppbevares i 3,5 år etter regnskapsårets slutt.
        </p>
      </article>
    </div>
  );
}
