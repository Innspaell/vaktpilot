// Opplysninger om leverandøren og tekster for personvern og databehandleravtale.
// Rett her ved endringer. Ny DPA_VERSION gjør at bedriftene må godta avtalen på nytt.

export const VENDOR = {
  name: "InnSpæll AS",
  orgNumber: "936 532 233",
  place: "Stjørdal",
  /** Kontakt for personvern. Fylles inn av InnSpæll. Tom = vises som «kontakt via arbeidsgiveren». */
  contactEmail: "personvern@innspaell.no",
};

export const DPA_VERSION = "2026-11";

export const SUBPROCESSORS = [
  { name: "Supabase Inc.", purpose: "Database, innlogging og fillagring", location: "EU (Stockholm, Sverige)", basis: "EUs standard personvernbestemmelser (SCC)" },
  { name: "Vercel Inc.", purpose: "Drift av nettsiden og serverfunksjoner", location: "EU (Stockholm) for serverfunksjoner; globalt nettverk for statiske filer", basis: "EUs standard personvernbestemmelser (SCC) og EU–US Data Privacy Framework" },
  { name: "Resend Inc.", purpose: "Utsending av innloggingskoder og varsler på e-post", location: "EU (Irland)", basis: "EUs standard personvernbestemmelser (SCC)" },
];

export const RETENTION = [
  ["Innlogging og tilgang", "Stenges dagen etter sluttdato"],
  ["Kontaktinfo, tilgjengelighet og varsler", "Slettes 3 måneder etter sluttdato"],
  ["Vakter uten registrerte timer", "Beholdes som bemanningshistorikk; navnet anonymiseres etter oppbevaringstiden"],
  ["Timer, godkjenninger, lønnsgrunnlag og endringslogg", "5 år etter utgangen av regnskapsåret (bokføringsloven), deretter anonymisert"],
  ["Ferie og fravær (bare type og dato, aldri diagnose)", "5 år etter utgangen av regnskapsåret, deretter anonymisert"],
] as const;

export const DPA_SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "1. Parter og formål",
    body: [
      "Denne avtalen gjelder mellom bedriften som bruker Vaktpilot (behandlingsansvarlig) og InnSpæll AS (databehandler).",
      "Formålet er å levere Vaktpilot: vaktplanlegging, bemanning, timeregistrering, fravær og grunnlag for lønn. InnSpæll behandler personopplysninger bare for å levere tjenesten og etter bedriftens instrukser.",
    ],
  },
  {
    title: "2. Hvilke opplysninger og hvem",
    body: [
      "Registrerte: bedriftens ansatte og administratorer.",
      "Opplysninger: navn, e-post, telefon, ansattnummer, stilling og avtale (stillingsprosent, lønnstype), arbeidsroller, vakter, timer og stempling, fravær med type og dato, ønsker om arbeidstid, beskjeder på oppslagstavlen og varsler.",
      "Sykefravær registreres uten diagnose eller helseopplysninger. Bedriften skal ikke legge inn helseopplysninger i kommentarfelt.",
    ],
  },
  {
    title: "3. InnSpælls plikter",
    body: [
      "Behandle opplysningene bare etter dokumenterte instrukser fra bedriften, slik de er gitt gjennom bruken av tjenesten og denne avtalen.",
      "Sørge for at personer med tilgang har taushetsplikt.",
      "Ha tekniske og organisatoriske sikkerhetstiltak: kryptert forbindelse, tilgangsstyring per bedrift i databasen (hver bedrift ser bare egne data), logging av endringer, og sikkerhetskopier hos underleverandør.",
      "Bistå bedriften med å oppfylle de ansattes rettigheter (innsyn, retting, sletting, dataportabilitet). Ansatte kan laste ned egne data i appen; administrator kan laste ned alle bedriftens data.",
      "Varsle bedriften uten ugrunnet opphold, og senest innen 48 timer, ved brudd på personopplysningssikkerheten.",
      "Bistå ved vurdering av personvernkonsekvenser og forhåndsdrøftinger når det er relevant.",
    ],
  },
  {
    title: "4. Underleverandører",
    body: [
      "Bedriften godkjenner underleverandørene som er listet i personvernerklæringen. InnSpæll varsler bedriften før nye underleverandører tas i bruk, og bedriften kan motsette seg endringen.",
      "Overføring utenfor EU/EØS skjer bare med gyldig grunnlag etter personvernforordningen kapittel V.",
    ],
  },
  {
    title: "5. Lagring og sletting",
    body: [
      "Opplysningene lagres og slettes etter rutinene i personvernerklæringen. Ved oppsigelse av avtalen kan bedriften laste ned alle data. InnSpæll sletter deretter bedriftens data innen 90 dager, med unntak av det som må oppbevares etter lov.",
    ],
  },
  {
    title: "6. Revisjon og varighet",
    body: [
      "Bedriften kan be om dokumentasjon på at avtalen følges. Avtalen gjelder så lenge bedriften bruker Vaktpilot, og erstatter tidligere databehandleravtaler om samme tjeneste.",
      "Norsk rett gjelder. Avtalen godtas elektronisk av en administrator på vegne av bedriften; tidspunkt, navn og versjon lagres.",
    ],
  },
];

