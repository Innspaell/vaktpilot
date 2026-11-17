"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CompanyLookup } from "@/components/CompanyLookup";
import { completeSignup, createSignupForMe, requestSignupCode } from "./actions";

export type SignupStatus = {
  open: boolean; open_for_me: boolean; email_ready: boolean;
  base: number; included: number; per: number; trial_days: number; lock_months: number;
  rule_sets: { id: string; name: string; description: string | null }[];
};

export function SignupForm({ status, loggedInEmail }: { status: SignupStatus; loggedInEmail: string | null }) {
  const form = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState<"details" | "code">("details");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hasUser, setHasUser] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.current) return;
    setBusy(true);
    setError(null);
    const fd = new FormData(form.current);
    const res = loggedInEmail ? await createSignupForMe(fd) : step === "details" ? await requestSignupCode(fd) : await completeSignup(fd);
    setBusy(false);
    setHasUser(Boolean(res.hasUser));
    if (res.error && !res.ok) {
      setError(res.error);
      return;
    }
    if (!loggedInEmail && step === "details") {
      setStep("code");
      setTimeout(() => form.current?.querySelector<HTMLInputElement>("#code")?.focus(), 50);
      return;
    }
    if (res.error) {
      setError(res.error);
      window.location.href = "/login";
      return;
    }
    // Ledere må sette opp tofaktor før de kommer inn; appen sender dit automatisk
    window.location.href = "/";
  }

  return (
    <form ref={form} onSubmit={submit} className="mt-6 space-y-4">
      <div className={step === "details" ? "space-y-4" : "hidden"}>
        <section className="card space-y-4">
          <h2 className="h2">Bedriften</h2>
          <div className="grid gap-4 md:grid-cols-2"><CompanyLookup /></div>
          <label className="block">
            <span className="label">Tariffavtale</span>
            <select name="rule_set" className="input" defaultValue="">
              <option value="">Ingen tariffavtale (arbeidsmiljøloven)</option>
              {status.rule_sets.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-muted">Usikker? Velg ingen. Du kan endre det under Innstillinger senere, og be oss legge inn en avtale som mangler.</span>
          </label>
        </section>

        <section className="card space-y-4">
          <h2 className="h2">Deg</h2>
          <p className="-mt-2 text-sm text-muted">Du blir eier og administrator i Vaktpilot for bedriften.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block"><span className="label">Navn</span><input name="full_name" required autoComplete="name" className="input" /></label>
            <label className="block"><span className="label">Mobil</span><input name="phone" type="tel" autoComplete="tel" inputMode="tel" className="input" /></label>
            {loggedInEmail ? (
              <p className="text-sm text-muted md:col-span-2">Du er logget inn som <b className="text-ink">{loggedInEmail}</b>.</p>
            ) : (
              <label className="block md:col-span-2">
                <span className="label">E-post</span>
                <input name="email" type="email" required autoComplete="email" inputMode="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
                <span className="mt-1 block text-xs text-muted">Vi sender en kode hit for å bekrefte at det er din.</span>
              </label>
            )}
            <label className="block md:col-span-2">
              <span className="label">E-post for faktura (valgfritt)</span>
              <input name="invoice_email" type="email" inputMode="email" className="input" placeholder={loggedInEmail ?? (email || "Samme som over")} />
            </label>
          </div>
        </section>

        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="accept" required className="mt-1 h-4 w-4" />
          <span>
            Jeg godtar <Link href="/vilkar" target="_blank" className="text-brand underline">vilkårene</Link> og <Link href="/vilkar#databehandleravtale" target="_blank" className="text-brand underline">databehandleravtalen</Link> på vegne av bedriften, og har lov til det.
          </span>
        </label>
      </div>

      {step === "code" && (
        <section className="card space-y-4">
          <h2 className="h2">Bekreft e-posten</h2>
          <p className="-mt-2 text-sm text-muted">Vi har sendt en kode til <b className="text-ink">{email}</b>. Den gjelder i en time.</p>
          <label className="block">
            <span className="label">Kode</span>
            <input id="code" name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="input w-40 text-lg tracking-widest" />
          </label>
          <label className="block">
            <span className="label">Lag et passord</span>
            <input name="password" type="password" required minLength={10} autoComplete="new-password" className="input" />
            <span className="mt-1 block text-xs text-muted">Minst 10 tegn. Etterpå setter du opp tofaktor med en app på mobilen, siden du blir leder.</span>
          </label>
          <button type="button" className="text-sm text-brand" onClick={() => { setStep("details"); setError(null); }}>‹ Tilbake og endre</button>
        </section>
      )}

      {error && (
        <p className="text-sm text-bad">
          {error}{" "}
          {hasUser && <Link href="/login?next=/kom-i-gang" className="font-semibold text-brand">Logg inn</Link>}
        </p>
      )}
      <button className="btn-primary w-full sm:w-auto" disabled={busy}>
        {busy ? "Et øyeblikk …" : loggedInEmail ? "Registrer bedriften" : step === "details" ? "Send kode" : "Registrer bedriften"}
      </button>
    </form>
  );
}
