import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { getContext, requireOrg } from "@/lib/context";
import { signOut, switchOrganization } from "../actions";
import { SelfEmployeeCard } from "@/components/SelfEmployeeCard";

async function resetCalendar() {
  "use server";
  const ctx = await requireOrg();
  await ctx.supabase.rpc("reset_calendar_token", { p_org: ctx.org.id });
  revalidatePath("/profil");
}

export default async function ProfilePage() {
  const ctx = await getContext();
  let calendarUrl: string | null = null;
  if (ctx.employeeId) {
    const { data } = await ctx.supabase.from("employees").select("calendar_token").eq("id", ctx.employeeId).single();
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (data?.calendar_token && host) calendarUrl = `${host}/api/kalender/${data.calendar_token}.ics`;
  }
  return (
    <div className="space-y-4">
      <h1 className="h1">Profil</h1>
      <section className="card">
        <div className="text-sm text-muted">Innlogget som</div>
        <div className="font-medium">{ctx.email}</div>
      </section>
      {calendarUrl && (
        <section className="card">
          <h2 className="h2">Vaktene i mobilkalenderen</h2>
          <p className="mt-1 text-sm text-muted">Legg til kalenderen én gang. Nye og endrede vakter og godkjent fravær dukker opp av seg selv. Kalender-appen oppdaterer vanligvis hver time.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`webcal://${calendarUrl}`} className="btn-primary">Legg til på iPhone / Mac</a>
            <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://${calendarUrl}`)}`} target="_blank" rel="noreferrer" className="btn-ghost">Google Kalender</a>
          </div>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-brand">Vis lenken (Outlook og andre)</summary>
            <p className="mt-2 break-all rounded-lg bg-paper p-2 font-mono text-xs">https://{calendarUrl}</p>
            <p className="mt-1 text-xs text-muted">Lenken er personlig. Del den ikke. Har den kommet på avveie, lag en ny:</p>
            <form action={resetCalendar} className="mt-2"><button className="btn-ghost">Lag ny lenke</button></form>
          </details>
        </section>
      )}
      {ctx.org && ctx.employeeId && (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="h2">Når kan du jobbe?</h2>
            <p className="text-sm text-muted">Fast ukemønster, dager du ikke kan, og ønske om ekstravakter.</p>
          </div>
          <Link href="/tilgjengelighet" className="btn-ghost">Åpne</Link>
        </section>
      )}
      {ctx.isAdmin && !ctx.employeeId && <SelfEmployeeCard email={ctx.email} />}
      {ctx.orgs.length > 1 && (
        <section className="card">
          <h2 className="h2">Bedrift</h2>
          <form action={switchOrganization} className="mt-3 flex gap-2">
            <select name="org" defaultValue={ctx.org?.id} className="input">
              {ctx.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button className="btn-ghost">Bytt</button>
          </form>
        </section>
      )}
      {ctx.isPlatformAdmin && (
        <section className="card">
          <div className="flex flex-wrap gap-3">
            <Link href="/plattform" className="font-medium text-brand">Plattform (InnSpæll)</Link>
            <Link href="/ny-bedrift" className="font-medium text-brand">Opprett ny bedrift</Link>
          </div>
        </section>
      )}
      <section className="card text-sm">
        <h2 className="h2">Personvern</h2>
        <div className="mt-2 flex flex-wrap gap-3">
          <a href="/api/eksport/meg" className="btn-ghost">Last ned mine data</a>
          <Link href="/personvern" className="btn-ghost">Personvernerklæring</Link>
        </div>
      </section>
      <form action={signOut}>
        <button className="btn-ghost w-full">Logg ut</button>
      </form>
    </div>
  );
}