/** Kundevilkår. Ny TERMS_VERSION gjelder nye kunder; eksisterende kunder varsles etter punkt 8.3. */
export const TERMS_VERSION = "2026-11";

export const TERMS_SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "1. Partene og avtalen",
    body: [
      `1.1 Avtalen gjelder mellom ${VENDOR.name} (org.nr. ${VENDOR.orgNumber}), heretter «InnSpæll», og bedriften som tar i bruk Vaktpilot, heretter «Kunden».`,
      "1.2 Avtalen består av disse vilkårene, gjeldende prisliste på vaktpilot.no og databehandleravtalen. Ved motstrid gjelder databehandleravtalen for behandling av personopplysninger, og disse vilkårene for alt annet.",
      "1.3 Avtalen inngås når Kunden oppretter bedriften i Vaktpilot og bekrefter vilkårene, eller signerer en egen ordre. Den som bekrefter, må ha fullmakt til å binde Kunden.",
      "1.4 Vaktpilot selges bare til næringsdrivende. Forbrukerkjøpsloven gjelder ikke.",
    ],
  },
  {
    title: "2. Tjenesten",
    body: [
      "2.1 Vaktpilot er en nettbasert tjeneste for vaktplan, timeregistrering, fravær, ferie og grunnlag for lønn. Tjenesten leveres «som den er», med de funksjonene som finnes til enhver tid.",
      "2.2 Vaktpilot beregner timer og tillegg. Vaktpilot utbetaler ikke lønn, beregner ikke skatt eller arbeidsgiveravgift, og er ikke et lønnssystem.",
      "2.3 InnSpæll kan videreutvikle og endre tjenesten. Endringer som vesentlig reduserer funksjoner Kunden bruker, varsles minst 30 dager før de trer i kraft.",
      "2.4 Testfase. Funksjoner merket som test eller utkast kan ha feil og kan endres eller fjernes uten varsel. Kunden skal ikke bygge lønnsutbetaling på dem uten egen kontroll.",
    ],
  },
  {
    title: "3. Kundens ansvar",
    body: [
      "3.1 Kunden er arbeidsgiver og har alltid ansvaret for riktig lønn, overtid, tillegg, ferie og feriepenger, og for at arbeidstiden følger arbeidsmiljøloven, tariffavtaler og arbeidsavtaler.",
      "3.2 Kunden skal kontrollere lønnsgrunnlaget før det brukes til utbetaling, og velge og bekrefte riktig tariffavtale og lokale avtaler i Vaktpilot.",
      "3.3 Tariffsatser i Vaktpilot er lagt inn av InnSpæll etter offentlige kilder, og kan være forenklet. Det står i appen hva som er forenklet. At en tariff kan velges i Vaktpilot, betyr ikke at Kunden er bundet av den.",
      "3.4 Varsler om arbeidstid og hvile er hjelpemidler. Manglende varsel betyr ikke at reglene er fulgt.",
      "3.5 Kunden er ansvarlig for at opplysningene som legges inn er riktige, for hvem som får tilgang, og for at ledere bruker tofaktorinnlogging og ikke deler innlogging.",
      "3.6 Kunden skal ikke bruke tjenesten i strid med lov, prøve å få tilgang til andres data, eller belaste tjenesten unormalt.",
    ],
  },
  {
    title: "4. Pris, betaling og oppsigelse",
    body: [
      "4.1 Prisen følger prislisten på vaktpilot.no. Lanseringspris: 299 kr per måned eks. mva. med 5 aktive ansatte inkludert, og 39 kr per måned for hver aktiv ansatt utover det. En ansatt er aktiv når hen har hatt en publisert vakt eller registrerte timer i måneden.",
      "4.2 Kunder som får lanseringspris, beholder den i 12 måneder fra avtalen inngås. Deretter gjelder ordinær prisliste.",
      "4.3 Antall aktive ansatte telles automatisk og vises for Kunden under Innstillinger › Abonnement. Fakturering skjer månedlig etterskuddsvis, med betalingsfrist 14 dager.",
      "4.4 Nye kunder får en gratis prøveperiode på 30 dager. Måneder som starter før prøveperioden er over, faktureres ikke. Avtalen fortsetter etter prøveperioden hvis Kunden ikke sier opp.",
      "4.5 InnSpæll kan endre prisene med 60 dagers varsel. Kunden kan da si opp med virkning fra når endringen trer i kraft.",
      "4.6 Ved forsinket betaling kan InnSpæll kreve forsinkelsesrente. Er betaling mer enn 30 dager forsinket etter skriftlig purring, kan InnSpæll stenge tilgangen for ledere. De ansatte beholder alltid tilgang til egne timer og egne data.",
      "4.7 Det er ingen bindingstid. Begge parter kan si opp avtalen skriftlig (også i appen eller på e-post) med virkning fra utgangen av måneden.",
    ],
  },
  {
    title: "5. Tilgjengelighet, feil og support",
    body: [
      "5.1 InnSpæll skal sørge for at tjenesten er tilgjengelig og fungerer, men garanterer ikke at den er uten avbrudd eller feil. Planlagt vedlikehold varsles i appen i forkant når det er mulig.",
      "5.2 Feil meldes til InnSpæll på e-post. Feil som hindrer lønnskjøring eller innlogging prioriteres, og InnSpæll skal starte feilretting innen neste virkedag.",
      "5.3 Retter InnSpæll en feil i beregningen, gjøres det med virkning fremover. Låste lønnsperioder endres ikke, men Vaktpilot viser differansen slik at Kunden kan rette den ved neste lønnskjøring.",
      "5.4 Tjenesten driftes hos underleverandører (Supabase i EU, Vercel og Resend). Listen over underleverandører står i databehandleravtalen.",
    ],
  },
  {
    title: "6. Ansvarsbegrensning",
    body: [
      "6.1 InnSpæll er ansvarlig for direkte tap Kunden lider som følge av at InnSpæll har opptrådt uaktsomt.",
      "6.2 InnSpæll er ikke ansvarlig for indirekte tap, som tapt fortjeneste, tapte data utover det som kan gjenopprettes fra sikkerhetskopi, krav fra tredjeparter, eller tap som følge av driftsavbrudd.",
      "6.3 InnSpæll er ikke ansvarlig for feil lønn, etterbetaling, renter, tilleggskrav eller sanksjoner som følger av lønnsgrunnlag eller arbeidstidsvarsler fra Vaktpilot, siden Kunden etter punkt 3 skal kontrollere grunnlaget og har ansvaret som arbeidsgiver. Dette gjelder også når årsaken er feil eller forenkling i en tariff som er lagt inn av InnSpæll.",
      "6.4 InnSpælls samlede ansvar i et kalenderår er begrenset til det Kunden har betalt for tjenesten de siste 12 månedene før skaden oppstod.",
      "6.5 Begrensningene gjelder ikke ved forsett eller grov uaktsomhet, eller der loven ikke tillater dem.",
      "6.6 Krav må fremmes skriftlig innen rimelig tid, og senest 6 måneder etter at Kunden ble kjent med forholdet.",
    ],
  },
  {
    title: "7. Personvern og data",
    body: [
      "7.1 Kunden er behandlingsansvarlig for personopplysninger om sine ansatte. InnSpæll er databehandler etter databehandleravtalen, som Kunden godtar ved registrering.",
      "7.2 Data lagres i EU/EØS. InnSpæll bruker ikke Kundens data til andre formål enn å levere tjenesten, og selger ikke data.",
      "7.3 Kunden eier sine data. Ved oppsigelse kan Kunden laste ned lønnsgrunnlag, timer og rapporter før avtalen opphører. InnSpæll sletter Kundens data innen 90 dager etter opphør, bortsett fra det InnSpæll må oppbevare etter lov, som regnskapsbilag.",
      "7.4 InnSpæll kan bruke anonyme og samlede tall (for eksempel antall aktive ansatte) til drift, fakturering og forbedring av tjenesten.",
    ],
  },
  {
    title: "8. Øvrige bestemmelser",
    body: [
      "8.1 Mislighold. Ved vesentlig mislighold kan den andre parten heve avtalen dersom forholdet ikke er rettet innen 30 dager etter skriftlig varsel.",
      "8.2 Force majeure. Ingen av partene er ansvarlige for forhold utenfor deres kontroll, som brudd hos underleverandører, strøm eller nett, angrep eller offentlige pålegg.",
      "8.3 Endringer i vilkårene. InnSpæll kan endre vilkårene med 30 dagers varsel i appen og på e-post. Endringer til ugunst for Kunden gir Kunden rett til å si opp før de trer i kraft.",
      "8.4 Overdragelse. InnSpæll kan overdra avtalen til et selskap som overtar tjenesten. Kunden får varsel.",
      "8.5 Lovvalg og verneting. Avtalen følger norsk rett. Tvister løses først ved forhandling, deretter ved Trøndelag tingrett som avtalt verneting.",
    ],
  },
];
