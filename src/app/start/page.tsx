import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/caveat/500.css";
import "./start.css";
import { VENDOR } from "@/lib/legal";
import { loadSiteImages, type SITE_IMAGES } from "@/lib/site-images";

export const revalidate = 300;

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

export default async function StartPage() {
  const img = await loadSiteImages();
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

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-8 md:grid-cols-[1fr_1fr] md:pt-14">
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

        <HeroPicture image={img.hero} />
      </section>

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[0.9fr_1.1fr] md:items-start">
          <figure className="md:sticky md:top-8">
            <Picture image={img.tavle} className="w-full rounded-2xl shadow-lg" sizes="(min-width: 768px) 45vw, 100vw" />
            <figcaption className="hand mt-2 text-xl text-muted">Kjent syn? Tavla vi alle har hatt.</figcaption>
          </figure>
          <div>
          <h2 className="display text-3xl font-bold md:text-4xl">Dette slipper du</h2>
          <dl className="mt-6 divide-y divide-line">
            {INSTEAD.map(([old, now], i) => (
              <div key={old} className="py-5">
                <dt className="hand text-[1.6rem] leading-tight text-muted">
                  <span className="strike" style={{ "--d": `${0.9 + i * 0.25}s` } as React.CSSProperties}>{old}</span>
                </dt>
                <dd className="mt-1 text-base leading-relaxed">{now}</dd>
              </div>
            ))}
          </dl>
          </div>
        </div>
      </section>

      <section className="bg-[var(--fjord)] text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-[1.1fr_0.9fr]">
          <Picture image={img.syk} className="w-full rounded-2xl" sizes="(min-width: 768px) 55vw, 100vw" />
          <div>
            <h2 className="display text-3xl font-bold leading-tight md:text-4xl">Klokka er 06:45. Ola er syk.</h2>
            <p className="mt-4 max-w-[30rem] leading-relaxed text-white/85">
              Legg ut vakta som ledig med to trykk. De som kan jobbe, får beskjed på mobilen og melder seg.
              Du velger hvem som tar den, og planen oppdateres for alle. Ingen telefonrunde før frokost.
            </p>
          </div>
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

type Img = (typeof SITE_IMAGES)[keyof typeof SITE_IMAGES];

function Picture({ image, className, sizes }: { image: Img; className?: string; sizes: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image.src} srcSet={image.srcSet || undefined} sizes={image.srcSet ? sizes : undefined} alt={image.alt}
      width={image.w} height={image.h} loading="lazy" decoding="async" className={`h-auto bg-paper object-cover ${className ?? ""}`} />
  );
}

/** Søndagskvelden med regnearket, og telefonen der det samme er løst. */
function HeroPicture({ image }: { image: Img }) {
  return (
    <div className="relative pb-10 md:pb-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.src} srcSet={image.srcSet || undefined} sizes="(min-width: 768px) 50vw, 100vw" alt={image.alt}
        width={image.w} height={image.h} fetchPriority="high" className="aspect-[3/2] h-auto w-full rounded-2xl bg-paper object-cover shadow-xl" />
      <div className="absolute -bottom-2 left-3 w-[150px] rounded-[1.6rem] border-[7px] border-ink bg-paper p-2 shadow-2xl sm:w-[170px] md:-bottom-10 md:-left-10" aria-hidden>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink/80" />
        <div className="rounded-lg bg-brand p-2 text-white">
          <div className="text-[10px] text-white/80">Uke 47</div>
          <div className="text-xs font-semibold">Alle vakter fylt</div>
        </div>
        <ul className="mt-2 space-y-1 text-[10px]">
          <li className="flex justify-between rounded bg-white px-1.5 py-1"><b>Lør</b><span>Siri tar vakta</span></li>
          <li className="flex justify-between rounded bg-white px-1.5 py-1"><b>Søn</b><span className="tabular-nums">10–17</span></li>
        </ul>
        <div className="hand mt-1.5 text-center text-sm text-good">Ferdig til Dagsrevyen</div>
      </div>
    </div>
  );
}
