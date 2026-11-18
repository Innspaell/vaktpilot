import Link from "next/link";
import { DPA_SECTIONS, DPA_VERSION, TERMS_SECTIONS, TERMS_VERSION, VENDOR } from "@/lib/legal";
import { SupportContact } from "@/components/SupportContact";

export const metadata = { title: "Vilkår – Vaktpilot" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-10 text-sm leading-relaxed">
      <div>
        <Link href="/" className="text-sm font-semibold text-brand">Vaktpilot</Link>
        <h1 className="h1 mt-1">Vilkår for Vaktpilot</h1>
        <p className="mt-2 text-muted">Versjon {TERMS_VERSION}. {VENDOR.name}, org.nr. {VENDOR.orgNumber}, {VENDOR.place}.</p>
      </div>

      <div className="space-y-5">
        {TERMS_SECTIONS.map((s) => (
          <section key={s.title} className="space-y-2">
            <h2 className="h2">{s.title}</h2>
            {s.body.map((p) => <p key={p}>{p}</p>)}
          </section>
        ))}
      </div>

      <div id="databehandleravtale" className="scroll-mt-6 space-y-5 border-t border-line pt-8">
        <div>
          <h2 className="h1">Databehandleravtale</h2>
          <p className="mt-2 text-muted">Versjon {DPA_VERSION}. Gjelder mellom bedriften (behandlingsansvarlig) og {VENDOR.name} (databehandler).</p>
        </div>
        {DPA_SECTIONS.map((s) => (
          <section key={s.title} className="space-y-2">
            <h3 className="h2">{s.title}</h3>
            {s.body.map((p) => <p key={p}>{p}</p>)}
          </section>
        ))}
      </div>

      <SupportContact intro="Spørsmål om vilkårene? Kontakt oss på" />
      <p className="flex gap-4"><Link href="/personvern" className="text-brand">Personvernerklæring</Link><Link href="/" className="text-brand">Til Vaktpilot</Link></p>
    </main>
  );
}
