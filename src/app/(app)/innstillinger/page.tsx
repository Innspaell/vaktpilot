import { requireAdmin } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { CompanyLookup } from "@/components/CompanyLookup";
import { addWorkRole, deleteWorkRole, updateOrganization } from "../actions";

export default async function SettingsPage() {
  const ctx = await requireAdmin();
  const [{ data: org }, { data: roles }, { data: absenceTypes }] = await Promise.all([
    ctx.supabase.from("organizations").select("*").eq("id", ctx.org.id).single(),
    ctx.supabase.from("work_roles").select("id, name, color").eq("org_id", ctx.org.id).order("name"),
    ctx.supabase.from("absence_types").select("id, name, paid, is_sick, unit").eq("org_id", ctx.org.id).order("name"),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="h1">Innstillinger</h1>

      <section className="card">
        <h2 className="h2">Bedrift</h2>
        <ActionForm action={updateOrganization} className="mt-4 grid gap-4 md:grid-cols-2">
          <CompanyLookup defaultName={org?.name ?? ""} defaultOrgNumber={org?.org_number ?? ""} defaultAddress={org?.address ?? ""}
            defaultPostalCode={org?.postal_code ?? ""} defaultCity={org?.city ?? ""} />
          <Field label="Heltid, timer per uke"><input name="full_time_hours_week" type="number" step="0.25" defaultValue={Number(org?.full_time_hours_week)} className="input" /></Field>
          <Field label="Feriedager per år" hint="Standard for nye ansatte, telt mandag–fredag. 25 = 5 uker.">
            <input name="vacation_days_year" type="number" defaultValue={org?.vacation_days_year} className="input" />
          </Field>
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
        <h2 className="h2">Arbeidsroller</h2>
        <p className="mt-1 text-sm text-muted">Brukes i bemanningsbehov og vakter, for eksempel Kundebehandler.</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {(roles ?? []).map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line py-1 pl-3 pr-1 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
              {r.name}
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
