"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true },
    });
    setBusy(false);
    if (error) setError("Kunne ikke sende lenke. Prøv igjen om litt.");
    else setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="mb-8">
        <div className="text-sm font-semibold uppercase tracking-wider text-brand">Vaktpilot</div>
        <h1 className="h1 mt-1">Logg inn</h1>
        <p className="mt-2 text-muted">Vi sender deg en innloggingslenke på e-post. Bruk e-posten arbeidsgiveren din har registrert.</p>
      </div>
      {sent ? (
        <div className="card">
          <p className="font-semibold">Sjekk e-posten din</p>
          <p className="mt-1 text-sm text-muted">Vi har sendt en lenke til {email}. Åpne den på denne enheten.</p>
          <button className="btn-ghost mt-4 w-full" onClick={() => setSent(false)}>
            Bruk en annen e-post
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="card space-y-4">
          <div>
            <label className="label" htmlFor="email">E-post</label>
            <input id="email" type="email" required autoComplete="email" inputMode="email" className="input"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Sender …" : "Send innloggingslenke"}</button>
        </form>
      )}
    </main>
  );
}
