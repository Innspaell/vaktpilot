import Link from "next/link";
import type { AppContext } from "@/lib/context";
import { ActionForm } from "./Form";
import { addPost, deletePost, togglePin } from "@/app/(app)/tavle/actions";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };
type Post = { id: string; author_user: string; author_name: string; title: string | null; body: string; pinned: boolean; created_at: string };

function ago(iso: string) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "nå";
  if (min < 60) return `${min} min siden`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} t siden`;
  const d = Math.round(h / 24);
  return d === 1 ? "i går" : `${d} dager siden`;
}

/** Oppslagstavle. compact = forsiden (fokus + siste innlegg). */
export async function Board({ ctx, compact }: { ctx: Ctx; compact?: boolean }) {
  const { data } = await ctx.supabase.from("board_posts").select("id, author_user, author_name, title, body, pinned, created_at")
    .eq("org_id", ctx.org.id).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(compact ? 4 : 100);
  const posts = (data ?? []) as Post[];
  if (compact && posts.length === 0) {
    return (
      <Link href="/tavle" className="card flex items-center justify-between text-sm hover:border-brand">
        <span><b>Oppslagstavle</b> <span className="text-muted">· ingen beskjeder ennå</span></span>
        <span className="font-semibold text-brand">Skriv en beskjed</span>
      </Link>
    );
  }

  return (
    <section className={compact ? "card" : "space-y-3"}>
      {compact && (
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="h2">Oppslagstavle</h2>
          <Link href="/tavle" className="text-sm font-semibold text-brand">Se alle</Link>
        </div>
      )}
      {!compact && (
        <div className="card">
          <ActionForm action={addPost} submitLabel="Publiser" className="space-y-3">
            <input name="title" className="input" placeholder="Overskrift (valgfritt)" maxLength={120} />
            <textarea name="body" required rows={3} maxLength={4000} className="input" placeholder="Skriv en beskjed til alle …" />
            {ctx.isAdmin && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pinned" className="h-4 w-4" /> Sett i fokus (vises øverst for alle)</label>
            )}
          </ActionForm>
        </div>
      )}
      <ul className={compact ? "space-y-2" : "space-y-3"}>
        {posts.map((p) => {
          const canDelete = ctx.isAdmin || p.author_user === ctx.userId;
          return (
            <li key={p.id} className={`${compact ? "rounded-lg p-3" : "card"} ${p.pinned ? "border-l-4 border-l-brand bg-brand-soft" : compact ? "bg-paper" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {p.pinned && <span className="mb-1 inline-block text-xs font-semibold uppercase tracking-wider text-brand">I fokus</span>}
                  {p.title && <div className="font-semibold">{p.title}</div>}
                  <p className={`whitespace-pre-wrap text-sm ${compact ? "line-clamp-3" : ""}`}>{p.body}</p>
                  <div className="mt-1 text-xs text-muted">{p.author_name} · {ago(p.created_at)}</div>
                </div>
                {!compact && (canDelete || ctx.isAdmin) && (
                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                    {ctx.isAdmin && (
                      <form action={togglePin}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="pinned" value={p.pinned ? "0" : "1"} />
                        <button className="text-brand">{p.pinned ? "Ta ut av fokus" : "Sett i fokus"}</button>
                      </form>
                    )}
                    {canDelete && (
                      <form action={deletePost}><input type="hidden" name="id" value={p.id} /><button className="text-muted hover:text-bad">Slett</button></form>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!compact && posts.length === 0 && <p className="card text-sm text-muted">Ingen innlegg ennå.</p>}
    </section>
  );
}
