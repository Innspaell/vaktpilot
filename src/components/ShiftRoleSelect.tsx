"use client";

import { useState, useTransition } from "react";
import { setShiftRole } from "@/app/(app)/vaktplan/actions";

/** Rolle på en vakt: lagres med en gang du velger, uten å laste siden på nytt. */
export function ShiftRoleSelect({ shiftId, current, roles }: { shiftId: string; current: string | null; roles: { id: string; name: string; color: string }[] }) {
  const [value, setValue] = useState(current ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const color = roles.find((r) => r.id === value)?.color;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="h-3 w-3 rounded-full ring-1 ring-line" style={{ background: color ?? "transparent" }} aria-hidden />
      <select aria-label="Rolle på vakten" value={value} disabled={pending} className="input w-auto"
        onChange={(e) => {
          const prev = value;
          const next = e.target.value;
          setValue(next);
          setMsg(null);
          start(async () => {
            const r = await setShiftRole(shiftId, next || null);
            if (r.error) { setValue(prev); setMsg({ ok: false, text: r.error }); }
            else setMsg({ ok: true, text: "Lagret" });
          });
        }}>
        <option value="">Ingen rolle</option>
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {pending && <span className="text-sm text-muted">Lagrer …</span>}
      {msg && <span role="status" className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
    </div>
  );
}
