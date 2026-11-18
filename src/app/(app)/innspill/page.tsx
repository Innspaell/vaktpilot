import { getContext } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { sendFeedback } from "./actions";
import { KIND_LABEL, STATUS } from "@/lib/feedback";
import { SupportContact } from "@/components/SupportContact";

export const metadata = { title: "Ønsker og innspill – Vaktpilot" };

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ fra?: string }> }) {
  const ctx = await getContext();
  const { fra } = await searchParams;
  const { data } = await ctx.supabase.from("feedback").select("id, kind, body, status, reply, created_at").eq("user_id", ctx.userId)
    .order("created_at", { ascending: false }).limit(30);
  const mine = data ?? [];
  const date = (d: string) => new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="max-w-2xl space-y-4">
      <header>
        <h1 className="h1">Ønsker og innspill</h1>
        <p className="mt-1 text-muted">Savner du noe, er noe tungvint, eller virker noe ikke? Si fra. Vaktpilot blir laget sammen med dem som bruker den.</p>
        <SupportContact intro="Haster det, eller gjelder det lønn eller faktura? Kontakt oss på" className="mt-2 text-sm" />
      </header>

      <section className="card">
        <ActionForm action={sendFeedback} submitLabel="Send">
          <input type="hidden" name="page" value={fra ?? ""} />
          <fieldset>
            <legend className="label">Hva gjelder det?</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {Object.entries(KIND_LABEL).map(([k, l], i) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-line has-[:checked]:ring-2 has-[:checked]:ring-brand">
                  <input type="radio" name="kind" value={k} defaultChecked={i === 0} /> {l}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Fortell oss" hint="Skriv gjerne hva du prøvde å gjøre, og hvordan det burde vært. Ikke skriv personopplysninger om andre.">
            <textarea name="body" required minLength={3} maxLength={4000} rows={5} className="input" />
          </Field>
        </ActionForm>
      </section>

      {mine.length > 0 && (
        <section className="card p-0">
          <h2 className="h2 px-4 pt-4">Det du har sendt</h2>
          <ul className="mt-2 divide-y divide-line">
            {mine.map((f) => (
              <li key={f.id} className="space-y-1 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted">{KIND_LABEL[f.kind]}, {date(f.created_at)}</span>
                  <span className={`badge ${STATUS[f.status]?.cls}`}>{STATUS[f.status]?.label}</span>
                </div>
                <p className="whitespace-pre-line text-sm">{f.body}</p>
                {f.reply && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm"><b>Svar fra InnSpæll:</b> {f.reply}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
