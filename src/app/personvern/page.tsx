import Link from "next/link";
import { BILLING_NOTE, RETENTION, SUBPROCESSORS, VENDOR } from "@/lib/legal";

export const metadata = { title: "Personvernerklæring – Vaktpilot" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10 text-sm leading-relaxed">
      <div>
        <div className="text-sm font-semibold uppercase tracking-wider text-brand">Vaktpilot</div>
        <h1 className="h1 mt-1">Personvernerklæring</h1>
        <p className="mt-2 text-muted">Sist oppdatert 20. november 2026</p>
      </div>

      <section className="space-y-2">
        <h2 className="h2">Hvem er ansvarlig</h2>
        <p>Arbeidsgiveren din er behandlingsansvarlig for opplysningene om deg i Vaktpilot. Navn og kontaktinfo til arbeidsgiveren, og eventuelt personvernombud, står i appen under Profil → Personvern. {VENDOR.name} (org.nr. {VENDOR.orgNumber}) lager og drifter Vaktpilot, og er databehandler for arbeidsgiveren etter en databehandleravtale.</p>
        <p>Spørsmål om opplysningene dine går først til arbeidsgiveren din, også etter at du har sluttet og ikke lenger kan logge inn.{VENDOR.contactEmail ? <> Du kan også kontakte {VENDOR.name} på <a className="text-brand" href={`mailto:${VENDOR.contactEmail}`}>{VENDOR.contactEmail}</a>.</> : null}</p>
      </section>

      <section className="space-y-2">
        <h2 className="h2">Hva vi lagrer, hvorfor og på hvilket grunnlag</h2>
        <p>Opplysningene kommer fra arbeidsgiveren din (for eksempel avtale og vakter) og fra deg selv (for eksempel timer, ønsker og søknader).</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Navn, e-post og telefon</b>: for innlogging og for å kunne nå deg om vakter. Grunnlag: arbeidsavtalen (personvernforordningen art. 6 nr. 1 b).</li>
          <li><b>Stilling og avtale</b> (stillingsprosent, timer, lønnstype): for å planlegge riktig mengde arbeid og beregne lønn. Grunnlag: arbeidsavtalen (art. 6 nr. 1 b).</li>
          <li><b>Vakter, timer og stempling</b>: arbeidsgiveren har plikt til å registrere arbeidstid (arbeidsmiljøloven § 10-7), og timene er grunnlag for lønn. Grunnlag: rettslig plikt og arbeidsavtalen (art. 6 nr. 1 c og b).</li>
          <li><b>Fravær</b>: fraværstype og dato, for å planlegge bemanning og håndtere lønn og fravær. Opplysninger om sykefravær er helseopplysninger. Vaktpilot har ikke felt for diagnose. Grunnlag: arbeidsgiverens plikter og rettigheter i arbeidsforholdet (art. 6 nr. 1 c og art. 9 nr. 2 b, jf. personopplysningsloven § 6).</li>
          <li><b>Nærmeste pårørende</b>: navn og telefon du legger inn selv, slik at arbeidsgiveren kan varsle noen hvis noe skjer med deg på jobb. Grunnlag: arbeidsgiverens berettigede interesse (art. 6 nr. 1 f).</li>
          <li><b>Ønsker om arbeidstid, beskjeder på oppslagstavlen og valgfrie varsler</b> (e-postvarsler og morgenliste): det du selv legger inn eller slår på. Grunnlag: arbeidsgiverens berettigede interesse i god planlegging og kommunikasjon (art. 6 nr. 1 f). Du kan slå av e-postvarsler og morgenliste under Profil. Ikke skriv helseopplysninger eller diagnoser på oppslagstavlen.</li>
        </ul>
        <p><b>Hvem ser hva:</b> Fraværstypen er tilgjengelig for dem som har tjenstlig behov: administratorene og lederen med ansvar for deg. Kolleger ser bare at du er fraværende. Timer, avtaler og nærmeste pårørende ser bare du, administratorene og lederen din. Vaktplanen med navn og klokkeslett ser alle i bedriften.</p>
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
              <b>{s.name}</b>: {s.purpose}<div className="mt-0.5 text-xs text-muted">{s.location} Overføringsgrunnlag: {s.basis}.</div>
            </li>
          ))}
        </ul>
        <p>Vil du vite mer om garantiene ved overføring utenfor EØS, eller få en kopi av dem, kontakt {VENDOR.contactEmail ? <a className="text-brand" href={`mailto:${VENDOR.contactEmail}`}>{VENDOR.contactEmail}</a> : VENDOR.name}.</p>
        <p>{BILLING_NOTE}</p>
      </section>

      <section className="space-y-2">
        <h2 className="h2">Dine rettigheter</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Innsyn</b> i hvilke opplysninger som er lagret om deg.</li>
          <li><b>Retting</b> av opplysninger som er feil.</li>
          <li><b>Sletting</b> når opplysningene ikke lenger trengs og arbeidsgiveren ikke har plikt til å oppbevare dem.</li>
          <li><b>Begrensning</b> av behandlingen, for eksempel mens det avklares om en opplysning er riktig.</li>
          <li><b>Dataportabilitet</b>: å få utlevert opplysninger du selv har gitt, i et maskinlesbart format, når behandlingen bygger på arbeidsavtalen.</li>
          <li><b>Protest</b> mot behandling som bygger på arbeidsgiverens berettigede interesse.</li>
        </ul>
        <p>Rettighetene utøves overfor arbeidsgiveren din, også etter at tilgangen din er stengt. I tillegg kan du selv laste ned dine data under Profil i appen mens du har tilgang. Du kan klage til Datatilsynet.</p>
        <p>Vaktpilot bruker bare de informasjonskapslene som trengs for å holde deg innlogget og huske valgene dine i appen. Vi bruker ikke sporing eller reklame.</p>
      </section>

      <p><Link href="/" className="text-brand">Til Vaktpilot</Link></p>
    </main>
  );
}
