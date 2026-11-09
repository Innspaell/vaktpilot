"use client";

import { useState } from "react";

/** Velg ansatt til en vakt, eller legg inn en ny ansatt i samme skjema. */
export function EmployeePicker({
  people,
  roles,
}: {
  people: { id: string; name: string; pct?: number | null }[];
  roles: { id: string; name: string }[];
}) {
  const [value, setValue] = useState("");
  const isNew = value === "__new";
  return (
    <>
      <label className="block">
        <span className="label">Ansatt</span>
        <select name="employee_id" className="input" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Ledig vakt (ansatte kan melde seg)</option>
          {people.length > 0 && (
            <optgroup label="Ansatte">
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.pct ? ` · ${p.pct} %` : ""}</option>
              ))}
            </optgroup>
          )}
          <option value="__new">+ Ny ansatt …</option>
        </select>
      </label>
      {isNew && (
        <div className="grid gap-3 rounded-lg border border-brand/30 bg-brand-soft p-3 md:col-span-4 md:grid-cols-4">
          <div className="text-sm font-semibold md:col-span-4">Ny ansatt</div>
          <label className="block"><span className="label">Navn</span><input name="full_name" required className="input" /></label>
          <label className="block"><span className="label">E-post (for innlogging)</span><input name="email" type="email" className="input" /></label>
          <label className="block"><span className="label">Stillingsprosent</span>
            <input name="position_pct" type="number" min={1} max={100} step="0.5" defaultValue={100} className="input" />
          </label>
          <label className="block"><span className="label">Lønnstype</span>
            <select name="pay_type" defaultValue="hourly" className="input">
              <option value="hourly">Timelønn</option>
              <option value="fixed">Fastlønn</option>
            </select>
          </label>
          {roles.length > 0 && (
            <label className="block"><span className="label">Arbeidsrolle</span>
              <select name="new_work_role_id" className="input" defaultValue="">
                <option value="">Ingen</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          )}
          <p className="self-end text-xs text-muted md:col-span-3">Flere opplysninger kan legges inn under Ansatte senere.</p>
        </div>
      )}
    </>
  );
}
