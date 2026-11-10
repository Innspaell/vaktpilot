import type { AppContext } from "@/lib/context";
import { colleagues } from "@/lib/data";
import { formatDateLong, localDate, localTime } from "@/lib/time";
import { ActionForm, Field } from "./Form";
import { cancelSwap, decideSwap, proposeSwap, respondSwap } from "@/app/(app)/foresporsler/swap-actions";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };
type Swap = {
  id: string; shift_id: string; from_employee_id: string; to_employee_id: string | null; status: string; to_accepted: boolean;
  comment: string | null; created_at: string; shifts: { starts_at: string; ends_at: string } | null;
};

export async function SwapSection({ ctx, preselect }: { ctx: Ctx; preselect?: string }) {
  const tz = ctx.org.timezone;
  const [names, { data: swapsData }, { data: myShifts }] = await Promise.all([
    colleagues(ctx),
    ctx.supabase.from("shift_swaps")
      .select("id, shift_id, from_employee_id, to_employee_id, status, to_accepted, comment, created_at, shifts(starts_at, ends_at)")
      .eq("org_id", ctx.org.id).order("created_at", { ascending: false }).limit(40),
    ctx.employeeId
      ? ctx.supabase.from("shifts").select("id, starts_at, ends_at").eq("employee_id", ctx.employeeId).eq("status", "published")
          .gt("starts_at", new Date().toISOString()).order("starts_at").limit(40)
      : Promise.resolve({ data: [] as { id: string; starts_at: string; ends_at: string }[] }),
  ]);
  const swaps = (swapsData ?? []) as unknown as Swap[];
  const when = (s: Swap["shifts"]) =>
    s ? <><span className="capitalize">{formatDateLong(localDate(new Date(s.starts_at), tz))}</span> <span className="tabular-nums">{localTime(new Date(s.starts_at), tz)}–{localTime(new Date(s.ends_at), tz)}</span></> : null;
  const pending = swaps.filter((w) => w.status === "pending");
  const incoming = pending.filter((w) => w.to_employee_id && w.to_employee_id === ctx.employeeId && !w.to_accepted);
  const mine = swaps.filter((w) => w.from_employee_id === ctx.employeeId || w.to_employee_id === ctx.employeeId);
  const forAdmin = pending.filter((w) => !w.to_employee_id || w.to_accepted);
  const awaitingColleague = pending.filter((w) => w.to_employee_id && !w.to_accepted);
  const people = Array.from(names, ([id, name]) => ({ id, name })).filter((p) => p.id !== ctx.employeeId);
  const busy = new Set(pending.map((w) => w.shift_id));

  return (
    <div className="space-y-4">
      {incoming.length > 0 && (
        <section className="card border-brand/30 bg-brand-soft">
          <h2 className="h2">Kan du ta denne vakten?</h2>
          <ul className="mt-2 space-y-2">
            {incoming.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 text-sm">
                <div>
                  <b>{names.get(w.from_employee_id)}</b> spør: {when(w.shifts)}
                  {w.comment && <div className="text-muted">«{w.comment}»</div>}
                </div>
                <form action={respondSwap} className="flex gap-2">
                  <input type="hidden" name="id" value={w.id} />
                  <button name="answer" value="yes" className="btn-primary">Ja, jeg tar den</button>
                  <button name="answer" value="no" className="btn-ghost">Nei</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ctx.isAdmin && (
        <section className="card p-0">
          <h2 className="h2 px-4 pt-4">Bytter som venter på deg</h2>
          {forAdmin.length === 0 ? <p className="p-4 text-sm text-muted">Ingenting venter.</p> : (
            <ul className="mt-2 divide-y divide-line">
              {forAdmin.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div>
                    <b>{names.get(w.from_employee_id)}</b> {w.to_employee_id ? <>→ <b>{names.get(w.to_employee_id)}</b> (har sagt ja)</> : "vil gi bort vakten"}
                    <div>{when(w.shifts)}</div>
                    {w.comment && <div className="text-muted">«{w.comment}»</div>}
                  </div>
                  <form action={decideSwap} className="flex gap-2">
                    <input type="hidden" name="id" value={w.id} />
                    <button name="decision" value="approve" className="btn-primary">{w.to_employee_id ? "Godkjenn bytte" : "Godkjenn – gjør ledig"}</button>
                    <button name="decision" value="reject" className="btn-ghost">Avslå</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {awaitingColleague.length > 0 && (
            <p className="border-t border-line px-4 py-2 text-xs text-muted">{awaitingColleague.length} venter på svar fra kollega.</p>
          )}
        </section>
      )}

      {ctx.employeeId && (
        <section className="card">
          <h2 className="h2">Bytt eller gi bort en vakt</h2>
          <p className="mt-1 text-sm text-muted">Spør en kollega, eller gi vakten bort så den blir ledig. Leder godkjenner til slutt.</p>
          {(myShifts ?? []).filter((s) => !busy.has(s.id)).length === 0 ? <p className="mt-2 text-sm text-muted">Du har ingen kommende vakter å bytte.</p> : (
            <ActionForm action={proposeSwap} submitLabel="Send" className="mt-3 grid gap-3 md:grid-cols-3">
              <Field label="Vakt">
                <select name="shift_id" required className="input" defaultValue={preselect ?? ""}>
                  <option value="" disabled>Velg vakt</option>
                  {(myShifts ?? []).filter((s) => !busy.has(s.id)).map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatDateLong(localDate(new Date(s.starts_at), tz))} {localTime(new Date(s.starts_at), tz)}–{localTime(new Date(s.ends_at), tz)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Til">
                <select name="to_employee_id" required className="input" defaultValue="">
                  <option value="" disabled>Velg</option>
                  <option value="bort">Gi bort (blir ledig vakt)</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Melding (valgfritt)"><input name="comment" className="input" /></Field>
            </ActionForm>
          )}
        </section>
      )}

      {mine.length > 0 && (
        <section className="card p-0">
          <h2 className="h2 px-4 pt-4">Dine bytter</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {mine.slice(0, 15).map((w) => {
              const status =
                w.status === "pending" ? (w.to_employee_id && !w.to_accepted ? "Venter på kollega" : "Venter på leder")
                  : { approved: "Godkjent", rejected: "Avslått", cancelled: "Trukket" }[w.status] ?? w.status;
              return (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span>
                    {w.from_employee_id === ctx.employeeId ? (w.to_employee_id ? `Til ${names.get(w.to_employee_id)}` : "Gitt bort") : `Fra ${names.get(w.from_employee_id)}`}: {when(w.shifts)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`badge ${w.status === "approved" ? "bg-good-soft text-good" : w.status === "pending" ? "bg-warn-soft text-warn" : "bg-paper text-muted"}`}>{status}</span>
                    {w.status === "pending" && w.from_employee_id === ctx.employeeId && (
                      <form action={cancelSwap}><input type="hidden" name="id" value={w.id} /><button className="text-xs text-muted hover:text-bad">Trekk</button></form>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
