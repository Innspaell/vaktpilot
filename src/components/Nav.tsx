"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEAD } from "@/lib/nav-items";

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

/** Det alle bruker. */
const ME = [
  { href: "/", label: "Hjem", icon: ICONS.home },
  { href: "/vaktplan", label: "Vaktplan", icon: ICONS.plan },
  { href: "/timer", label: "Timer", icon: ICONS.time },
  { href: "/foresporsler", label: "Fri og bytte", icon: ICONS.leave, count: "mine" as const },
  { href: "/profil", label: "Profil", icon: ICONS.me },
];


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

/** Bunnmeny på mobil. Ledere får «Meny» i stedet for Profil, der alt annet ligger. */
export function BottomNav({ isAdmin, counts }: { isAdmin: boolean; counts: NavCounts }) {
  const path = usePathname();
  const items = isAdmin
    ? [...ME.slice(0, 4), { href: "/meny", label: "Meny", icon: ICONS.menu, count: undefined }]
    : ME;
  const menuActive = isAdmin && (path === "/meny" || path === "/profil" || LEAD.some((l) => isActive(path, l.href, l.match)) || path.startsWith("/tavle"));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="grid grid-cols-5">
        {items.map((i) => {
          const on = i.href === "/meny" ? menuActive : isActive(path, i.href) && !(i.href === "/vaktplan" && menuActive);
          const n = i.href === "/meny" ? counts.approvals : i.count ? counts[i.count] : 0;
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

/** Sidemeny på PC: «Meg» og «Ledelse». */
export function SideNav({ isAdmin, isPlatformAdmin, counts }: { isAdmin: boolean; isPlatformAdmin?: boolean; counts: NavCounts }) {
  const path = usePathname();
  const link = (href: string, label: string, on: boolean, n = 0) => (
    <Link key={href} href={href}
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium ${on ? "bg-brand-soft text-brand" : "text-ink hover:bg-paper"}`}>
      <span>{label}</span>
      <Badge n={n} />
    </Link>
  );
  const heading = (t: string) => <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted">{t}</div>;
  return (
    <nav className="space-y-1">
      {isAdmin && heading("Meg")}
      {ME.map((i) => link(i.href, i.label, isActive(path, i.href), i.count ? counts[i.count] : 0))}
      {isAdmin && heading("Ledelse")}
      {isAdmin && LEAD.map((i) => link(i.href, i.label, isActive(path, i.href, i.match), i.count ? counts[i.count] : 0))}
      {isPlatformAdmin && heading("InnSpæll")}
      {isPlatformAdmin && link("/plattform", "Plattform", path.startsWith("/plattform"))}
    </nav>
  );
}

/** Faner inne i et lederområde, f.eks. Planlegge: Plan · Bemanningsbehov · Turnus. */
export function SubNav({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label="Underside">
      {tabs.map((t) => {
        const on = path === t.href || path.startsWith(t.href + "/");
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
export function AreaTabs({ availability }: { availability: boolean }) {
  const path = usePathname();
  const plan = [
    { href: "/vaktplan/rediger", label: "Plan" },
    { href: "/bemanning", label: "Bemanningsbehov" },
    { href: "/turnus", label: "Turnus" },
    ...(availability ? [{ href: "/tilgjengelighet", label: "Når kan de jobbe" }] : []),
  ];
  const pay = [
    { href: "/lonn", label: "Lønn" },
    { href: "/rapporter", label: "Rapporter" },
  ];
  const inGroup = (tabs: { href: string }[]) => tabs.some((t) => path === t.href || path.startsWith(t.href + "/"));
  if (inGroup(plan)) return <SubNav tabs={plan} />;
  if (inGroup(pay)) return <SubNav tabs={pay} />;
  return null;
}
