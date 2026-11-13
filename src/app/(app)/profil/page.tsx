import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { ChangePassword } from "@/components/ChangePassword";
import { getContext, requireOrg } from "@/lib/context";
import { signOut, switchOrganization } from "../actions";
import { SelfEmployeeCard } from "@/components/SelfEmployeeCard";
import { NOTIFICATION_GROUPS } from "@/lib/notification-kinds";

async function resetCalendar() {
  "use server";
  const ctx = await requireOrg();
  await ctx.supabase.rpc("reset_calendar_token", { p_org: ctx.org.id });
  revalidatePath("/profil");
}

async function setEmailNotifications(fd: FormData) {
  "use server";
  const ctx = await requireOrg();
  await ctx.supabase.rpc("set_my_email_notifications", { p_org: ctx.org.id, p_on: fd.get("on") === "1" });
  revalidatePath("/profil");
}

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ passord?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  // E-postvarsler: hvilke typer bedriften sender på e-post, og om jeg har reservert meg
  let emailGroups: string[] = [];
  let emailOn = true;
  if (ctx.org && ctx.userId) {
    const [{ data: o }, { data: m }] = await Promise.all([
      ctx.supabase.from("organizations").select("email_prefs").eq("id", ctx.org.id).single(),
      ctx.supabase.from("memberships").select("email_notifications").eq("org_id", ctx.org.id).eq("user_id", ctx.userId).maybeSingle(),
    ]);
    const prefs = (o?.email_prefs ?? {}) as Record<string, unknown>;
    emailGroups = NOTIFICATION_GROUPS
      .filter((g) => (g.to === "ansatte" || ctx.isAdmin) && g.kinds.some((k) => prefs[k] === true))
      .map((g) => g.label);
    emailOn = m?.email_notifications !== false;
  }
  let calendarUrl: string | null = null;
  let me: { name: string; roles: string; terms: string } | null = null;
  if (ctx.employeeId) {
    const [{ data }, { data: roleRows }, { data: term }] = await Promise.all([
      ctx.supabase.from("employees").select("calendar_token, full_name").eq("id", ctx.employeeId).single(),
      ctx.supabase.from("employee_work_roles").select("work_roles(name)").eq("employee_id", ctx.employeeId),
      ctx.supabase.from("employment_terms").select("position_pct, hours_per_week").eq("employee_id", ctx.employeeId).is("valid_to", null).maybeSingle(),
    ]);
    const roleNames = (roleRows ?? []).map((r) => (r.work_roles as unknown as { name: string } | null)?.name).filter(Boolean).join(", ");
    me = {
      name: data?.full_name ?? "",
      roles: roleNames,
      terms: term ? `${Number(term.position_pct ?? 0).toLocaleString("nb-NO")} % · ${Number(term.hours_per_week ?? 0).toLocaleString("nb-NO")} t/uke` : "",
    };
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (data?.calendar_token && host) calendarUrl = `${host}/api/kalender/${data.calendar_token}.ics`;
  }
  return (
    <div className="space-y-4">
      <h1 className="h1">Profil</h1>
      <section className="card">
        {me?.name && <div className="text-lg font-semibold">{me.name}</div>}
        <div className="text-sm text-muted">Innlogget som {ctx.email}</div>
        {me && (me.roles || me.terms || ctx.org) && (
          <dl className="mt-3 divide-y divide-line text-sm">
            {ctx.org && <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Bedrift</dt><dd className="text-right">{ctx.org.name}</dd></div>}
            {me.roles && <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Rolle</dt><dd className="text-right">{me.roles}</dd></div>}
            {me.terms && <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Stilling</dt><dd className="text-right">{me.terms}</dd></div>}
          </dl>
        )}
        <p className="mt-2 text-xs text-muted">Er noe feil? Si fra til lederen din.</p>
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
      {ctx.org && ctx.employeeId && ctx.canSetAvailability && (
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
      {ctx.org && (
        <section className="card">
          <h2 className="h2">Varsler på e-post</h2>
          {emailGroups.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{ctx.org.name} sender ikke varsler på e-post. Du ser varslene under bjella i appen.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">
                {ctx.org.name} sender disse varslene på e-post{ctx.email ? ` til ${ctx.email}` : ""}, i tillegg til i appen:
              </p>
              <ul className="mt-2 list-disc pl-5 text-sm">{emailGroups.map((g) => <li key={g}>{g}</li>)}</ul>
              <p className="mt-2 text-xs text-muted">Leser du varselet i appen innen to minutter, kommer det ingen e-post. Flere varsler samtidig kommer i én e-post.</p>
              <form action={setEmailNotifications} className="mt-3 flex flex-wrap items-center gap-3">
                <input type="hidden" name="on" value={emailOn ? "0" : "1"} />
                <span className={`badge ${emailOn ? "bg-good-soft text-good" : "bg-paper text-muted"}`}>{emailOn ? "Du får e-post" : "Du får ikke e-post"}</span>
                <button className="btn-ghost">{emailOn ? "Slå av e-post" : "Slå på e-post"}</button>
              </form>
            </>
          )}
        </section>
      )}
      <details id="passord" className="card" open={sp.passord === "1"}>
        <summary className="h2 cursor-pointer">Passord</summary>
        <p className="mb-3 mt-1 text-sm text-muted">Med passord kan du logge inn uten å vente på kode på e-post.</p>
        <ChangePassword />
      </details>
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
