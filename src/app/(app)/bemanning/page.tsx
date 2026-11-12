import { requireAdmin } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { norwegianHolidays } from "@/lib/holidays";
import { formatDateLong } from "@/lib/time";
import { today } from "@/lib/data";
import { addOverride, addShiftTemplate, addTemplate, deleteOverride, deleteShiftTemplate, deleteTemplate, setHolidayOpen } from "./actions";

const WEEKDAYS = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
const hm = (t: string | null) => (t ? t.slice(0, 5) : "");

export default async function StaffingPage() {
  const ctx = await requireAdmin();
  const now = today(ctx);
  const [{ data: templates }, { data: overrides }, { data: roles }, { data: rules }, { data: shiftTemplates }] = await Promise.all([
    ctx.supabase.from("staffing_templates").select("*").eq("org_id", ctx.org.id).order("weekday").order("start_time"),
    ctx.supabase.from("staffing_overrides").select("*").eq("org_id", ctx.org.id).gte("date", now).order("date").order("start_time"),
    ctx.supabase.from("work_roles").select("id, name").eq("org_id", ctx.org.id).order("name"),
    ctx.supabase.from("holiday_rules").select("holiday_key, is_open").eq("org_id", ctx.org.id),
    ctx.supabase.from("shift_templates").select("*").eq("org_id", ctx.org.id).order("start_time"),
  ]);
  const roleName = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const openKeys = new Set((rules ?? []).filter((r) => r.is_open).map((r) => r.holiday_key));
  const year = Number(now.slice(0, 4));
  const holidays = [...norwegianHolidays(year), ...norwegianHolidays(year + 1)].filter((h) => h.date >= now).slice(0, 12);

  const roleSelect = (
    <Field label="Arbeidsrolle">
      <select name="work_role_id" className="input" defaultValue="">
        <option value="">Alle</option>
        {(roles ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </Field>
  );

  return (
    <div className="space-y-4">
      <h1 className="h1">Bemanningsbehov</h1>

      <section className="card">
        <h2 className="h2">Fast behov per ukedag</h2>
        <p className="mt-1 text-sm text-muted">Hvor mange som trengs i hvert tidsrom. Dager uten behov regnes som stengt.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {WEEKDAYS.map((name, i) => {
            const rows = (templates ?? []).filter((t) => t.weekday === i + 1);
            return (
              <div key={name} className="rounded-lg border border-line p-3">
                <div className="text-sm font-semibold">{name}</div>
                {rows.length === 0 ? <div className="text-sm text-muted">Stengt</div> : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {rows.map((t) => (
                      <li key={t.id} className="flex items-center justify-between">
                        <span className="tabular-nums">{hm(t.start_time)}–{hm(t.end_time)}: <b>{t.required}</b> {t.work_role_id ? roleName.get(t.work_role_id) : "ansatte"}</span>
                        <form action={deleteTemplate}><input type="hidden" name="id" value={t.id} /><button className="px-2 text-muted hover:text-bad" aria-label="Slett">×</button></form>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <ActionForm action={addTemplate} submitLabel="Legg til behov" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((n, i) => (
              <label key={n} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm">
                <input type="checkbox" name="weekday" value={i + 1} className="h-4 w-4" defaultChecked={i < 5} /> {n.slice(0, 3)}
              </label>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Fra"><input name="start" type="time" required defaultValue="08:00" className="input" /></Field>
            <Field label="Til"><input name="end" type="time" required defaultValue="16:00" className="input" /></Field>
            <Field label="Antall"><input name="required" type="number" min={0} required defaultValue={2} className="input" /></Field>
            {roleSelect}
          </div>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="h2">Avvik på datoer</h2>
        <p className="mt-1 text-sm text-muted">Erstatter det faste behovet den dagen. Bruk «stengt» for dager dere holder lukket.</p>
        {(overrides ?? []).length > 0 && (
          <ul className="mt-3 divide-y divide-line text-sm">
            {(overrides ?? []).map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2">
                <span className="capitalize">{formatDateLong(o.date)}: {o.closed ? "Stengt" : <span className="tabular-nums">{hm(o.start_time)}–{hm(o.end_time)}, {o.required} {o.work_role_id ? roleName.get(o.work_role_id) : "ansatte"}</span>}</span>
                <form action={deleteOverride}><input type="hidden" name="id" value={o.id} /><button className="px-2 text-muted hover:text-bad" aria-label="Slett">×</button></form>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addOverride} submitLabel="Legg til avvik" className="mt-4 grid gap-3 md:grid-cols-5">
          <Field label="Dato"><input name="date" type="date" required defaultValue={now} className="input" /></Field>
          <Field label="Fra"><input name="start" type="time" className="input" /></Field>
          <Field label="Til"><input name="end" type="time" className="input" /></Field>
          <Field label="Antall"><input name="required" type="number" min={0} defaultValue={1} className="input" /></Field>
          {roleSelect}
          <label className="flex items-center gap-2 text-sm md:col-span-5"><input type="checkbox" name="closed" className="h-4 w-4" /> Stengt hele dagen</label>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="h2">Helligdager</h2>
        <p className="mt-1 text-sm text-muted">Stengt er standard. Åpne en helligdag her, og legg inn behovet som avvik på datoen.</p>
        <ul className="mt-3 divide-y divide-line text-sm">
          {holidays.map((h) => {
            const open = openKeys.has(h.key);
            return (
              <li key={h.date} className="flex items-center justify-between gap-2 py-2">
                <span><span className="capitalize">{formatDateLong(h.date)}</span> <span className="text-muted">· {h.name}</span></span>
                <form action={setHolidayOpen}>
                  <input type="hidden" name="key" value={h.key} />
                  <input type="hidden" name="open" value={open ? "0" : "1"} />
                  <button className={`badge px-3 py-1 ${open ? "bg-good-soft text-good" : "bg-paper text-muted ring-1 ring-line"}`}>{open ? "Åpent" : "Stengt"}</button>
                </form>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">Valget gjelder helligdagen hvert år.</p>
      </section>

      <section className="card">
        <h2 className="h2">Vaktmaler</h2>
        {(shiftTemplates ?? []).length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {(shiftTemplates ?? []).map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-lg border border-line py-1 pl-3 pr-1">
                {t.name} <span className="tabular-nums text-muted">{hm(t.start_time)}–{hm(t.end_time)}</span>
                <form action={deleteShiftTemplate}><input type="hidden" name="id" value={t.id} /><button className="px-2 text-muted hover:text-bad" aria-label="Slett">×</button></form>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addShiftTemplate} submitLabel="Legg til mal" className="mt-4 grid gap-3 md:grid-cols-5">
          <Field label="Navn"><input name="name" required placeholder="Morgen" className="input" /></Field>
          <Field label="Fra"><input name="start" type="time" required defaultValue="08:00" className="input" /></Field>
          <Field label="Til"><input name="end" type="time" required defaultValue="16:00" className="input" /></Field>
          <Field label="Pause (min)"><input name="break_minutes" type="number" min={0} step={5} defaultValue={30} className="input" /></Field>
          {roleSelect}
        </ActionForm>
      </section>
    </div>
  );
}
