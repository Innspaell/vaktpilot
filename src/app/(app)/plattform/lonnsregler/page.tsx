import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { createRuleSet, handleRequest, markChecked, openAttachment } from "./actions";
import { AREAS } from "@/lib/pay-rules-data";

export default async function PayRulesAdminPage() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) redirect("/");
  const [{ data: sets }, { data: versions }, { data: usage }, { data: requests }, { data: orgs }] = await Promise.all([
    ctx.supabase.from("pay_rule_sets").select("id, key, name, description, kind, org_id, checked_year, area").order("area").order("name"),
    ctx.supabase.from("pay_rule_versions").select("rule_set_id, valid_from, status").order("valid_from", { ascending: false }),
    ctx.supabase.rpc("pay_rule_usage"),
    ctx.supabase.from("pay_rule_requests").select("id, org_id, message, file_path, file_name, status, reply, created_at").order("created_at", { ascending: false }).limit(30),
    ctx.supabase.from("organizations").select("id, name").order("name"),
  ]);
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  type U = { rule_set_id: string; org_id: string; org_name: string };
  const users = (id: string) => ((usage ?? []) as U[]).filter((u) => u.rule_set_id === id);
  const latest = (id: string) => (versions ?? []).find((v) => v.rule_set_id === id)?.valid_from;
  const year = new Date().getFullYear();
  const fmt = (d: string) => d.split("-").reverse().join(".");
  const open = (requests ?? []).filter((r) => r.status === "new");
  const toCheck = (sets ?? []).filter((x) => x.kind === "tariff" && users(x.id).length > 0 && (x.checked_year ?? 0) < year);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/plattform" className="text-sm text-brand">‹ Plattform</Link>
        <h1 className="h1 mt-1">Lønnsregler og tariffer</h1>
        <p className="mt-1 text-sm text-muted">
          Regelsettene bedriftene kan velge under Innstillinger › Lønnsregler. Nye satser legges inn som en ny versjon med datoen de gjelder fra.
          Bedrifter som bruker regelsettet får beskjed.
        </p>
      </div>

      {open.length > 0 && (
        <section className="card border-warn/40">
          <h2 className="h2">Forespørsler fra kunder ({open.length})</h2>
          <ul className="mt-2 divide-y divide-line">
            {open.map((r) => (
              <li key={r.id} className="space-y-2 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><b>{orgName.get(r.org_id) ?? "Ukjent bedrift"}</b><span className="text-xs text-muted">{new Date(r.created_at).toLocaleString("nb-NO")}</span></div>
                {r.message && <p className="whitespace-pre-wrap">{r.message}</p>}
                {r.file_path && (
                  <form action={openAttachment}><input type="hidden" name="path" value={r.file_path} /><button className="text-brand">📎 {r.file_name ?? "Vedlegg"}</button></form>
                )}
                <form action={handleRequest} className="flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input name="reply" placeholder="Svar til kunden (valgfritt), f.eks. «Reiselivsoverenskomsten er lagt inn»" className="input flex-1" />
                  <button className="btn-ghost">Marker som behandlet</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {toCheck.length > 0 && (
        <section className="card">
          <h2 className="h2">Til kontroll i {year}</h2>
          <p className="mt-1 text-sm text-muted">Tariffer i bruk som ikke er kontrollert etter årets lønnsoppgjør. Påminnelse kommer 15. juni.</p>
          <ul className="mt-2 divide-y divide-line text-sm">
            {toCheck.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><Link href={`/plattform/lonnsregler/${x.id}`} className="font-medium text-brand">{x.name}</Link> · satser fra {latest(x.id) ? fmt(latest(x.id)!) : "–"}</span>
                <form action={markChecked}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="year" value={year} /><button className="btn-ghost py-1 text-xs">Kontrollert, ingen endring</button></form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-0">
        <ul className="divide-y divide-line">
          {(sets ?? []).map((x) => {
            const u = users(x.id);
            return (
              <li key={x.id}>
                <Link href={`/plattform/lonnsregler/${x.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-paper">
                  <span className="min-w-0">
                    <span className="block font-medium">{x.name}</span>
                    <span className="block text-xs text-muted">
                      {AREAS[x.area ?? "ingen"]} · {x.kind === "law" ? "Lov" : x.org_id ? `Egen avtale for ${orgName.get(x.org_id) ?? "bedrift"}` : "Tariff"}
                      {(versions ?? []).some((v) => v.rule_set_id === x.id && v.status !== "published") ? " · har utkast" : ""}
                      {!(versions ?? []).some((v) => v.rule_set_id === x.id && v.status === "published") ? " · ikke publisert" : ""}
                      {" · "}{latest(x.id) ? `satser fra ${fmt(latest(x.id)!)}` : "ingen satser ennå"}
                      {x.kind === "tariff" && ` · kontrollert ${x.checked_year ?? "aldri"}`}
                    </span>
                  </span>
                  <span className="text-sm text-muted">{u.length ? u.map((z) => z.org_name).join(", ") : "Ikke i bruk"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h2 className="h2">Nytt regelsett</h2>
        <p className="mt-1 text-sm text-muted">Start gjerne med en kopi av det som ligner mest, og endre satsene etterpå.</p>
        <ActionForm action={createRuleSet} submitLabel="Opprett" className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Navn"><input name="name" required placeholder="F.eks. Reiselivsoverenskomsten" className="input" /></Field>
          <Field label="Gjelder for">
            <select name="org_id" className="input" defaultValue="">
              <option value="">Alle bedrifter (felles tariff)</option>
              {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>Bare {o.name} (lokal avtale)</option>)}
            </select>
          </Field>
          <Field label="Kopier satser fra">
            <select name="copy_from" className="input" defaultValue={(sets ?? []).find((x) => x.key === "aml")?.id ?? ""}>
              <option value="">Ingen (tomt)</option>
              {(sets ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Satsene gjelder fra"><input name="valid_from" type="date" className="input" /></Field>
          <Field label="Tariffområde">
            <select name="area" className="input" defaultValue="handel">
              {Object.entries(AREAS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <div className="md:col-span-2"><Field label="Beskrivelse"><input name="description" placeholder="Partene, hvem den gjelder for" className="input" /></Field></div>
        </ActionForm>
      </section>
    </div>
  );
}
