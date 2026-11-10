import { ActionForm, Field } from "./Form";
import { saveEntry } from "@/app/(app)/timer/actions";

/** Skjema for ny eller rettet timeregistrering. */
export function EntryForm({
  id, shiftId, date, start, end, breakMinutes = 30, comment, people, submitLabel, maxDate,
}: {
  id?: string; shiftId?: string; date: string; start: string; end: string; breakMinutes?: number; comment?: string | null;
  people?: { id: string; name: string }[]; submitLabel?: string; maxDate: string;
}) {
  return (
    <ActionForm action={saveEntry} submitLabel={submitLabel ?? (id ? "Lagre endring" : "Registrer")} className="grid gap-3 md:grid-cols-5">
      {id && <input type="hidden" name="id" value={id} />}
      {shiftId && <input type="hidden" name="shift_id" value={shiftId} />}
      {people && (
        <Field label="Ansatt">
          <select name="employee_id" required className="input" defaultValue="">
            <option value="" disabled>Velg</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Dato"><input name="date" type="date" required max={maxDate} defaultValue={date} className="input" /></Field>
      <Field label="Fra"><input name="start" type="time" required defaultValue={start} className="input" /></Field>
      <Field label="Til"><input name="end" type="time" required defaultValue={end} className="input" /></Field>
      <Field label="Pause (min)"><input name="break_minutes" type="number" min={0} step={5} defaultValue={breakMinutes} className="input" /></Field>
      <div className={people ? "md:col-span-5" : "md:col-span-5"}>
        <Field label="Kommentar (valgfritt)"><input name="comment" defaultValue={comment ?? ""} placeholder="F.eks. jobbet over på grunn av kø" className="input" /></Field>
      </div>
    </ActionForm>
  );
}
