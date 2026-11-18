import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { ConfirmButton } from "@/components/ConfirmButton";
import { fikenConfigured } from "@/lib/fiken";
import { currentMonth, monthLabel } from "@/lib/usage";
import { blockAction, deleteOrgData, invoiceAction, runBillingNow, saveBillingSettings, setOrgBilling, testFikenConnection } from "./actions";

export const metadata = { title: "Fakturaer – Plattform" };

type Inv = {
  id: string; org_id: string; issue_date: string; due_date: string; period_to: string | null; net: number; gross: number; status: string;
  invoice_number: string | null; error: string | null; reminder_sent_at: string | null; lines: { description: string; quantity: number; unit_price: number }[];
  organizations: { name: string; invoice_email: string | null } | null;
};

export default async function InvoicesPage() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) redirect("/");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date());
  const [{ data: settings }, { data: invoiceRows }, { data: orgRows }] = await Promise.all([
    ctx.supabase.from("platform_settings").select("invoice_mode, fiken_company, fiken_bank_account, payment_days, reminder_days, block_days").eq("id", 1).maybeSingle(),
    ctx.supabase.from("invoices").select("id, org_id, issue_date, due_date, period_to, net, gross, status, invoice_number, error, reminder_sent_at, lines, organizations(name, invoice_email)")
      .order("issue_date", { ascending: false }).limit(200),
    ctx.supabase.from("organizations").select("id, name, active, billing_enabled, billing_from, billed_through, trial_ends_at, blocked_at, block_paused_until, invoice_email, signup_by, ended_at, delete_after")
      .order("name"),
  ]);
  const invoices = (invoiceRows ?? []) as unknown as Inv[];
  const orgs = orgRows ?? [];
  const kr = (n: number) => `${Number(n).toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
  const short = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "–");
  const waiting = invoices.filter((i) => i.status === "ready");
  const problems = invoices.filter((i) => i.status === "failed" || i.status === "sending");
  const unpaid = invoices.filter((i) => i.status === "sent");
  const done = invoices.filter((i) => i.status === "paid" || i.status === "void").slice(0, 30);
  const blocked = orgs.filter((o) => o.blocked_at);
  const prev = (() => { const [y, m] = currentMonth().split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();
  const fikenReady = fikenConfigured() && settings?.fiken_company && settings?.fiken_bank_account;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/plattform" className="text-sm text-brand">‹ Plattform</Link>
          <h1 className="h1">Fakturaer</h1>
        </div>
        <ActionForm action={runBillingNow} submitLabel="Kjør fakturering nå" className="flex flex-wrap items-center gap-3"><span /></ActionForm>
      </header>
      <p className="text-sm text-muted">
        Hver morgen lager Vaktpilot fakturaene som skal ut, sender godkjente via Fiken og sjekker hva som er betalt.
        Fastprisen faktureres på forskudd, ekstra ansatte etterskuddsvis.
      </p>

      {!fikenReady && (
        <section className="card bg-warn-soft text-sm">
          <p className="font-semibold text-warn">Fiken er ikke koblet til ennå</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li className={fikenConfigured() ? "text-muted line-through" : ""}>Bestill API-modulen i Fiken (Innstillinger › Moduler, 99 kr/mnd), og lag en personlig API-nøkkel under Rediger konto › Sikkerhet › Personlige API-nøkler.</li>
            <li className={fikenConfigured() ? "text-muted line-through" : ""}>Legg nøkkelen inn i Vercel som miljøvariabelen <code>FIKEN_API_TOKEN</code> (Production), og deploy på nytt. Ikke lim den inn i chatten.</li>
            <li className={settings?.fiken_company ? "text-muted line-through" : ""}>Skriv inn firma-ID (står i adressen når du er inne i Fiken: fiken.no/foretak/<b>firma-id</b>/…) og bankkontoen fakturaene skal betales til.</li>
            <li>Trykk «Test tilkoblingen».</li>
          </ol>
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="h2">Innstillinger</h2>
        <ActionForm action={saveBillingSettings} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Sending" hint="Start med «Jeg godkjenner først» til du har sett at fakturaene blir riktige.">
              <select name="mode" defaultValue={settings?.invoice_mode ?? "manual"} className="input">
                <option value="manual">Jeg godkjenner først</option>
                <option value="auto">Send automatisk</option>
                <option value="off">Av (ingen fakturaer lages)</option>
              </select>
            </Field>
            <Field label="Firma-ID i Fiken"><input name="company" defaultValue={settings?.fiken_company ?? ""} placeholder="innspaell-as" className="input" /></Field>
            <Field label="Bankkonto i Fiken" hint="Kontokode fra Fiken, f.eks. 1920:10001."><input name="bank" defaultValue={settings?.fiken_bank_account ?? ""} placeholder="1920:10001" className="input" /></Field>
            <Field label="Betalingsfrist (dager)"><input name="payment" type="number" min={1} max={60} defaultValue={settings?.payment_days ?? 14} className="input" /></Field>
            <Field label="Påminnelse etter forfall (dager)"><input name="reminder" type="number" min={1} max={60} defaultValue={settings?.reminder_days ?? 14} className="input" /></Field>
            <Field label="Sperring etter påminnelse (dager)"><input name="block" type="number" min={1} max={90} defaultValue={settings?.block_days ?? 30} className="input" /></Field>
          </div>
        </ActionForm>
        <ActionForm action={testFikenConnection} submitLabel="Test tilkoblingen" className="flex flex-wrap items-center gap-3"><span /></ActionForm>
      </section>

      {blocked.length > 0 && (
        <section className="card space-y-2 bg-bad-soft">
          <h2 className="h2 text-bad">Sperret</h2>
          {blocked.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><b>{o.name}</b> siden {short(o.blocked_at)}. Lederne har bare ansatt-tilgang.</span>
              <form action={blockAction}><input type="hidden" name="org" value={o.id} /><input type="hidden" name="action" value="pause" />
                <button className="btn-ghost py-1.5">Opphev og vent 14 dager</button></form>
            </div>
          ))}
        </section>
      )}

      <InvoiceList title="Venter på godkjenning" rows={waiting} kr={kr} short={short} today={today}
        actions={waiting.length > 0 && (
          <form action={invoiceAction} className="flex gap-2">
            <input type="hidden" name="action" value="approve" />
            {waiting.map((i) => <input key={i.id} type="hidden" name="id" value={i.id} />)}
            <button className="btn-primary py-1.5">Godkjenn alle ({waiting.length})</button>
          </form>
        )}
        rowActions={(i) => (
          <div className="flex gap-3">
            <form action={invoiceAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="action" value="approve" /><button className="text-sm font-semibold text-brand">Godkjenn</button></form>
            <form action={invoiceAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="action" value="void" />
              <ConfirmButton label="Ikke send" confirmLabel="Gi perioden gratis" className="text-sm text-muted" /></form>
          </div>
        )}
        empty="Ingen fakturaer venter." />

      {problems.length > 0 && (
        <InvoiceList title="Trenger oppfølging" rows={problems} kr={kr} short={short} today={today}
          rowActions={(i) => (
            <div className="flex flex-wrap gap-3">
              {i.status === "failed" && !i.invoice_number && <form action={invoiceAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="action" value="retry" /><button className="text-sm font-semibold text-brand">Prøv igjen</button></form>}
              <form action={invoiceAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="action" value="mark_sent" /><button className="text-sm text-brand" title="Hvis du har sendt den fra Fiken selv">Merk som sendt</button></form>
              {!i.invoice_number && <form action={invoiceAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="action" value="void" /><ConfirmButton label="Ikke send" confirmLabel="Gi perioden gratis" className="text-sm text-muted" /></form>}
            </div>
          )} />
      )}

      <InvoiceList title="Sendt, ikke betalt" rows={unpaid} kr={kr} short={short} today={today} empty="Alt er betalt."
        rowActions={(i) => (
          <form action={invoiceAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="action" value="mark_paid" />
            <button className="text-sm text-brand" title="Fiken merker betalt automatisk når banken er avstemt. Bruk denne hvis det trengs før.">Merk som betalt</button></form>
        )} />

      <section className="card overflow-x-auto p-0">
        <h2 className="h2 px-4 pt-4">Bedrifter som faktureres</h2>
        <table className="mt-2 w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-4 py-2 font-medium">Bedrift</th><th className="px-2 py-2 font-medium">Faktura til</th>
            <th className="px-2 py-2 font-medium">Betalt til og med</th><th className="px-4 py-2" />
          </tr></thead>
          <tbody className="divide-y divide-line">
            {orgs.filter((o) => o.active).map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-2 font-medium">{o.name}{o.trial_ends_at && o.trial_ends_at > today && <span className="ml-2 badge bg-good-soft text-good">Prøve til {short(o.trial_ends_at)}</span>}</td>
                <td className="px-2 py-2 text-xs">{o.invoice_email ?? <span className="text-warn">mangler</span>}</td>
                <td className="px-2 py-2 text-xs">{o.billing_enabled ? (o.billed_through ? short(o.billed_through) : `Første faktura ${short(o.trial_ends_at && o.trial_ends_at > (o.billing_from ?? "") ? o.trial_ends_at : o.billing_from)}`) : "Faktureres ikke"}</td>
                <td className="px-4 py-2 text-right">
                  <form action={setOrgBilling}>
                    <input type="hidden" name="org" value={o.id} /><input type="hidden" name="enabled" value={o.billing_enabled ? "0" : "1"} />
                    {o.billing_enabled
                      ? <ConfirmButton label="Stopp fakturering" confirmLabel="Stopp" className="text-xs text-muted hover:text-bad" />
                      : <ConfirmButton label="Start fakturering" confirmLabel="Fakturer fra 1. neste måned" className="text-xs font-semibold text-brand" />}
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-muted">
          Bedrifter som registrerer seg selv, faktureres automatisk etter prøveperioden. Eksisterende kunder (som Æ e Trønder) faktureres ikke før du starter det her.
          Fakturagrunnlaget som Excel: <a href={`/api/plattform/faktura?maned=${prev}`} className="text-brand">{monthLabel(`${prev}-01`)}</a>.
        </p>
      </section>

      {orgs.some((o) => o.ended_at) && (
        <section className="card space-y-3">
          <h2 className="h2">Avsluttede abonnement</h2>
          <p className="text-sm text-muted">Vilkårene lover sletting innen 90 dager etter avslutning. Kunden får beskjed 14 dager før. Sletting kan ikke angres.</p>
          {orgs.filter((o) => o.ended_at).map((o) => (
            <div key={o.id} className="rounded-lg p-3 ring-1 ring-line">
              <p className="text-sm"><b>{o.name}</b>: avsluttet {short(o.ended_at)}, slettes fra {short(o.delete_after)}
                {o.delete_after && o.delete_after <= today && <span className="ml-2 badge bg-warn-soft text-warn">Skal slettes nå</span>}</p>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-bad">Slett alle data</summary>
                <ActionForm action={deleteOrgData} submitLabel="Slett for godt" className="mt-2 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="org" value={o.id} />
                  <Field label={`Skriv «${o.name}» for å bekrefte`}><input name="name" required className="input" autoComplete="off" /></Field>
                </ActionForm>
              </details>
            </div>
          ))}
        </section>
      )}

      <InvoiceList title="Betalt og avsluttet" rows={done} kr={kr} short={short} today={today} empty="Ingen ennå." />
    </div>
  );
}

function InvoiceList({ title, rows, kr, short, today, actions, rowActions, empty }: {
  title: string; rows: Inv[]; kr: (n: number) => string; short: (d: string | null) => string; today: string;
  actions?: React.ReactNode; rowActions?: (i: Inv) => React.ReactNode; empty?: string;
}) {
  if (!rows.length && !empty) return null;
  const sum = rows.reduce((s, i) => s + Number(i.net), 0);
  return (
    <section className="card p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <h2 className="h2">{title}{rows.length > 0 && <span className="ml-2 text-sm font-normal text-muted">{rows.length} stk, {kr(sum)} eks. mva.</span>}</h2>
        {actions}
      </div>
      {rows.length === 0 ? <p className="px-4 pb-4 pt-1 text-sm text-muted">{empty}</p> : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((i) => {
            const overdue = i.status === "sent" && i.due_date < today;
            return (
              <li key={i.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <details className="min-w-0 flex-1">
                    <summary className="cursor-pointer">
                      <b>{i.organizations?.name}</b>
                      <span className="ml-2 text-sm text-muted">
                        {i.invoice_number ? `nr. ${i.invoice_number}, ` : ""}{short(i.issue_date)}, forfall {short(i.due_date)}{i.period_to ? `, til og med ${short(i.period_to)}` : ""}
                      </span>
                      <span className="ml-2 tabular-nums">{kr(i.net)}</span>
                      {overdue && <span className="ml-2 badge bg-bad-soft text-bad">{i.reminder_sent_at ? `Påminnet ${short(i.reminder_sent_at)}` : "Forfalt"}</span>}
                      {i.status === "void" && <span className="ml-2 badge bg-paper text-muted">Ikke sendt (gratis)</span>}
                    </summary>
                    <div className="mt-2 space-y-0.5 text-sm">
                      {i.lines.map((l, n) => (
                        <div key={n} className="flex justify-between gap-3"><span>{l.description}{Number(l.quantity) !== 1 ? ` × ${l.quantity}` : ""}</span><span className="tabular-nums">{kr(Number(l.quantity) * Number(l.unit_price))}</span></div>
                      ))}
                      <div className="text-xs text-muted">Til {i.organizations?.invoice_email ?? "– (mangler e-post)"}. Med mva. {kr(i.gross)}.</div>
                      {i.error && <p className="text-xs text-bad">{i.error}</p>}
                    </div>
                  </details>
                  {rowActions?.(i)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
