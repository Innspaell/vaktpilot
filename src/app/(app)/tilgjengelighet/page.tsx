import Link from "next/link";
import { requireOrg } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { formatDateLong, localDate } from "@/lib/time";
import { colleagues } from "@/lib/data";
import { addDate, removeAvailability, saveWeekly } from "./actions";

const WD = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

export default async function AvailabilityPage() {
  const ctx = await requireOrg();
  const today = localDate(new Date(), ctx.org.timezone);

  if (!ctx.org.availabilityEnabled) {
    return (
      <div className="space-y-4">
        <h1 className="h1">Når kan jeg jobbe</h1>
        <p className="card text-sm text-muted">
          {ctx.isAdmin ? <>Denne funksjonen er ikke slått på. Du kan slå den på under <Link href="/innstillinger" className="text-brand">Innstillinger</Link>.</> : "Bedriften bruker ikke denne funksjonen."}
        </p>
      </div>
    );
  }
  if (ctx.isAdmin && (!ctx.employeeId || !ctx.canSetAvailability)) return <AdminOverview ctx={ctx} today={today} />;
  if (!ctx.employeeId) return <p className="card text-sm text-muted">Du er ikke registrert som ansatt.</p>;
  if (!ctx.canSetAvailability) return <p className="card text-sm text-muted">Lederen din har ikke slått på denne funksjonen for deg.</p>;

  const { data } = await ctx.supabase.from("availability").select("id, kind, date, weekday, note")
    .eq("employee_id", ctx.employeeId).order("date");
  const rows = data ?? [];
  const weekly = new Map(rows.filter((r) => !r.date && r.kind !== "wants_extra").map((r) => [r.weekday, r.kind]));
  const extra = rows.find((r) => r.kind === "wants_extra");
  const dates = rows.filter((r) => r.date && r.date >= today);

  return (
    <div className="space-y-4">
      <h1 className="h1">Når kan du jobbe?</h1>
      <p className="text-sm text-muted">Lederen ser dette, og den automatiske vaktplanen tar hensyn til det. Dager du ikke kan, får du ikke vakt.</p>

      <section className="card">
        <h2 className="h2">Fast ukemønster</h2>
        <ActionForm action={saveWeekly} className="mt-3 space-y-3">
          <div className="divide-y divide-line">
            {WD.map((name, i) => {
              const cur = weekly.get(i + 1) ?? "";
              return (
                <fieldset key={name} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <legend className="sr-only">{name}</legend>
                  <span className="w-24 text-sm font-medium">{name}</span>
                  <div className="flex gap-1 text-sm">
                    {[["", "Kan"], ["available", "Gjerne"], ["unavailable", "Kan ikke"]].map(([v, label]) => (
                      <label key={v} className={`cursor-pointer rounded-lg border px-3 py-1.5 has-[:checked]:text-white ${v === "unavailable" ? "has-[:checked]:border-bad has-[:checked]:bg-bad" : v === "available" ? "has-[:checked]:border-good has-[:checked]:bg-good" : "has-[:checked]:border-brand has-[:checked]:bg-brand"} border-line`}>
                        <input type="radio" name={`wd_${i + 1}`} value={v} defaultChecked={cur === v} className="sr-only" />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <label className="flex items-start gap-2 rounded-lg bg-paper p-3 text-sm">
            <input type="checkbox" name="wants_extra" defaultChecked={Boolean(extra)} className="mt-0.5 h-4 w-4" />
            <span><b>Jeg ønsker ekstravakter</b><span className="block text-xs text-muted">Du kan da få litt mer enn avtalt tid, og får beskjed om ledige vakter.</span></span>
          </label>
          <Field label="Kommentar til leder (valgfritt)"><input name="extra_note" defaultValue={extra?.note ?? ""} className="input" placeholder="F.eks. kan ikke før kl. 10 på tirsdager" /></Field>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="h2">Enkeltdager</h2>
        <ActionForm action={addDate} submitLabel="Legg til" className="mt-3 grid gap-3 md:grid-cols-4">
          <Field label="Fra"><input name="from" type="date" required min={today} defaultValue={today} className="input" /></Field>
          <Field label="Til"><input name="to" type="date" min={today} className="input" /></Field>
          <Field label="Hva">
            <select name="kind" className="input"><option value="unavailable">Kan ikke</option><option value="available">Kan gjerne</option></select>
          </Field>
          <Field label="Kommentar"><input name="note" className="input" /></Field>
        </ActionForm>
        {dates.length > 0 && (
          <ul className="mt-3 divide-y divide-line text-sm">
            {dates.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <span><span className="capitalize">{formatDateLong(d.date!)}</span>: <b className={d.kind === "unavailable" ? "text-bad" : "text-good"}>{d.kind === "unavailable" ? "kan ikke" : "kan gjerne"}</b>{d.note && <span className="text-muted"> · {d.note}</span>}</span>
                <form action={removeAvailability}><input type="hidden" name="id" value={d.id} /><button className="px-2 text-muted hover:text-bad" aria-label="Fjern">×</button></form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ctx.isAdmin && <AdminOverview ctx={ctx} today={today} />}
    </div>
  );
}

async function AdminOverview({ ctx, today }: { ctx: Awaited<ReturnType<typeof requireOrg>>; today: string }) {
  const [{ data }, names] = await Promise.all([
    ctx.supabase.from("availability").select("employee_id, kind, date, weekday, note").eq("org_id", ctx.org.id),
    colleagues(ctx),
  ]);
  const rows = (data ?? []).filter((r) => !r.date || r.date >= today);
  const people = Array.from(names, ([id, name]) => ({ id, name }));
  return (
    <section className="card">
      <h2 className="h2">Ansattes ønsker</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1 pr-2 font-medium">Ansatt</th>{["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"].map((d) => <th key={d} className="px-1 py-1 text-center font-medium">{d}</th>)}<th className="py-1 pl-2 font-medium">Annet</th></tr></thead>
          <tbody className="divide-y divide-line">
            {people.map((p) => {
              const mine = rows.filter((r) => r.employee_id === p.id);
              return (
                <tr key={p.id}>
                  <td className="py-1.5 pr-2">{p.name}</td>
                  {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
                    const k = mine.find((r) => !r.date && r.weekday === wd && r.kind !== "wants_extra")?.kind;
                    return <td key={wd} className="px-1 py-1.5 text-center">{k === "unavailable" ? <span className="text-bad">✕</span> : k === "available" ? <span className="text-good">●</span> : <span className="text-line">·</span>}</td>;
                  })}
                  <td className="py-1.5 pl-2 text-xs text-muted">
                    {mine.some((r) => r.kind === "wants_extra") && <span className="badge mr-1 bg-good-soft text-good">ønsker ekstra</span>}
                    {mine.filter((r) => r.date).length > 0 && `${mine.filter((r) => r.date && r.kind === "unavailable").length} dager kan ikke`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">● gjerne · ✕ kan ikke</p>
    </section>
  );
}
