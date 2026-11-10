import Link from "next/link";
import { RETENTION, SUBPROCESSORS, VENDOR } from "@/lib/legal";

export const metadata = { title: "Personvernerklæring – Vaktpilot" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10 text-sm leading-relaxed">
      <div>
        <div className="text-sm font-semibold uppercase tracking-wider text-brand">Vaktpilot</div>
        <h1 className="h1 mt-1">Personvernerklæring</h1>
        <p className="mt-2 text-muted">Sist oppdatert november 2026</p>
      </div>

      <section className="space-y-2">
        <h2 className="h2">Hvem er ansvarlig</h2>
        <p>Arbeidsgiveren din er behandlingsansvarlig for opplysningene om deg i Vaktpilot. {VENDOR.name} (org.nr. {VENDOR.orgNumber}) lager og drifter Vaktpilot, og er databehandler for arbeidsgiveren etter en databehandleravtale.</p>
        <p>Spørsmål om opplysningene dine går først til arbeidsgiveren din.{VENDOR.contactEmail ? <> Du kan også kontakte {VENDOR.name} på <a className="text-brand" href={`mailto:${VENDOR.contactEmail}`}>{VENDOR.contactEmail}</a>.</> : null}</p>
      </section>

      <section className="space-y-2">
        <h2 className="h2">Hva vi lagrer, og hvorfor</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Navn, e-post og telefon</b>: for innlogging og for å kunne nå deg om vakter.</li>
          <li><b>Stilling og avtale</b> (stillingsprosent, lønnstype): for å planlegge riktig mengde arbeid og beregne timesaldo.</li>
          <li><b>Vakter, timer og stempling</b>: arbeidsgiveren har plikt til å føre oversikt over arbeidstid (arbeidsmiljøloven § 10-7) og grunnlag for lønn.</li>
          <li><b>Fravær</b>: type og dato, for planlegging og lønn. Vi lagrer aldri diagnose eller helseopplysninger.</li>
          <li><b>Ønsker om arbeidstid</b> og beskjeder på oppslagstavlen: det du selv legger inn.</li>
        </ul>
        <p>Grunnlaget er arbeidsavtalen og arbeidsgiverens plikter etter lov (personvernforordningen art. 6 nr. 1 bokstav b og c). Kolleger ser at du er borte, men ikke hvorfor. Bare arbeidsgiverens administratorer ser fraværstype, timer og avtaler.</p>
      </section>

      <section className="space-y-2">
        <h2 className="h2">Hvor lenge</h2>
        <table className="w-full">
          <tbody className="divide-y divide-line">
            {RETENTION.map(([what, how]) => <tr key={what}><td className="py-1.5 pr-3 align-top font-medium">{what}</td><td className="py-1.5 text-muted">{how}</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="h2">Underleverandører</h2>
        <ul className="space-y-2">
          {SUBPROCESSORS.map((s) => (
            <li key={s.name} className="rounded-lg bg-white p-3 ring-1 ring-line">
              <b>{s.name}</b>: {s.purpose}<div className="text-xs text-muted">{s.location} · {s.basis}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="h2">Dine rettigheter</h2>
        <p>Du har rett til innsyn, retting, sletting når lagringsplikten ikke gjelder, og til å få utlevert dine data. Du kan laste ned dine egne data under Profil i appen. Du kan klage til Datatilsynet.</p>
        <p>Vaktpilot bruker bare de informasjonskapslene som trengs for å holde deg innlogget. Vi bruker ikke sporing eller reklame.</p>
      </section>

      <p><Link href="/" className="text-brand">Til Vaktpilot</Link></p>
    </main>
  );
}
