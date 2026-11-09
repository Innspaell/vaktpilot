"use client";

import { useEffect, useRef, useState } from "react";
import type { Company } from "@/lib/brreg";

function fmt(n: string) {
  return n.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

/**
 * Navnefelt med søk i Brønnøysundregistrene. Velger man et treff, fylles
 * orgnr og adresse inn. Feltene kan fortsatt redigeres for hånd.
 */
export function CompanyLookup({
  defaultName = "",
  defaultOrgNumber = "",
  defaultAddress = "",
  defaultPostalCode = "",
  defaultCity = "",
}: {
  defaultName?: string;
  defaultOrgNumber?: string;
  defaultAddress?: string;
  defaultPostalCode?: string;
  defaultCity?: string;
}) {
  const [name, setName] = useState(defaultName);
  const [orgNumber, setOrgNumber] = useState(defaultOrgNumber);
  const [address, setAddress] = useState(defaultAddress);
  const [postalCode, setPostalCode] = useState(defaultPostalCode);
  const [city, setCity] = useState(defaultCity);
  const [results, setResults] = useState<Company[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const skipNext = useRef(true);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = name.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/brreg?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const j = await r.json();
        setResults(j.results ?? []);
        setError(j.error ?? null);
        setOpen(true);
        setActive(-1);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Fikk ikke kontakt med Brønnøysundregistrene.");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [name]);

  function pick(c: Company) {
    skipNext.current = true;
    setName(c.name);
    setOrgNumber(c.orgNumber);
    setAddress(c.address ?? "");
    setPostalCode(c.postalCode ?? "");
    setCity(c.city ?? "");
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <>
      <div className="relative md:col-span-2">
        <label className="label" htmlFor="company-name">Navn eller organisasjonsnummer</label>
        <input
          id="company-name"
          name="name"
          required
          autoComplete="off"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          role="combobox"
          aria-expanded={open}
          aria-controls="company-results"
        />
        <span className="mt-1 block text-xs text-muted">
          {loading ? "Søker i Brønnøysundregistrene …" : error ?? "Skriv navnet, så henter vi orgnr og adresse fra Brønnøysundregistrene."}
        </span>
        {open && results.length > 0 && (
          <ul id="company-results" role="listbox"
            className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-line bg-white py-1 shadow-lg">
            {results.map((c, i) => (
              <li key={c.orgNumber} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}
                  className={`block w-full px-3 py-2 text-left text-sm ${i === active ? "bg-brand-soft" : "hover:bg-paper"}`}>
                  <span className="font-medium">{c.name}</span>
                  {c.inactive && <span className="badge ml-2 bg-bad-soft text-bad">Slettet/avvikles</span>}
                  <span className="block text-xs text-muted">
                    {fmt(c.orgNumber)}{c.form ? ` · ${c.form}` : ""}{c.city ? ` · ${c.city}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && !loading && results.length === 0 && name.trim().length >= 2 && !error && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-muted shadow-lg">
            Ingen treff. Du kan fylle inn for hånd.
          </div>
        )}
      </div>
      <label className="block">
        <span className="label">Organisasjonsnummer</span>
        <input name="org_number" inputMode="numeric" className="input" value={orgNumber} onChange={(e) => setOrgNumber(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Adresse</span>
        <input name="address" className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Postnummer</span>
        <input name="postal_code" inputMode="numeric" className="input" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Poststed</span>
        <input name="city" className="input" value={city} onChange={(e) => setCity(e.target.value)} />
      </label>
    </>
  );
}
