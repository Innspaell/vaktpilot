"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const EMPLOYEE = [
  { href: "/", label: "Hjem", icon: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" },
  { href: "/vaktplan", label: "Vaktplan", icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { href: "/timer", label: "Timer", icon: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/foresporsler", label: "Forespørsler", icon: "M4 5h16v11H8l-4 4z" },
  { href: "/profil", label: "Profil", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" },
];

const ADMIN = [
  { href: "/ansatte", label: "Ansatte" },
  { href: "/innstillinger", label: "Innstillinger" },
];

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="grid grid-cols-5">
        {EMPLOYEE.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active(path, i.href) ? "text-brand" : "text-muted"}`}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={i.icon} />
              </svg>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SideNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const link = (href: string, label: string) => (
    <Link key={href} href={href}
      className={`block rounded-lg px-3 py-2 text-sm font-medium ${active(path, href) ? "bg-brand-soft text-brand" : "text-ink hover:bg-paper"}`}>
      {label}
    </Link>
  );
  return (
    <nav className="space-y-1">
      {EMPLOYEE.map((i) => link(i.href, i.label))}
      {isAdmin && <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted">Administrasjon</div>}
      {isAdmin && ADMIN.map((i) => link(i.href, i.label))}
    </nav>
  );
}

export function AdminStrip() {
  const path = usePathname();
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 md:hidden">
      {ADMIN.map((i) => (
        <Link key={i.href} href={i.href}
          className={`badge whitespace-nowrap px-3 py-1.5 text-sm ${active(path, i.href) ? "bg-brand text-white" : "bg-white text-ink ring-1 ring-line"}`}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}
