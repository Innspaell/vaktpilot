import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlanner, type AppContext } from "@/lib/context";
import { EmergencyContacts, type EmergencyContact } from "@/components/EmergencyContacts";
import { ActionForm, Field } from "@/components/Form";
import { addTerms, createLoginInvite, resetEmployeeMfa, setEmployeeLogin, setMemberRole, updateEmployee } from "../../actions";
import { LoginSetup } from "@/components/LoginSetup";
import { TermsDateField } from "@/components/TermsDateField";
import { VacationOverview } from "@/components/VacationOverview";
import { loginStatus, TONE_CLASS, type LoginStatusRow } from "@/lib/login-status";

const nb = (n: unknown) => Number(n ?? 0).toLocaleString("nb-NO");
const dateNo = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ny?: string }> }) {
  const { id } = await params;
  const { ny } = await searchParams;
  const ctx = await requirePlanner();
  if (!ctx.isAdmin) return <ManagerView ctx={ctx} id={id} />;

  const { data: kin } = await ctx.supabase.from("emergency_contacts").select("id, name, relation, phone").eq("employee_id", id).order("sort_order").order("created_at");
  const [{ data: e }, { data: terms }, { data: roles }, { data: myRoles }, { data: statusRows }, { data: ruleSets }] = await Promise.all([
    ctx.supabase.from("employees").select("*").eq("id", id).eq("org_id", ctx.org.id).maybeSingle(),
    ctx.supabase.from("employment_terms").select("*").eq("employee_id", id).order("valid_from", { ascending: false }),
    ctx.supabase.from("work_roles").select("id, name").eq("org_id", ctx.org.id).order("name"),
    ctx.supabase.from("employee_work_roles").select("work_role_id").eq("employee_id", id),
    ctx.supabase.rpc("employees_login_status", { p_org: ctx.org.id }),
    ctx.supabase.from("pay_rule_sets").select("id, name, pay_rule_versions!inner(status)").eq("pay_rule_versions.status", "published").order("name"),
  ]);
  if (!e) notFound();
  const { data: mfaRows } = e.user_id ? await ctx.supabase.rpc("users_mfa_status", { p_users: [e.user_id] }) : { data: [] };
  const hasMfa = Boolean((mfaRows as { has_mfa: boolean }[] | null)?.[0]?.has_mfa);
  const ls = loginStatus(e, ((statusRows ?? []) as LoginStatusRow[]).find((r) => r.employee_id === e.id));

  let membershipRole: string | null = null;
  if (e.user_id) {
    const { data: m } = await ctx.supabase.from("memberships").select("role").eq("org_id", ctx.org.id).eq("user_id", e.user_id).maybeSingle();
    membershipRole = m?.role ?? null;
  }
  const has = new Set((myRoles ?? []).map((r) => r.work_role_id));
  const current = (terms ?? []).find((t) => !t.valid_to);

  return (
    <div className="space-y-4">
      <Link href="/ansatte" className="text-sm font-medium text-brand">← Alle ansatte</Link>
      <h1 className="h1">{e.full_name}</h1>
      {ny && (
        <p className="card bg-good-soft text-sm text-good">
          {e.full_name} er lagt til. {e.email ? `Be vedkommende logge inn med ${e.email}.` : "Legg inn e-post så vedkommende kan logge inn."}
        </p>
      )}

      <section className="card">
        <h2 className="h2">Opplysninger</h2>
        <ActionForm action={updateEmployee} className="mt-4 grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={e.id} />
          <Field label="Navn"><input name="full_name" required defaultValue={e.full_name} className="input" /></Field>
          <Field label="E-post"><input name="email" type="email" defaultValue={e.email ?? ""} className="input" /></Field>
          <Field label="Telefon"><input name="phone" type="tel" defaultValue={e.phone ?? ""} className="input" /></Field>
          <Field label="Ansattnummer"><input name="employee_number" defaultValue={e.employee_number ?? ""} className="input" /></Field>
          <Field label="Startdato"><input name="start_date" type="date" defaultValue={e.start_date} className="input" /></Field>
          <Field label="Sluttdato" hint="Tilgangen stenges fra denne datoen.">
            <input name="end_date" type="date" defaultValue={e.end_date ?? ""} className="input" />
          </Field>
          <Field label="Stillingsprosent" hint={current ? `Gjelder avtalen fra ${dateNo(current.valid_from)}. Endring fra en senere dato: bruk «Ny avtale» under.` : undefined}>
            <input name="position_pct" type="number" min={0} max={100} step="0.5" defaultValue={Number(current?.position_pct ?? 100)} className="input" />
          </Field>
          <Field label="Timer per uke" hint="Tomt = regnes ut fra stillingsprosent og heltid.">
            <input name="hours_per_week" type="number" min={0} step="0.25" defaultValue={current ? Number(current.hours_per_week) : ""} className="input" />
          </Field>
          <label className="flex items-start gap-2 text-sm md:col-span-2">
            <input type="checkbox" name="on_call" defaultChecked={Boolean(current?.on_call)} className="mt-0.5 h-4 w-4" />
            <span>Tilkallingsvikar eller ekstrahjelp uten avtalt arbeidstid<span className="block text-xs text-muted">Ingen timer må fylles. Stillingsprosent og timer settes til 0, og timer opp til heltid regnes som ordinære.</span></span>
          </label>
          <Field label="Lønnstype">
            <select name="pay_type" defaultValue={current?.pay_type ?? "hourly"} className="input">
              <option value="hourly">Timelønn</option>
              <option value="fixed">Fastlønn</option>
            </select>
          </Field>
          <Field label="Arbeidsdager i uka" hint="Brukes til å regne om ferien etter ferieloven. Snitt ved varierende uker.">
            <input name="days_per_week" type="number" min={1} max={6} step="0.5" defaultValue={Number(current?.days_per_week ?? 5)} className="input" />
          </Field>
          <Field label="Fødselsår" hint="Valgfritt. Gir ekstra ferieuke fra året den ansatte fyller 60.">
            <input name="birth_year" type="number" min={1940} max={2015} defaultValue={e.birth_year ?? ""} className="input" />
          </Field>
          {ctx.org.availabilityEnabled && (
            <label className="flex items-start gap-2 text-sm md:col-span-2">
              <input type="hidden" name="availability_shown" value="1" />
              <input type="checkbox" name="availability_enabled" defaultChecked={Boolean(e.availability_enabled)} className="mt-0.5 h-4 w-4" />
              <span>Kan si fra om når vedkommende kan jobbe<span className="block text-xs text-muted">For ekstrahjelp og folk på tilkalling. Fast ansatte med fast turnus trenger det sjelden.</span></span>
            </label>
          )}
          <label className="flex items-start gap-2 text-sm md:col-span-2">
            <input type="checkbox" name="auto_plan" defaultChecked={e.auto_plan ?? true} className="mt-0.5 h-4 w-4" />
            <span>Med i automatisk vaktplan<span className="block text-xs text-muted">Slå av for ledelse og andre som ikke skal få vakter automatisk. De kan fortsatt settes opp for hånd.</span></span>
          </label>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" name="is_shift_worker" defaultChecked={e.is_shift_worker} className="h-4 w-4" /> Jobber turnus eller skift
          </label>
          <fieldset className="md:col-span-2">
            <legend className="label">Arbeidsroller</legend>
            {(roles ?? []).length === 0 ? (
              <p className="text-sm text-muted">Ingen roller ennå. <Link href="/innstillinger" className="text-brand">Legg til i innstillinger.</Link></p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(roles ?? []).map((r) => (
                  <label key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                    <input type="checkbox" name="work_roles" value={r.id} defaultChecked={has.has(r.id)} className="h-4 w-4" />
                    {r.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="h2">Avtale</h2>
        {current ? (
          <p className="mt-1 text-sm text-muted">
            Gjelder fra {dateNo(current.valid_from)}: {current.on_call ? "tilkalling, ingen avtalt tid" : `${nb(current.position_pct)} % · ${nb(current.hours_per_week)} t/uke`} ·{" "}
            {current.pay_type === "fixed" ? "fastlønn" : "timelønn"} · {current.paid_holidays ? "betalte helligdager" : "ikke betalte helligdager"} ·{" "}
            {Number(current.days_per_week ?? 5)} arbeidsdager i uka
            {current.pay_rule_set_id ? ` · egen tariff: ${(ruleSets ?? []).find((r) => r.id === current.pay_rule_set_id)?.name ?? "ukjent"}` : ""}
            {current.averaging_weeks ? ` · gjennomsnittsberegning over ${current.averaging_weeks} uker fra ${current.averaging_from}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">Ingen gjeldende avtale.</p>
        )}
        {(terms ?? []).length > 1 && (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line text-sm">
            {(terms ?? []).map((t) => (
              <li key={t.id} className={`flex flex-wrap justify-between gap-2 px-3 py-2 ${t.valid_to ? "text-muted" : ""}`}>
                <span className="tabular-nums">{t.valid_from.split("-").reverse().join(".")} – {t.valid_to ? t.valid_to.split("-").reverse().join(".") : "nå"}</span>
                <span>{t.on_call ? "tilkalling" : `${Number(t.position_pct)} %`} · {t.pay_type === "fixed" ? "fastlønn" : "timelønn"}</span>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-brand">Ny avtale fra en dato</summary>
          <p className="mt-2 text-sm text-muted">Gjeldende avtale avsluttes dagen før. Gamle timelister beregnes fortsatt etter avtalen som gjaldt da. Du kan også legge inn en avtale for en periode før gjeldende avtale, for eksempel timebasis før fast ansettelse.</p>
          <ActionForm action={addTerms} className="mt-4 grid gap-4 md:grid-cols-3">
            <input type="hidden" name="employee_id" value={e.id} />
            <TermsDateField terms={(terms ?? []).map((t) => ({ valid_from: t.valid_from, valid_to: t.valid_to }))} startDate={e.start_date} />
            <Field label="Stillingsprosent"><input name="position_pct" type="number" min={0} max={100} step="0.5" defaultValue={Number(current?.position_pct ?? 100)} className="input" /></Field>
            <Field label="Timer per uke"><input name="hours_per_week" type="number" min={0} step="0.25" defaultValue={Number(current?.hours_per_week ?? 37.5)} className="input" /></Field>
            <Field label="Lønnstype">
              <select name="pay_type" defaultValue={current?.pay_type ?? "hourly"} className="input">
                <option value="hourly">Timelønn</option>
                <option value="fixed">Fastlønn</option>
              </select>
            </Field>
            <Field label="Arbeidsdager i uka" hint="Brukes til ferieberegning."><input name="days_per_week" type="number" min={1} max={6} step="0.5" defaultValue={Number(current?.days_per_week ?? 5)} className="input" /></Field>
            <Field label="Lønnsregler" hint="Bare hvis den ansatte har en annen avtale enn bedriften.">
              <select name="pay_rule_set_id" defaultValue={current?.pay_rule_set_id ?? ""} className="input">
                <option value="">Som bedriften</option>
                {(ruleSets ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Gjennomsnittsberegning (uker)" hint="Skriftlig avtale etter aml. § 10-5. Tomt = nei.">
              <input name="averaging_weeks" type="number" min={2} max={52} defaultValue={current?.averaging_weeks ?? ""} className="input" />
            </Field>
            <Field label="Snitt beregnes fra"><input name="averaging_from" type="date" defaultValue={current?.averaging_from ?? ""} className="input" /></Field>
            <label className="flex items-start gap-2 text-sm md:col-span-3">
            <input type="checkbox" name="on_call" defaultChecked={Boolean(current?.on_call)} className="mt-0.5 h-4 w-4" />
            <span>Tilkallingsvikar eller ekstrahjelp uten avtalt arbeidstid<span className="block text-xs text-muted">Ingen timer må fylles. Stillingsprosent og timer settes til 0, og timer opp til heltid regnes som ordinære.</span></span>
          </label>
            <label className="flex items-start gap-2 self-end pb-3 text-sm md:col-span-3">
              <input type="checkbox" name="paid_holidays" defaultChecked={current?.paid_holidays ?? false} className="mt-0.5 h-4 w-4" />
              <span>Helligdagsgodtgjørelse (timelønn)
                <span className="block text-xs text-muted">Betalt for helligdager på hverdager selv om den ansatte ikke jobber, slik noen tariffavtaler krever. Jobber den ansatte på en helligdag, får vedkommende helligdagstillegg uansett.</span>
              </span>
            </label>
          </ActionForm>
        </details>
        {(terms ?? []).length > 1 && (
          <ul className="mt-4 space-y-1 border-t border-line pt-3 text-sm text-muted">
            {(terms ?? []).filter((t) => t.valid_to).map((t) => (
              <li key={t.id}>{t.valid_from} – {t.valid_to}: {t.on_call ? "tilkalling" : `${Number(t.position_pct)} %`} · {t.pay_type === "fixed" ? "fast" : "time"}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2">Innlogging</h2>
          <span className={`badge ${TONE_CLASS[ls.tone]}`}>{ls.short}</span>
        </div>
        <p className="mt-1 text-sm">{ls.long}</p>
        <p className="mt-1 text-sm text-muted">
          {e.user_id
            ? `${e.full_name} har innlogging${e.email ? ` med ${e.email}` : ""}.${e.must_change_password ? " Har ikke byttet det midlertidige passordet ennå." : ""}`
            : `${e.full_name} har ikke innlogging ennå. Send en lenke der vedkommende lager passordet selv, eller sett et midlertidig passord. E-posten trenger ikke bekreftes.`}
          {" "}Den ansatte kan også logge inn med kode på e-post, hvis e-posten er registrert.
        </p>
        {e.user_id && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Tofaktor:</span>
            <span className={`badge ${hasMfa ? "bg-good-soft text-good" : "bg-paper text-muted"}`}>{hasMfa ? "På" : "Av"}</span>
            {hasMfa && (membershipRole === "employee" || ctx.isPlatformAdmin) && (
              <form action={resetEmployeeMfa}>
                <input type="hidden" name="user_id" value={e.user_id} />
                <input type="hidden" name="employee_id" value={e.id} />
                <button className="text-brand">Nullstill (mistet mobil)</button>
              </form>
            )}
          </div>
        )}
        {membershipRole && membershipRole !== "employee" ? (
          <p className="mt-2 text-sm text-muted">Administratorer setter passord selv under Profil.</p>
        ) : (
          <LoginSetup passwordAction={setEmployeeLogin} inviteAction={createLoginInvite} employeeId={e.id} defaultLogin={e.email ?? ""} hasLogin={Boolean(e.user_id)} />
        )}
      </section>

      <EmergencyContacts contacts={(kin ?? []) as EmergencyContact[]} editable employeeId={e.id}
        intro="Den ansatte legger inn dette selv under Profil og får varsel til minst én er registrert. Du kan også legge inn eller rette her." />

      <div>
        <h2 className="h2 mb-2 px-1">Ferie</h2>
        <VacationOverview ctx={ctx} employeeId={e.id} admin />
      </div>

      {e.user_id && membershipRole && membershipRole !== "owner" && e.user_id !== ctx.userId && (
        <section className="card">
          <h2 className="h2">Tilgang</h2>
          <form action={setMemberRole} className="mt-3 flex flex-wrap items-center gap-3">
            <input type="hidden" name="user_id" value={e.user_id} />
            <select name="role" defaultValue={membershipRole} className="input w-auto">
              <option value="employee">Ansatt</option>
              <option value="manager">Leder</option>
              <option value="admin">Administrator</option>
            </select>
            <button className="btn-ghost">Endre tilgang</button>
          </form>
          <p className="mt-2 text-xs text-muted">
            Leder planlegger vakter, godkjenner timer, fravær og bytter, og ser lønnsgrunnlaget for avdelingene vedkommende har ansvar for
            (velges under Ansatte → Avdelinger). Uten avdelinger gjelder det hele bedriften. Bare administrator endrer innstillinger, ansatte og avtaler, og låser lønn.
          </p>
        </section>
      )}
    </div>
  );
}

/** Lesevisning for ledere: kontaktinfo, avtale og pårørende. Endringer gjøres av administrator. */
async function ManagerView({ ctx, id }: { ctx: AppContext & { org: NonNullable<AppContext["org"]> }; id: string }) {
  const [{ data: e }, { data: term }, { data: kin }, { data: roleRows }] = await Promise.all([
    ctx.supabase.from("employees").select("id, full_name, email, phone, employee_number, start_date, end_date").eq("id", id).eq("org_id", ctx.org.id).maybeSingle(),
    ctx.supabase.from("employment_terms").select("valid_from, position_pct, hours_per_week, on_call, pay_type").eq("employee_id", id).is("valid_to", null).maybeSingle(),
    ctx.supabase.from("emergency_contacts").select("id, name, relation, phone").eq("employee_id", id).order("sort_order").order("created_at"),
    ctx.supabase.from("employee_work_roles").select("work_roles(name)").eq("employee_id", id),
  ]);
  if (!e) notFound();
  const roles = (roleRows ?? []).map((r) => (r.work_roles as unknown as { name: string } | null)?.name).filter(Boolean).join(", ");
  const d = (x: string | null) => (x ? x.split("-").reverse().join(".") : "");
  const rows: [string, React.ReactNode][] = [
    ["E-post", e.email ? <a href={`mailto:${e.email}`} className="text-brand">{e.email}</a> : "–"],
    ["Telefon", e.phone ? <a href={`tel:${e.phone.replace(/\s+/g, "")}`} className="text-brand">{e.phone}</a> : "–"],
    ["Ansattnummer", e.employee_number ?? "–"],
    ["Startdato", d(e.start_date)],
    ...(e.end_date ? [["Sluttdato", d(e.end_date)] as [string, React.ReactNode]] : []),
    ["Roller", roles || "–"],
    ["Stilling", term ? (term.on_call ? "Tilkalling, ingen avtalt arbeidstid" : `${nb(term.position_pct)} % · ${nb(term.hours_per_week)} t/uke`) + ` · ${term.pay_type === "fixed" ? "fastlønn" : "timelønn"}` : "–"],
  ];
  return (
    <div className="space-y-4">
      <Link href="/ansatte" className="text-sm font-medium text-brand">← Alle ansatte</Link>
      <h1 className="h1">{e.full_name}</h1>
      <section className="card">
        <h2 className="h2">Opplysninger</h2>
        <dl className="mt-2 divide-y divide-line text-sm">
          {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>)}
        </dl>
        <p className="mt-2 text-xs text-muted">Endringer i opplysninger og avtale gjøres av administrator.</p>
      </section>
      <EmergencyContacts contacts={(kin ?? []) as EmergencyContact[]} editable={false} />
    </div>
  );
}
