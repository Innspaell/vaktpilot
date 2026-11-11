import { createClient } from "@/lib/supabase/server";
import { AcceptInvite } from "./AcceptInvite";

export const dynamic = "force-dynamic";

export default async function WelcomePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = /^[0-9a-f]{48}$/.test(token) ? await supabase.rpc("invite_info", { p_token: token }) : { data: null };
  const info = Array.isArray(data) ? data[0] : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="mb-6">
        {info?.logo_url ? (
          <div className="flex items-center justify-between gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={info.logo_url} alt={info.org_name} className="max-h-14 w-auto max-w-[60%] object-contain" />
            <span className="text-xs font-semibold uppercase tracking-wider text-brand">Vaktpilot</span>
          </div>
        ) : (
          <div className="text-sm font-semibold uppercase tracking-wider text-brand">Vaktpilot</div>
        )}
        {info ? (
          <>
            <h1 className="h1 mt-4">Velkommen, {info.full_name.split(" ")[0]}!</h1>
            <p className="mt-2 text-muted">{info.org_name} bruker Vaktpilot til vaktplan, timer og fravær. Lag passordet ditt, så er du i gang.</p>
          </>
        ) : (
          <>
            <h1 className="h1 mt-1">Lenken virker ikke</h1>
            <p className="mt-2 text-muted">Den er brukt, utløpt eller skrevet feil. Be lederen din om en ny lenke, eller logg inn hvis du allerede har passord.</p>
            <a href="/login" className="btn-primary mt-4 inline-flex">Til innlogging</a>
          </>
        )}
      </div>
      {info && <AcceptInvite token={token} email={info.email} />}
    </main>
  );
}
