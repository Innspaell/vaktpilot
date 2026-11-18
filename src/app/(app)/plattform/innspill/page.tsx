import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { KIND_LABEL, STATUS } from "@/lib/feedback";

export const metadata = { title: "Innspill – Plattform" };

async function answer(fd: FormData) {
  "use server";
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) return;
  await ctx.supabase.rpc("platform_answer_feedback", { p_id: String(fd.get("id")), p_status: String(fd.get("status")), p_reply: String(fd.get("reply") ?? "") });
  revalidatePath("/plattform/innspill");
}

const ROLE: Record<string, string> = { owner: "eier", admin: "leder", employee: "ansatt" };

export default async function PlatformFeedbackPage({ searchParams }: { searchParams: Promise<{ vis?: string }> }) {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) redirect("/");
  const { vis = "aapne" } = await searchParams;
  let q = ctx.supabase.from("feedback").select("id, kind, body, page, role, status, reply, created_at, organizations(name)").order("created_at", { ascending: false }).limit(200);
  if (vis === "aapne") q = q.in("status", ["new", "planned"]);
  const { data } = await q;
  type Row = { id: string; kind: string; body: string; page: string | null; role: string | null; status: string; reply: string | null; created_at: string; organizations: { name: string } | null };
  const rows = (data ?? []) as unknown as Row[];
  const date = (d: string) => new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });

  return (
    <div className="space-y-4">
      <header>
        <Link href="/plattform" className="text-sm text-brand">‹ Plattform</Link>
        <h1 className="h1">Innspill fra brukerne</h1>
        <p className="mt-1 text-sm text-muted">Når du endrer status eller skriver svar, får den som sendte beskjed i appen.</p>
      </header>
      <nav className="flex gap-2 text-sm">
        <Link href="?vis=aapne" className={vis === "aapne" ? "btn-primary py-1.5" : "btn-ghost py-1.5"}>Nye og planlagt</Link>
        <Link href="?vis=alle" className={vis === "alle" ? "btn-primary py-1.5" : "btn-ghost py-1.5"}>Alle</Link>
      </nav>
      {rows.length === 0 && <p className="card text-sm text-muted">Ingen innspill her.</p>}
      {rows.map((f) => (
        <section key={f.id} className="card space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted">
              <b className={f.kind === "problem" ? "text-bad" : "text-ink"}>{KIND_LABEL[f.kind]}</b>
              {" "}fra {f.role ? ROLE[f.role] ?? f.role : "bruker"}{f.organizations ? ` i ${f.organizations.name}` : ""}, {date(f.created_at)}{f.page ? `, på ${f.page}` : ""}
            </span>
            <span className={`badge ${STATUS[f.status]?.cls}`}>{STATUS[f.status]?.label}</span>
          </div>
          <p className="whitespace-pre-line text-sm">{f.body}</p>
          <form action={answer} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={f.id} />
            <select name="status" defaultValue={f.status} className="input w-auto">
              {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
            <input name="reply" defaultValue={f.reply ?? ""} placeholder="Svar (valgfritt)" className="input min-w-48 flex-1" />
            <button className="btn-ghost">Lagre</button>
          </form>
        </section>
      ))}
    </div>
  );
}
