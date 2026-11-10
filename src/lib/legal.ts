// Opplysninger om leverandøren og tekster for personvern og databehandleravtale.
// Rett her ved endringer. Ny DPA_VERSION gjør at bedriftene må godta avtalen på nytt.

export const VENDOR = {
  name: "InnSpæll AS",
  orgNumber: "936 532 233",
  place: "Stjørdal",
  /** Kontakt for personvern. Fylles inn av InnSpæll. Tom = vises som «kontakt via arbeidsgiveren». */
  contactEmail: "",
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
