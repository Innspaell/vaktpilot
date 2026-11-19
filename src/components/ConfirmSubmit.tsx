"use client";
import { useState } from "react";

/**
 * Sendeknapp som spør først når `warning` er satt: første trykk viser advarselen, andre trykk sender.
 * Brukes for handlinger som er lov, men som lederen bør tenke over.
 */
export function ConfirmSubmit({ label, confirmLabel, warning, form, className = "btn-primary" }:
  { label: string; confirmLabel?: string; warning?: string | null; form?: string; className?: string }) {
  const [asking, setAsking] = useState(false);
  if (!warning) return <button form={form} className={className}>{label}</button>;
  if (!asking) return <button type="button" onClick={() => setAsking(true)} className={className}>{label}</button>;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
      <span>{warning}</span>
      <button form={form} className="btn-primary">{confirmLabel ?? "Ja, godkjenn likevel"}</button>
      <button type="button" onClick={() => setAsking(false)} className="btn-ghost">Avbryt</button>
    </div>
  );
}
