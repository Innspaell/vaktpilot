"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEAD, leadItems } from "@/lib/nav-items";

export type { NavCounts } from "@/lib/nav-items";
import type { NavCounts } from "@/lib/nav-items";

const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z",
  plan: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  time: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  leave: "M4 5h16v11H8l-4 4z",
  me: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  menu: "M4 7h16M4 12h16M4 17h16",
};

/** Det alle bruker. «Å gjøre» er forsiden. */
const ME = [
  { href: "/", label: "Å gjøre", icon: ICONS.home, count: true },
  { href: "/vaktplan", label: "Vaktplan", icon: ICONS.plan },
  { href: "/timer", label: "Timer", icon: ICONS.time },
  { href: "/foresporsler", label: "Fri og bytte", icon: ICONS.leave },
  { href: "/profil", label: "Profil", icon: ICONS.me },
];
const PLAN_ICON = "M4 5h16v15H4zM4 9h16M9 9v11";

function isActive(path: string, href: string, match?: string[]) {
  if (match) return match.some((m) => path === m || path.startsWith(m + "/"));
  if (href === "/") return path === "/";
  if (href === "/vaktplan") return path === "/vaktplan" || path.startsWith("/vaktplan/vakt");
  return path === href || path.startsWith(href + "/");
}

function Badge({ n, inverted }: { n: number; inverted?: boolean }) {
  if (!n) return null;
  return (
    <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 ${inverted ? "bg-white text-brand" : "bg-bad text-white"}`}>
      {n > 9 ? "9+" : n}
    </span>
  );
}

/** Bunnmeny på mobil. Ledere: Å gjøre, Vaktplan, Planlegge, Timer og Meny (resten). */
export function BottomNav({ isAdmin, counts }: { isAdmin: boolean; counts: NavCounts }) {
  const path = usePathname();
  const items = isAdmin
    ? [ME[0], ME[1], { href: "/vaktplan/rediger", label: "Planlegge", icon: PLAN_ICON, count: false }, ME[2], { href: "/meny", label: "Meny", icon: ICONS.menu, count: false }]
    : ME;
  const planMatch = LEAD[0].match;
  const menuActive = isAdmin && (path === "/meny" || path === "/profil" || path.startsWith("/foresporsler")
    || LEAD.slice(1).some((l) => isActive(path, l.href, l.match)) || path.startsWith("/tavle"));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
      <ul className="grid grid-cols-5">
        {items.map((i) => {
          const on = i.href === "/meny" ? menuActive
            : i.href === "/vaktplan/rediger" ? isActive(path, i.href, planMatch)
            : isActive(path, i.href) && !(i.href === "/vaktplan" && isActive(path, "/vaktplan/rediger", planMatch));
          const n = i.count ? counts.todo : 0;
          return (
            <li key={i.href}>
              <Link href={i.href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${on ? "text-brand" : "text-muted"}`}>
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={i.icon} />
                </svg>
                {i.label}
                {n > 0 && <span className="absolute right-[18%] top-1"><Badge n={n} /></span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Sidemeny på PC. Ledere: arbeidsliste og lederområder øverst, det personlige under «Meg». */
export function SideNav({ isAdmin, canPlan, isPlatformAdmin, counts }: { isAdmin: boolean; canPlan: boolean; isPlatformAdmin?: boolean; counts: NavCounts }) {
  const path = usePathname();
  const link = (href: string, label: string, on: boolean, n = 0) => (
    <Link key={href} href={href}
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium ${on ? "bg-brand-soft text-brand" : "text-ink hover:bg-paper"}`}>
      <span>{label}</span>
      <Badge n={n} />
    </Link>
  );
  const heading = (t: string) => <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted">{t}</div>;
  const planOn = isActive(path, "/vaktplan/rediger", LEAD[0].match);
  return (
    <nav className="space-y-1">
      {canPlan ? (
        <>
          {link("/", "Å gjøre", path === "/", counts.todo)}
          {link("/vaktplan", "Vaktplan", isActive(path, "/vaktplan") && !planOn)}
          {leadItems(isAdmin).map((i) => link(i.href, i.label, isActive(path, i.href, i.match)))}
          {heading("Meg")}
          {link("/timer", "Mine timer", isActive(path, "/timer"))}
          {link("/foresporsler", "Fri og bytte", isActive(path, "/foresporsler"))}
          {link("/profil", "Profil", isActive(path, "/profil"))}
        </>
      ) : (
        ME.map((i) => link(i.href, i.label, isActive(path, i.href), i.count ? counts.todo : 0))
      )}
      {isPlatformAdmin && heading("InnSpæll")}
      {isPlatformAdmin && link("/plattform", "Plattform", path.startsWith("/plattform"))}
      <Link href={`/innspill?fra=${encodeURIComponent(path)}`}
        className={`mt-4 block rounded-lg px-3 py-2 text-sm ${path === "/innspill" ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-paper hover:text-ink"}`}>
        Ønsker og innspill
      </Link>
    </nav>
  );
}

/** Faner inne i et lederområde, f.eks. Planlegge: Plan · Bemanningsbehov · Turnus. */
export function SubNav({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  // Den mest presise fanen er aktiv (/ansatte/avdelinger slår /ansatte)
  const active = tabs.filter((t) => path === t.href || path.startsWith(t.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label="Underside">
      {tabs.map((t) => {
        const on = t.href === active;
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${on ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Viser riktige faner for lederområdet man står i. */
export function AreaTabs({ availability, personnelList = false, isAdmin = true }: { availability: boolean; personnelList?: boolean; isAdmin?: boolean }) {
  const path = usePathname();
  const plan = [
    { href: "/vaktplan/rediger", label: "Plan" },
    { href: "/bemanning", label: "Bemanningsbehov" },
    ...(isAdmin ? [{ href: "/turnus", label: "Turnus" }] : []),
    ...(availability ? [{ href: "/tilgjengelighet", label: "Når kan de jobbe" }] : []),
  ];
  const pay = [
    { href: "/lonn", label: "Lønn" },
    { href: "/rapporter", label: "Rapporter" },
    ...(personnelList && isAdmin ? [{ href: "/personalliste", label: "Personalliste" }] : []),
  ];
  const people = [
    { href: "/ansatte", label: "Ansatte" },
    { href: "/ansatte/avdelinger", label: "Avdelinger" },
    { href: "/fravaer", label: "Fravær" },
  ];
  const inGroup = (tabs: { href: string }[]) => tabs.some((t) => path === t.href || path.startsWith(t.href + "/"));
  if (inGroup(plan)) return <SubNav tabs={plan} />;
  if (inGroup(people)) return <SubNav tabs={people} />;
  if (inGroup(pay)) return <SubNav tabs={pay} />;
  return null;
}
