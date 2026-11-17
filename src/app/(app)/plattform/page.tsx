import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext, ORG_COOKIE } from "@/lib/context";
import { DPA_VERSION } from "@/lib/legal";
import { currentMonth, monthLabel, type UsageMonth } from "@/lib/usage";

async function savePrices(fd: FormData) {
  "use server";
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return;
  const n = (k: string) => Math.max(0, Number(String(fd.get(k) ?? "0").replace(",", ".")) || 0);
  await ctx.supabase.from("platform_settings").update({
    base_price: n("base"), per_employee_price: n("per"), included_employees: Math.round(n("incl")), updated_at: new Date().toISOString(),
  }).eq("id", 1);
  await ctx.supabase.rpc("run_usage_now");
  revalidatePath("/plattform");
}

async function saveSignup(fd: FormData) {
  "use server";
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return;
  await ctx.supabase.rpc("platform_set_signup", {
    p_open: fd.get("open") === "on",
    p_trial_days: Math.round(Number(fd.get("trial") ?? 30) || 0),
    p_lock_months: Math.round(Number(fd.get("lock") ?? 12) || 0),
    p_annual_months: Math.round(Number(fd.get("annual") ?? 10) || 0),
  });
  revalidatePath("/plattform");
  revalidatePath("/start");
}

async function resolveError(fd: FormData) {
  "use server";
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return;
  const id = String(fd.get("id") ?? "");
  const q = ctx.supabase.from("app_errors").update({ resolved_at: new Date().toISOString() });
  await (id === "alle" ? q.is("resolved_at", null) : q.eq("id", id));
  revalidatePath("/plattform");
}

async function resetMfaByEmail(fd: FormData) {
  "use server";
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return;
  await ctx.supabase.rpc("platform_reset_mfa_by_email", { p_email: String(fd.get("email") ?? "") });
  revalidatePath("/plattform");
}

async function saveOrgPrice(fd: FormData) {
  "use server";
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return;
  const v = (k: string) => {
    const t = String(fd.get(k) ?? "").trim().replace(",", ".");
    return t === "" ? null : Math.max(0, Number(t) || 0);
  };
  const incl = v("incl");
  const until = String(fd.get("until") ?? "").trim();
  await ctx.supabase.rpc("platform_set_org_price", {
    p_org: String(fd.get("org")), p_base: v("base"), p_included: incl === null ? null : Math.round(incl), p_per: v("per"),
    p_locked_until: /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : null,
  });
  revalidatePath("/plattform");
}

async function setActive(fd: FormData) {
  "use server";
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return;
  await ctx.supabase.rpc("platform_set_active", { p_org: String(fd.get("org")), p_active: fd.get("active") === "1" });
  revalidatePath("/plattform");
}

