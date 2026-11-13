import type { Metadata } from "next";
import Link from "next/link";
import { VENDOR } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Vaktpilot – vaktplan, timer og fravær for små bedrifter",
  description: "Vaktplan, timeregistrering, fravær og lønnsgrunnlag på mobilen. Laget i Stjørdal. I testfase.",
};

const FEATURES: { title: string; text: string; icon: string }[] = [
  { title: "Vaktplan på et blunk", text: "Legg inn bemanningsbehovet, og la autoplanen fordele vaktene etter stillingsprosent og ønsker. Du godkjenner før noe publiseres.", icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { title: "Timer uten papir", text: "De ansatte bekrefter arbeidsdagen med ett trykk. Du godkjenner, og lønnsgrunnlaget er klart for regnskapsprogrammet deres.", icon: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { title: "Ferie etter ferieloven", text: "Feriesaldo per år, regnet om for deltid. Avtale om overføring lages og signeres med fingeren i appen.", icon: "M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4z" },
  { title: "Fravær og sykefravær", text: "Egenmelding, sykmelding, permisjon og avspasering på ett sted, med sykefraværsprosent og uten helseopplysninger.", icon: "M12 21s-7-4.5-9.5-9A5.5 5.5 0 0112 6a5.5 5.5 0 019.5 6C19 16.5 12 21 12 21z" },
  { title: "Vaktbytte og ledige vakter", text: "Ansatte bytter vakter seg imellom og melder seg på ledige vakter. Du får varsel og godkjenner.", icon: "M7 7h11l-3-3M17 17H6l3 3" },
  { title: "Tariff og regler innebygd", text: "Overtid, tillegg, helligdager og hviletid etter arbeidsmiljøloven og overenskomsten. Varsler, ikke sperrer.", icon: "M9 12l2 2 4-4M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" },
];

const SHIFTS: [string, string, string, string?][] = [
  ["Tir 10.", "09:00–16:30", "Kundebehandler"],
  ["Tor 12.", "08:00–15:30", "Kundebehandler"],
  ["Lør 14.", "10:00–15:00", "Ledig vakt", "open"],
];

export default function StartPage() {
  return (
    <div className="min-h-dvh bg-white text-ink">
      <div className="bg-warn-soft px-4 py-2 text-center text-sm text-warn">
        <b>Vaktpilot er i testfase.</b> Vi tester sammen med de første bedriftene og åpner for flere snart.
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
          <span className="text-lg font-bold tracking-tight">Vaktpilot</span>
        </div>
        <nav className="flex items-center gap-2">
          <ComingSoon className="btn-ghost">Logg inn</ComingSoon>
          <ComingSoon className="btn-primary hidden sm:inline-flex">Kjøp Vaktpilot</ComingSoon>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-6 md:grid-cols-[1.1fr_0.9fr] md:pt-12">
        <div>
          <span className="badge bg-brand-soft text-brand">For butikker, utleie, kafeer og andre med vakter</span>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight [text-wrap:balance] md:text-5xl">
            Vaktplan, timer og fravær. I lomma til alle.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted">
            Vaktpilot erstatter regneark, lapper og meldinger. Lederen planlegger på et par minutter, de ansatte ser vaktene sine på mobilen,
            og lønnsgrunnlaget er klart når måneden er slutt.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ComingSoon className="btn-primary px-6 py-3 text-base">Kjøp Vaktpilot</ComingSoon>
            <ComingSoon className="btn-ghost px-6 py-3 text-base">Logg inn</ComingSoon>
          </div>
          <p className="mt-3 text-sm text-muted">Bestilling og innlogging åpner når testfasen er over.</p>
        </div>

        <PhoneMock />
      </section>

      <section className="bg-paper">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Alt en liten bedrift trenger. Ingenting den ikke trenger.</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={f.icon} /></svg>
                </span>
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-16 md:grid-cols-3">
        <div>
          <h2 className="text-xl font-bold">Enkelt å komme i gang</h2>
          <p className="mt-2 text-sm text-muted">Vi setter opp bedriften med roller, åpningstider og tariff. Ansatte får en lenke og lager passordet selv.</p>
        </div>
        <div>
          <h2 className="text-xl font-bold">Data i Norden</h2>
          <p className="mt-2 text-sm text-muted">Alt lagres i EU, i Stockholm. Hver bedrift ser bare sine egne data. Databehandleravtale er innebygd.</p>
        </div>
        <div>
          <h2 className="text-xl font-bold">Forutsigbar pris</h2>
          <p className="mt-2 text-sm text-muted">Fast pris per bedrift og en liten sum per ansatt. Priser kommer når testfasen er over.</p>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted">
          <span>Vaktpilot er laget i {VENDOR.place} av {VENDOR.name} · org.nr. {VENDOR.orgNumber}</span>
          <span className="flex gap-4">
            <Link href="/personvern" className="hover:text-brand">Personvern</Link>
            {VENDOR.contactEmail && <span>{VENDOR.contactEmail}</span>}
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

function PhoneMock() {
  return (
    <div className="relative mx-auto w-full max-w-[300px]" aria-hidden>
      <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-brand-soft" />
      <div className="rounded-[2.2rem] border-[10px] border-ink bg-paper p-3 shadow-xl">
        <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-ink/80" />
        <div className="rounded-xl border border-brand/30 bg-brand-soft p-3">
          <div className="text-sm font-semibold">Dagens vakt: 09:00–16:30</div>
          <div className="mt-2 rounded-lg bg-brand py-2 text-center text-sm font-semibold text-white">Bekreft arbeidsdag</div>
        </div>
        <div className="mt-3 rounded-xl border border-line bg-white p-3">
          <div className="text-xs font-semibold text-muted">Mine vakter</div>
          <ul className="mt-2 space-y-2">
            {SHIFTS.map(([d, t, r, open]) => (
              <li key={d} className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs ${open ? "bg-warn-soft" : "bg-paper"}`}>
                <span><b>{d}</b> <span className="text-muted">{r}</span></span>
                <span className="tabular-nums">{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-line bg-white p-3"><div className="text-[11px] text-muted">Timesaldo</div><div className="text-lg font-bold text-good">+1,5 t</div></div>
          <div className="rounded-xl border border-line bg-white p-3"><div className="text-[11px] text-muted">Ferie igjen</div><div className="text-lg font-bold">11 dager</div></div>
        </div>
      </div>
    </div>
  );
}
