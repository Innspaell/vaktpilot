"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "loading" | "verify" | "enroll" | "done";

/** Bekreft kode fra kodeappen, eller sett opp tofaktor første gang. */
export function TwoFactor() {
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [required, setRequired] = useState(false);

  const next = () => {
    const n = new URLSearchParams(window.location.search).get("next");
    return n && n.startsWith("/") && !n.startsWith("//") ? n : "/";
  };

  useEffect(() => {
    (async () => {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data: req } = await supabase.rpc("mfa_required");
      setRequired(Boolean(req));
      const wantsSetup = new URLSearchParams(window.location.search).get("sett-opp") === "1";
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = factors?.totp?.[0];
      if (verified) {
        if (aal?.currentLevel === "aal2" && !wantsSetup) { window.location.href = next(); return; }
        setFactorId(verified.id);
        setMode("verify");
        return;
      }
      if (!req && !wantsSetup) { window.location.href = next(); return; }
      // Rydd bort halvferdige oppsett før nytt
      for (const f of factors?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Vaktpilot ${new Date().toISOString().slice(0, 10)}`, issuer: "Vaktpilot" });
      if (e || !data) { setError("Kunne ikke starte oppsettet. Prøv igjen."); setMode("enroll"); return; }
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
      setMode("enroll");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    const c = code.replace(/\D/g, "");
    if (c.length !== 6) { setError("Koden har 6 sifre."); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: c });
    setBusy(false);
    if (err) { setError("Feil kode. Sjekk at klokka på mobilen stemmer, og prøv den nye koden."); setCode(""); return; }
    setMode("done");
    window.location.href = next();
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="card space-y-4">
      <div>
        <div className="text-sm font-semibold uppercase tracking-wider text-brand">Vaktpilot</div>
        <h1 className="h1 mt-1">{mode === "enroll" ? "Skru på tofaktor" : "Bekreft at det er deg"}</h1>
      </div>

      {mode === "loading" && <p className="text-sm text-muted">Et øyeblikk …</p>}

      {mode === "enroll" && (
        <>
          <p className="text-sm text-muted">
            {required ? "Som leder har du tilgang til alle ansattes opplysninger, så innloggingen din må ha et ekstra lag. " : ""}
            Det tar et par minutter, og du gjør det bare én gang.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Åpne en kodeapp på mobilen, for eksempel Google Authenticator, Microsoft Authenticator eller Passord-appen på iPhone.</li>
            <li>Skann QR-koden under. Er du på mobilen nå, kan du i stedet kopiere nøkkelen og lime den inn i appen.</li>
            <li>Skriv inn den 6-sifrede koden appen viser.</li>
          </ol>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR-kode for kodeappen" className="mx-auto h-48 w-48 rounded-lg border border-line bg-white p-2" />
          )}
          {secret && (
            <p className="text-center text-xs text-muted">
              Nøkkel: <code className="select-all break-all rounded bg-paper px-1 py-0.5 text-ink">{secret}</code>
            </p>
          )}
        </>
      )}

      {mode === "verify" && <p className="text-sm text-muted">Åpne kodeappen på mobilen og skriv inn koden for Vaktpilot.</p>}

      {(mode === "enroll" || mode === "verify") && (
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="label">Kode fra kodeappen</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} autoFocus
              className="input text-center text-2xl font-semibold tracking-[0.4em] tabular-nums" />
          </label>
          {error && <p className="text-sm text-bad">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Sjekker …" : mode === "enroll" ? "Skru på" : "Fortsett"}</button>
        </form>
      )}

      {mode === "verify" && (
        <p className="text-xs text-muted">Mistet mobilen? Kontakt lederen din, eller InnSpæll hvis du er leder, så nullstilles tofaktor.</p>
      )}
      <button type="button" onClick={logout} className="w-full text-center text-sm text-muted">Logg ut</button>
    </div>
  );
}
