"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/(app)/actions";

export function ActionForm({
  action,
  children,
  submitLabel = "Lagre",
  className = "space-y-4",
  secondary = false,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel?: string;
  className?: string;
  /** Vis knappen som sekundærknapp (f.eks. «Test tilkoblingen») */
  secondary?: boolean;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      {/* Egen rad i rutenett, nederst i rader: knappen står alltid likt under feltene */}
      <div className="col-span-full flex flex-wrap items-center gap-3 self-end">
        <Submit label={submitLabel} secondary={secondary} />
        {state?.error && <p className="text-sm text-bad">{state.error}</p>}
        {state?.ok && <p className="text-sm text-good">{state.ok}</p>}
      </div>
    </form>
  );
}

function Submit({ label, secondary }: { label: string; secondary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={secondary ? "btn-ghost" : "btn-primary"} disabled={pending}>
      {pending ? (label === "Lagre" ? "Lagrer …" : "Vent litt …") : label}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
