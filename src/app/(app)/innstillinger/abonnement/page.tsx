import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireLeader } from "@/lib/context";
import { currentMonth, kr, monthLabel, type UsageMonth } from "@/lib/usage";

async function saveInvoiceEmail(fd: FormData) {
  "use server";
  const ctx = await requireLeader();
  const v = String(fd.get("invoice_email") ?? "").trim().toLowerCase();
  if (v && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(v)) return;
  await ctx.supabase.from("organizations").update({ invoice_email: v || null }).eq("id", ctx.org.id);
  revalidatePath("/innstillinger/abonnement");
}

async function setBilling(fd: FormData) {
  "use server";
  const ctx = await requireLeader();
  await ctx.supabase.rpc("set_billing_interval", { p_org: ctx.org.id, p_interval: fd.get("interval") === "year" ? "year" : "month" });
  revalidatePath("/innstillinger/abonnement");
}

async function setCancellation(fd: FormData) {
  "use server";
  const ctx = await requireLeader();
  await ctx.supabase.rpc("request_cancellation", { p_org: ctx.org.id, p_cancel: fd.get("cancel") === "1" });
  revalidatePath("/innstillinger/abonnement");
}

export default async function SubscriptionPage() {
  const ctx = await requireLeader();
  await ctx.supabase.rpc("refresh_my_usage", { p_org: ctx.org.id });
  const { data } = await ctx.supabase.from("usage_months").select("*").eq("org_id", ctx.org.id).order("month", { ascending: false }).limit(13);
  const months = (data ?? []) as UsageMonth[];
  const { data: org } = await ctx.supabase.from("organizations")
    .select("price_locked_until, trial_ends_at, invoice_email, cancel_requested_at, billing_interval, annual_start, annual_end").eq("id", ctx.org.id).single();
  const { data: settings } = await ctx.supabase.rpc("signup_status");
  const { data: invoiceRows } = await ctx.supabase.from("invoices")
    .select("id, issue_date, due_date, period_to, gross, net, status, invoice_number, kid, bank_account, lines")
    .eq("org_id", ctx.org.id).in("status", ["sent", "paid", "failed", "sending"]).order("issue_date", { ascending: false }).limit(24);
  type Inv = { id: string; issue_date: string; due_date: string; period_to: string | null; gross: number; net: number; status: string;
    invoice_number: string | null; kid: string | null; bank_account: string | null; lines: { description: string; quantity: number; unit_price: number }[] };
  const invoices = (invoiceRows ?? []) as Inv[];
  const kr2 = (n: number) => `${Number(n).toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
  const short = (d: string) => d.split("-").reverse().join(".");
  const annualMonths = Number((settings as { annual_months?: number } | null)?.annual_months ?? 0);
  const interval = (org?.billing_interval as string | null) ?? "month";
  const annualStart = org?.annual_start as string | null;
  const annualEnd = org?.annual_end as string | null;
  const lockedUntil = org?.price_locked_until as string | null;
  const trialEnds = org?.trial_ends_at as string | null;
  const cancelAt = org?.cancel_requested_at as string | null;
  const longDate = (d: string) => new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date());
  const cm = currentMonth();
  const cur = months.find((m) => m.month === cm);
  const history = months.filter((m) => m.month !== cm);

  let names: string[] = [];
  if (cur?.active_employee_ids.length) {
    const { data: emps } = await ctx.supabase.from("employees").select("full_name").in("id", cur.active_employee_ids).order("full_name");
    names = (emps ?? []).map((e) => e.full_name);
  }
  const over = cur ? Math.max(cur.active_count - cur.included, 0) : 0;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/innstillinger" className="text-sm text-brand">‹ Innstillinger</Link>
        <h1 className="h1 mt-1">Abonnement</h1>
      </div>

      {trialEnds && trialEnds > today && !cancelAt && (
        <section className="card bg-good-soft">
          <p className="font-semibold text-good">Prøveperiode til {longDate(trialEnds)}</p>
          <p className="mt-1 text-sm">Fra {longDate(trialEnds)} betaler dere for resten av måneden, deretter for hele måneder. Du trenger ikke gjøre noe for å fortsette.</p>
        </section>
      )}

      {cur && (
        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2">Pris</h2>
            {lockedUntil && lockedUntil >= cm && (
              <span className="badge bg-good-soft text-good">
                Lanseringspris – fast til {new Date(lockedUntil).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}
              </span>
            )}
          </div>
          <p className="mt-1 text-2xl font-bold">{kr(cur.base_price)} <span className="text-sm font-normal text-muted">per måned, eks. mva.</span></p>
          <p className="mt-1 text-sm text-muted">
            {cur.included} aktive ansatte er inkludert.
            {Number(cur.per_extra) > 0 ? ` Hver aktiv ansatt utover det koster ${kr(cur.per_extra)} per måned.` : ""}
          </p>
          <p className="mt-2 text-xs text-muted">
            En ansatt er aktiv i en måned når vedkommende har hatt en publisert vakt eller registrert timer i måneden.
            Ansatte som ikke har jobbet, og de som har sluttet, telles ikke.
          </p>
        </section>
      )}

      {cur && (
        <section className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="h2">Denne måneden ({monthLabel(cur.month)})</h2>
            <span className={`badge ${over ? "bg-warn-soft text-warn" : "bg-good-soft text-good"}`}>
              {cur.active_count} av {cur.included} inkludert
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Så langt i måneden, med planlagte vakter som er publisert.
            {over > 0 && Number(cur.per_extra) > 0 ? ` ${over} ekstra ansatt${over === 1 ? "" : "e"}: ${kr(over * cur.per_extra)}.` : ""}
            {" "}Beløp denne måneden: <b className="text-ink">{kr(cur.amount)}</b>{cur.trial ? " (prøveperiode)" : cur.billed_from ? ` (fra ${longDate(cur.billed_from)})` : Number(cur.annual_charge) > 0 ? " (årspris)" : cur.annual_covered ? " (fastprisen er betalt for året)" : ""}.
          </p>
          {names.length > 0 && (
            <ul className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">{names.map((n) => <li key={n}>{n}</li>)}</ul>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="card p-0">
          <h2 className="h2 px-4 pt-4">Tidligere måneder</h2>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Måned</th><th className="px-2 py-2 text-right font-medium">Aktive</th><th className="px-4 py-2 text-right font-medium">Beløp</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {history.map((m) => (
                <tr key={m.month}>
                  <td className="px-4 py-2 first-letter:uppercase">{monthLabel(m.month)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{m.active_count}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{kr(m.amount)}{m.trial ? <span className="block text-xs text-muted">prøveperiode</span> : m.billed_from ? <span className="block text-xs text-muted">fra {longDate(m.billed_from)}</span> : Number(m.annual_charge) > 0 ? <span className="block text-xs text-muted">årspris</span> : m.annual_covered ? <span className="block text-xs text-muted">betalt for året</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {cur && (annualMonths > 0 || interval === "year" || annualStart) && (
        <section className="card">
          <h2 className="h2">Betaling</h2>
          {(() => {
            const yearly = kr(Number(cur.base_price) * (annualMonths || 10));
            const covered = annualStart && annualStart <= today.slice(0, 8) + "01" && (!annualEnd || annualEnd > today);
            if (interval === "year") {
              return (<>
                <p className="mt-1 text-sm">
                  <b>Årlig betaling.</b> {annualStart && annualStart > today ? `Året starter ${longDate(annualStart)}, og ${yearly} faktureres da.` : `Inneværende år startet ${annualStart ? longDate(annualStart) : ""} og fornyes automatisk.`}
                  {" "}Ansatte utover de {cur.included} inkluderte faktureres månedlig.
                </p>
                <form action={setBilling} className="mt-3"><input type="hidden" name="interval" value="month" />
                  <button className="btn-ghost">Gå over til månedlig</button>
                  <span className="mt-1 block text-xs text-muted">{annualStart && annualStart > today ? "Året har ikke startet, så ingenting er betalt." : "Året som er betalt, gjelder ut. Deretter betaler dere månedlig."}</span>
                </form>
              </>);
            }
            return (<>
              <p className="mt-1 text-sm">
                <b>Månedlig betaling.</b>
                {covered && annualEnd ? ` Året dere har betalt for gjelder til ${longDate(annualEnd)}, deretter månedlig.` : ""}
              </p>
              {annualMonths > 0 && (
                <form action={setBilling} className="mt-3"><input type="hidden" name="interval" value="year" />
                  <button className="btn-ghost">Gå over til årlig: {yearly} per år</button>
                  <span className="mt-1 block text-xs text-muted">Du betaler for {annualMonths} måneder og får 12. {covered ? "Fortsetter etter året som er betalt." : "Året starter neste måned."}</span>
                </form>
              )}
            </>);
          })()}
        </section>
      )}

      <section className="card p-0">
        <h2 className="h2 px-4 pt-4">Fakturaer</h2>
        {invoices.length === 0 ? (
          <p className="px-4 pb-4 pt-1 text-sm text-muted">Ingen fakturaer ennå. {trialEnds && trialEnds > today ? `Første faktura kommer ${longDate(trialEnds)}.` : ""}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {invoices.map((i) => {
              const overdue = i.status === "sent" && i.due_date < today;
              return (
                <li key={i.id} className="px-4 py-3">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                      <span>
                        <b>Faktura {i.invoice_number ?? ""}</b> <span className="text-sm text-muted">{short(i.issue_date)}{i.period_to ? `, til og med ${short(i.period_to)}` : ""}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{kr2(i.gross)}</span>
                        <span className={`badge ${i.status === "paid" ? "bg-good-soft text-good" : overdue ? "bg-bad-soft text-bad" : "bg-paper text-muted"}`}>
                          {i.status === "paid" ? "Betalt" : overdue ? "Forfalt" : `Forfaller ${short(i.due_date)}`}
                        </span>
                      </span>
                    </summary>
                    <div className="mt-2 space-y-1 text-sm">
                      {i.lines.map((l, n) => (
                        <div key={n} className="flex justify-between gap-3"><span>{l.description}{Number(l.quantity) !== 1 ? ` × ${l.quantity}` : ""}</span><span className="tabular-nums">{kr2(Number(l.quantity) * Number(l.unit_price))}</span></div>
                      ))}
                      <div className="flex justify-between gap-3 text-muted"><span>Mva. 25 %</span><span className="tabular-nums">{kr2(Number(i.gross) - Number(i.net))}</span></div>
                      {i.status !== "paid" && (i.bank_account || i.kid) && <p className="text-muted">Betal til konto {i.bank_account ?? "–"}{i.kid ? ` med KID ${i.kid}` : ""}.</p>}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <p className="px-4 pb-4 pt-2 text-xs text-muted">Fakturaene sendes fra Fiken som EHF eller e-post. Fastprisen betales på forskudd, ekstra ansatte etterskuddsvis.</p>
      </section>

      <section className="card">
        <h2 className="h2">Faktura</h2>
        <p className="mt-1 text-sm text-muted">Faktura sendes ved starten av hver periode, med 14 dagers betalingsfrist.</p>
        <form action={saveInvoiceEmail} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block min-w-64 flex-1">
            <span className="label">E-post for faktura</span>
            <input name="invoice_email" type="email" inputMode="email" defaultValue={(org?.invoice_email as string | null) ?? ""} className="input" />
          </label>
          <button className="btn-ghost">Lagre</button>
        </form>
      </section>

      <section className="card">
        <h2 className="h2">Si opp</h2>
        {cancelAt ? (
          <>
            <p className="mt-1 text-sm">Du sa opp {longDate(cancelAt)}. Abonnementet avsluttes ved utgangen av måneden. Last ned data dere vil ta vare på under Rapporter og Personvern før det.</p>
            <form action={setCancellation} className="mt-3"><input type="hidden" name="cancel" value="0" /><button className="btn-ghost">Angre oppsigelsen</button></form>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">Ingen bindingstid. Sier du opp, avsluttes abonnementet ved utgangen av måneden. InnSpæll får beskjed.</p>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-bad">Si opp Vaktpilot</summary>
              <form action={setCancellation} className="mt-3 space-y-2">
                <input type="hidden" name="cancel" value="1" />
                <p className="text-sm">Er du sikker? Dere kan laste ned alle data før abonnementet avsluttes, og angre helt til da.</p>
                <button className="btn-ghost text-bad">Ja, si opp</button>
              </form>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
