"use client";
import { useEffect } from "react";

/** Husker hvilken vaktplan-visning brukeren valgte sist (i et år). */
export function RememberView({ view }: { view: string }) {
  useEffect(() => {
    try { document.cookie = `vp_vaktplan=${view}; path=/; max-age=31536000; samesite=lax`; } catch { /* ingen lagring */ }
  }, [view]);
  return null;
}
