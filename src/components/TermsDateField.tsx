"use client";

import { useState } from "react";

type Term = { valid_from: string; valid_to: string | null };
const short = (d: string) => d.split("-").reverse().join(".");
const dayBefore = (d: string) => new Date(Date.parse(d) - 86400000).toISOString().slice(0, 10);

/**
 * Fra-dato for en ny avtale. Velges en dato før gjeldende avtale, forklares det med en gang
 * hva som skjer, og lederen bekrefter (og kan flytte startdatoen) før det lagres.
 */
export function TermsDateField({ terms, startDate }: { terms: Term[]; startDate: string | null }) {
  const [date, setDate] = useState("");
  const current = terms.find((t) => !t.valid_to);
  const before = Boolean(date && current && date < current.valid_from);
  const same = Boolean(date && terms.some((t) => t.valid_from === date));
  // Perioden den nye avtalen får: fram til neste avtale starter
  const nextStart = terms.map((t) => t.valid_from).filter((f) => date && f > date).sort()[0];
  const covering = terms.find((t) => date && t.valid_from < date && (!t.valid_to || t.valid_to >= date));

  return (
    <div className="space-y-2 md:col-span-3">
      <label className="block max-w-xs">
        <span className="label">Fra dato</span>
        <input name="valid_from" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="input" />
      </label>
      {same && <p className="text-sm text-bad">Det finnes allerede en avtale som starter {short(date)}. Velg en annen dato.</p>}
      {before && !same && nextStart && (
        <div className="space-y-2 rounded-lg bg-warn-soft p-3 text-sm">
          <p>
            <b>Datoen er før avtalen som gjelder nå</b> (fra {short(current!.valid_from)}).
            {" "}Den nye avtalen gjelder da fra {short(date)} til og med {short(dayBefore(nextStart))}. Avtalen fra {short(nextStart)} blir som den er.
            {covering && ` Avtalen som gjaldt fra ${short(covering.valid_from)}, avsluttes ${short(dayBefore(date))}.`}
          </p>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="before_ok" required className="mt-0.5 h-4 w-4" />
            <span>Ja, legg inn avtalen for denne perioden</span>
          </label>
          {startDate && date < startDate && (
            <label className="flex items-start gap-2">
              <input type="checkbox" name="move_start" defaultChecked className="mt-0.5 h-4 w-4" />
              <span>Flytt startdatoen fra {short(startDate)} til {short(date)}<span className="block text-xs text-muted">Så startdatoen stemmer med første avtale.</span></span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