async function joinOrg(fd: FormData) {
  "use server";
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return;
  const org = String(fd.get("org"));
  const { error } = await ctx.supabase.rpc("platform_join_org", { p_org: org });
  if (!error) (await cookies()).set(ORG_COOKIE, org, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/");
}

export default async function PlatformPage() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) redirect("/");
  const cm = currentMonth();
  const prevMonth = (() => { const [y, m] = cm.split("-").map(Number); return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`; })();
  const [{ data: orgs, error }, { data: settings }, { data: usageRows }, { data: priceRows }] = await Promise.all([
    ctx.supabase.rpc("platform_overview"),
    ctx.supabase.from("platform_settings").select("base_price, per_employee_price, included_employees, signup_open, trial_days, launch_lock_months, annual_months").eq("id", 1).maybeSingle(),
    ctx.supabase.from("usage_months").select("*").in("month", [cm, prevMonth]),
    ctx.supabase.from("organizations").select("id, price_base, price_included, price_per_extra, price_locked_until, trial_ends_at, cancel_requested_at, signup_at"),
  ]);
  const [{ data: emailReady }, { data: invoiceRows }] = await Promise.all([
    ctx.supabase.rpc("email_sending_ready"),
    ctx.supabase.rpc("platform_invoice_basis", { p_month: prevMonth }),
  ]);
  type InvoiceRow = { org_id: string; name: string; org_number: string | null; invoice_email: string | null; active_count: number; included: number;
    extra: number; amount: number; trial: boolean; final: boolean; cancel_requested_at: string | null;
    billing_interval: string; annual_covered: boolean; annual_charge: number; billed_from: string | null };
  const invoice = (invoiceRows ?? []) as InvoiceRow[];
  const invoiceTotal = invoice.reduce((sum, r) => sum + Number(r.amount), 0);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date());
  const { data: errors } = await ctx.supabase.from("app_errors").select("id, source, message, path, count, last_seen, resolved_at")
    .gte("last_seen", new Date(Date.now() - 7 * 86400000).toISOString()).order("last_seen", { ascending: false }).limit(50);
  const { data: capacity } = await ctx.supabase.from("capacity_snapshots")
    .select("taken_at, db_bytes, connections, max_connections, cache_hit_pct, slow_queries, warnings").order("taken_at", { ascending: false }).limit(8);
  const openErrors = (errors ?? []).filter((x) => !x.resolved_at);
  const usage = new Map(((usageRows ?? []) as UsageMonth[]).map((u) => [`${u.org_id}|${u.month}`, u]));
  const custom = new Map((priceRows ?? []).map((p) => [p.id as string, p]));
  type Row = { org_id: string; name: string; org_number: string | null; active: boolean; created_at: string; employees: number; logged_in: number;
    admins: number; shifts_30d: number; entries_30d: number; last_activity: string | null; dpa_version: string | null; dpa_at: string | null };
  const rows = (orgs ?? []) as Row[];
  const base = Number(settings?.base_price ?? 0);
  const per = Number(settings?.per_employee_price ?? 0);
  const incl = Number(settings?.included_employees ?? 5);
  const kr = (n: number) => n.toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });
  const activeRows = rows.filter((r) => r.active);
  const monthly = activeRows.reduce((s, r) => s + Number(usage.get(`${r.org_id}|${cm}`)?.amount ?? base), 0);
  const overCount = activeRows.filter((r) => { const u = usage.get(`${r.org_id}|${cm}`); return u && u.active_count > u.included; }).length;
  const memberOf = new Set(ctx.orgs.map((o) => o.id));
  const fmt = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">Plattform</h1>
        <div className="flex gap-2">
          <Link href="/plattform/lonnsregler" className="btn-ghost">Lønnsregler og tariffer</Link>
          <Link href="/plattform/nettside" className="btn-ghost">Nettsiden</Link>
          <Link href="/ny-bedrift" className="btn-primary">Ny bedrift</Link>
        </div>
      </header>
      {error && <p className="card bg-bad-soft text-sm text-bad">{error.message}</p>}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Aktive bedrifter" value={String(activeRows.length)} />
        <Kpi label={`Aktive ansatte i ${monthLabel(cm).split(" ")[0]}`} value={String(activeRows.reduce((s, r) => s + (usage.get(`${r.org_id}|${cm}`)?.active_count ?? 0), 0))} />
        <Kpi label="Bedrifter over inkludert antall" value={String(overCount)} />
        <Kpi label={`Inntekt ${monthLabel(cm).split(" ")[0]} (estimat)`} value={kr(monthly)} />
      </section>

      <section className="card">
        <h2 className="h2">Pris</h2>
        <form action={savePrices} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block"><span className="label">Fast per bedrift / mnd (kr)</span><input name="base" type="number" min={0} step="1" defaultValue={base} className="input w-40" /></label>
          <label className="block"><span className="label">Aktive ansatte inkludert</span><input name="incl" type="number" min={0} step="1" defaultValue={incl} className="input w-40" /></label>
          <label className="block"><span className="label">Per ekstra aktiv ansatt / mnd (kr)</span><input name="per" type="number" min={0} step="1" defaultValue={per} className="input w-40" /></label>
          <button className="btn-ghost">Lagre</button>
        </form>
        <p className="mt-2 text-xs text-muted">
          Aktiv ansatt = har hatt publisert vakt eller registrert timer i måneden. Tallet oppdateres hver time og låses når måneden er over.
          Standardprisen gjelder alle bedrifter uten egen avtale.
        </p>
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2">Registrering av nye bedrifter</h2>
          <span className={`badge ${settings?.signup_open ? "bg-good-soft text-good" : "bg-paper text-muted"}`}>{settings?.signup_open ? "Åpen" : "Stengt"}</span>
        </div>
        <form action={saveSignup} className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="open" defaultChecked={Boolean(settings?.signup_open)} className="h-4 w-4" />
            Åpen for alle på vaktpilot.no/kom-i-gang
          </label>
          <label className="block"><span className="label">Gratis prøveperiode (dager)</span><input name="trial" type="number" min={0} max={90} defaultValue={settings?.trial_days ?? 30} className="input w-32" /></label>
          <label className="block"><span className="label">Fast lanseringspris (måneder)</span><input name="lock" type="number" min={0} max={36} defaultValue={settings?.launch_lock_months ?? 12} className="input w-32" /></label>
          <label className="block"><span className="label">Årlig betaling: pris for antall måneder</span><input name="annual" type="number" min={0} max={12} defaultValue={settings?.annual_months ?? 10} className="input w-32" /></label>
          <button className="btn-ghost">Lagre</button>
        </form>
        {!emailReady && <p className="mt-2 text-sm text-warn">E-post er ikke satt opp (Resend-nøkkelen mangler), så nye brukere får ikke koden. Innloggede brukere kan registrere seg likevel.</p>}
        <p className="mt-2 text-xs text-muted">
          Du kan teste skjemaet selv på <a href="/kom-i-gang" className="text-brand">/kom-i-gang</a> mens det er stengt. Nye bedrifter får prisen som gjelder nå, fast i antall måneder over (0 = ingen fast pris).
          Prøveperioden er nøyaktig så mange dager; måneden den slutter i faktureres forholdsmessig. Årlig betaling: 0 = ikke tilbudt; 10 = to måneder gratis, og årsprisen kommer på fakturagrunnlaget for årets første måned. Du får varsel når noen registrerer seg eller sier opp.
        </p>
      </section>

      <section className="card overflow-x-auto p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h2 className="h2">Fakturagrunnlag for {monthLabel(prevMonth)}</h2>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">Sum {kr(invoiceTotal)} eks. mva.</span>
            <a href={`/api/plattform/faktura?maned=${prevMonth.slice(0, 7)}`} className="btn-ghost py-1.5">Last ned Excel</a>
          </div>
        </div>
        {invoice.length === 0 ? <p className="px-4 py-4 text-sm text-muted">Ingen bedrifter i denne måneden.</p> : (
          <table className="mt-2 w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Bedrift</th><th className="px-2 py-2 font-medium">Faktura til</th>
              <th className="px-2 py-2 text-right font-medium">Aktive</th><th className="px-2 py-2 text-right font-medium">Ekstra</th>
              <th className="px-4 py-2 text-right font-medium">Beløp</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {invoice.map((r) => (
                <tr key={r.org_id}>
                  <td className="px-4 py-2"><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.org_number ?? "uten orgnr"}</div></td>
                  <td className="px-2 py-2 text-xs">{r.invoice_email ?? <span className="text-warn">mangler</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.active_count} / {r.included}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.extra}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.trial ? <span className="text-muted">Prøveperiode</span> : kr(Number(r.amount))}
                    {Number(r.annual_charge) > 0 ? <span className="block text-xs text-brand">årspris {kr(Number(r.annual_charge))}</span>
                      : r.annual_covered ? <span className="block text-xs text-muted">årlig, betalt</span> : null}
                    {r.billed_from && <span className="block text-xs text-muted">fra {fmt.format(new Date(r.billed_from))}</span>}
                    {!r.final && <span className="block text-xs text-warn">ikke låst ennå</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="px-4 py-3 text-xs text-muted">Grunnlaget låses når måneden er over. Fakturer fra regnskapsprogrammet deres.</p>
      </section>

      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Bedrift</th>
              <th className="px-2 py-2 text-right font-medium">Aktive nå</th>
              <th className="px-2 py-2 text-right font-medium">Forrige mnd</th>
              <th className="px-2 py-2 text-right font-medium">Ansattkort</th>
              <th className="px-2 py-2 text-right font-medium">Logget inn</th>
              <th className="px-2 py-2 text-right font-medium">Vakter 30 d</th>
              <th className="px-2 py-2 text-right font-medium">Timer 30 d</th>
              <th className="px-2 py-2 font-medium">Sist aktiv</th>
              <th className="px-2 py-2 font-medium">Databehandleravtale</th>
              <th className="px-2 py-2 text-right font-medium">Pris / mnd</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.org_id} className={r.active ? "" : "text-muted"}>
                <td className="px-4 py-2">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted">{r.org_number ?? "uten orgnr"} · {custom.get(r.org_id)?.signup_at ? "registrerte seg" : "opprettet"} {fmt.format(new Date(r.created_at))}</div>
                  {(() => {
                    const c = custom.get(r.org_id);
                    return (<div className="mt-1 flex flex-wrap gap-1">
                      {c?.trial_ends_at && c.trial_ends_at > today && <span className="badge bg-good-soft text-good">Prøve til {fmt.format(new Date(c.trial_ends_at))}</span>}
                      {c?.cancel_requested_at && <span className="badge bg-bad-soft text-bad">Sagt opp {fmt.format(new Date(c.cancel_requested_at))}</span>}
                    </div>);
                  })()}
                </td>
                {(() => {
                  const u = usage.get(`${r.org_id}|${cm}`);
                  const p = usage.get(`${r.org_id}|${prevMonth}`);
                  return (<>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {u ? <span className={u.active_count > u.included ? "font-semibold text-warn" : ""}>{u.active_count}<span className="text-xs text-muted"> / {u.included}</span></span> : "–"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{p ? p.active_count : "–"}</td>
                  </>);
                })()}
                <td className="px-2 py-2 text-right tabular-nums">{r.employees}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.logged_in}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.shifts_30d}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.entries_30d}</td>
                <td className="px-2 py-2 text-xs">{r.last_activity ? fmt.format(new Date(r.last_activity)) : "–"}</td>
                <td className="px-2 py-2 text-xs">
                  {r.dpa_version === DPA_VERSION ? <span className="badge bg-good-soft text-good">Godtatt</span>
                    : r.dpa_version ? <span className="badge bg-warn-soft text-warn">Gammel versjon</span>
                    : <span className="badge bg-bad-soft text-bad">Mangler</span>}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {r.active ? kr(Number(usage.get(`${r.org_id}|${cm}`)?.amount ?? base)) : "–"}
                  {(() => {
                    const c = custom.get(r.org_id);
                    const has = c && (c.price_base !== null || c.price_included !== null || c.price_per_extra !== null);
                    return (
                      <details className="mt-1 text-left text-xs">
                        <summary className={`cursor-pointer ${has ? "font-semibold text-brand" : "text-muted"}`}>{has ? (c?.price_locked_until ? `Fast til ${fmt.format(new Date(c.price_locked_until))}` : "Egen avtale") : "Standard"}</summary>
                        <form action={saveOrgPrice} className="mt-2 grid w-48 gap-1">
                          <input type="hidden" name="org" value={r.org_id} />
                          <label>Fast (kr)<input name="base" inputMode="decimal" defaultValue={c?.price_base ?? ""} placeholder={String(base)} className="input py-1" /></label>
                          <label>Inkludert<input name="incl" inputMode="numeric" defaultValue={c?.price_included ?? ""} placeholder={String(incl)} className="input py-1" /></label>
                          <label>Per ekstra (kr)<input name="per" inputMode="decimal" defaultValue={c?.price_per_extra ?? ""} placeholder={String(per)} className="input py-1" /></label>
                          <label>Fast pris til<input name="until" type="date" defaultValue={c?.price_locked_until ?? ""} className="input py-1" /></label>
                          <button className="btn-ghost mt-1 py-1">Lagre</button>
                          <span className="text-muted">Tomt felt = standard.</span>
                        </form>
                      </details>
                    );
                  })()}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    {memberOf.has(r.org_id) ? (
                      <span className="text-xs text-muted">Du er med</span>
                    ) : (
                      <form action={joinOrg}><input type="hidden" name="org" value={r.org_id} /><button className="text-xs font-semibold text-brand" title="Gir deg administratortilgang. Logges.">Gå inn</button></form>
                    )}
                    <form action={setActive}>
                      <input type="hidden" name="org" value={r.org_id} />
                      <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                      <button className={`text-xs ${r.active ? "text-muted hover:text-bad" : "text-good"}`}>{r.active ? "Deaktiver" : "Aktiver"}</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-muted">«Gå inn» gir deg administratortilgang i bedriften for support, og registreres i bedriftens endringslogg. En deaktivert bedrift får ikke påminnelser eller kalender.</p>

      <section id="kapasitet" className="card scroll-mt-20">
        <h2 className="h2">Kapasitet (databasen)</h2>
        <p className="mt-1 text-xs text-muted">
          Måles hver mandag morgen. Du får varsel når noe nærmer seg grensen for maskinen dere har (Micro: 1 GB minne, 60 tilkoblinger, 8 GB disk inkludert).
          Prosessor og minne i detalj: Supabase › Reports › Database.
        </p>
        {(capacity ?? []).length === 0 ? <p className="mt-2 text-sm text-muted">Første måling kommer mandag.</p> : (
          <>
            {(capacity![0].warnings as string[]).length > 0
              ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-warn">{(capacity![0].warnings as string[]).map((w) => <li key={w}>{w}</li>)}</ul>
              : <p className="mt-2 text-sm text-good">Alt innenfor. Ingen grunn til å bytte maskin.</p>}
            <table className="mt-3 w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-1 font-medium">Uke</th><th className="py-1 text-right font-medium">Database</th>
                <th className="py-1 text-right font-medium">Tilkoblinger</th><th className="py-1 text-right font-medium">Treff i minnet</th>
                <th className="py-1 text-right font-medium">Trege spørringer</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {capacity!.map((c) => (
                  <tr key={c.taken_at}>
                    <td className="py-1">{new Date(c.taken_at).toLocaleDateString("nb-NO", { timeZone: "Europe/Oslo" })}</td>
                    <td className="py-1 text-right tabular-nums">{(Number(c.db_bytes) / 1024 / 1024).toLocaleString("nb-NO", { maximumFractionDigits: 0 })} MB</td>
                    <td className="py-1 text-right tabular-nums">{c.connections} / {c.max_connections}</td>
                    <td className="py-1 text-right tabular-nums">{c.cache_hit_pct !== null ? `${Number(c.cache_hit_pct).toLocaleString("nb-NO")} %` : "–"}</td>
                    <td className="py-1 text-right tabular-nums">{(c.slow_queries as unknown[]).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(capacity![0].slow_queries as { query: string; mean_ms: number; calls: number }[]).length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-brand">Trege spørringer</summary>
                <ul className="mt-1 space-y-1">
                  {(capacity![0].slow_queries as { query: string; mean_ms: number; calls: number }[]).map((q) => (
                    <li key={q.query}><code className="break-all">{q.query}</code> · {q.mean_ms} ms i snitt · {q.calls} ganger</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      <section id="feil" className="card scroll-mt-20">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2">Feil siste 7 dager</h2>
          {openErrors.length > 0 && <form action={resolveError}><input type="hidden" name="id" value="alle" /><button className="text-xs text-brand">Marker alle som løst</button></form>}
        </div>
        <p className="mt-1 text-xs text-muted">
          Feil fra appen og de faste jobbene. Du får varsel når en ny feil dukker opp. Oppetid: la en tjeneste som UptimeRobot sjekke https://vaktpilot.no/api/helse hvert 5. minutt.
        </p>
        {(errors ?? []).length === 0 ? <p className="mt-2 text-sm text-good">Ingen feil.</p> : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {(errors ?? []).map((x) => (
              <li key={x.id} className={`flex flex-wrap items-start justify-between gap-2 py-2 ${x.resolved_at ? "opacity-50" : ""}`}>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{x.message}</span>
                  <span className="block text-xs text-muted">
                    {x.source} · {x.path ?? "–"} · {x.count} gang{x.count === 1 ? "" : "er"} · sist {new Date(x.last_seen).toLocaleString("nb-NO", { timeZone: "Europe/Oslo" })}
                  </span>
                </span>
                {!x.resolved_at && <form action={resolveError}><input type="hidden" name="id" value={x.id} /><button className="text-xs text-brand">Løst</button></form>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="h2">Nullstill tofaktor</h2>
        <p className="mt-1 text-sm text-muted">For en leder som har mistet mobilen. Sjekk at det er riktig person (ring tilbake på kjent nummer) før du nullstiller. Brukeren setter opp tofaktor på nytt ved neste innlogging. Logges.</p>
        <form action={resetMfaByEmail} className="mt-3 flex flex-wrap gap-2">
          <input name="email" type="email" required placeholder="E-postadressen til lederen" className="input flex-1" />
          <button className="btn-ghost">Nullstill</button>
        </form>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="card"><div className="text-xs text-muted">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value}</div></div>;
}
