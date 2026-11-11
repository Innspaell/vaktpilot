import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/context";
import { CARRYOVER_REASONS } from "@/lib/vacation";
import { answerCarryover } from "../../actions";
import { PrintButton } from "@/components/PrintButton";

const fmt = (iso: string | null, tz: string) =>
  iso ? new Intl.DateTimeFormat("nb-NO", { dateStyle: "long", timeStyle: "short", timeZone: tz }).format(new Date(iso)) : null;
const n = (x: number) => x.toLocaleString("nb-NO", { maximumFractionDigits: 2 });

export default async function CarryoverDocument({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const tz = ctx.org.timezone;
  const { data: c } = await ctx.supabase.from("vacation_carryovers")
    .select("*, employees(full_name, employee_number, user_id)").eq("id", id).maybeSingle();
  if (!c) notFound();
  const { data: org } = await ctx.supabase.from("organizations").select("name, org_number, address, postal_code, city, vacation_year_start_month").eq("id", c.org_id).single();
  const emp = c.employees as unknown as { full_name: string; employee_number: string | null; user_id: string | null };
  const isEmployee = emp.user_id === ctx.userId;
  const statutory = c.reason !== "agreement";
  const needsEmployee = c.status === "pending" && isEmployee && !c.employee_accepted_at;
  const needsEmployer = c.status === "pending" && ctx.isAdmin && !c.employer_accepted_at;
  const canWithdraw = c.status === "pending" && c.proposed_by === ctx.userId;
  const sm = org?.vacation_year_start_month ?? 1;
  const yearText = (y: number) => (sm === 1 ? String(y) : `${y}/${y + 1}`);
  const statusText: Record<string, string> = {
    pending: "Venter på at begge parter godtar",
    signed: statutory ? "Registrert" : "Inngått",
    rejected: "Ikke inngått (avslått)",
    cancelled: "Ikke inngått (trukket)",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={ctx.isAdmin && !isEmployee ? `/ansatte/${c.employee_id}` : "/foresporsler"} className="text-sm text-brand">‹ Tilbake</Link>
        <PrintButton />
      </div>

      {(needsEmployee || needsEmployer) && (
        <section className="card border-brand/30 bg-brand-soft print:hidden">
          <h2 className="h2">Avtalen venter på deg</h2>
          <p className="mt-1 text-sm">
            Les avtalen under. Når du trykker «Godta», lagres navnet ditt og tidspunktet som din underskrift.
            {needsEmployer && isEmployee && " Du godtar her både som ansatt og på vegne av bedriften, fordi du er eneste administrator."}
          </p>
          <form action={answerCarryover} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="id" value={c.id} />
            <button name="answer" value="yes" className="btn-primary">Godta avtalen</button>
            <button name="answer" value="no" className="btn-ghost">{canWithdraw ? "Trekk forslaget" : "Avslå"}</button>
          </form>
        </section>
      )}
      {!needsEmployee && !needsEmployer && canWithdraw && (
        <form action={answerCarryover} className="print:hidden">
          <input type="hidden" name="id" value={c.id} />
          <button name="answer" value="no" className="btn-ghost">Trekk forslaget</button>
        </form>
      )}

      <article className="card space-y-5 p-6 print:border-0 print:p-0 md:p-8">
        <header className="border-b border-line pb-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">{statutory ? "Melding om overføring av ferie" : "Avtale om overføring av ferie"}</div>
          <h1 className="mt-1 text-2xl font-bold">Overføring av {n(Number(c.days))} feriedager fra {yearText(c.from_year)} til {yearText(c.from_year + 1)}</h1>
          <p className="mt-1 text-sm text-muted">Status: <b className="text-ink">{statusText[c.status]}</b> · Dokument-ID {c.id.slice(0, 8)}</p>
        </header>

        <section className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Arbeidsgiver</div>
            <div className="mt-1 font-medium">{org?.name}</div>
            {org?.org_number && <div>Org.nr. {org.org_number}</div>}
            {org?.address && <div>{org.address}, {org.postal_code} {org.city}</div>}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Arbeidstaker</div>
            <div className="mt-1 font-medium">{emp.full_name}</div>
            {emp.employee_number && <div>Ansattnr. {emp.employee_number}</div>}
          </div>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          {statutory ? (
            <>
              <p>
                {n(Number(c.days))} feriedager fra ferieåret {yearText(c.from_year)} overføres til ferieåret {yearText(c.from_year + 1)}.
              </p>
              <p>Grunnlag: {CARRYOVER_REASONS[c.reason]}. Overføringen følger av loven og krever ikke avtale.</p>
            </>
          ) : (
            <>
              <p>
                Arbeidsgiver og arbeidstaker avtaler at <b>{n(Number(c.days))} feriedager</b> fra ferieåret {yearText(c.from_year)} overføres
                til ferieåret {yearText(c.from_year + 1)}. Dagene er telt mandag–fredag. {n(Number(c.days))} slike dager tilsvarer {n(Number(c.days) * 1.2)} virkedager etter ferieloven.
              </p>
              <p>
                Avtalen er inngått etter ferieloven § 7 tredje ledd, som tillater at inntil 12 virkedager (2 uker) overføres til neste ferieår etter skriftlig avtale.
                Den overførte ferien kommer i tillegg til ferien for {yearText(c.from_year + 1)}, og tidspunktet for avviklingen avtales på vanlig måte.
              </p>
              <p>
                Feriepenger for de overførte dagene utbetales etter de vanlige reglene i ferieloven og gjeldende tariffavtale.
                Gjelder overføringen den avtalefestede femte ferieuka, gjelder vilkårene i tariffavtalen.
              </p>
            </>
          )}
          {c.note && <p><span className="text-muted">Kommentar:</span> «{c.note}»</p>}
        </section>

        <section className="grid gap-4 border-t border-line pt-4 text-sm sm:grid-cols-2">
          <Signature title="For arbeidsgiver" name={c.employer_name} at={fmt(c.employer_accepted_at, tz)} statutory={statutory} />
          <Signature title="Arbeidstaker" name={c.employee_accepted_at ? emp.full_name : null} at={fmt(c.employee_accepted_at, tz)} statutory={statutory} />
        </section>

        <footer className="border-t border-line pt-3 text-xs text-muted">
          Avtalen er inngått elektronisk i Vaktpilot. Hver part har godtatt den innlogget med egen e-post. Navn og tidspunkt er lagret.
          Laget {fmt(c.created_at, tz)}. Mal {c.doc_version}.
        </footer>
      </article>
    </div>
  );
}

function Signature({ title, name, at, statutory }: { title: string; name: string | null; at: string | null; statutory: boolean }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</div>
      {at ? (
        <>
          <div className="mt-1 font-medium">{name}</div>
          <div className="text-muted">Godtatt elektronisk {at}</div>
        </>
      ) : (
        <div className="mt-1 text-muted">{statutory ? "Ikke nødvendig" : "Ikke godtatt ennå"}</div>
      )}
    </div>
  );
}
