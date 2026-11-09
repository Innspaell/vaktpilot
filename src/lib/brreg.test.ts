import { describe, expect, it } from "vitest";
import { toCompany, formatOrgNumber } from "./brreg";

describe("Brønnøysund", () => {
  it("henter orgnr og forretningsadresse", () => {
    const c = toCompany({
      organisasjonsnummer: "123456789",
      navn: "Æ E TRØNDER AS",
      organisasjonsform: { kode: "AS" },
      forretningsadresse: { adresse: ["Kirkegata 1", ""], postnummer: "7500", poststed: "STJØRDAL" },
    });
    expect(c).toEqual({
      orgNumber: "123456789", name: "Æ E TRØNDER AS", form: "AS",
      address: "Kirkegata 1", postalCode: "7500", city: "STJØRDAL", inactive: false,
    });
  });

  it("bruker postadresse når forretningsadresse mangler, og merker konkurs", () => {
    const c = toCompany({ organisasjonsnummer: "1", navn: "X", postadresse: { adresse: ["Postboks 5"] }, konkurs: true });
    expect(c.address).toBe("Postboks 5");
    expect(c.inactive).toBe(true);
  });

  it("formaterer orgnr", () => {
    expect(formatOrgNumber("123456789")).toBe("123 456 789");
  });
});
