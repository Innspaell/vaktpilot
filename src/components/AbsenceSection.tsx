import type { AppContext } from "@/lib/context";
import { colleagues } from "@/lib/data";
import { formatDateLong, localDate, addDays } from "@/lib/time";
import { workdaysBetween } from "@/lib/absence";
import { ActionForm, Field } from "./Form";
import { VacationOverview } from "./VacationOverview";
import { cancelAbsence, decideAbsence, registerAbsence, requestAbsence } from "@/app/(app)/foresporsler/absence-actions";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

const STATUS: Record<string, [string, string]> = {
  pending: ["Venter", "bg-warn-soft text-warn"],
  approved: ["Godkjent", "bg-good-soft text-good"],
  rejected: ["Avslått", "bg-bad-soft text-bad"],
  cancelled: ["Trukket", "bg-paper text-muted"],
};

type Row = {
  id: string; employee_id: string; from_date: string; to_date: string; partial_hours: number | null;
  status: string; comment: string | null; absence_types: { name: string; key: string; is_sick: boolean } | null;
};

function range(r: { from_date: string; to_date: string; partial_hours: number | null }) {
  if (r.from_date === r.to_date) {
    return `${formatDateLong(r.from_date)}${r.partial_hours ? `, ${String(r.partial_hours).replace(".", ",")} t` : ""}`;
  }
  return `${formatDateLong(r.from_date)} – ${formatDateLong(r.to_date)}`;
}

