import { markIntroSeen } from "@/app/(app)/ferie/actions";

const STEPS: [string, string][] = [
  ["Se vaktene dine", "Under Vaktplan ser du dine vakter og ledige vakter. Trykk «Jeg kan jobbe» for å melde deg på en ledig vakt."],
  ["Bekreft arbeidsdagen", "Når vakta er ferdig, trykker du «Bekreft arbeidsdag» på forsiden. Da er timene registrert. Jobbet du annerledes, endrer du før du bekrefter."],
  ["Søk om fri og bytt vakter", "Under Forespørsler søker du om ferie eller fri, ser feriedagene dine og spør kolleger om å bytte vakt."],
  ["Få vaktene i kalenderen", "Under Profil legger du vaktene inn i kalenderen på telefonen. Der kan du også si fra om når du kan jobbe."],
];

/** Vises på forsiden til den ansatte har lukket den. */
export function Intro({ name }: { name?: string | null }) {
  return (
    <section className="card border-brand/30">
      <h2 className="text-lg font-semibold">Velkommen{name ? `, ${name.split(" ")[0]}` : ""}!</h2>
      <p className="mt-1 text-sm text-muted">Slik bruker du Vaktpilot:</p>
      <ol className="mt-3 space-y-3">
        {STEPS.map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">{i + 1}</span>
            <span className="text-sm"><b className="block">{t}</b><span className="text-muted">{d}</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-muted">Tips: Legg Vaktpilot på hjemskjermen. På iPhone: Del-knappen i Safari › «Legg til på Hjem-skjerm». På Android: menyen i Chrome › «Installer app».</p>
      <form action={markIntroSeen} className="mt-3"><button className="btn-primary w-full sm:w-auto">Skjønner, lukk</button></form>
    </section>
  );
}
