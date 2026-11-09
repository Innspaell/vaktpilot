import { requireOrg } from "@/lib/context";
import { clockState } from "@/lib/clock";
import { ClockButton } from "@/components/ClockButton";
import { formatDateLong, formatHours, localDate, localTime, workedMinutes } from "@/lib/time";

const STATUS: Record<string, [string, string]> = {
  draft: ["Utkast", "bg-paper text-muted"],
  submitted: ["Sendt inn", "bg-brand-soft text-brand"],
  approved: ["Godkjent", "bg-good-soft text-good"],
  locked: ["Låst", "bg-paper text-muted"],
};

export default async function TimePage() {
  const ctx = await requireOrg();
  const tz = ctx.org.timezone;
  const clock = await clockState(ctx);
  const { data: entries } = ctx.employeeId
    ? await ctx.supabase.from("time_entries").select("id, starts_at, ends_at, break_minutes, status, comment")
        .eq("employee_id", ctx.employeeId).order("starts_at", { ascending: false }).limit(30)
    : { data: [] };

  return (
    <div className="space-y-4">
      <h1 className="h1">Timer</h1>
      {!ctx.employeeId ? (
        <p className="card text-sm text-muted">Du er ikke registrert som ansatt i denne bedriften.</p>
      ) : (
        <>
          {clock && <ClockButton state={clock.state} since={clock.since} />}
          <section className="card p-0">
            <h2 className="h2 px-4 pt-4">Siste registreringer</h2>
            {(entries ?? []).length === 0 ? (
              <p className="p-4 text-sm text-muted">Ingen timer registrert ennå.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {(entries ?? []).map((e) => {
                  const s = new Date(e.starts_at);
                  const [label, cls] = STATUS[e.status];
                  return (
                    <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div>
                        <div className="font-medium capitalize">{formatDateLong(localDate(s, tz))}</div>
                        <div className="tabular-nums text-muted">
                          {localTime(s, tz)}–{e.ends_at ? localTime(new Date(e.ends_at), tz) : "pågår"}
                          {e.break_minutes > 0 && ` · pause ${e.break_minutes} min`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {e.ends_at && <span className="tabular-nums">{formatHours(workedMinutes(s, new Date(e.ends_at), e.break_minutes))}</span>}
                        <span className={`badge ${cls}`}>{label}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <p className="text-sm text-muted">Manuell registrering og retting av timer kommer i neste del.</p>
        </>
      )}
    </div>
  );
}
