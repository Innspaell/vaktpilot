import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/context";

async function markAllRead() {
  "use server";
  const ctx = await requireOrg();
  await ctx.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", ctx.userId).is("read_at", null);
  revalidatePath("/", "layout");
}

export default async function NotificationsPage() {
  const ctx = await requireOrg();
  const { data } = await ctx.supabase.from("notifications").select("id, title, body, link, read_at, created_at")
    .eq("user_id", ctx.userId).eq("org_id", ctx.org.id).order("created_at", { ascending: false }).limit(60);
  const rows = data ?? [];
  const unread = rows.filter((r) => !r.read_at).length;
  const fmt = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: ctx.org.timezone });
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="h1">Varsler</h1>
        {unread > 0 && <form action={markAllRead}><button className="btn-ghost">Merk alle som lest</button></form>}
      </header>
      {rows.length === 0 ? <p className="card text-sm text-muted">Ingen varsler.</p> : (
        <ul className="card divide-y divide-line p-0">
          {rows.map((n) => (
            <li key={n.id}>
              <Link href={n.link ?? "/"} className={`flex items-start gap-3 px-4 py-3 hover:bg-paper ${n.read_at ? "text-muted" : ""}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-brand"}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.read_at ? "" : "font-semibold text-ink"}`}>{n.title}</span>
                  {n.body && <span className="block text-sm">{n.body}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{fmt.format(new Date(n.created_at))}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
