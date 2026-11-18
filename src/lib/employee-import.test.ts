import { describe, expect, it } from "vitest";
import { buildXlsx } from "./xlsx";
import { parseEmployees, readDelimited, readSpreadsheet } from "./employee-import";

describe("import av ansatte", () => {
  it("leser tekst limt inn fra Excel og kjenner igjen kolonnene", () => {
    const rows = readDelimited("Navn\tE-post\tMobil\tStilling %\tStartdato\tLønnstype\tTurnus\nKari Nordmann\tKARI@a.no\t900 00 000\t80\t01.03.2025\tTimelønn\tja\nOla\t\t\t0,5\t2024-1-5\tfast\tnei\n");
    const { rows: out, missingName } = parseEmployees(rows);
    expect(missingName).toBe(false);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ full_name: "Kari Nordmann", email: "kari@a.no", phone: "900 00 000", position_pct: 80, start_date: "2025-03-01", pay_type: "hourly", is_shift_worker: true, problems: [] });
    expect(out[1]).toMatchObject({ full_name: "Ola", email: null, position_pct: 50, start_date: "2024-01-05", pay_type: "fixed", is_shift_worker: false });
  });

  it("CSV med semikolon, fornavn og etternavn, og feil i rader", () => {
    const rows = readDelimited('Fornavn;Etternavn;E-post\n"Per";"Hansen";per@x.no\n;;tom@x.no\nAnne;Lie;per@x.no\nBo;Ek;ikke-epost\nEva;Ny;finnes@x.no');
    const { rows: out } = parseEmployees(rows, ["finnes@x.no"]);
    expect(out[0].full_name).toBe("Per Hansen");
    expect(out[1].problems).toContain("Mangler navn");
    expect(out[2].problems).toContain("Samme e-post to ganger");
    expect(out[3].problems).toContain("Ugyldig e-post");
    expect(out[4].problems).toContain("Finnes allerede");
  });

  it("leser .xlsx", () => {
    const buf = buildXlsx([{ name: "Ansatte", rows: [["Navn", "E-post", "Stillingsprosent"], ["Kari Nordmann", "kari@a.no", 100], ["Ærlige Øystein", "oy@a.no", 40]] }]);
    const { rows: out } = parseEmployees(readSpreadsheet(Buffer.from(buf), "ansatte.xlsx"));
    expect(out.map((r) => [r.full_name, r.email, r.position_pct])).toEqual([["Kari Nordmann", "kari@a.no", 100], ["Ærlige Øystein", "oy@a.no", 40]]);
  });

  it("sier fra når navnekolonnen mangler", () => {
    expect(parseEmployees(readDelimited("Epost\na@b.no")).missingName).toBe(true);
  });
});
