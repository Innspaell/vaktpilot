import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { CompanyLookup } from "@/components/CompanyLookup";
import { addWorkRole, deleteWorkRole, moveWorkRole, removeLogo, updateOrganization, uploadLogo } from "../actions";

export default async function SettingsPage() {
  const ctx = await requireAdmin();
  const [{ data: org }, { data: roles }, { data: absenceTypes }] = await Promise.all([
    ctx.supabase.from("organizations").select("*").eq("id", ctx.org.id).single(),
    ctx.supabase.from("work_roles").select("id, name, color, sort_order").eq("org_id", ctx.org.id).order("sort_order").order("name"),
    ctx.supabase.from("absence_types").select("id, name, paid, is_sick, unit").eq("org_id", ctx.org.id).order("name"),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="h1">Innstillinger</h1>
      <Link href="/innstillinger/personvern" className="card flex items-center justify-between hover:border-brand">
        <span><b>Personvern og databehandleravtale</b><span className="block text-sm text-muted">Godta avtalen, last ned alle data, se sletterutiner</span></span>
        <span className="text-brand">›</span>
      </Link>
      <Link href="/innstillinger/varsler" className="card flex items-center justify-between hover:border-brand">
        <span><b>Varsler</b><span className="block text-sm text-muted">Velg hva ansatte og ledere skal få beskjed om</span></span>
        <span className="text-brand">›</span>
      </Link>

      <section className="card">
        <h2 className="h2">Bedrift</h2>
        <ActionForm action={updateOrganization} className="mt-4 grid gap-4 md:grid-cols-2">
          <CompanyLookup defaultName={org?.name ?? ""} defaultOrgNumber={org?.org_number ?? ""} defaultAddress={org?.address ?? ""}
            defaultPostalCode={org?.postal_code ?? ""} defaultCity={org?.city ?? ""} />
          <Field label="Heltid, timer per uke"><input name="full_time_hours_week" type="number" step="0.25" defaultValue={Number(org?.full_time_hours_week)} className="input" /></Field>
          <fieldset className="space-y-2 md:col-span-2">
            <legend className="label">Når kan jeg jobbe</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="availability_enabled" defaultChecked={org?.availability_enabled ?? false} className="mt-0.5 h-4 w-4" />
              <span>Ansatte kan si fra om når de kan jobbe
                <span className="block text-xs text-muted">Nyttig med mange på tilkalling eller ekstrahjelp. Du velger hvem det gjelder på siden til hver ansatt. Autoplanen og varsler om ledige vakter tar hensyn til det.</span>
              </span>
            </label>
          </fieldset>
          <fieldset className="space-y-2 md:col-span-2">
            <legend className="label">Ferie</legend>
            <p className="text-xs text-muted">Ferieloven gir 4 uker og 1 dag. Feriedagene regnes ut per ansatt fra hvor mange dager i uka de jobber. Fra året man fyller 60 kommer én ekstra uke.</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="vacation_fifth_week" defaultChecked={org?.vacation_fifth_week ?? true} className="mt-0.5 h-4 w-4" />
              <span>Avtalefestet femte ferieuke (tariff)<span className="block text-xs text-muted">Gir 5 uker i alt. Gjelder bedrifter med tariffavtale, som Bilutleieoverenskomsten.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="vacation_fifth_week_transferable" defaultChecked={org?.vacation_fifth_week_transferable ?? false} className="mt-0.5 h-4 w-4" />
              <span>Avtalefestet ferie kan også overføres til neste år<span className="block text-xs text-muted">Kryss bare av hvis tariffavtalen tillater det. Ellers gjelder lovens grense på 2 uker (12 virkedager).</span></span>
            </label>
          </fieldset>
          <Field label="Bemanning telles per">
            <select name="staffing_slot_minutes" defaultValue={org?.staffing_slot_minutes} className="input">
              <option value={15}>15 minutter</option>
              <option value={30}>30 minutter</option>
              <option value={60}>time</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-3 text-sm">
            <input type="checkbox" name="auto_submit_clock_entries" defaultChecked={org?.auto_submit_clock_entries} className="h-4 w-4" />
            Send inn stemplede timer automatisk
          </label>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="h2">Logo</h2>
        <p className="mt-1 text-sm text-muted">Vises øverst i appen for alle i bedriften. PNG med gjennomsiktig bakgrunn blir finest. Maks 2 MB.</p>
        {org?.logo_url && (
          <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-line bg-paper p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={org.logo_url} alt="Logo" className="max-h-16 w-auto object-contain" />
            <form action={removeLogo}><button className="btn-ghost">Fjern logo</button></form>
          </div>
        )}
        <ActionForm action={uploadLogo} submitLabel={org?.logo_url ? "Bytt logo" : "Last opp"} className="mt-3 flex flex-wrap items-end gap-3">
          <input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" required className="text-sm" />
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="h2">Arbeidsroller</h2>
        <p className="mt-1 text-sm text-muted">Brukes i bemanningsbehov og vakter. Rekkefølgen her er rekkefølgen i vaktplanen, øverst først.</p>
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {(roles ?? []).map((r, i) => (
            <li key={r.id} className="flex items-center gap-2 py-1.5 pl-3 pr-1 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
              <span className="flex-1">{r.name}</span>
              <form action={moveWorkRole} className="flex">
                <input type="hidden" name="id" value={r.id} />
                <button name="dir" value="up" disabled={i === 0} className="rounded px-2 py-1 text-muted hover:bg-paper disabled:opacity-30" aria-label={`Flytt ${r.name} opp`}>↑</button>
                <button name="dir" value="down" disabled={i === (roles ?? []).length - 1} className="rounded px-2 py-1 text-muted hover:bg-paper disabled:opacity-30" aria-label={`Flytt ${r.name} ned`}>↓</button>
              </form>
              <form action={deleteWorkRole}>
                <input type="hidden" name="id" value={r.id} />
                <button className="rounded px-2 py-1 text-muted hover:bg-paper hover:text-bad" aria-label={`Slett ${r.name}`}>×</button>
              </form>
            </li>
          ))}
        </ul>
        <ActionForm action={addWorkRole} submitLabel="Legg til rolle" className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Ny rolle"><input name="name" required className="input" /></Field>
          <Field label="Farge"><input name="color" type="color" defaultValue="#1f5fbf" className="h-11 w-16 rounded-lg border border-line" /></Field>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="h2">Fraværstyper</h2>
        <ul className="mt-3 divide-y divide-line text-sm">
          {(absenceTypes ?? []).map((t) => (
            <li key={t.id} className="flex justify-between py-2">
              <span>{t.name}</span>
              <span className="text-muted">{t.paid ? "betalt" : "ubetalt"} · {t.unit === "hour" ? "timer" : "dager"}{t.is_sick ? " · uten godkjenning" : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
