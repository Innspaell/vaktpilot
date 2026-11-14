import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/caveat/500.css";
import "./start.css";
import { VENDOR } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Vaktpilot – vaktplan, timer og fravær for små bedrifter",
  description: "Vaktplan, timeregistrering, fravær og lønnsgrunnlag på mobilen. Lagd i Stjørdal. I testfase.",
};

/** Det lederen slipper, og hva Vaktpilot gjør i stedet. */
const INSTEAD: [string, string][] = [
  ["«Kan noen ta lørdag?» i gruppechatten", "Ledige vakter legges ut i appen. De som kan, melder seg, og du velger hvem som får vakta."],
  ["Timelister på papir som skal tastes inn på nytt", "De ansatte bekrefter arbeidsdagen med ett trykk på mobilen. Du ser alt samlet og godkjenner."],
  ["Feriedager regnet ut på baksiden av en konvolutt", "Feriesaldo etter ferieloven, også for deltid. Overføring til neste år signeres med fingeren i appen."],
  ["Å lure på om noen har jobbet for mye", "Du får beskjed når planen bryter hviletid eller overtidsgrensene i arbeidsmiljøloven."],
];

const ALSO: [string, string][] = [
  ["Vaktbytte", "Ansatte bytter vakter seg imellom. Du godkjenner før noe endres."],
  ["Fravær", "Egenmelding, sykmelding, permisjon og avspasering på ett sted."],
  ["Lønnsgrunnlag", "Ordinære timer, overtid og tillegg, klart for regnskapsprogrammet deres."],
  ["Tariff", "Uten tariff regner Vaktpilot etter arbeidsmiljøloven. Har dere tariffavtale, legger vi den inn."],
  ["Kalender", "Vaktene dukker opp i kalenderen på mobilen, av seg selv."],
  ["Varsler", "Ny vakt, svar på fri og byttemeldinger i appen, og på e-post hvis dere vil."],
];

const FAQ: [string, string][] = [
  ["Vaktpilot er lagd i Trøndelag. Er det trygt for folk fra andre fylker?", "Ja, absolutt alle. Kanskje med unntak av … nei. Absolutt alle, faktisk. Appen er på bokmål, så det går helt fint å si «hva» i stedet for «ka»."],
  ["Hva koster Vaktpilot?", "Lanseringsprisen er 299 kr i måneden eks. mva. med 5 aktive ansatte inkludert. Hver aktiv ansatt utover det koster 39 kr i måneden. De første kundene beholder lanseringsprisen i 12 måneder."],
  ["Hva er en aktiv ansatt?", "En ansatt som har hatt en vakt eller registrert timer i løpet av måneden. Ekstrahjelp som ikke har jobbet, og ansatte som har sluttet, koster ingenting."],
  ["Er det bindingstid?", "Nei. Abonnementet løper fra måned til måned, og dere kan si opp når dere vil."],
  ["Kan vi prøve gratis?", "Ja. De første 30 dagene er gratis, og dere forplikter dere ikke til noe."],
  ["Må de ansatte laste ned en app?", "Nei. Vaktpilot åpnes i nettleseren på mobilen og kan legges på hjemskjermen som en app, både på iPhone og Android. De ansatte får en lenke og lager passordet selv."],
  ["Hvilket regnskaps- eller lønnsprogram kan vi bruke?", "Lønnsgrunnlaget kan lastes ned som Excel-fil og som fil for import i regnskaps- eller lønnsprogrammet. Si fra hvilket program dere bruker, så sørger vi for at fila passer."],
  ["Hvor lagres dataene, og hvem ser dem?", "Alt lagres i EU, i Stockholm. Hver bedrift ser bare sine egne data, og de ansatte ser bare det som gjelder dem selv. Databehandleravtale er innebygd i løsningen."],
  ["Hva skjer med dataene hvis vi slutter?", "Dere kan laste ned alle data før dere avslutter. Deretter sletter vi bedriftens data innen 90 dager, bortsett fra det loven krever at vi oppbevarer."],
];

