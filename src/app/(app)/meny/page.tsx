import Link from "next/link";
import { getContext } from "@/lib/context";
import { LEAD } from "@/lib/nav-items";
import { navCounts } from "@/lib/nav-counts";

/** Meny på mobil for ledere: det personlige og lederområdene samlet. */
export default async function MenuPage() {
  const ctx = await getContext();
  const counts = ctx.org ? await navCounts(ctx) : { approvals: 0, mine: 0 };
  const row = (href: string, label: string, hint?: string, n = 0) => (
    <li key={href}>
      <Link href={href} className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 hover:bg-paper">
        <span><span className="block font-medium">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
        <span className="flex items-center gap-2">
          {n > 0 && <span className="badge bg-bad text-white">{n}</span>}
          <span className="text-muted">›</span>
        </span>
      </Link>
    </li>
  );
  const hints: Record<string, string> = {
    "/vaktplan/rediger": "Plan, bemanningsbehov og turnus",
    "/ansatte": "Avtaler, roller, innlogging og ferie",
    "/fravaer": "Søknader, vaktbytter og sykefravær",
    "/lonn": "Lønnsgrunnlag, avspasering og rapporter",
    "/innstillinger": "Bedrift, varsler og personvern",
  };
  return (
    <div className="space-y-4">
      <h1 className="h1">Meny</h1>
      <section>
        <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted">Meg</h2>
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {row("/profil", "Profil", "Kalenderlenke, passord og personvern")}
          {row("/tavle", "Oppslagstavle")}
          {ctx.canSetAvailability && row("/tilgjengelighet", "Når kan jeg jobbe")}
          {row("/varsler", "Varsler")}
        </ul>
      </section>
      {ctx.isAdmin && (
        <section>
          <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted">Ledelse</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {LEAD.map((l) => row(l.href, l.label, hints[l.href], l.count ? counts[l.count] : 0))}
          </ul>
        </section>
      )}
      {ctx.isPlatformAdmin && (
        <section>
          <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted">InnSpæll</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">{row("/plattform", "Plattform")}</ul>
        </section>
      )}
    </div>
  );
}
