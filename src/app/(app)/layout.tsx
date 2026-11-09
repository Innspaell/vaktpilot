import { getContext } from "@/lib/context";
import { BottomNav, SideNav, AdminStrip } from "@/components/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
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
        {ctx.org && <SideNav isAdmin={ctx.isAdmin} />}
      </aside>
      <main className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center justify-between gap-3 md:hidden">
          {ctx.org?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ctx.org.logoUrl} alt={ctx.org.name} className="h-10 w-auto max-w-[60%] object-contain" />
          ) : (
            <div className="text-sm font-semibold uppercase tracking-wider text-brand">Vaktpilot</div>
          )}
          {ctx.org && !ctx.org.logoUrl && <div className="truncate text-sm text-muted">{ctx.org.name}</div>}
          {ctx.org?.logoUrl && <div className="text-xs font-semibold uppercase tracking-wider text-muted">Vaktpilot</div>}
        </div>
        {ctx.isAdmin && <AdminStrip />}
        {children}
      </main>
      {ctx.org && <BottomNav />}
    </div>
  );
}
