import { ActionForm, Field } from "@/components/Form";
import { addEmergencyContact, removeEmergencyContact } from "@/lib/emergency-contacts";

export interface EmergencyContact { id: string; name: string; relation: string | null; phone: string }

/** Liste over nærmeste pårørende, med skjema for å legge til (når editable). */
export function EmergencyContacts({ contacts, editable, employeeId, intro }: { contacts: EmergencyContact[]; editable: boolean; employeeId?: string; intro?: string }) {
  return (
    <section id="parorende" className={`card scroll-mt-4 ${contacts.length === 0 ? "border-warn" : ""}`}>
      <h2 className="h2">Nærmeste pårørende</h2>
      {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      {contacts.length === 0 ? (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Ingen pårørende er lagt inn ennå.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line text-sm">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                <b>{c.name}</b>{c.relation ? <span className="text-muted"> · {c.relation}</span> : null}
                <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className="block text-brand tabular-nums">{c.phone}</a>
              </span>
              {editable && (
                <form action={removeEmergencyContact}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="text-sm text-muted hover:text-bad">Fjern</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <ActionForm action={addEmergencyContact} submitLabel="Legg til pårørende" className="mt-4 grid gap-3 md:grid-cols-3">
          {employeeId && <input type="hidden" name="employee_id" value={employeeId} />}
          <Field label="Navn"><input name="name" required maxLength={120} className="input" /></Field>
          <Field label="Relasjon" hint="Valgfritt, f.eks. ektefelle, mor, samboer."><input name="relation" maxLength={60} className="input" /></Field>
          <Field label="Telefon"><input name="phone" type="tel" required maxLength={40} className="input" /></Field>
        </ActionForm>
      )}
    </section>
  );
}
