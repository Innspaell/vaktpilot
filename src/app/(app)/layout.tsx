import Link from "next/link";
import { getContext } from "@/lib/context";
import { AreaTabs, BottomNav, SideNav } from "@/components/Nav";
import { navCounts } from "@/lib/nav-counts";
import { ServiceNotices } from "@/components/ServiceNotices";
import { SupportContact } from "@/components/SupportContact";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const { count: unread } = ctx.org
    ? await ctx.supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId).eq("org_id", ctx.org.id).is("read_at", null)
    : { count: 0 };
  const counts = ctx.org ? await navCounts(ctx) : { approvals: 0, mine: 0 };
  // Ansatte uten pårørende får et varsel øverst til minst én er lagt inn
  const { count: kin } = ctx.org && ctx.employeeId
    ? await ctx.supabase.from("emergency_contacts").select("id", { count: "exact", head: true }).eq("employee_id", ctx.employeeId)
    : { count: null };
  const kinNotice = ctx.org && ctx.employeeId && kin === 0 && (
    <Link href="/profil#parorende" className="card flex items-center justify-between gap-3 border-warn bg-warn-soft" role="status">
      <span>
        <b className="block text-warn">Legg inn nærmeste pårørende</b>
        <span className="text-sm">Hvem skal kontaktes hvis noe skjer med deg på jobb? Legg inn minst én person.</span>
      </span>
      <span className="text-warn">›</span>
    </Link>
  );
  // Forfalte fakturaer vises for lederne øverst på alle sider
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date());
  const { data: overdue } = ctx.org && ctx.isLeader
    ? await ctx.supabase.from("invoices").select("invoice_number, gross, due_date, kid, bank_account").eq("org_id", ctx.org.id).eq("status", "sent").lt("due_date", today).order("due_date")
    : { data: null };
  const kr = (n: number) => `${Number(n).toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
  const billingNotice = ctx.org && ctx.isLeader && (ctx.org.blocked || (overdue?.length ?? 0) > 0) && (
    <div className={`card ${ctx.org.blocked ? "bg-bad-soft" : "bg-warn-soft"}`} role="status">
      <p className={`font-semibold ${ctx.org.blocked ? "text-bad" : "text-warn"}`}>
        {ctx.org.blocked ? "Tilgangen for ledere er sperret fordi en faktura ikke er betalt" : overdue!.length === 1 ? "En faktura har forfalt" : `${overdue!.length} fakturaer har forfalt`}
      </p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {(overdue ?? []).map((i) => (
          <li key={i.invoice_number ?? i.due_date}>
            Faktura {i.invoice_number}: {kr(i.gross)}, forfalt {i.due_date.split("-").reverse().join(".")}
            {i.bank_account ? `, konto ${i.bank_account}` : ""}{i.kid ? `, KID ${i.kid}` : ""}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-sm">
        {ctx.org.blocked
          ? "Du ser Vaktpilot som en vanlig ansatt til betalingen er registrert. Da åpnes alt igjen av seg selv, vanligvis innen et døgn. De ansatte merker ingenting."
          : "Har dere betalt, kan dere se bort fra dette."}{" "}
        <Link href="/innstillinger/abonnement" className="font-semibold text-brand">Se fakturaer</Link>
      </p>
      <SupportContact intro="Spørsmål om fakturaen?" className="mt-1 text-sm" />
    </div>
  );
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
      <aside className="hidden w-52 shrink-0 md:block print:hidden">
        {/* Kundens logo og bjella øverst. Uten logo står Vaktpilot der. */}
        <div className="mb-2 flex items-start justify-between gap-2 pl-3">
          {ctx.org?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ctx.org.logoUrl} alt={ctx.org.name} className="max-h-14 w-auto min-w-0 max-w-[75%] object-contain" />
          ) : (
            <div className="min-w-0 pt-1">
              <VaktpilotMark size="lg" />
              {ctx.org && <div className="mt-1 truncate text-sm text-muted">{ctx.org.name}</div>}
            </div>
          )}
          {bell}
        </div>
        {(ctx.org || ctx.isPlatformAdmin) && <SideNav isAdmin={ctx.isAdmin} canPlan={ctx.canPlan} isPlatformAdmin={ctx.isPlatformAdmin} counts={counts} />}
        {ctx.org?.logoUrl && (
          <div className="mt-6 border-t border-line px-3 pt-3">
            <VaktpilotMark size="sm" />
          </div>
        )}
      </aside>
      <main className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center justify-between gap-3 md:hidden print:hidden">
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
        <ServiceNotices />
        {billingNotice}
        {kinNotice}
        {ctx.canPlan && ctx.org && <AreaTabs availability={ctx.org.availabilityEnabled} personnelList={ctx.org.personnelList} isAdmin={ctx.isAdmin} />}
        {children}
      </main>
      {ctx.org && <BottomNav isAdmin={ctx.canPlan} counts={counts} />}
    </div>
  );
}


/** «Vaktpilot» med appikonet. Stor øverst når bedriften ikke har logo, liten nederst som signatur ellers. */
function VaktpilotMark({ size }: { size: "sm" | "lg" }) {
  return (
    <span className={`flex items-center gap-2 font-bold tracking-tight text-ink ${size === "lg" ? "text-xl" : "text-sm"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" className={`${size === "lg" ? "h-8 w-8" : "h-5 w-5"} rounded-md`} />
      Vaktpilot
    </span>
  );
}
