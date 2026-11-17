import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/context";
import { currentMonth, kr, monthLabel, type UsageMonth } from "@/lib/usage";

async function saveInvoiceEmail(fd: FormData) {
  "use server";
  const ctx = await requireAdmin();
  const v = String(fd.get("invoice_email") ?? "").trim().toLowerCase();
  if (v && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(v)) return;
  await ctx.supabase.from("organizations").update({ invoice_email: v || null }).eq("id", ctx.org.id);
  revalidatePath("/innstillinger/abonnement");
}

async function setCancellation(fd: FormData) {
  "use server";
  const ctx = await requireAdmin();
  await ctx.supabase.rpc("request_cancellation", { p_org: ctx.org.id, p_cancel: fd.get("cancel") === "1" });
  revalidatePath("/innstillinger/abonnement");
}

export default async function SubscriptionPage() {
  const ctx = await requireAdmin();
  await ctx.supabase.rpc("refresh_my_usage", { p_org: ctx.org.id });
  const { data } = await ctx.supabase.from("usage_months").select("*").eq("org_id", ctx.org.id).order("month", { ascending: false }).limit(13);
  const months = (data ?? []) as UsageMonth[];
  const { data: org } = await ctx.supabase.from("organizations")
    .select("price_locked_until, trial_ends_at, invoice_email, cancel_requested_at").eq("id", ctx.org.id).single();
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
          <p className="mt-1 text-sm">Måneder som starter før prøveperioden er over, er gratis. Du trenger ikke gjøre noe for å fortsette etterpå.</p>
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
            En ansatt er aktiv i en måned når hen har hatt en publisert vakt eller registrert timer i måneden.
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
            {" "}Beløp denne måneden: <b className="text-ink">{kr(cur.amount)}</b>{cur.trial ? " (prøveperiode)" : ""}.
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
                  <td className="px-4 py-2 capitalize">{monthLabel(m.month)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{m.active_count}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{kr(m.amount)}{m.trial ? <span className="block text-xs text-muted">prøveperiode</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2 className="h2">Faktura</h2>
        <p className="mt-1 text-sm text-muted">Faktura sendes etterskuddsvis hver måned, med 14 dagers betalingsfrist.</p>
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
