import Link from "next/link";
import type { AppContext } from "@/lib/context";
import { loadVacation, relevantYears } from "@/lib/vacation-data";
import { ADJUSTMENT_TYPES, CARRYOVER_REASONS, type VacationYear } from "@/lib/vacation";
import { ActionForm, Field } from "./Form";
import { SignaturePad } from "./SignaturePad";
import { addVacationAdjustment, deleteVacationAdjustment, proposeCarryover } from "@/app/(app)/ferie/actions";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

const n = (x: number) => x.toLocaleString("nb-NO", { maximumFractionDigits: 2 });
const STATUS: Record<string, [string, string]> = {
  pending: ["Venter på signatur", "bg-warn-soft text-warn"],
  signed: ["Signert", "bg-good-soft text-good"],
  rejected: ["Avslått", "bg-bad-soft text-bad"],
  cancelled: ["Trukket", "bg-paper text-muted"],
};

/** Liten linje til forsiden. */
export async function VacationLine({ ctx }: { ctx: Ctx }) {
  if (!ctx.employeeId) return null;
  const probe = await loadVacation(ctx, [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1], ctx.employeeId);
  const ys = probe.byEmployee.get(ctx.employeeId) ?? [];
  const cur = ys.find((y) => y.year === probe.currentYear);
  const next = ys.find((y) => y.year === probe.currentYear + 1);
  if (!cur) return null;
  const showNext = next && (next.booked > 0 || next.pending > 0 || next.carriedIn > 0);
  return (
    <Link href="/foresporsler" className="card flex items-center justify-between gap-3 hover:border-brand">
      <span>
        <span className="block text-sm text-muted">Feriedager igjen</span>
        <span className="text-2xl font-bold tabular-nums">{n(cur.remaining)}</span>
        <span className="ml-1 text-sm text-muted">i {cur.year}</span>
        {showNext && <span className="ml-3 text-sm text-muted">· {n(next.remaining)} i {next.year}</span>}
      </span>
      <span className="text-brand">›</span>
    </Link>
  );
}

