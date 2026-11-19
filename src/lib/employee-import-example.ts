import { buildXlsx, type Cell } from "./xlsx";

/** Overskriftene import av ansatte kjenner igjen, i den rekkefølgen eksempelfila bruker. */
export const EXAMPLE_HEADERS = ["Navn", "E-post", "Mobil", "Ansattnummer", "Startdato", "Stillingsprosent", "Lønnstype", "Turnus"];

/** Eksempelfil for import av ansatte: ett ark med eksempler å skrive over, og ett med forklaring. */
export function employeeImportExample() {
  const people: Cell[][] = [
    ["Olav Tryggvason", "olav@eksempel.no", "997 00 997", 1, "01.01.2025", 100, "Fastlønn", "Nei"],
    ["Kari Kjøttkakesen", "kari@eksempel.no", "900 00 001", 2, "01.03.2025", 80, "Timelønn", "Ja"],
    ["Ola Ka-Di-Sei", "ola@eksempel.no", "900 00 002", 3, "15.04.2025", 60, "Timelønn", "Ja"],
    ["Sigrid Sodd", "sigrid@eksempel.no", "900 00 003", 4, "01.06.2025", 40, "Timelønn", "Ja"],
  ];
  const guide: Cell[][] = [
    ["Slik fyller du ut fila"],
    [],
    ["1. Gå til arket «Ansatte»."],
    ["2. La overskriftene i første rad stå. Du kan fjerne kolonner du ikke trenger, eller endre rekkefølgen."],
    ["3. Slett eksemplene og skriv inn de ansatte, én per rad."],
    ["4. Lagre fila, og last den opp under Ansatte › Importer fra Excel i Vaktpilot."],
    ["5. Du ser alle radene før noe lagres. Rader med feil blir merket og hoppet over."],
    [],
    ["MÅ MED"],
    ["Kolonne", "Slik skriver du det"],
    ["Navn", "Fullt navn, for eksempel Kari Kjøttkakesen. Du kan også bruke to kolonner: Fornavn og Etternavn."],
    [],
    ["KAN MED (tomme felt er greit)"],
    ["Kolonne", "Slik skriver du det", "Hvis det står tomt"],
    ["E-post", "kari@firma.no. Brukes til innlogging og invitasjon.", "Den ansatte kan ikke logge inn før du legger inn e-post."],
    ["Mobil", "Med eller uten mellomrom.", "Ingenting skjer."],
    ["Ansattnummer", "Samme nummer som i lønnssystemet.", "Lønnsgrunnlaget får ikke ansattnummer."],
    ["Startdato", "01.03.2025 eller 2025-03-01.", "Du velger én dato for alle når du importerer."],
    ["Stillingsprosent", "100, 80 eller 0,8.", "Du velger én verdi for alle når du importerer."],
    ["Lønnstype", "Timelønn eller Fastlønn.", "Du velger for alle når du importerer."],
    ["Turnus", "Ja eller Nei. Ja hvis den ansatte jobber turnus eller skift.", "Regnes som Nei."],
    [],
    ["Godt å vite"],
    ["Vaktpilot leser bare det første arket i fila."],
    ["Samme e-post kan bare brukes én gang. Ansatte som allerede finnes i Vaktpilot, blir hoppet over."],
    ["Du kan også kopiere cellene rett fra Excel og lime dem inn i Vaktpilot, i stedet for å laste opp fila."],
    ["Maks 500 ansatte per fil."],
  ];
  return buildXlsx([
    { name: "Ansatte", rows: [EXAMPLE_HEADERS, ...people], widths: [22, 24, 14, 14, 12, 16, 12, 8] },
    { name: "Les meg – slik fyller du ut", rows: guide, widths: [18, 58, 58] },
  ]);
}
