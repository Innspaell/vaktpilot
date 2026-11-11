"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

/** Knapp som må trykkes to ganger: først «Slett», så «Ja, slett». Brukes inne i et <form>. */
export function ConfirmButton({ label, confirmLabel, className = "text-sm text-bad" }: { label: string; confirmLabel: string; className?: string }) {
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();
  if (!armed) return <button type="button" onClick={() => setArmed(true)} className={className}>{label}</button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">Er du sikker?</span>
      <button type="submit" disabled={pending} className="btn-primary min-h-9 bg-bad px-3 py-1.5">{confirmLabel}</button>
      <button type="button" onClick={() => setArmed(false)} className="btn-ghost min-h-9 px-3 py-1.5">Avbryt</button>
    </span>
  );
}