export default function StartPage() {
  return (
    <div className="start min-h-dvh bg-white text-ink">
      <p className="bg-[var(--postit)] px-4 py-2 text-center text-sm">
        Vaktpilot e i testfase. Vi prøver den ut sammen med de første bedriftene, og innlogging og kjøp åpner snart.
      </p>

      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
          <span className="display text-xl font-bold">Vaktpilot</span>
        </div>
        <nav className="flex items-center gap-2">
          <ComingSoon className="btn-ghost">Logg inn</ComingSoon>
          <ComingSoon className="btn-primary hidden sm:inline-flex">Kjøp Vaktpilot</ComingSoon>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-8 md:grid-cols-[1.15fr_0.85fr] md:pt-14">
        <div>
          <h1 className="display text-[2.6rem] font-extrabold leading-[1.02] [text-wrap:balance] md:text-[4.2rem]">
            Vaktplan for folk som har bedre ting å gjøre på søndagskvelden.
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted">
            Vaktpilot tar over for regnearket, gruppechatten og lappen på kjøleskapet. Du setter opp uka på et par minutter,
            de ansatte ser vaktene sine på mobilen, og lønnsgrunnlaget ligger klart når måneden er omme.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ComingSoon className="btn-primary px-6 py-3 text-base">Kjøp Vaktpilot</ComingSoon>
            <ComingSoon className="btn-ghost px-6 py-3 text-base">Logg inn</ComingSoon>
          </div>
        </div>

        <FridgeAndPhone />
      </section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="display text-3xl font-bold md:text-4xl">Dette slipper du</h2>
          <dl className="mt-8 divide-y divide-line">
            {INSTEAD.map(([old, now], i) => (
              <div key={old} className="grid gap-2 py-5 md:grid-cols-[1fr_1.1fr] md:gap-10">
                <dt className="hand text-[1.7rem] leading-tight text-muted">
                  <span className="strike" style={{ "--d": `${0.9 + i * 0.25}s` } as React.CSSProperties}>{old}</span>
                </dt>
                <dd className="self-center text-base leading-relaxed">{now}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="bg-paper">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="display text-2xl font-bold md:text-3xl">Og resten av det en liten bedrift trenger</h2>
          <dl className="mt-8 grid gap-x-12 gap-y-6 sm:grid-cols-2">
            {ALSO.map(([t, d]) => (
              <div key={t} className="border-l-2 border-brand pl-4">
                <dt className="font-semibold">{t}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-10 px-4 py-16 md:grid-cols-[1.2fr_0.8fr]">
        <div>
          <h2 className="display text-2xl font-bold md:text-3xl">Lagd i Stjørdal</h2>
          <div className="mt-4 max-w-[36rem] space-y-4 leading-relaxed">
            <p>
              Vaktpilot er lagd av InnSpæll i Stjørdal, sammen med en bilutleie i Trøndelag som var lei av å planlegge i regneark.
              Alt i appen er noe en ekte leder eller ansatt har trengt i en ekte arbeidsuke.
            </p>
            <p>
              Vi setter opp bedriften for dere, med roller, åpningstider og tariff. De ansatte får en lenke og lager passordet selv.
              Lurer dere på noe, svarer et menneske. Gjerne på trøndersk.
            </p>
          </div>
        </div>
        <div className="self-start rounded-2xl bg-[var(--fjord)] p-6 text-white">
          <h2 className="display text-xl font-bold">Lanseringspris</h2>
          <p className="mt-3">
            <span className="display text-5xl font-extrabold">299 kr</span>
            <span className="ml-1 text-white/70">i måneden</span>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-white/80">
            5 aktive ansatte er med i prisen. Hver ansatt utover det koster 39 kr i måneden. Priser eks. mva.
            De første kundene beholder prisen i 12 måneder.
          </p>
          <p className="mt-3 text-sm text-white/80">Ingen bindingstid. 30 dager gratis.</p>
        </div>
      </section>

      <section className="bg-paper">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <h2 className="display text-2xl font-bold md:text-3xl">Spørsmål og svar</h2>
          <div className="mt-6 divide-y divide-line rounded-xl border border-line bg-white">
            {FAQ.map(([q, a], i) => (
              <details key={q} open={i === 0} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                  {q}
                  <span className="text-brand transition group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted">
          <span>Lagd i {VENDOR.place} av {VENDOR.name}, org.nr. {VENDOR.orgNumber}</span>
          <span className="flex gap-4">
            <Link href="/personvern" className="hover:text-brand">Personvern</Link>
            {VENDOR.contactEmail && <a href={`mailto:${VENDOR.contactEmail}`} className="hover:text-brand">{VENDOR.contactEmail}</a>}
          </span>
        </div>
      </footer>
    </div>
  );
}

/** Knapp som vises, men ikke virker ennå. */
function ComingSoon({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <button type="button" aria-disabled="true" title="Kommer snart" className={`${className} relative cursor-not-allowed`}>
      {children}
      <span className="pointer-events-none absolute -right-1 -top-2 rounded-full bg-warn px-1.5 text-[10px] font-bold leading-4 text-white">Snart</span>
    </button>
  );
}

/** Lappen på kjøleskapet slik det er i dag, og telefonen slik det blir. */
function FridgeAndPhone() {
  return (
    <div className="relative mx-auto h-[400px] w-full max-w-[400px] sm:h-[440px]" aria-hidden>
      <div className="note hand absolute left-0 top-6 z-10 w-[185px] rounded-sm px-4 pb-5 pt-6 text-[1.15rem] leading-snug text-ink/85 sm:w-[230px] sm:px-5 sm:pb-6 sm:pt-7 sm:text-[1.35rem]">
        <span className="magnet absolute left-1/2 top-[-10px] h-6 w-6 -translate-x-1/2 rounded-full" />
        <div className="text-[1.35rem] sm:text-[1.6rem]">Vakter uke 47</div>
        <div>Man: Kari 9–16</div>
        <div>Tir: <span className="strike" style={{ "--d": "0.5s" } as React.CSSProperties}>Ola 9–16</span> syk!</div>
        <div>Ons: Siri? spør</div>
        <div>Lør: ??? (gruppa)</div>
        <div className="mt-2 text-[1.15rem] text-ink/60">Jonas bytter m/ noen? sjekk m/ sjefen</div>
      </div>

      <div className="absolute bottom-0 right-0 w-[200px] rounded-[2rem] sm:w-[230px] border-[9px] border-ink bg-paper p-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-ink/80" />
        <div className="rounded-xl bg-brand p-3 text-white">
          <div className="text-xs text-white/80">I dag</div>
          <div className="text-sm font-semibold">09:00–16:30</div>
          <div className="mt-2 rounded-lg bg-white py-1.5 text-center text-xs font-semibold text-brand">Bekreft arbeidsdag</div>
        </div>
        <ul className="mt-3 space-y-1.5 text-xs">
          <li className="flex justify-between rounded-lg bg-white px-2 py-1.5"><b>Tir</b><span className="text-muted">Siri tar vakta</span></li>
          <li className="flex justify-between rounded-lg bg-white px-2 py-1.5"><b>Ons</b><span className="tabular-nums">10:00–17:00</span></li>
          <li className="flex justify-between rounded-lg bg-warn-soft px-2 py-1.5"><b>Lør</b><span>Ledig, 2 kan</span></li>
        </ul>
        <div className="mt-3 rounded-lg bg-white px-2 py-1.5 text-[11px] text-muted">Jonas vil bytte torsdag. Godkjenn?</div>
      </div>
    </div>
  );
}
