# Backlog

Ting som er bestemt eller foreslått, men ikke bygget ennå. Sortert etter prioritet.

## 1. Varsler utenfor appen
- **E-post fra ikkesvar@vaktpilot.no** via Resend når domenet er klart (DNS hos Domeneshop). Egen SMTP i Supabase, 6-sifret innloggingskode i e-postmalen, og påminnelser på e-post etter de samme varselvalgene som i appen.
- **Push-varsler på mobil** når Vaktpilot er lagt på hjemskjermen (også iPhone).

## 2. Lov og plikter
- **Oppfølging av sykmeldte etter NAVs frister:** påminnelse til leder om oppfølgingsplan innen 4 uker og dialogmøte innen 7 uker. Telling av arbeidsgiverperioden (16 dager) og når refusjon fra NAV kan kreves.
- **Overtidsgrenser over tid** (arbeidsmiljøloven § 10-6): vise hvor nær hver ansatt er grensene per 7 dager, 4 uker og 52 uker (10, 25 og 200 timer), med varsel før grensen nås.
- **Kvote for sykt barn:** telle dager mot årskvoten (10 dager, 15 ved flere barn, mer for aleneomsorg).
- **Varsler etter ferieloven:** ferie som ikke er fastsatt 2 måneder før, og hovedferie (3 uker mellom 1. juni og 30. september).
- **Forskuddsferie** (ferieloven § 7 nr. 4: inntil 12 virkedager av neste års ferie etter avtale) som egen avtaletype med signatur, slik som overføring.

## 3. Drift og forretning for InnSpæll
- **Fakturering av kundene:** fast pris per bedrift pluss per aktiv ansatt. Plattformsiden viser antall aktive ansatte per måned og lager fakturagrunnlag (f.eks. til Fiken).
- **Feilvarsling og drift:** varsling ved feil, side som viser om appen er oppe, og rutine for sikkerhetskopi. Bør være på plass før kunde nummer to.
- **Tofaktorinnlogging for administratorer.**
- **Automatiske tester av hele flyten** (innlogging, vakt, bekreftelse, lønnsfil) som kjøres før hver publisering.

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
- **BankID-signering** av avtaler. I dag signeres med håndskrevet signatur på skjermen. Krever avtale med en signeringsleverandør (f.eks. Signicat, Criipto eller Idfy) og kostnad per signatur.
