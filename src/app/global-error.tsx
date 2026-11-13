"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    // Feil fra serveren (med digest) er allerede logget der
    if (error.digest) return;
    reportError("client", `${error.name}: ${error.message}`, typeof window !== "undefined" ? window.location.pathname : null, error.digest);
  }, [error]);
  return (
    <html lang="nb">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0, background: "#f4f6f8" }}>
        <div style={{ maxWidth: 420, padding: 24, background: "#fff", borderRadius: 12, textAlign: "center" }}>
          <h1 style={{ fontSize: 22 }}>Noe gikk galt</h1>
          <p style={{ color: "#5b6773" }}>Feilen er sendt til InnSpæll. Last siden på nytt om litt.</p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full innlasting etter feil */}
          <a href="/" style={{ color: "#1f5fbf", fontWeight: 600 }}>Til forsiden</a>
        </div>
      </body>
    </html>
  );
}