/** Feriesaldo per år, med overføring. mode: ansatt selv, eller leder på ansattsiden. */
export async function VacationOverview({ ctx, employeeId, admin }: { ctx: Ctx; employeeId: string; admin?: boolean }) {
  const cy = new Date().getFullYear();
  const data = await loadVacation(ctx, [cy - 1, cy, cy + 1], employeeId);
  const all = data.byEmployee.get(employeeId) ?? [];
  const cur = all.find((y) => y.year === data.currentYear);
  const next = all.find((y) => y.year === data.currentYear + 1);
  const hasNext = Boolean(next && (next.booked || next.pending || next.carriedIn || next.adjustments));
  const years = relevantYears(data.currentYear, data.today, hasNext).map((y) => all.find((v) => v.year === y)).filter(Boolean) as VacationYear[];
  const carryovers = data.carryovers;

  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${years.length > 1 ? "md:grid-cols-2" : ""}`}>
        {years.map((y) => <YearCard key={y.year} y={y} admin={admin} />)}
      </div>

      {admin && (
        <details className="card">
          <summary className="h2 cursor-pointer">Startsaldo og justering</summary>
          <p className="mt-1 text-sm text-muted">
            Bruk dette når dere tar i bruk Vaktpilot midt i et år: legg inn ferie som allerede er tatt, og ferie som er overført fra året før.
            Justeringen gjelder ferieåret du velger.
          </p>
          <ActionForm action={addVacationAdjustment} submitLabel="Legg inn" className="mt-3 grid gap-3 md:grid-cols-4">
            <input type="hidden" name="employee_id" value={employeeId} />
            <Field label="Ferieår">
              <select name="year" defaultValue={data.currentYear} className="input">
                {[data.currentYear - 1, data.currentYear, data.currentYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select name="type" className="input">
                {Object.entries(ADJUSTMENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Dager" hint="Annen justering: minus trekker fra.">
              <input name="days" inputMode="decimal" required placeholder="f.eks. 14" className="input" />
            </Field>
            <Field label="Kommentar"><input name="note" placeholder="Valgfritt" className="input" /></Field>
          </ActionForm>
        </details>
      )}

      <section className="card">
        <h2 className="h2">Overføre ferie til neste år</h2>
        <p className="mt-1 text-sm text-muted">
          Ferie skal som hovedregel tas i ferieåret. Etter skriftlig avtale kan inntil {n(data.maxCarryover)} dager overføres til neste år.
          {admin
            ? " Du lager avtalen og signerer for bedriften. Den ansatte får varsel og signerer med fingeren i appen. Når begge har signert, flyttes dagene av seg selv."
            : " Ønsker du å overføre ferie, ta det opp med lederen din. Lederen lager avtalen, og du signerer den her i appen."}
          {" "}Ferie som ikke kunne tas på grunn av sykdom eller foreldrepermisjon overføres uten avtale. Det registrerer lederen.
        </p>
        {carryovers.length > 0 && (
          <ul className="mt-3 divide-y divide-line text-sm">
            {carryovers.map((c) => {
              const [label, cls] = STATUS[c.status] ?? [c.status, "bg-paper text-muted"];
              return (
                <li key={c.id}>
                  <Link href={`/ferie/overforing/${c.id}`} className="flex items-center justify-between gap-2 py-2 hover:text-brand">
                    <span>{n(Number(c.days))} dager fra {c.from_year} til {c.from_year + 1}{c.reason !== "agreement" && <span className="text-muted"> · {c.reason === "sick" ? "sykdom" : c.reason === "parental" ? "permisjon" : "ikke avviklet"}</span>}</span>
                    <span className={`badge ${cls}`}>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {admin && (
          <div className="mt-3 space-y-2">
            <details className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold text-brand">Lag avtale om overføring</summary>
              <ActionForm action={proposeCarryover} submitLabel="Signer og send til den ansatte" className="mt-3 grid gap-3 md:grid-cols-3">
                <input type="hidden" name="employee_id" value={employeeId} />
                <input type="hidden" name="reason" value="agreement" />
                <Field label="Fra ferieår">
                  <select name="from_year" defaultValue={data.currentYear} className="input">
                    {[data.currentYear - 1, data.currentYear].map((y) => <option key={y} value={y}>{y} → {y + 1}</option>)}
                  </select>
                </Field>
                <Field label="Dager" hint={`Inntil ${n(data.maxCarryover)} per år.`}>
                  <input name="days" inputMode="decimal" required defaultValue={cur && cur.remaining > 0 ? Math.min(cur.remaining, data.maxCarryover) : ""} className="input" />
                </Field>
                <Field label="Kommentar"><input name="note" placeholder="Valgfritt" className="input" /></Field>
                <div className="md:col-span-3"><SignaturePad label="Din signatur, for bedriften" /></div>
              </ActionForm>
            </details>
            <details className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold text-brand">Registrer overføring som følger av loven</summary>
              <p className="mt-2 text-xs text-muted">Sykdom, foreldrepermisjon eller forhold arbeidsgiver har ansvaret for. Ingen avtale eller grense. Den ansatte får beskjed.</p>
              <ActionForm action={proposeCarryover} submitLabel="Registrer" className="mt-3 grid gap-3 md:grid-cols-4">
                <input type="hidden" name="employee_id" value={employeeId} />
                <Field label="Fra ferieår">
                  <select name="from_year" defaultValue={data.currentYear} className="input">
                    {[data.currentYear - 1, data.currentYear].map((y) => <option key={y} value={y}>{y} → {y + 1}</option>)}
                  </select>
                </Field>
                <Field label="Dager"><input name="days" inputMode="decimal" required className="input" /></Field>
                <Field label="Grunnlag">
                  <select name="reason" className="input">
                    {Object.entries(CARRYOVER_REASONS).filter(([k]) => k !== "agreement").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Kommentar"><input name="note" placeholder="Valgfritt" className="input" /></Field>
              </ActionForm>
            </details>
          </div>
        )}
      </section>
    </div>
  );
}

function YearCard({ y, admin }: { y: VacationYear; admin?: boolean }) {
  const rows: [string, number, string?][] = [
    ["Rett etter avtalen", y.entitlement],
    ...(y.adjustments ? [["Startsaldo / justering", y.adjustments] as [string, number]] : []),
    ...(y.carriedIn ? [["Overført fra året før", y.carriedIn] as [string, number]] : []),
    ...(y.carriedOut ? [["Overført til året etter", -y.carriedOut] as [string, number]] : []),
    ["Tatt", -y.taken],
    ["Godkjent, ikke tatt ennå", -y.booked],
  ];
  return (
    <section className="card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="h2">Ferie {y.year}</h2>
        <span className={`text-2xl font-bold tabular-nums ${y.remaining < 0 ? "text-bad" : ""}`}>{n(y.remaining)} <span className="text-sm font-normal text-muted">igjen</span></span>
      </div>
      <dl className="mt-2 divide-y divide-line text-sm">
        {rows.map(([l, v]) => (
          <div key={l} className="flex justify-between py-1"><dt className="text-muted">{l}</dt><dd className="tabular-nums">{v > 0 ? "+" : v < 0 ? "−" : ""}{n(Math.abs(v))}</dd></div>
        ))}
      </dl>
      {y.pending > 0 && (
        <p className={`mt-2 text-xs ${y.remainingIfApproved < 0 ? "text-bad" : "text-muted"}`}>
          {n(y.pending)} dager venter på svar. Blir de godkjent, er det {n(y.remainingIfApproved)} igjen.
        </p>
      )}
      {admin && y.ledger.filter((l) => l.source in ADJUSTMENT_TYPES).length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
          {y.ledger.filter((l) => l.source in ADJUSTMENT_TYPES).map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2">
              <span className="text-muted">{ADJUSTMENT_TYPES[l.source]}{l.note ? ` · ${l.note}` : ""}: <b className="text-ink">{l.amount > 0 ? "+" : ""}{n(l.amount)}</b></span>
              <form action={deleteVacationAdjustment}><input type="hidden" name="id" value={l.id} /><button className="text-bad">Fjern</button></form>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">Telt mandag–fredag uten helligdager. Ferie trekkes fra året den tas.</p>
    </section>
  );
}
