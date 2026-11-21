"use client";

import { useState } from "react";
import { Field } from "@/components/Form";

/**
 * Type fravær, og grad bare når legemeldt sykmelding er valgt (forhåndsutfylt med 100 %).
 * Graden gjelder arbeidsevnen; timene den ansatte jobber, føres som vanlig.
 */
export function AbsenceTypeGrade({ types }: { types: { id: string; name: string; key: string; note?: string }[] }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const sick = types.find((t) => t.id === typeId)?.key === "sykmelding";
  return (
    <>
      <Field label="Type">
        <select name="absence_type_id" required className="input" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.note ?? ""}</option>)}
        </select>
      </Field>
      {sick && (
        <Field label="Sykmeldingsgrad (%)" hint="Står det gradert på sykmeldingen, f.eks. 50? Graden gjelder arbeidsevnen. Timene den ansatte jobber, føres som vanlig.">
          <input key={typeId} name="percent" type="number" min={1} max={100} step={1} inputMode="numeric" defaultValue={100} required className="input" />
        </Field>
      )}
    </>
  );
}
