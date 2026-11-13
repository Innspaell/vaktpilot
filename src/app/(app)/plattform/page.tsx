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
    ctx.supabase.from("platform_settings").select("base_price, per_employee_price, included_employees").eq("id", 1).maybeSingle(),
    ctx.supabase.from("usage_months").select("*").in("month", [cm, prevMonth]),
    ctx.supabase.from("organizations").select("id, price_base, price_included, price_per_extra, price_locked_until"),
  ]);
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
        <Link href="/ny-bedrift" className="btn-primary">Ny bedrift</Link>
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
                  <div className="text-xs text-muted">{r.org_number ?? "uten orgnr"} · opprettet {fmt.format(new Date(r.created_at))}</div>
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
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="card"><div className="text-xs text-muted">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value}</div></div>;
}
