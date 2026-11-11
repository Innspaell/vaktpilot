"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function AcceptInvite({ token, email }: { token: string; email: string }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (a.length < 8) return setError("Passordet må ha minst 8 tegn.");
    if (a !== b) return setError("Passordene er ikke like.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("accept_invite", { p_token: token, p_password: a });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: a });
    if (signErr) {
      window.location.href = "/login";
      return;
    }
    window.location.href = "/";
  }

  return (
    <form onSubmit={save} className="card space-y-4">
      <div>
        <div className="label">E-post</div>
        <div className="font-medium">{email}</div>
        <p className="text-xs text-muted">Dette er brukernavnet ditt når du logger inn.</p>
      </div>
      <div>
        <label className="label" htmlFor="p1">Velg passord</label>
        <input id="p1" type="password" autoComplete="new-password" required minLength={8} value={a} onChange={(e) => setA(e.target.value)} className="input" />
        <p className="mt-1 text-xs text-muted">Minst 8 tegn.</p>
      </div>
      <div>
        <label className="label" htmlFor="p2">Gjenta passordet</label>
        <input id="p2" type="password" autoComplete="new-password" required minLength={8} value={b} onChange={(e) => setB(e.target.value)} className="input" />
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Lagrer …" : "Lagre og logg inn"}</button>
    </form>
  );
}
