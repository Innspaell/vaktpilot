import { ActionForm, Field } from "./Form";
import { addSelfAsEmployee } from "@/app/(app)/actions";

/** Vises for administratorer som ikke selv er registrert som ansatt. */
export function SelfEmployeeCard({ email }: { email: string }) {
  return (
    <section className="card border-brand/30 bg-brand-soft">
      <h2 className="h2">Jobber du vakter selv?</h2>
      <p className="mt-1 text-sm text-muted">
        Legg deg til som ansatt, så kan du settes opp på vakter, stemple og søke om fri. Du beholder administratortilgangen.
        Du kobles til innloggingen din ({email}).
      </p>
      <ActionForm action={addSelfAsEmployee} submitLabel="Legg meg til som ansatt" className="mt-3 grid gap-3 md:grid-cols-4">
        <Field label="Navn"><input name="full_name" required className="input" /></Field>
        <Field label="Stillingsprosent"><input name="position_pct" type="number" min={1} max={100} step="0.5" defaultValue={100} className="input" /></Field>
        <Field label="Lønnstype">
          <select name="pay_type" defaultValue="fixed" className="input">
            <option value="fixed">Fastlønn</option>
            <option value="hourly">Timelønn</option>
          </select>
        </Field>
        <Field label="Startdato"><input name="start_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="input" /></Field>
      </ActionForm>
    </section>
  );
}
