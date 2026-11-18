import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fakturering via Fiken (API v2). Nøkkelen ligger i Vercel som FIKEN_API_TOKEN (personlig API-nøkkel).
 * Fiken tillater bare én forespørsel om gangen, så alt kjøres etter hverandre.
 */
const BASE = "https://api.fiken.no/api/v2";

export function fikenConfigured() {
  return Boolean(process.env.FIKEN_API_TOKEN);
}

async function fiken(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.FIKEN_API_TOKEN}`, "Content-Type": "application/json", Accept: "application/json", ...init.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Fiken svarte ${res.status} på ${init.method ?? "GET"} ${path.replace(/\/companies\/[^/]+/, "")}: ${text.slice(0, 300)}`);
  }
  return res;
}

const idFromLocation = (res: Response) => {
  const id = Number(res.headers.get("Location")?.split("/").pop());
  if (!id) throw new Error("Fiken svarte uten id på det som ble opprettet.");
  return id;
};

/** Sjekk at nøkkelen og firmaet virker. */
export async function testFiken(company: string) {
  const res = await fiken(`/companies/${encodeURIComponent(company)}`);
  const c = (await res.json()) as { name?: string; organizationNumber?: string };
  return `${c.name ?? company}${c.organizationNumber ? ` (org.nr. ${c.organizationNumber})` : ""}`;
}

type Org = { id: string; name: string; org_number: string | null; email: string | null; address: string | null; postal_code: string | null; city: string | null; fiken_contact_id: number | null };
type SendItem = { id: string; issue_date: string; due_date: string; period_to: string | null; lines: { description: string; quantity: number; unit_price: number }[]; org: Org };
type RunResult = { created: number; dunning: number; fiken: { company: string | null; bank_account: string | null }; send: SendItem[]; check: { id: string; fiken_invoice_id: number }[] };

export type BillingSummary = { created: number; dunning: number; sent: number; paid: number; failed: number; errors: string[]; skipped?: string };

/**
 * Hele fakturajobben: lager nye fakturaer og purringer i databasen, sender godkjente via Fiken og sjekker betaling.
 * secret = hemmeligheten databasen sender med (fra den daglige jobben), eller null når InnSpæll kjører den selv.
 */
export async function runBilling(supabase: SupabaseClient, secret: string | null): Promise<BillingSummary> {
  const { data, error } = await supabase.rpc("billing_run", { p_secret: secret });
  if (error) throw new Error(error.message);
  const run = data as RunResult;
  const summary: BillingSummary = { created: run.created, dunning: run.dunning, sent: 0, paid: 0, failed: 0, errors: [] };
  const step = async (invoice: string, s: string, p: Record<string, unknown> = {}) => {
    const { data: ok, error: e } = await supabase.rpc("billing_step", { p_secret: secret, p_invoice: invoice, p_step: s, p });
    if (e) throw new Error(e.message);
    return Boolean(ok);
  };

  const company = run.fiken.company;
  if (!fikenConfigured() || !company || !run.fiken.bank_account) {
    if (run.send.length || run.check.length) summary.skipped = "Fiken er ikke satt opp ennå (nøkkel, firma eller bankkonto mangler).";
    return summary;
  }
  const c = `/companies/${encodeURIComponent(company)}`;

  for (const inv of run.send) {
    if (!(await step(inv.id, "start"))) continue;
    let fikenId: number | null = null;
    try {
      // Kunden i Fiken: finn på org.nr., ellers opprett
      let contactId = inv.org.fiken_contact_id;
      if (!contactId && inv.org.org_number) {
        const found = (await (await fiken(`${c}/contacts?organizationNumber=${inv.org.org_number}&customer=true`)).json()) as { contactId: number }[];
        contactId = found[0]?.contactId ?? null;
      }
      if (!contactId) {
        const address = inv.org.address && inv.org.postal_code && inv.org.city
          ? { streetAddress: inv.org.address, postCode: inv.org.postal_code, city: inv.org.city, country: "Norge" } : undefined;
        contactId = idFromLocation(await fiken(`${c}/contacts`, {
          method: "POST",
          body: JSON.stringify({ name: inv.org.name, organizationNumber: inv.org.org_number ?? undefined, email: inv.org.email ?? undefined, customer: true, address }),
        }));
      }
      if (contactId !== inv.org.fiken_contact_id) {
        await step(inv.id, "contact", { contact_id: contactId });
        // Samme bedrift kan ha flere fakturaer i samme kjøring
        for (const other of run.send) if (other.org.id === inv.org.id) other.org.fiken_contact_id = contactId;
      }

      fikenId = idFromLocation(await fiken(`${c}/invoices`, {
        method: "POST",
        body: JSON.stringify({
          issueDate: inv.issue_date, dueDate: inv.due_date, customerId: contactId, bankAccountCode: run.fiken.bank_account, cash: false, currency: "NOK",
          ourReference: "Vaktpilot",
          invoiceText: inv.period_to ? `Vaktpilot til og med ${inv.period_to.split("-").reverse().join(".")}. Fastpris på forskudd, ekstra ansatte etterskuddsvis.` : "Vaktpilot",
          lines: inv.lines.map((l) => ({
            description: l.description, quantity: Number(l.quantity), unitPrice: Math.round(Number(l.unit_price) * 100), vatType: "HIGH", incomeAccount: "3000",
          })),
        }),
      }));
      const created = (await (await fiken(`${c}/invoices/${fikenId}`)).json()) as { invoiceNumber?: number; kid?: string; bankAccountNumber?: string };
      await step(inv.id, "created", { fiken_invoice_id: fikenId, invoice_number: String(created.invoiceNumber ?? ""), kid: created.kid ?? null, bank_account: created.bankAccountNumber ?? null });

      // auto = EHF når kunden kan ta imot det, ellers e-post
      await fiken(`${c}/invoices/send`, {
        method: "POST",
        body: JSON.stringify({ invoiceId: fikenId, method: ["auto"], includeDocumentAttachments: true, recipientEmail: inv.org.email ?? undefined, recipientName: inv.org.name }),
      });
      await step(inv.id, "sent");
      summary.sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.failed++;
      summary.errors.push(`${inv.org.name}: ${msg}`);
      await step(inv.id, "failed", fikenId ? { error: msg, fiken_invoice_id: fikenId } : { error: msg }).catch(() => undefined);
    }
  }

  for (const inv of run.check) {
    try {
      const f = (await (await fiken(`${c}/invoices/${inv.fiken_invoice_id}`)).json()) as { sale?: { settled?: boolean } };
      if (f.sale?.settled && (await step(inv.id, "paid"))) summary.paid++;
    } catch (e) {
      summary.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return summary;
}
