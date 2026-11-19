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
    ["Skriv over eksemplene på arket «Ansatte» med dine egne ansatte, én per rad. Overskriftene i første rad må stå."],
    ["Vaktpilot leser bare det første arket. Du ser alt før noe lagres, og kan hoppe over rader med feil."],
    ["Olav Tryggvason grunnla Nidaros i 997, og er derfor daglig leder i eksemplet. Bare navn er påkrevd; resten kan stå tomt."],
    [],
    ["Kolonne", "Må fylles ut?", "Slik skriver du det"],
    ["Navn", "Ja", "Fullt navn. Du kan også bruke to kolonner: Fornavn og Etternavn."],
    ["E-post", "Nei, men lurt", "Brukes til innlogging og invitasjon. Uten e-post kan den ansatte ikke logge inn før du legger den inn."],
    ["Mobil", "Nei", "Med eller uten mellomrom."],
    ["Ansattnummer", "Nei", "Bruk samme nummer som i lønnssystemet, så passer lønnsgrunnlaget rett inn."],
    ["Startdato", "Nei", "01.03.2025 eller 2025-03-01. Tom = du velger én dato for alle når du importerer."],
    ["Stillingsprosent", "Nei", "100, 80 eller 0,8. Tom = du velger én verdi for alle."],
    ["Lønnstype", "Nei", "Timelønn eller Fastlønn. Tom = du velger for alle."],
    ["Turnus", "Nei", "Ja hvis den ansatte jobber turnus eller skift, ellers Nei."],
  ];
  return buildXlsx([
    { name: "Ansatte", rows: [EXAMPLE_HEADERS, ...people], widths: [22, 24, 14, 14, 12, 16, 12, 8] },
    { name: "Slik fyller du ut", rows: guide, widths: [18, 16, 90] },
  ]);
}
