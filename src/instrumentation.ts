import type { Instrumentation } from "next";

export function register() {}

/** Alle feil på serveren (sider, serverhandlinger, API) går til feilloggen. */
export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  const e = err as Error & { digest?: string };
  // Omdirigeringer og «ikke funnet» er ikke feil
  if (e?.digest?.startsWith("NEXT_REDIRECT") || e?.digest?.startsWith("NEXT_HTTP_ERROR_FALLBACK") || e?.message === "NEXT_NOT_FOUND") return;
  const { reportError } = await import("./lib/report-error");
  await reportError("server", `${e?.name ?? "Error"}: ${e?.message ?? String(err)}`, request.path, e?.digest);
};
