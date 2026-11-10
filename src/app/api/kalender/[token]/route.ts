import { createClient } from "@supabase/supabase-js";

/**
 * Kalenderlenke (iCal). Telefonens kalender henter denne jevnlig uten innlogging.
 * Tilgangen styres av den hemmelige lenken; databasefunksjonen gir bare den ansattes egne vakter.
 */
export const dynamic = "force-dynamic";

type Row = { uid: string; kind: string; title: string; starts_at: string | null; ends_at: string | null;
  from_date: string | null; to_date: string | null; break_minutes: number; updated: string; org_name: string; tz: string };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (d: string) => d.replace(/-/g, "");
function nextDay(d: string) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10).replace(/-/g, "");
}
/** Linjer i iCal skal brytes etter 75 tegn. */
const fold = (line: string) => line.match(/.{1,74}/g)?.join("\r\n ") ?? line;

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = token.replace(/\.ics$/, "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Ikke funnet", { status: 404 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.rpc("calendar_feed", { p_token: id });
  if (error) return new Response("Feil", { status: 500 });
  const rows = (data ?? []) as Row[];
  const orgName = rows[0]?.org_name ?? "Vaktpilot";
  const now = utc(new Date().toISOString());

  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//InnSpæll AS//Vaktpilot//NO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`Vakter – ${orgName}`)}`, "X-WR-TIMEZONE:Europe/Oslo", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  for (const r of rows) {
    lines.push("BEGIN:VEVENT", `UID:${r.kind}-${r.uid}@vaktpilot`, `DTSTAMP:${now}`, `LAST-MODIFIED:${utc(r.updated)}`);
    if (r.kind === "shift" && r.starts_at && r.ends_at) {
      lines.push(`DTSTART:${utc(r.starts_at)}`, `DTEND:${utc(r.ends_at)}`, `SUMMARY:${esc(`Vakt: ${r.title}`)}`,
        `DESCRIPTION:${esc(`${orgName}${r.break_minutes ? ` · pause ${r.break_minutes} min` : ""}`)}`, "TRANSP:OPAQUE");
    } else if (r.from_date && r.to_date) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(r.from_date)}`, `DTEND;VALUE=DATE:${nextDay(r.to_date)}`,
        `SUMMARY:${esc(r.title)}`, "TRANSP:TRANSPARENT");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=900" },
  });
}
