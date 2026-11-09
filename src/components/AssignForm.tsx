"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/(app)/actions";

/** Velg ansatt for en vakt. Lagrer med en gang man velger, og viser advarsler. */
export function AssignForm({
  action,
  shiftId,
  current,
  people,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  shiftId: string;
  current: string | null;
  people: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={shiftId} />
      <select
        name="employee_id"
        defaultValue={current ?? ""}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm"
        aria-label="Ansatt"
      >
        <option value="">Ledig</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {state?.error && <span className="max-w-64 text-right text-xs text-bad">{state.error}</span>}
    </form>
  );
}
