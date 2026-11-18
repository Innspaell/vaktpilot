import { createClient } from "@/lib/supabase/server";

/** Driftsmeldinger fra InnSpæll, øverst på siden mens de gjelder. */
export async function ServiceNotices() {
  const now = new Date().toISOString();
  const { data } = await (await createClient()).from("service_notices").select("id, message, level, starts_at, ends_at")
    .lte("starts_at", new Date(Date.now() + 24 * 3600000).toISOString()).or(`ends_at.is.null,ends_at.gt.${now}`).order("starts_at");
  if (!data?.length) return null;
  const time = (d: string) => new Date(d).toLocaleString("nb-NO", { timeZone: "Europe/Oslo", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="space-y-2">
      {data.map((n) => {
        const upcoming = n.starts_at > now;
        const tone = n.level === "down" ? "bg-bad-soft text-bad" : n.level === "warning" ? "bg-warn-soft text-warn" : "bg-brand-soft text-brand";
        return (
          <div key={n.id} className={`card py-3 text-sm ${tone}`} role="status">
            <b>{n.level === "down" ? "Driftsavbrudd" : upcoming ? "Planlagt" : "Melding fra Vaktpilot"}:</b>{" "}
            <span className="text-ink">{n.message}</span>
            {(upcoming || n.ends_at) && (
              <span className="text-muted"> ({upcoming ? `fra ${time(n.starts_at)}` : ""}{upcoming && n.ends_at ? " " : ""}{n.ends_at ? `til ${time(n.ends_at)}` : ""})</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
