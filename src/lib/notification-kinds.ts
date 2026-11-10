// Varseltyper bedriften kan slå av og på. Nøkler må stemme med «kind» i databasen.

export interface NotificationGroup {
  key: string;
  label: string;
  description: string;
  /** Hvem som får varselet */
  to: "ansatte" | "ledere";
  kinds: string[];
  /** Merkes som lest av seg selv når saken er løst */
  autoResolves?: string;
}

export const NOTIFICATION_GROUPS: NotificationGroup[] = [
  { key: "schedule", to: "ansatte", label: "Ny vaktplan er publisert", kinds: ["schedule_published"],
    description: "Når du publiserer en periode, får alle med vakter i perioden beskjed." },
  { key: "changed", to: "ansatte", label: "Vakt endret, tildelt eller fjernet", kinds: ["shift_changed", "shift_assigned"],
    description: "Når en publisert vakt får ny tid, eller noen settes på eller tas av vakta." },
  { key: "open", to: "ansatte", label: "Ledige vakter", kinds: ["open_shifts"],
    description: "Når det publiseres eller oppstår en ledig vakt.",
    autoResolves: "når vakta er tatt, avlyst eller har startet" },
  { key: "cancelled", to: "ansatte", label: "Vakter avlyst", kinds: ["shifts_cancelled"],
    description: "Når du fjerner publiserte vakter for en periode." },
  { key: "shift_answer", to: "ansatte", label: "Svar på vaktpåmelding", kinds: ["shift_approved", "shift_rejected"],
    description: "Når en påmelding til en ledig vakt godkjennes eller avslås." },
  { key: "absence_answer", to: "ansatte", label: "Svar på fri og registrert fravær", kinds: ["absence_decided", "absence_registered"],
    description: "Når en søknad om fri behandles, eller leder registrerer fravær på den ansatte." },
  { key: "swap", to: "ansatte", label: "Vaktbytte", kinds: ["swap_offer", "swap_answer", "swap_decided"],
    description: "Når en kollega spør om du kan ta en vakt, svarer på spørsmålet ditt, eller leder avgjør byttet.",
    autoResolves: "når kollegaen har svart eller byttet er avgjort" },
  { key: "time_approved", to: "ansatte", label: "Timer godkjent", kinds: ["time_approved"],
    description: "Når leder godkjenner timer. Ett varsel per godkjenning." },
  { key: "reminder_shift", to: "ansatte", label: "Påminnelse dagen før vakt", kinds: ["reminder_shift"],
    description: "Sendes kl. 17 dagen før.",
    autoResolves: "når vakta er over" },
  { key: "reminder_confirm", to: "ansatte", label: "Påminnelse om å bekrefte arbeidsdagen", kinds: ["reminder_confirm"],
    description: "Sendes kl. 17 hvis en vakt i dag eller i går ikke er bekreftet eller stemplet.",
    autoResolves: "når arbeidsdagen er bekreftet" },
  { key: "shift_request", to: "ledere", label: "Ny vaktpåmelding", kinds: ["shift_request"],
    description: "Når en ansatt melder seg på en ledig vakt som må godkjennes.",
    autoResolves: "når påmeldingen er godkjent eller avslått" },
  { key: "absence_request", to: "ledere", label: "Søknad om fri og registrert fravær", kinds: ["absence_request"],
    description: "Når en ansatt søker om fri eller registrerer egenmelding.",
    autoResolves: "når søknaden er behandlet eller trukket" },
  { key: "swap_request", to: "ledere", label: "Vaktbytte som må godkjennes", kinds: ["swap_request"],
    description: "Når en kollega har sagt ja til et bytte, eller en ansatt vil gi bort en vakt.",
    autoResolves: "når byttet er godkjent eller avslått" },
];

/** En gruppe er på hvis ingen av typene er slått av. */
export function groupEnabled(prefs: Record<string, unknown> | null | undefined, g: NotificationGroup) {
  return !g.kinds.some((k) => prefs?.[k] === false);
}
