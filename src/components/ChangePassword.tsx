"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Bytt passord. Brukes når lederen har gitt et startpassord, og på profilen. */
export function ChangePassword({ required = false }: { required?: boolean }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (a.length < 8) return setError("Passordet må ha minst 8 tegn.");
    if (a !== b) return setError("Passordene er ikke like.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: a });
    if (error) {
      setBusy(false);
      setError(error.message.includes("different") ? "Velg et annet passord enn startpassordet." : "Kunne ikke lagre passordet. Prøv igjen.");
      return;
    }
    await supabase.rpc("password_changed");
    setBusy(false);
    setDone(true);
    setA(""); setB("");
    if (required) window.location.reload();
  }

  if (done && !required) return <p className="text-sm text-good">Passordet er byttet.</p>;
  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="np1">Nytt passord</label>
        <input id="np1" type="password" autoComplete="new-password" required minLength={8} value={a} onChange={(e) => setA(e.target.value)} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="np2">Gjenta passordet</label>
        <input id="np2" type="password" autoComplete="new-password" required minLength={8} value={b} onChange={(e) => setB(e.target.value)} className="input" />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Lagrer …" : "Lagre passord"}</button>
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    </form>
  );
}
