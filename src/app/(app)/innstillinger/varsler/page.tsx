import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { ActionForm } from "@/components/Form";
import { NOTIFICATION_GROUPS, groupEnabled, type NotificationGroup } from "@/lib/notification-kinds";
import { saveNotificationPrefs } from "./actions";

export default async function NotificationSettingsPage() {
  const ctx = await requireAdmin();
  const [{ data: org }, { data: ready }] = await Promise.all([
    ctx.supabase.from("organizations").select("notification_prefs, email_prefs").eq("id", ctx.org.id).single(),
    ctx.supabase.rpc("email_sending_ready"),
  ]);
  const prefs = (org?.notification_prefs ?? {}) as Record<string, unknown>;
  const emailPrefs = (org?.email_prefs ?? {}) as Record<string, unknown>;

  const list = (to: NotificationGroup["to"]) => NOTIFICATION_GROUPS.filter((g) => g.to === to).map((g) => (
    <li key={g.key}>
      <div className="flex items-start gap-3 py-3">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{g.label}</span>
          <span className="block text-sm text-muted">{g.description}</span>
          {g.autoResolves && <span className="mt-0.5 block text-xs text-good">Merkes som lest av seg selv {g.autoResolves}.</span>}
        </span>
        <label className="flex w-14 shrink-0 cursor-pointer flex-col items-center gap-1 text-xs text-muted">
          <input type="checkbox" name={`g_${g.key}`} defaultChecked={groupEnabled(prefs, g)} className="h-5 w-5" aria-label={`${g.label} i appen`} />
          Appen
        </label>
        <label className="flex w-14 shrink-0 cursor-pointer flex-col items-center gap-1 text-xs text-muted">
          <input type="checkbox" name={`e_${g.key}`} defaultChecked={g.kinds.some((k) => emailPrefs[k] === true)} className="h-5 w-5" aria-label={`${g.label} på e-post`} />
          E-post
        </label>
      </div>
    </li>
  ));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/innstillinger" className="text-sm text-brand">‹ Innstillinger</Link>
        <h1 className="h1 mt-1">Varsler</h1>
        <p className="mt-1 text-sm text-muted">
          Velg hvilke varsler Vaktpilot sender i bedriften. Varslene vises under bjella i appen.
          Et varsel blir merket som lest når mottakeren trykker på det, og noen også av seg selv når saken er løst.
          Det du slår av her, blir ikke sendt i det hele tatt.
        </p>
      </div>
      <section className="card text-sm">
        <h2 className="h2">Varsler på e-post</h2>
        <p className="mt-1 text-muted">
          E-post er av til du slår det på for en varseltype. Når du slår på e-post, får alle i bedriften beskjed i appen om hvilke varsler som kommer på e-post,
          og hver enkelt kan slå av e-post for seg selv under Profil. E-posten venter to minutter: leses varselet i appen før det, sendes ingen e-post.
          Flere varsler samtidig samles i én e-post. E-post sendes bare for varsler som også er på i appen.
        </p>
        {!ready && <p className="mt-2 rounded-lg bg-warn-soft p-2 text-warn">E-postutsending er ikke koblet til ennå. Valgene lagres, men e-post sendes først når InnSpæll har koblet den til.</p>}
      </section>
      <ActionForm action={saveNotificationPrefs} className="space-y-4">
        <section className="card">
          <h2 className="h2">Til ansatte</h2>
          <ul className="mt-1 divide-y divide-line">{list("ansatte")}</ul>
        </section>
        <section className="card">
          <h2 className="h2">Til ledere og administratorer</h2>
          <ul className="mt-1 divide-y divide-line">{list("ledere")}</ul>
        </section>
      </ActionForm>
      
    </div>
  );
}
