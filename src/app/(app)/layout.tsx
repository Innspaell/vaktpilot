import Link from "next/link";
import { getContext } from "@/lib/context";
import { BottomNav, SideNav, AdminStrip } from "@/components/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const { count: unread } = ctx.org
    ? await ctx.supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId).eq("org_id", ctx.org.id).is("read_at", null)
    : { count: 0 };
  const bell = ctx.org && (
    <Link href="/varsler" className="relative rounded-lg p-1.5 text-muted hover:bg-white hover:text-ink" aria-label={`Varsler${unread ? `, ${unread} uleste` : ""}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 004 0" />
      </svg>
      {unread ? <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-bad px-1 text-center text-[11px] font-bold leading-5 text-white">{unread > 9 ? "9+" : unread}</span> : null}
    </Link>
  );
  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-4 pb-24 pt-4 md:pb-10 md:pt-8">
      <aside className="hidden w-52 shrink-0 md:block">
        <div className="mb-6 px-3">
          {ctx.org?.logoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ctx.org.logoUrl} alt={ctx.org.name} className="max-h-16 w-auto max-w-full object-contain" />
              <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted">Vaktpilot</div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold uppercase tracking-wider text-brand">Vaktpilot</div>
              {ctx.org && <div className="mt-0.5 truncate text-sm text-muted">{ctx.org.name}</div>}
            </>
          )}
        </div>
        {ctx.org && <div className="mb-2 px-1">{bell}</div>}
        {(ctx.org || ctx.isPlatformAdmin) && <SideNav isAdmin={ctx.isAdmin} isPlatformAdmin={ctx.isPlatformAdmin} />}
      </aside>
      <main className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center justify-between gap-3 md:hidden">
          {ctx.org?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ctx.org.logoUrl} alt={ctx.org.name} className="h-10 w-auto max-w-[60%] object-contain" />
          ) : (
            <div className="text-sm font-semibold uppercase tracking-wider text-brand">Vaktpilot</div>
          )}
          <div className="flex min-w-0 items-center gap-2">
            {ctx.org && !ctx.org.logoUrl && <div className="truncate text-sm text-muted">{ctx.org.name}</div>}
            {bell}
          </div>
        </div>
        {ctx.isAdmin && <AdminStrip />}
        {children}
      </main>
      {ctx.org && <BottomNav />}
    </div>
  );
}