export async function AbsenceSection({ ctx }: { ctx: Ctx }) {
  const today = localDate(new Date(), ctx.org.timezone);
  let q = ctx.supabase
    .from("absence_requests")
    .select("id, employee_id, from_date, to_date, partial_hours, status, comment, absence_types(name, key, is_sick)")
    .eq("org_id", ctx.org.id)
    .order("from_date", { ascending: false })
    .limit(60);
  if (!ctx.isAdmin) q = q.eq("employee_id", ctx.employeeId ?? "");

  const [{ data }, { data: types }, names] = await Promise.all([
    q,
    ctx.supabase.from("absence_types").select("id, name, key, is_sick, needs_approval, unit").eq("org_id", ctx.org.id).order("name"),
    colleagues(ctx),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const pending = rows.filter((r) => r.status === "pending");
  const upcoming = rows.filter((r) => r.status === "approved" && r.to_date >= today).reverse();
  const history = rows.filter((r) => !pending.includes(r) && !upcoming.includes(r)).slice(0, 15);
  const typeOptions = (types ?? []).map((t) => (
    <option key={t.id} value={t.id}>{t.name}{t.needs_approval ? "" : " (registreres uten godkjenning)"}</option>
  ));
  const people = Array.from(names, ([id, name]) => ({ id, name }));

  // Vakter som kolliderer med ventende søknader (for administrator)
  const conflicts = new Map<string, number>();
  if (ctx.isAdmin && pending.length) {
    const minFrom = pending.reduce((m, r) => (r.from_date < m ? r.from_date : m), pending[0].from_date);
    const maxTo = pending.reduce((m, r) => (r.to_date > m ? r.to_date : m), pending[0].to_date);
    const { data: shifts } = await ctx.supabase.from("shifts").select("employee_id, starts_at")
      .eq("org_id", ctx.org.id).neq("status", "cancelled").not("employee_id", "is", null)
      .gte("starts_at", new Date(Date.parse(minFrom) - 86400000).toISOString())
      .lt("starts_at", new Date(Date.parse(addDays(maxTo, 2))).toISOString());
    for (const r of pending) {
      const n = (shifts ?? []).filter((s) => {
        const d = localDate(new Date(s.starts_at), ctx.org.timezone);
        return s.employee_id === r.employee_id && d >= r.from_date && d <= r.to_date;
      }).length;
      if (n) conflicts.set(r.id, n);
    }
  }

  return (
    <div className="space-y-4">
      {ctx.employeeId && <VacationOverview ctx={ctx} employeeId={ctx.employeeId} />}

      {ctx.employeeId && (
        <section className="card">
          <h2 className="h2">Søk om fri</h2>
          <p className="mt-1 text-sm text-muted">Ferie, avspasering eller annen fri fram i tid. Sykefravær registreres uten godkjenning, og du skal ikke oppgi årsak.</p>
          <ActionForm action={requestAbsence} submitLabel="Send" className="mt-3 grid gap-3 md:grid-cols-4">
            <Field label="Type"><select name="absence_type_id" required className="input">{typeOptions}</select></Field>
            <Field label="Fra"><input name="from_date" type="date" required min={today} defaultValue={today} className="input" /></Field>
            <Field label="Til"><input name="to_date" type="date" required min={today} defaultValue={today} className="input" /></Field>
            <Field label="Timer (deler av dag)" hint="Tomt = hele dager."><input name="partial_hours" type="number" step="0.5" min="0.5" max="12" className="input" /></Field>
            <div className="md:col-span-4"><Field label="Kommentar (valgfritt)"><input name="comment" className="input" /></Field></div>
          </ActionForm>
        </section>
      )}

      {ctx.isAdmin && (
        <section className="card">
          <h2 className="h2">Registrer fravær for en ansatt</h2>
          <ActionForm action={registerAbsence} submitLabel="Registrer" className="mt-3 grid gap-3 md:grid-cols-4">
            <Field label="Ansatt">
              <select name="employee_id" required className="input" defaultValue="">
                <option value="" disabled>Velg ansatt</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Type"><select name="absence_type_id" required className="input">{typeOptions}</select></Field>
            <Field label="Fra"><input name="from_date" type="date" required defaultValue={today} className="input" /></Field>
            <Field label="Til"><input name="to_date" type="date" required defaultValue={today} className="input" /></Field>
            <Field label="Timer (deler av dag)"><input name="partial_hours" type="number" step="0.5" min="0.5" max="12" className="input" /></Field>
            <label className="flex items-center gap-2 self-end pb-3 text-sm md:col-span-3">
              <input type="checkbox" name="release_shifts" defaultChecked className="h-4 w-4" /> Gjør vaktene i perioden ledige
            </label>
          </ActionForm>
        </section>
      )}

      <section className="card p-0">
        <h2 className="h2 px-4 pt-4">{ctx.isAdmin ? "Søknader om fri som venter" : "Dine søknader som venter"}</h2>
        {pending.length === 0 ? <p className="p-4 text-sm text-muted">Ingenting venter.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {pending.map((r) => (
              <li key={r.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <div>
                    {ctx.isAdmin && <div className="font-medium">{names.get(r.employee_id)}</div>}
                    <div><b>{r.absence_types?.name}</b>: <span className="capitalize">{range(r)}</span></div>
                    <div className="text-muted">{workdaysBetween(r.from_date, r.to_date)} arbeidsdager</div>
                    {r.comment && <div className="text-muted">«{r.comment}»</div>}
                  </div>
                  {ctx.isAdmin ? (
                    <form action={decideAbsence} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      {conflicts.get(r.id) && (
                        <label className="flex items-center gap-1.5 text-xs">
                          <input type="checkbox" name="release_shifts" defaultChecked className="h-4 w-4" /> Gjør vaktene ledige
                        </label>
                      )}
                      <button name="decision" value="approve" className="btn-primary">Godkjenn</button>
                      <button name="decision" value="reject" className="btn-ghost">Avslå</button>
                    </form>
                  ) : (
                    <form action={cancelAbsence}><input type="hidden" name="id" value={r.id} /><button className="btn-ghost">Trekk</button></form>
                  )}
                </div>
                {conflicts.get(r.id) && (
                  <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                    ⚠ {names.get(r.employee_id)} har {conflicts.get(r.id)} {conflicts.get(r.id) === 1 ? "vakt" : "vakter"} i denne perioden.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="card p-0">
          <h2 className="h2 px-4 pt-4">Kommende fravær</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {upcoming.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>{ctx.isAdmin && <b>{names.get(r.employee_id)} · </b>}{r.absence_types?.name}: <span className="capitalize">{range(r)}</span></span>
                <span className="badge bg-good-soft text-good">Godkjent</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <details className="card">
          <summary className="h2 cursor-pointer">Tidligere</summary>
          <ul className="mt-2 divide-y divide-line text-sm">
            {history.map((r) => {
              const [label, cls] = STATUS[r.status];
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{ctx.isAdmin && <b>{names.get(r.employee_id)} · </b>}{r.absence_types?.name}: <span className="capitalize">{range(r)}</span></span>
                  <span className={`badge ${cls}`}>{label}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}

