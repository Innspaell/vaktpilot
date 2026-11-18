import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireAdmin, type AppContext } from "@/lib/context";

async function hideGettingStarted() {
  "use server";
  const ctx = await requireAdmin();
  await ctx.supabase.from("organizations").update({ onboarding_hidden_at: new Date().toISOString() }).eq("id", ctx.org.id);
  revalidatePath("/");
}

/** «Kom i gang» for nye bedrifter. Forsvinner når alt er gjort, eller når lederen skjuler den. */
export async function GettingStarted({ ctx }: { ctx: AppContext & { org: NonNullable<AppContext["org"]> } }) {
  const id = ctx.org.id;
  const { data: org } = await ctx.supabase.from("organizations").select("onboarding_hidden_at, signup_at, trial_ends_at").eq("id", id).maybeSingle();
  // Bare for bedrifter som har registrert seg selv, og ikke etter at den er skjult
  if (!org?.signup_at || org.onboarding_hidden_at) return null;
  const [{ count: employees }, { count: shifts }, { count: published }, { count: invites }, { data: rules }] = await Promise.all([
    ctx.supabase.from("employees").select("id", { count: "exact", head: true }).eq("org_id", id),
    ctx.supabase.from("shifts").select("id", { count: "exact", head: true }).eq("org_id", id),
    ctx.supabase.from("shifts").select("id", { count: "exact", head: true }).eq("org_id", id).eq("status", "published"),
    ctx.supabase.from("login_invites").select("id", { count: "exact", head: true }).eq("org_id", id),
    ctx.supabase.from("org_pay_rules").select("confirmed_at").eq("org_id", id),
  ]);
  const steps: { title: string; text: string; href: string; done: boolean }[] = [
    { title: "Legg inn de ansatte", text: "Navn, e-post og stillingsprosent. Du kan legge inn flere om gangen.", href: "/ansatte", done: (employees ?? 0) >= 2 },
    { title: "Sjekk tariff og innstillinger", text: "Velg tariffavtale (eller ingen), og bekreft satsene.", href: "/innstillinger", done: (rules ?? []).length === 0 ? false : (rules ?? []).every((r) => r.confirmed_at) },
    { title: "Lag den første vaktplanen", text: "Lag vakter for en uke, eller bruk turnus som gjentar seg.", href: "/vaktplan", done: (shifts ?? 0) > 0 },
    { title: "Publiser vaktplanen", text: "Først når den er publisert, ser de ansatte vaktene sine.", href: "/vaktplan", done: (published ?? 0) > 0 },
    { title: "Inviter de ansatte", text: "De får en e-post og lager egen innlogging. Da får de vaktene på mobilen.", href: "/ansatte", done: (invites ?? 0) > 0 },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;
  return (
    <section className="card border-brand/30">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Kom i gang</h2>
        <span className="text-sm text-muted">{steps.length - left} av {steps.length} gjort</span>
      </div>
      {org.trial_ends_at && <p className="mt-1 text-sm text-muted">Prøveperioden varer til og med {new Date(new Date(org.trial_ends_at).getTime() - 86400000).toLocaleDateString("nb-NO", { day: "numeric", month: "long" })}.</p>}
      <ol className="mt-3 space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.done ? "bg-good text-white" : "bg-brand-soft text-brand"}`} aria-hidden>
              {s.done ? "✓" : i + 1}
            </span>
            <span className="text-sm">
              {s.done ? <b className="block text-muted line-through">{s.title}</b> : <Link href={s.href} className="block font-bold text-brand">{s.title}</Link>}
              {!s.done && <span className="text-muted">{s.text}</span>}
              <span className="sr-only">{s.done ? " (gjort)" : ""}</span>
            </span>
          </li>
        ))}
      </ol>
      <form action={hideGettingStarted} className="mt-3"><button className="text-sm text-muted hover:text-ink">Skjul denne lista</button></form>
    </section>
  );
}
