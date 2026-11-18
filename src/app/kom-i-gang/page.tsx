import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignupForm, type SignupStatus } from "./SignupForm";
import { SupportContact } from "@/components/SupportContact";

export const metadata = { title: "Kom i gang – Vaktpilot" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const supabase = await createClient();
  const [{ data: status }, { data: { user } }] = await Promise.all([supabase.rpc("signup_status"), supabase.auth.getUser()]);
  const s = status as SignupStatus | null;
  const kr = (n: number) => `${Number(n).toLocaleString("nb-NO")} kr`;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <Link href="/" className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={32} height={32} className="rounded-lg" />
        <span className="text-lg font-extrabold">Vaktpilot</span>
      </Link>
      <h1 className="h1 mt-6">Kom i gang med Vaktpilot</h1>

      {!s?.open_for_me ? (
        <div className="card mt-4 space-y-2">
          <p className="font-semibold">Registreringen åpner når testfasen er over.</p>
          <p className="text-sm text-muted">Vi prøver Vaktpilot ut sammen med de første bedriftene nå. Har du allerede en bruker, kan du <Link href="/login" className="text-brand">logge inn</Link>.</p>
        </div>
      ) : (
        <>
          <p className="mt-2 text-muted">
            {s.trial_days > 0 ? `De første ${s.trial_days} dagene er gratis. ` : ""}
            Deretter {kr(s.base)} per måned eks. mva. med {s.included} aktive ansatte inkludert{Number(s.per) > 0 ? `, og ${kr(s.per)} per ekstra aktiv ansatt` : ""}.
            {s.lock_months > 0 ? ` Prisen er fast i ${s.lock_months} måneder.` : ""} Ingen bindingstid.
          </p>
          {!s.open && <p className="card mt-3 bg-warn-soft text-sm text-warn">Registreringen er stengt for andre. Du ser den fordi du er plattform-admin.</p>}
          {!s.email_ready && !user && <p className="card mt-3 bg-warn-soft text-sm text-warn">E-postutsending er ikke satt opp, så koden kan ikke sendes ennå.</p>}
          <SignupForm status={s} loggedInEmail={user?.email ?? null} />
        </>
      )}
      <SupportContact intro="Spørsmål før du bestemmer deg? Kontakt oss på" className="mt-8 text-sm text-muted" />
    </main>
  );
}
