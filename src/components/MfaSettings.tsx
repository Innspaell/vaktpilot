"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Tofaktor på profilsiden: status, skru på, bytt mobil eller skru av (når det ikke er påkrevd). */
export function MfaSettings({ required }: { required: boolean }) {
  const supabase = createClient();
  const [factorId, setFactorId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => setFactorId(data?.totp?.[0]?.id ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(thenSetup: boolean) {
    if (!factorId) return;
    if (!thenSetup && !confirm("Skru av tofaktor?")) return;
    setBusy(true);
    const { error: e } = await supabase.auth.mfa.unenroll({ factorId });
    if (e) { setBusy(false); setError("Kunne ikke endre. Logg ut og inn igjen, og prøv på nytt."); return; }
    await supabase.auth.refreshSession();
    window.location.href = thenSetup ? "/tofaktor?sett-opp=1&next=/profil" : "/profil";
  }

  if (factorId === undefined) return <p className="text-sm text-muted">Henter …</p>;
  return (
    <div className="space-y-2 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span className={`badge ${factorId ? "bg-good-soft text-good" : "bg-paper text-muted"}`}>{factorId ? "På" : "Av"}</span>
        <span className="text-muted">
          {required ? "Påkrevd for ledere. " : ""}Ved ny innlogging skriver du inn en kode fra kodeappen på mobilen.
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {!factorId && <a href="/tofaktor?sett-opp=1&next=/profil" className="btn-primary">Skru på tofaktor</a>}
        {factorId && <button type="button" onClick={() => remove(true)} disabled={busy} className="btn-ghost">Ny mobil / sett opp på nytt</button>}
        {factorId && !required && <button type="button" onClick={() => remove(false)} disabled={busy} className="btn-ghost text-bad">Skru av</button>}
      </div>
      {error && <p className="text-bad">{error}</p>}
    </div>
  );
}
