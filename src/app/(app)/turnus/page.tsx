import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { colleagues } from "@/lib/data";
import { localDate, addDays, isoWeekday } from "@/lib/time";
import { ActionForm, Field } from "@/components/Form";
import { addRotationShift, applyRotation, createRotation, deleteRotation, deleteRotationShift } from "./actions";

const WD = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const hm = (t: string) => t.slice(0, 5);

export default async function RotationPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const ctx = await requireAdmin();
  const today = localDate(new Date(), ctx.org.timezone);
  const nextMonday = addDays(today, 8 - isoWeekday(today));
  const [{ data: rotations }, names, { data: roles }] = await Promise.all([
    ctx.supabase.from("rotations").select("id, name, weeks").eq("org_id", ctx.org.id).order("name"),
    colleagues(ctx),
    ctx.supabase.from("work_roles").select("id, name").eq("org_id", ctx.org.id).order("sort_order"),
  ]);
  const current = (rotations ?? []).find((r) => r.id === id) ?? null;
  const { data: rows } = current
    ? await ctx.supabase.from("rotation_shifts").select("*").eq("rotation_id", current.id).order("week_index").order("weekday").order("start_time")
    : { data: [] };
  const people = Array.from(names, ([pid, name]) => ({ id: pid, name }));
  const roleName = new Map((roles ?? []).map((r) => [r.id, r.name]));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">Fast turnus</h1>
        <Link href="/vaktplan/rediger" className="btn-ghost">Til vaktplanen</Link>
      </header>
      <p className="text-sm text-muted">Lag et fast mønster som gjentas, for eksempel annenhver uke. Legg det inn i planen for en periode, og juster enkeltvakter etterpå.</p>

      <section className="card">
        <div className="flex flex-wrap gap-2">
          {(rotations ?? []).map((r) => (
            <Link key={r.id} href={`/turnus?id=${r.id}`} className={`badge px-3 py-1.5 text-sm ${r.id === current?.id ? "bg-brand text-white" : "bg-white text-ink ring-1 ring-line"}`}>
              {r.name} · {r.weeks} {r.weeks === 1 ? "uke" : "uker"}
            </Link>
          ))}
        </div>
        <ActionForm action={createRotation} submitLabel="Ny turnus" className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Navn"><input name="name" required placeholder="F.eks. Vinter 2-ukers" className="input" /></Field>
          <Field label="Antall uker i mønsteret"><input name="weeks" type="number" min={1} max={12} defaultValue={2} className="input w-28" /></Field>
        </ActionForm>
      </section>

      {current && (
        <>
          <section className="card">
            <div className="flex items-baseline justify-between">
              <h2 className="h2">{current.name}</h2>
              <form action={deleteRotation}><input type="hidden" name="id" value={current.id} /><button className="text-sm text-muted hover:text-bad">Slett turnus</button></form>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="py-1 pr-2 font-medium">Uke</th>{WD.map((d) => <th key={d} className="px-1 py-1 font-medium">{d}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {Array.from({ length: current.weeks }, (_, w) => w + 1).map((w) => (
                    <tr key={w}>
                      <td className="py-2 pr-2 align-top font-medium">Uke {w}</td>
                      {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
                        <td key={wd} className="px-1 py-2 align-top">
                          {(rows ?? []).filter((r) => r.week_index === w && r.weekday === wd).map((r) => (
                            <form key={r.id} action={deleteRotationShift} className="mb-1 rounded-md bg-paper px-1.5 py-1 text-xs">
                              <input type="hidden" name="id" value={r.id} />
                              <div className="font-semibold tabular-nums">{hm(r.start_time)}–{hm(r.end_time)}</div>
                              <div className="truncate text-muted">{r.employee_id ? names.get(r.employee_id) : "Ledig"}{r.work_role_id ? ` · ${roleName.get(r.work_role_id)}` : ""}</div>
                              <button className="text-muted hover:text-bad" aria-label="Fjern">fjern</button>
                            </form>
                          ))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="mt-3" open={(rows ?? []).length === 0}>
              <summary className="cursor-pointer text-sm font-semibold text-brand">+ Legg til vakt i mønsteret</summary>
              <ActionForm action={addRotationShift} submitLabel="Legg til" className="mt-3 grid gap-3 md:grid-cols-4">
                <input type="hidden" name="rotation_id" value={current.id} />
                <Field label="Uke i mønsteret">
                  <select name="week_index" className="input">{Array.from({ length: current.weeks }, (_, i) => <option key={i} value={i + 1}>Uke {i + 1}</option>)}</select>
                </Field>
                <Field label="Fra"><input name="start" type="time" required defaultValue="08:00" className="input" /></Field>
                <Field label="Til"><input name="end" type="time" required defaultValue="16:00" className="input" /></Field>
                <Field label="Pause (min)"><input name="break_minutes" type="number" min={0} step={5} defaultValue={30} className="input" /></Field>
                <Field label="Ansatt">
                  <select name="employee_id" className="input" defaultValue=""><option value="">Ledig vakt</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                </Field>
                <Field label="Arbeidsrolle">
                  <select name="work_role_id" className="input" defaultValue=""><option value="">Ingen</option>{(roles ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                </Field>
                <fieldset className="md:col-span-4">
                  <legend className="label">Ukedager</legend>
                  <div className="flex flex-wrap gap-2">
                    {WD.map((n, i) => (
                      <label key={n} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm">
                        <input type="checkbox" name="weekday" value={i + 1} defaultChecked={i < 5} className="h-4 w-4" /> {n}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </ActionForm>
            </details>
          </section>

          <section className="card">
            <h2 className="h2">Legg turnusen inn i vaktplanen</h2>
            <p className="mt-1 text-sm text-muted">Uke 1 i mønsteret starter mandagen i den uka du velger. Vaktene lages som utkast, og vakter som overlapper med eksisterende hoppes over.</p>
            <ActionForm action={applyRotation} submitLabel="Legg inn" className="mt-3 grid gap-3 md:grid-cols-3">
              <input type="hidden" name="rotation_id" value={current.id} />
              <Field label="Fra"><input name="from" type="date" required defaultValue={nextMonday} className="input" /></Field>
              <Field label="Til"><input name="to" type="date" required defaultValue={addDays(nextMonday, 7 * current.weeks * 4 - 1)} className="input" /></Field>
              <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" name="skip_holidays" defaultChecked className="h-4 w-4" /> Hopp over helligdager</label>
            </ActionForm>
          </section>
        </>
      )}
    </div>
  );
}
