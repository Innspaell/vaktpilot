"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { autoPlanWeek, undoAutoPlan, clearAutoDrafts, type AutoPlanState } from "@/app/(app)/vaktplan/autoplan-actions";

function hours(min: number) {
  return (Math.round((min / 60) * 10) / 10).toLocaleString("nb-NO");
}

function Submit() {
  const { pending } = useFormStatus();
  return <button className="btn-primary" disabled={pending}>{pending ? "Lager forslag …" : "Lag forslag"}</button>;
}

export function AutoPlanPanel({ from, days, hasAutoDrafts }: { from: string; days: number; hasAutoDrafts: boolean }) {
  const [state, action] = useActionState<AutoPlanState, FormData>(autoPlanWeek, undefined);
  return (
    <details className="rounded-lg border border-line" open={Boolean(state)}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-brand">Lag vaktplan automatisk</summary>
      <div className="space-y-3 border-t border-line p-3">
        <p className="text-sm text-muted">
          Lager vakter ut fra bemanningsbehovet og fordeler dem etter stillingsprosent. Systemet tar hensyn til arbeidsroller, fravær og søknader om fri, og til
          11 timers hvile. Vakter som allerede finnes, beholdes. Alt lagres som utkast som du kan endre før du publiserer.
        </p>
        <form action={action} className="grid gap-3 md:grid-cols-4">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="days" value={days} />
          <label className="block">
            <span className="label">Lengste vakt (timer)</span>
            <input name="max_hours" type="number" step="0.5" min="2" max="13" defaultValue="8.5" className="input" />
          </label>
          <label className="block">
            <span className="label">Korteste vakt (timer)</span>
            <input name="min_hours" type="number" step="0.5" min="1" max="8" defaultValue="3" className="input" />
          </label>
          <label className="flex items-center gap-2 self-end pb-3 text-sm md:col-span-2">
            <input type="checkbox" name="create_open" defaultChecked className="h-4 w-4" />
            Lag ledige vakter for det ingen kan ta
          </label>
          <div className="flex flex-wrap items-center gap-3 md:col-span-4">
            <Submit />
            {state?.error && <span className="text-sm text-bad">{state.error}</span>}
            {state?.ok && <span className="text-sm text-good">{state.ok}</span>}
          </div>
        </form>

        {state?.summary && state.summary.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 pr-3 font-medium">Ansatt</th>
                  <th className="py-1 pr-3 text-right font-medium">Avtalt</th>
                  <th className="py-1 pr-3 text-right font-medium">Planlagt</th>
                  <th className="py-1 text-right font-medium">Nye vakter</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {state.summary.map((s) => {
                  const diff = s.planned - s.target;
                  return (
                    <tr key={s.name}>
                      <td className="py-1.5 pr-3">{s.name}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{hours(s.target)} t</td>
                      <td className={`py-1.5 pr-3 text-right tabular-nums ${diff < -60 ? "text-warn" : diff > 60 ? "text-bad" : "text-good"}`}>
                        {hours(s.planned)} t
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{s.shifts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">Oransje: under avtalt tid fordi behovet eller hviletiden ikke ga flere vakter. Rødt: over avtalt tid.</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {state?.runId && (
            <form action={undoAutoPlan}>
              <input type="hidden" name="run_id" value={state.runId} />
              <button className="btn-ghost">Angre dette forslaget</button>
            </form>
          )}
          {hasAutoDrafts && (
            <form action={clearAutoDrafts}>
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="days" value={days} />
              <button className="btn-ghost">Fjern alle automatiske utkast i perioden</button>
            </form>
          )}
        </div>
      </div>
    </details>
  );
}
