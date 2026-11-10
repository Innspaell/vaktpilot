import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { ActionForm } from "@/components/Form";
import { NOTIFICATION_GROUPS, groupEnabled, type NotificationGroup } from "@/lib/notification-kinds";
import { saveNotificationPrefs } from "./actions";

export default async function NotificationSettingsPage() {
  const ctx = await requireAdmin();
  const { data: org } = await ctx.supabase.from("organizations").select("notification_prefs").eq("id", ctx.org.id).single();
  const prefs = (org?.notification_prefs ?? {}) as Record<string, unknown>;

  const list = (to: NotificationGroup["to"]) => NOTIFICATION_GROUPS.filter((g) => g.to === to).map((g) => (
    <li key={g.key}>
      <label className="flex cursor-pointer items-start gap-3 py-3">
        <input type="checkbox" name={`g_${g.key}`} defaultChecked={groupEnabled(prefs, g)} className="mt-0.5 h-5 w-5 shrink-0" />
        <span className="min-w-0">
          <span className="block font-medium">{g.label}</span>
          <span className="block text-sm text-muted">{g.description}</span>
          {g.autoResolves && <span className="mt-0.5 block text-xs text-good">Merkes som lest av seg selv {g.autoResolves}.</span>}
        </span>
      </label>
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
      <p className="text-xs text-muted">E-post kommer i tillegg når e-postutsending er satt opp. Den følger de samme valgene.</p>
    </div>
  );
}
