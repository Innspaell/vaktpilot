import { ActionForm } from "@/components/Form";
import { addEntryNote, answerEntryNote } from "@/app/(app)/timer/actions";
import { formatDateLong } from "@/lib/time";

export type EntryNote = {
  id: string; employee_id: string; time_entry_id: string | null; shift_id: string | null; date: string;
  body: string; status: "open" | "done"; answer: string | null; created_at: string;
};

export const NOTE_SELECT = "id, employee_id, time_entry_id, shift_id, date, body, status, answer, created_at";

/** Merknadene på en arbeidsdag, med svar fra lederen. */
export function NoteList({ notes, leader }: { notes: EntryNote[]; leader?: boolean }) {
  if (!notes.length) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {notes.map((n) => (
        <li key={n.id} className={`rounded-lg px-3 py-2 text-sm ${n.status === "open" ? "bg-warn-soft" : "bg-paper"}`}>
          <div><span className="font-medium">{leader ? "Merknad fra den ansatte" : "Din merknad"}:</span> «{n.body}»</div>
          <div className="text-xs text-muted">
            {n.status === "open" ? (leader ? "Venter på deg" : "Venter på svar fra lederen") : n.answer ? <>Svar fra leder: «{n.answer}»</> : "Behandlet av leder"}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Skjema for den ansatte: legg til informasjon lederen må ta stilling til. */
export function NoteForm({ date, entryId, shiftId, label, hint }: { date: string; entryId?: string; shiftId?: string; label: string; hint: string }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm font-semibold text-brand">{label}</summary>
      <ActionForm action={addEntryNote} submitLabel="Send til lederen" className="mt-2 space-y-2">
        <input type="hidden" name="date" value={date} />
        {entryId && <input type="hidden" name="time_entry_id" value={entryId} />}
        {shiftId && <input type="hidden" name="shift_id" value={shiftId} />}
        <textarea name="body" required rows={2} maxLength={2000} className="input" placeholder={hint} />
      </ActionForm>
    </details>
  );
}

/** Lederens liste: åpne merknader med svarfelt. */
export function LeaderNotes({ notes, names }: { notes: EntryNote[]; names: Map<string, string> }) {
  if (!notes.length) return null;
  return (
    <section id="merknader" className="card scroll-mt-20 border-warn/40">
      <h2 className="h2">Merknader fra ansatte</h2>
      <p className="mt-1 text-sm text-muted">Informasjon de ansatte har lagt til en arbeidsdag. Endre timene i listen under hvis det trengs, og merk merknaden som behandlet. Svaret ditt går til den ansatte.</p>
      <ul className="mt-3 space-y-3">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg border border-line p-3 text-sm">
            <div><span className="font-medium">{names.get(n.employee_id) ?? "Ukjent"}</span> · <span>{formatDateLong(n.date)}</span></div>
            <p className="mt-1">«{n.body}»</p>
            <form action={answerEntryNote} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={n.id} />
              <input name="answer" maxLength={2000} className="input min-w-0 flex-1" placeholder="Svar til den ansatte (valgfritt)" aria-label="Svar" />
              <button className="btn-primary">Merk som behandlet</button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
