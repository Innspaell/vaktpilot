"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Innlogging med engangskode på e-post. Koden skrives inn her, så den virker også
 * i appen på hjemskjermen (en lenke åpnes ofte i Safari i stedet).
 * E-posten inneholder også en lenke som reserve.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      setError(error.status === 429 ? "For mange forsøk. Vent et minutt og prøv igjen." : "Kunne ikke sende kode. Prøv igjen om litt.");
      return;
    }
    setStep("code");
    setTimeout(() => codeRef.current?.focus(), 50);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length < 6) {
      setError("Skriv inn hele koden.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: "email" });
    if (error) {
      setBusy(false);
      setError("Koden er feil eller utløpt. Sjekk e-posten eller be om en ny kode.");
      return;
    }
    await supabase.rpc("claim_invites");
    window.location.href = "/";
  }

  // Passord finnes bare for testbrukere som er opprettet med passord i Supabase. Vanlige brukere bruker kode.
  async function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      setBusy(false);
      setError("Feil e-post eller passord.");
      return;
    }
    await supabase.rpc("claim_invites");
    window.location.href = "/";
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="mb-8">
        <div className="text-sm font-semibold uppercase tracking-wider text-brand">Vaktpilot</div>
        <h1 className="h1 mt-1">Logg inn</h1>
        <p className="mt-2 text-muted">
          {step === "email"
            ? "Vi sender deg en kode på e-post. Bruk e-posten arbeidsgiveren din har registrert."
            : step === "password"
              ? "Innlogging med passord er bare for testbrukere."
              : `Vi har sendt en kode til ${email}. Den gjelder i en time.`}
        </p>
      </div>

      {step === "email" ? (
        <form onSubmit={sendCode} className="card space-y-4">
          <div>
            <label className="label" htmlFor="email">E-post</label>
            <input id="email" type="email" required autoComplete="email" inputMode="email" className="input"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Sender …" : "Send kode"}</button>
          <button type="button" className="w-full text-center text-xs text-muted hover:text-brand" onClick={() => { setStep("password"); setError(null); }}>
            Logg inn med passord (testbruker)
          </button>
        </form>
      ) : step === "password" ? (
        <form onSubmit={passwordLogin} className="card space-y-4">
          <div>
            <label className="label" htmlFor="pemail">E-post</label>
            <input id="pemail" type="email" required autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">Passord</label>
            <input id="password" type="password" required autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Logger inn …" : "Logg inn"}</button>
          <button type="button" className="w-full text-center text-sm text-brand" onClick={() => { setStep("email"); setError(null); }}>Tilbake til innlogging med kode</button>
        </form>
      ) : (
        <form onSubmit={verify} className="card space-y-4">
          <div>
            <label className="label" htmlFor="code">Kode fra e-posten</label>
            <input id="code" ref={codeRef} required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]*" maxLength={10}
              className="input text-center text-2xl font-semibold tracking-[0.4em] tabular-nums"
              value={code} onChange={(e) => setCode(e.target.value)} placeholder="••••••" />
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Logger inn …" : "Logg inn"}</button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-brand" onClick={() => { setStep("email"); setCode(""); setError(null); }}>Annen e-post</button>
            <button type="button" className="text-brand" disabled={busy} onClick={() => sendCode()}>Send ny kode</button>
          </div>
          <p className="text-xs text-muted">Fikk du en lenke i stedet? Den virker også. Åpne den på denne enheten.</p>
        </form>
      )}
    </main>
  );
}
