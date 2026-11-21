import Link from "next/link";
import { requireOrg } from "@/lib/context";
import { addDays, dayBounds, formatDateLong, localDate, localTime } from "@/lib/time";
import { PrintButton } from "@/components/PrintButton";
import { groupBySite, PL_RETENTION_NOTE, rowNotes, WORKER_LABEL, type PlRow, type PlSite } from "@/lib/personnel-list";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Personalliste etter bokføringsforskriften § 8-5-6: hvem som har jobbet, med inn- og utstempling og alle rettelser.
 * En dag eller en hel periode i datoorden, én liste per arbeidssted, til skjerm, utskrift og fil (til kontrolløren).
 * Kan vises av ledere, og av alle ansatte når bedriften har slått det på (kontroll når leder ikke er der).
 */
export default async function PersonnelListPage({ searchParams }: { searchParams: Promise<{ dato?: string; fra?: string; til?: string; sted?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const tz = ctx.org.timezone;
  const today = localDate(new Date(), tz);
  const clamp = (d: string | undefined, fallback: string) => (d && ISO.test(d) && d <= today ? d : fallback);
  let from = clamp(sp.fra ?? sp.dato, today);
  let to = clamp(sp.til ?? sp.dato ?? sp.fra, from);
  if (to < from) [from, to] = [to, from];
  if (Date.parse(to) - Date.parse(from) > 366 * 86400000) from = addDays(to, -366);
  const single = from === to;
  const date = to;

  const [{ data: header }, { data: siteData }] = await Promise.all([
    ctx.supabase.rpc("personnel_list_header", { p_org: ctx.org.id }).maybeSingle(),
    ctx.supabase.rpc("personnel_list_sites", { p_org: ctx.org.id }),
  ]);
  const sites = (siteData ?? []) as PlSite[];
  const site = sp.sted && sites.some((x) => x.id === sp.sted) ? sp.sted : null;
  const { data, error } = await ctx.supabase.rpc("personnel_list_range", { p_org: ctx.org.id, p_from: from, p_to: to, p_site: site });
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
  const rows = (data ?? []) as PlRow[];
  const active = rows.filter((r) => !r.deleted);
  const inside = active.filter((r) => !r.ends_at && r.work_date === today).length;
  const people = new Set(active.map((r) => r.employee_id)).size;
  const t = (iso: string | null) => (iso ? localTime(new Date(iso), tz) : "");
  const groups = groupBySite(rows, sites, site);
  const dm = (d: string, year: boolean) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nb-NO", { day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
  const range = single ? `${formatDateLong(from)} ${from.slice(0, 4)}` : `${dm(from, from.slice(0, 4) !== to.slice(0, 4))} – ${dm(to, true)}`;
  const q = (extra: Record<string, string>) => {
    const u = new URLSearchParams({ fra: from, til: to, ...(site ? { sted: site } : {}), ...extra });
    return u.toString();
  };
  const monthStart = `${today.slice(0, 8)}01`;
  const prevMonthEnd = addDays(monthStart, -1);
  const prevMonthStart = `${prevMonthEnd.slice(0, 8)}01`;

  // For ledere: hjelp til å fange opp det som mangler (bare for én dag)
  let missingCode: string[] = [];
  let notRegistered: string[] = [];
  if (ctx.isAdmin && single) {
    const { start, end } = dayBounds(date, tz);
    const [{ data: emps }, { data: shifts }] = await Promise.all([
      ctx.supabase.from("employees").select("id, full_name, employee_number, end_date, in_personnel_list").eq("org_id", ctx.org.id),
      ctx.supabase.from("shifts").select("employee_id, starts_at").eq("org_id", ctx.org.id).eq("status", "published")
        .not("employee_id", "is", null).gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString()),
    ]);
    const listed = (emps ?? []).filter((e) => e.in_personnel_list !== false);
    const current = listed.filter((e) => !e.end_date || e.end_date >= date);
    missingCode = current.filter((e) => !e.employee_number?.trim()).map((e) => e.full_name);
    const registered = new Set(active.map((r) => r.employee_id));
    const started = (shifts ?? []).filter((s) => new Date(s.starts_at) <= new Date() && listed.some((e) => e.id === s.employee_id));
    notRegistered = [...new Set(started.filter((s) => !registered.has(s.employee_id!)).map((s) => s.employee_id!))]
      .map((id) => (emps ?? []).find((e) => e.id === id)?.full_name ?? "Ukjent");
  }

  return (
    <div className="space-y-4">
      <header className="space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="h1">Personalliste</h1>
          <div className="flex flex-wrap items-center gap-2">
            <PrintButton />
            <a href={`/api/personalliste?${q({ format: "xlsx" })}`} className="btn-ghost">Excel</a>
            <a href={`/api/personalliste?${q({ format: "csv" })}`} className="btn-ghost">CSV</a>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {single && <Link href={`/personalliste?${q({ fra: addDays(date, -1), til: addDays(date, -1) })}`} className="btn-ghost" aria-label="Forrige dag">‹</Link>}
          <form action="/personalliste" className="flex flex-wrap items-end gap-2">
            <label className="text-sm"><span className="label">Fra</span><input name="fra" type="date" defaultValue={from} max={today} className="input" /></label>
            <label className="text-sm"><span className="label">Til</span><input name="til" type="date" defaultValue={to} max={today} className="input" /></label>
            {sites.length > 0 && (
              <label className="text-sm"><span className="label">Arbeidssted</span>
                <select name="sted" defaultValue={site ?? ""} className="input">
                  <option value="">Alle (én liste per sted)</option>
                  {sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            )}
            <button className="btn-ghost">Vis</button>
          </form>
          {single && date < today && <Link href={`/personalliste?${q({ fra: addDays(date, 1), til: addDays(date, 1) })}`} className="btn-ghost" aria-label="Neste dag">›</Link>}
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={`/personalliste?${q({ fra: today, til: today })}`} className="btn-ghost px-3 py-1.5 text-sm">I dag</Link>
          <Link href={`/personalliste?${q({ fra: addDays(today, -6), til: today })}`} className="btn-ghost px-3 py-1.5 text-sm">Siste 7 dager</Link>
          <Link href={`/personalliste?${q({ fra: monthStart, til: today })}`} className="btn-ghost px-3 py-1.5 text-sm">Denne måneden</Link>
          <Link href={`/personalliste?${q({ fra: prevMonthStart, til: prevMonthEnd })}`} className="btn-ghost px-3 py-1.5 text-sm">Forrige måned</Link>
        </div>
        <p className="text-xs text-muted">Ved kontroll: vis listen på skjermen, skriv den ut, eller send Excel-filen til kontrolløren på e-post. Velg «Lagre som PDF» i utskriftsvinduet for en PDF.</p>
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

      {groups.map((g, gi) => {
        const dates = [...new Set(g.rows.map((r) => r.work_date))];
        return (
          <article key={g.site?.id ?? "none"} className={`card print:border-0 print:p-0 ${gi > 0 ? "print:break-before-page" : ""}`} aria-label={`Personalliste ${g.site?.name ?? ""} ${range}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
              <div>
                <div className="text-lg font-bold">{h.name}</div>
                <div className="text-sm">Org.nr. {h.org_number ? h.org_number.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3") : "–"}</div>
                {g.site ? (
                  <div className="text-sm"><b>Arbeidssted: {g.site.name}</b>{g.site.address ? `, ${g.site.address}` : ""}</div>
                ) : sites.length > 0 ? (
                  <div className="text-sm"><b>Uten fast arbeidssted</b></div>
                ) : (h.address || h.city) && (
                  <div className="text-sm text-muted">{[h.address, [h.postal_code, h.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</div>
                )}
              </div>
              <div className="text-right">
                <div className="text-lg font-bold first-letter:uppercase">Personalliste {range}</div>
                <div className="text-sm text-muted">
                  {gi === 0 && groups.length === 1 ? <>{people} {people === 1 ? "person" : "personer"}{single && date === today ? ` · ${inside} inne nå` : ""}</> : `${new Set(g.rows.filter((r) => !r.deleted).map((r) => r.employee_id)).size} personer`}
                </div>
                <div className="text-xs text-muted">Vist {new Date().toLocaleString("nb-NO", { timeZone: tz, dateStyle: "short", timeStyle: "short" })}</div>
              </div>
            </div>

            {g.rows.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Ingen har registrert arbeidstid {single ? "denne dagen" : "i perioden"}.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="py-2 pr-3">Kode</th>
                      <th className="py-2 pr-3">Navn</th>
                      <th className="py-2 pr-3">Inn</th>
                      <th className="py-2 pr-3">Ut</th>
                      <th className="py-2">Merknad</th>
                    </tr>
                  </thead>
                  {dates.map((d) => (
                    <tbody key={d}>
                      {!single && (
                        <tr className="border-b border-line bg-paper print:bg-transparent">
                          <th colSpan={5} className="py-1.5 pl-2 text-left text-sm font-semibold first-letter:uppercase">{formatDateLong(d)} {d.slice(0, 4)}</th>
                        </tr>
                      )}
                      {g.rows.filter((r) => r.work_date === d).map((r) => {
                        const notes = rowNotes(r, tz);
                        return (
                          <tr key={r.entry_id} className={`border-b border-line align-top ${r.deleted ? "text-muted" : ""}`}>
                            <td className="py-2 pr-3 font-mono">{r.employee_number ?? "–"}</td>
                            <td className={`py-2 pr-3 font-medium ${r.deleted ? "line-through" : ""}`}>
                              {r.full_name}{WORKER_LABEL[r.worker_type] && <span className="ml-1 text-xs font-normal text-muted">({WORKER_LABEL[r.worker_type]})</span>}
                            </td>
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
                  ))}
                </table>
              </div>
            )}

            <p className="mt-4 text-xs text-muted">{PL_RETENTION_NOTE}</p>
          </article>
        );
      })}
    </div>
  );
}
