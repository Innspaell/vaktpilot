"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Feil fra serveren (med digest) er allerede logget der
    if (error.digest) return;
    reportError("client", `${error.name}: ${error.message}`, typeof window !== "undefined" ? window.location.pathname : null, error.digest);
  }, [error]);
  return (
    <div className="card mx-auto mt-10 max-w-md space-y-3 text-center">
      <h1 className="h1">Noe gikk galt</h1>
      <p className="text-sm text-muted">Feilen er sendt til InnSpæll. Prøv igjen, eller gå tilbake til forsiden.</p>
      <div className="flex justify-center gap-2">
        <button onClick={reset} className="btn-primary">Prøv igjen</button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full innlasting etter feil */}
        <a href="/" className="btn-ghost">Til forsiden</a>
      </div>
    </div>
  );
}
