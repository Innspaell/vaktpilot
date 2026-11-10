import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext, ORG_COOKIE } from "@/lib/context";
import { DPA_VERSION } from "@/lib/legal";

async function savePrices(fd: FormData) {
  "use server";
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return;
  const n = (k: string) => Math.max(0, Number(String(fd.get(k) ?? "0").replace(",", ".")) || 0);
  await ctx.supabase.from("platform_settings").update({ base_price: n("base"), per_employee_price: n("per"), updated_at: new Date().toISOString() }).eq("id", 1);
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
  const [{ data: orgs, error }, { data: settings }] = await Promise.all([
    ctx.supabase.rpc("platform_overview"),
    ctx.supabase.from("platform_settings").select("base_price, per_employee_price").eq("id", 1).maybeSingle(),
  ]);
  type Row = { org_id: string; name: string; org_number: string | null; active: boolean; created_at: string; employees: number; logged_in: number;
    admins: number; shifts_30d: number; entries_30d: number; last_activity: string | null; dpa_version: string | null; dpa_at: string | null };
  const rows = (orgs ?? []) as Row[];
  const base = Number(settings?.base_price ?? 0);
  const per = Number(settings?.per_employee_price ?? 0);
  const kr = (n: number) => n.toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });
  const activeRows = rows.filter((r) => r.active);
  const monthly = activeRows.reduce((s, r) => s + base + per * r.employees, 0);
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
        <Kpi label="Ansatte totalt" value={String(activeRows.reduce((s, r) => s + r.employees, 0))} />
        <Kpi label="Har logget inn" value={String(activeRows.reduce((s, r) => s + r.logged_in, 0))} />
        <Kpi label="Månedlig inntekt (estimat)" value={kr(monthly)} />
      </section>

      <section className="card">
        <h2 className="h2">Pris</h2>
        <form action={savePrices} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block"><span className="label">Fast per bedrift / mnd (kr)</span><input name="base" type="number" min={0} step="1" defaultValue={base} className="input w-40" /></label>
          <label className="block"><span className="label">Per aktiv ansatt / mnd (kr)</span><input name="per" type="number" min={0} step="1" defaultValue={per} className="input w-40" /></label>
          <button className="btn-ghost">Lagre</button>
        </form>
        <p className="mt-2 text-xs text-muted">Aktive ansatte = ansattkort uten passert sluttdato. Grunnlag for fakturering, for eksempel i Fiken.</p>
      </section>

      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Bedrift</th>
              <th className="px-2 py-2 text-right font-medium">Ansatte</th>
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
                <td className="px-2 py-2 text-right tabular-nums">{r.active ? kr(base + per * r.employees) : "–"}</td>
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
