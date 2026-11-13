# Backlog

Ting som er bestemt eller foreslått, men ikke bygget ennå. Sortert etter prioritet.

## 1. Varsler utenfor appen
- **Push-varsler på mobil** når Vaktpilot er lagt på hjemskjermen (også iPhone).

## 2. Lov og plikter
- **Oppfølging av sykmeldte etter NAVs frister:** påminnelse til leder om oppfølgingsplan innen 4 uker og dialogmøte innen 7 uker. Telling av arbeidsgiverperioden (16 dager) og når refusjon fra NAV kan kreves.
- **Overtidsgrenser over tid** (arbeidsmiljøloven § 10-6): vise hvor nær hver ansatt er grensene per 7 dager, 4 uker og 52 uker (10, 25 og 200 timer), med varsel før grensen nås.
- **Kvote for sykt barn:** telle dager mot årskvoten (10 dager, 15 ved flere barn, mer for aleneomsorg).
- **Varsler etter ferieloven:** ferie som ikke er fastsatt 2 måneder før, og hovedferie (3 uker mellom 1. juni og 30. september).
- **Forskuddsferie** (ferieloven § 7 nr. 4: inntil 12 virkedager av neste års ferie etter avtale) som egen avtaletype med signatur, slik som overføring.

## 3. Drift og forretning for InnSpæll
- **Betaling og abonnement med Stripe Billing** (anbefalt start): fast pris per bedrift pluss per aktiv ansatt, månedlig eller årlig, kortbetaling med automatisk faktura og kvittering (PDF på e-post) til kunden.
  - *Erlend må først:* opprette Stripe-konto for InnSpæll AS (ID-sjekk av eier, bankkonto), bestemme priser (fast + per ansatt, måned/år, eventuell prøveperiode), sette opp faktura etter norske regler (org.nr. med «MVA», 25 % moms, fortløpende nummer), og avtale med regnskapsfører hvordan Stripe-utbetalinger og gebyrer føres i Fiken.
  - *Bygges i Vaktpilot:* abonnementsstatus per bedrift oppdatert automatisk fra Stripe (webhook), side «Abonnement» under Innstillinger (velg måned/år, se fakturaer, bytt kort), antall ansatte oppdateres hver måned, ved manglende betaling først varsel og frist, deretter stengt administrasjon – ansatte beholder alltid tilgang til egne timer og data. Plattformsiden viser betalt/ubetalt, antall ansatte og omsetning.
- **Faktura fra Fiken (EHF/e-post)** som alternativ for kunder som vil betale på faktura: Vaktpilot regner ut beløpet og lager fakturaen i Fiken; tilgang følges opp mot innbetaling.
- **Feilvarsling og drift:** varsling ved feil, side som viser om appen er oppe, og rutine for sikkerhetskopi. Bør være på plass før kunde nummer to.
- **Tofaktorinnlogging for administratorer.**
- **Automatiske tester av hele flyten** (innlogging, vakt, bekreftelse, lønnsfil) som kjøres før hver publisering.

## 3b. Tariffer
- **Prøveberegning** før første lønnskjøring: en vanlig uke og en helgeuke, til sammenligning med det kunden får i dag.
- **Ferdige tariffer** for de vanligste bransjene (f.eks. Reiselivsoverenskomsten, Butikkoverenskomsten, Renholdsoverenskomsten), lagt inn og kontrollert mot gjeldende avtaletekst.

## 4. Sjekkes før første lønnskjøring
- Satsene i lønnsberegningen mot Bilutleieoverenskomsten 2026.
- Importformatet i Fiken, og om lønnsfila bør tilpasses det.
- Gjennomgang av hele appen innlogget som ansatt og som admin, på mobil.

## 5. Nyttig for kundene
- **Forventet lønn denne måneden** for ansatte.
- **Matpenger** beregnet automatisk.
- **Endringshistorikk for leder:** hvem endret timer, vakter og fravær, og når (data lagres allerede).
- **Sjekklister på vakter**, f.eks. åpning/stenging eller utlevering/innlevering av bil.
- **Flere avdelinger eller lokasjoner per bedrift.**
- **Engelsk språk** for ansatte som ikke leser norsk.
- **Pårørende og nødkontakt** per ansatt, synlig bare for leder.

## 6. Senere
- **BankID-signering** av avtaler (først ferieoverføring, senere andre avtaler). I dag signeres med håndskrevet signatur på skjermen. Ikke BankID ved daglig innlogging – det blir dyrt og tungvint.
  - *Erlend må først:* inngå avtale med en BankID-formidler (Idura/tidligere Criipto, eller Signicat). InnSpæll AS og eierne blir sjekket.
  - *Kostnad:* BankIDs pris til formidlere fra 1.1.2026 er ca. 4,46 kr per signatur og ca. 1,34 kr per innlogging (0,95 kr med biometri), pluss formidlerens plattformavgift.
  - *Bygges i Vaktpilot:* integrasjon med OIDC og signert PDF (PAdES) – den gamle BankID Server-løsningen ble avviklet 1. april 2026.
  - *Personvern:* BankID gir fødselsnummer. Personvernerklæring, databehandleravtale og listen over underleverandører må oppdateres.
