"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/(app)/actions";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;

/** Leder gir en ansatt innlogging: invitasjonslenke (anbefalt) eller midlertidig passord. E-post er påkrevd. */
export function LoginSetup({ passwordAction, inviteAction, employeeId, defaultLogin, hasLogin }: {
  passwordAction: Act; inviteAction: Act; employeeId: string; defaultLogin: string; hasLogin: boolean;
}) {
  const [mode, setMode] = useState<"invite" | "password">("invite");
  const [inviteState, invite, invitePending] = useActionState(inviteAction, undefined);
  const [pwState, setPw, pwPending] = useActionState(passwordAction, undefined);
  const state = mode === "invite" ? inviteState : pwState;
  const pending = mode === "invite" ? invitePending : pwPending;
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  function generate() {
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const p = Array.from(bytes, (b) => chars[b % chars.length]).join("");
    setPassword(`${p.slice(0, 5)}-${p.slice(5)}`);
    setShow(true);
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Hvordan skal den ansatte få passord?">
        {([
          ["invite", "Send lenke (anbefalt)", "Den ansatte lager passordet selv. Du kjenner det aldri."],
          ["password", "Sett midlertidig passord", "Når den ansatte trenger å komme i gang med en gang. Må byttes første gang."],
        ] as const).map(([k, t, d]) => (
          <label key={k} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${mode === k ? "border-brand bg-brand-soft" : "border-line"}`}>
            <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} className="mt-0.5 h-4 w-4" />
            <span><b className="block">{t}</b><span className="text-muted">{d}</span></span>
          </label>
        ))}
      </div>

      <form action={mode === "invite" ? invite : setPw} className="grid gap-3 md:grid-cols-2">
        <input type="hidden" name="employee_id" value={employeeId} />
        <div className={mode === "invite" ? "md:col-span-2" : ""}>
          <label className="label" htmlFor="login">E-post</label>
          <input id="login" name="login" type="email" required defaultValue={defaultLogin} autoComplete="off" className="input" placeholder="navn@eksempel.no" />
          <p className="mt-1 text-xs text-muted">Påkrevd. Brukes til innlogging, varsler og nytt passord.</p>
        </div>
        {mode === "password" && (
          <div>
            <label className="label" htmlFor="pw">{hasLogin ? "Nytt midlertidig passord" : "Midlertidig passord"}</label>
            <div className="flex gap-2">
              <input id="pw" name="password" required minLength={8} type={show ? "text" : "password"} autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)} className="input min-w-0 flex-1" />
              <button type="button" onClick={generate} className="btn-ghost shrink-0">Lag passord</button>
            </div>
            <label className="mt-1 flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Vis passordet
            </label>
          </div>
        )}
        <div className="space-y-1 text-sm md:col-span-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="send_welcome" defaultChecked className="h-4 w-4" />
            {mode === "invite" ? "Send lenken på e-post" : "Send velkomst-e-post med lenke til Vaktpilot"}
          </label>
          {mode === "password" && (
            <label className="flex items-center gap-2"><input type="checkbox" name="include_password" defaultChecked className="h-4 w-4" /> Ta med det midlertidige passordet i e-posten</label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button className="btn-primary" disabled={pending}>
            {pending ? "Lagrer …" : mode === "invite" ? (hasLogin ? "Send ny lenke" : "Lag invitasjon") : hasLogin ? "Sett nytt passord" : "Gi innlogging"}
          </button>
          {state?.error && <p className="text-sm text-bad">{state.error}</p>}
        </div>
      </form>

      {state?.ok && (
        <div className="rounded-lg bg-good-soft p-3 text-sm">
          <p className="font-semibold text-good">{state.ok}</p>
          {state.link && (
            <div className="mt-2 flex gap-2">
              <input readOnly value={state.link} onFocus={(e) => e.target.select()} className="input min-w-0 flex-1 text-xs" aria-label="Invitasjonslenke" />
              <button type="button" className="btn-ghost shrink-0" onClick={async () => {
                try { await navigator.clipboard.writeText(state.link!); setCopied(true); } catch { /* marker feltet i stedet */ }
              }}>{copied ? "Kopiert" : "Kopier"}</button>
            </div>
          )}
          {mode === "password" && <p className="mt-1">Første gang den ansatte logger inn, blir hen bedt om å lage sitt eget passord.</p>}
        </div>
      )}
    </div>
  );
}
