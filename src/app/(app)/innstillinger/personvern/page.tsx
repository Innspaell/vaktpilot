import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/context";
import { DPA_SECTIONS, DPA_VERSION, RETENTION, VENDOR } from "@/lib/legal";

async function acceptDpa() {
  "use server";
  const ctx = await requireAdmin();
  let name = ctx.email;
  if (ctx.employeeId) {
    const { data } = await ctx.supabase.from("employees").select("full_name").eq("id", ctx.employeeId).single();
    if (data) name = data.full_name;
  }
  await ctx.supabase.from("dpa_acceptances").insert({
    org_id: ctx.org.id, version: DPA_VERSION, accepted_by: ctx.userId, accepted_name: name, accepted_email: ctx.email,
  });
  revalidatePath("/innstillinger/personvern");
}

export default async function PrivacySettingsPage() {
  const ctx = await requireAdmin();
  const { data: acc } = await ctx.supabase.from("dpa_acceptances").select("version, accepted_name, accepted_email, accepted_at")
    .eq("org_id", ctx.org.id).order("accepted_at", { ascending: false });
  const current = (acc ?? []).find((a) => a.version === DPA_VERSION);
  const fmt = new Intl.DateTimeFormat("nb-NO", { dateStyle: "long", timeStyle: "short", timeZone: ctx.org.timezone });

  return (
    <div className="space-y-4">
      <Link href="/innstillinger" className="text-sm font-medium text-brand">← Innstillinger</Link>
      <h1 className="h1">Personvern</h1>

      <section className="card">
        <h2 className="h2">Databehandleravtale</h2>
        {current ? (
          <p className="mt-2 rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
            Godtatt av {current.accepted_name} ({current.accepted_email}) {fmt.format(new Date(current.accepted_at))}, versjon {current.version}.
          </p>
        ) : (
          <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Ikke godtatt ennå. Avtalen kreves etter personvernforordningen art. 28 når {VENDOR.name} behandler de ansattes opplysninger.</p>
        )}
        <div className="mt-4 max-h-96 space-y-4 overflow-y-auto rounded-lg border border-line p-4 text-sm leading-relaxed">
          <p className="font-semibold">Databehandleravtale mellom {ctx.org.name} (behandlingsansvarlig) og {VENDOR.name}, org.nr. {VENDOR.orgNumber} (databehandler). Versjon {DPA_VERSION}.</p>
          {DPA_SECTIONS.map((s) => (
            <div key={s.title}>
              <h3 className="font-semibold">{s.title}</h3>
              {s.body.map((p, i) => <p key={i} className="mt-1">{p}</p>)}
            </div>
          ))}
          <p>Underleverandører, lagringstid og sletterutiner står i <Link href="/personvern" className="text-brand">personvernerklæringen</Link>, som er en del av avtalen.</p>
        </div>
        {!current && (
          <form action={acceptDpa} className="mt-4">
            <button className="btn-primary">Godta på vegne av {ctx.org.name}</button>
          </form>
        )}
        <a href={`/api/eksport/bedrift?dpa=1`} className="mt-3 inline-block text-sm text-brand">Last ned avtalen og godkjenningen</a>
      </section>

      <section className="card">
        <h2 className="h2">Eksport av bedriftens data</h2>
        <p className="mt-1 text-sm text-muted">Alle opplysninger om ansatte, vakter, timer, fravær, tavle og endringslogg som én fil (JSON). Brukes ved bytte av system eller ved krav om dataportabilitet.</p>
        <a href="/api/eksport/bedrift" className="btn-primary mt-3">Last ned alle data</a>
      </section>

      <section className="card">
        <h2 className="h2">Sletterutiner</h2>
        <p className="mt-1 text-sm text-muted">Kjøres automatisk hver natt.</p>
        <table className="mt-2 w-full text-sm">
          <tbody className="divide-y divide-line">
            {RETENTION.map(([what, how]) => <tr key={what}><td className="py-1.5 pr-3 align-top font-medium">{what}</td><td className="py-1.5 text-muted">{how}</td></tr>)}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">Sett sluttdato på ansattkortet når noen slutter. Da stenges tilgangen, og slettingen starter.</p>
      </section>
    </div>
  );
}
