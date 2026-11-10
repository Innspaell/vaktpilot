"use client";

import { useActionState, useState } from "react";
import { markAbsent } from "@/app/(app)/vaktplan/actions";
import type { ActionState } from "@/app/(app)/actions";

export function AbsentForm({ shiftId, back, types }: { shiftId: string; back: string; types: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(markAbsent, undefined);
  const [handle, setHandle] = useState("open");
  return (
    <form action={action} className="mt-3 space-y-4">
      <input type="hidden" name="shift_id" value={shiftId} />
      <input type="hidden" name="back" value={back} />

      <fieldset>
        <legend className="label">Årsak</legend>
        <div className="grid grid-cols-2 gap-2">
          {types.map((t, i) => (
            <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="radio" name="absence_type_id" value={t.id} defaultChecked={i === 0} className="h-4 w-4" />
              {t.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Hva skjer med vakten?</legend>
        <div className="space-y-2 text-sm">
          {[
            ["open", "Gjør vakten ledig", "Andre kan melde seg på den."],
            ["cancel", "Fjern vakten", "Ingen skal jobbe den."],
            ["keep", "Behold vakten", "Fravær bare deler av dagen."],
          ].map(([v, title, hint]) => (
            <label key={v} className="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2.5 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="radio" name="handle" value={v} checked={handle === v} onChange={() => setHandle(v)} className="mt-0.5 h-4 w-4" />
              <span><span className="font-medium">{title}</span><span className="block text-xs text-muted">{hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      {handle === "keep" && (
        <label className="block">
          <span className="label">Timer borte</span>
          <input name="partial_hours" type="number" step="0.5" min="0.5" max="12" required className="input" />
        </label>
      )}

      <label className="block">
        <span className="label">Kommentar (valgfritt)</span>
        <input name="comment" className="input" placeholder="F.eks. ringte inn kl. 07" />
      </label>

      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Lagrer …" : "Sett fraværende"}</button>
        {state?.error && <span className="text-sm text-bad">{state.error}</span>}
      </div>
    </form>
  );
}
