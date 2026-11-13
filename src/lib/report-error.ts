/** Send en feil til Vaktpilots feillogg (fungerer både på server og i nettleser, uten innlogging). Feiler stille. */
export async function reportError(source: "server" | "client", message: string, path?: string | null, digest?: string | null) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    await fetch(`${url}/rest/v1/rpc/log_app_error`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_source: source, p_message: message.slice(0, 1000), p_path: path ?? null, p_digest: digest ?? null }),
      keepalive: true,
    });
  } catch {
    // Feilloggen skal aldri skape nye feil
  }
}
