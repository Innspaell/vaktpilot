// Oppslag i Enhetsregisteret (Brønnøysundregistrene). Åpent API, ingen nøkkel.
const BASE = "https://data.brreg.no/enhetsregisteret/api/enheter";

export interface Company {
  orgNumber: string;
  name: string;
  form: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  inactive: boolean;
}

type BrregEnhet = {
  organisasjonsnummer: string;
  navn: string;
  organisasjonsform?: { kode?: string };
  forretningsadresse?: { adresse?: string[]; postnummer?: string; poststed?: string };
  postadresse?: { adresse?: string[]; postnummer?: string; poststed?: string };
  konkurs?: boolean;
  underAvvikling?: boolean;
  slettedato?: string;
};

export function toCompany(e: BrregEnhet): Company {
  const a = e.forretningsadresse ?? e.postadresse;
  return {
    orgNumber: e.organisasjonsnummer,
    name: e.navn,
    form: e.organisasjonsform?.kode ?? null,
    address: a?.adresse?.filter(Boolean).join(", ") || null,
    postalCode: a?.postnummer ?? null,
    city: a?.poststed ?? null,
    inactive: Boolean(e.konkurs || e.underAvvikling || e.slettedato),
  };
}

/** Søk på navn, eller slå opp direkte hvis teksten er et orgnr (9 siffer). */
export async function searchCompanies(query: string): Promise<Company[]> {
  const q = query.trim();
  const digits = q.replace(/\s/g, "");
  if (/^\d{9}$/.test(digits)) {
    const r = await fetch(`${BASE}/${digits}`, { headers: { accept: "application/json" }, next: { revalidate: 86400 } });
    if (!r.ok) return [];
    return [toCompany(await r.json())];
  }
  if (q.length < 2) return [];
  const url = `${BASE}?navn=${encodeURIComponent(q)}&size=8`;
  const r = await fetch(url, { headers: { accept: "application/json" }, next: { revalidate: 3600 } });
  if (!r.ok) return [];
  const json = (await r.json()) as { _embedded?: { enheter?: BrregEnhet[] } };
  return (json._embedded?.enheter ?? []).map(toCompany).sort((a, b) => Number(a.inactive) - Number(b.inactive));
}

/** "123456789" → "123 456 789" */
export function formatOrgNumber(n: string) {
  return n.replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}
