"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/(app)/actions";

/** Leder gir en ansatt innlogging: brukernavn eller e-post, og et startpassord. */
export function LoginSetup({ action, employeeId, defaultLogin, hasLogin }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  employeeId: string; defaultLogin: string; hasLogin: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);

  function generate() {
    // Lett å lese opp: ingen tegn som forveksles (0/O, 1/l/I)
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const p = Array.from(bytes, (b) => chars[b % chars.length]).join("");
    setPassword(`${p.slice(0, 5)}-${p.slice(5)}`);
    setShow(true);
  }

  return (
    <form action={formAction} className="mt-3 grid gap-3 md:grid-cols-2">
      <input type="hidden" name="employee_id" value={employeeId} />
      <div>
        <label className="label" htmlFor="login">Brukernavn eller e-post</label>
        <input id="login" name="login" required defaultValue={defaultLogin} autoComplete="off" className="input" placeholder="f.eks. ola.nordmann" />
        <p className="mt-1 text-xs text-muted">Uten e-post: skriv et brukernavn (3–30 tegn, a–z, tall og punktum).</p>
      </div>
      <div>
        <label className="label" htmlFor="pw">{hasLogin ? "Nytt startpassord" : "Startpassord"}</label>
        <div className="flex gap-2">
          <input id="pw" name="password" required minLength={8} type={show ? "text" : "password"} autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} className="input min-w-0 flex-1" />
          <button type="button" onClick={generate} className="btn-ghost shrink-0">Lag passord</button>
        </div>
        <label className="mt-1 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Vis passordet
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Lagrer …" : hasLogin ? "Sett nytt passord" : "Gi innlogging"}</button>
        {state?.error && <p className="text-sm text-bad">{state?.error}</p>}
      </div>
      {state?.ok && (
        <div className="rounded-lg bg-good-soft p-3 text-sm md:col-span-2">
          <p className="font-semibold text-good">{state?.ok}</p>
          <p className="mt-1">Gi den ansatte brukernavnet og passordet. Første gang de logger inn, blir de bedt om å lage sitt eget passord.</p>
        </div>
      )}
    </form>
  );
}
