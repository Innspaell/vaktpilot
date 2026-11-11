"use client";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="btn-ghost">Skriv ut / lagre som PDF</button>;
}
