import { requireOrg } from "@/lib/context";
import { colleagues } from "@/lib/data";
import { formatDateLong, localDate, localTime } from "@/lib/time";
import { cancelRequest, decideRequest } from "../vaktplan/actions";

const STATUS: Record<string, [string, string]> = {
  pending: ["Venter", "bg-warn-soft text-warn"],
  approved: ["Godkjent", "bg-good-soft text-good"],
  rejected: ["Avslått", "bg-bad-soft text-bad"],
  cancelled: ["Trukket", "bg-paper text-muted"],
};

type Req = {
  id: string; employee_id: string; kind: "open_shift" | "proposal"; status: string; comment: string | null;
  requested_start: string | null; requested_end: string | null; created_at: string;
  warnings: { message: string }[];
  shifts: { starts_at: string; ends_at: string } | null;
};

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ feil?: string }> }) {
  const { feil } = await searchParams;
  const ctx = await requireOrg();
  const tz = ctx.org.timezone;
  let q = ctx.supabase
    .from("shift_requests")
    .select("id, employee_id, kind, status, comment, requested_start, requested_end, created_at, warnings, shifts!shift_requests_shift_id_fkey(starts_at, ends_at)")
    .eq("org_id", ctx.org.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!ctx.isAdmin) q = q.eq("employee_id", ctx.employeeId ?? "");
  const [{ data }, names] = await Promise.all([q, colleagues(ctx)]);
  const rows = (data ?? []) as unknown as Req[];
  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");

  const when = (r: Req) => {
    const s = new Date(r.shifts?.starts_at ?? r.requested_start!);
    const e = new Date(r.shifts?.ends_at ?? r.requested_end!);
    return <><span className="capitalize">{formatDateLong(localDate(s, tz))}</span> <span className="tabular-nums">{localTime(s, tz)}–{localTime(e, tz)}</span></>;
  };

  return (
    <div className="space-y-4">
      <h1 className="h1">Forespørsler</h1>
      {feil && <p className="card bg-bad-soft text-sm text-bad">{feil}</p>}

      <section className="card p-0">
        <h2 className="h2 px-4 pt-4">{ctx.isAdmin ? "Venter på deg" : "Dine ventende forespørsler"}</h2>
        {pending.length === 0 ? <p className="p-4 text-sm text-muted">Ingenting venter.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {pending.map((r) => (
              <li key={r.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-sm">
                    {ctx.isAdmin && <div className="font-medium">{names.get(r.employee_id)}</div>}
                    <div>{r.kind === "open_shift" ? "Vil ta ledig vakt" : "Tilbyr seg"}: {when(r)}</div>
                    {r.comment && <div className="text-muted">«{r.comment}»</div>}
                  </div>
                  {ctx.isAdmin ? (
                    <form action={decideRequest} className="flex gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <button name="decision" value="approve" className="btn-primary">Godkjenn</button>
                      <button name="decision" value="reject" className="btn-ghost">Avslå</button>
                    </form>
                  ) : (
                    <form action={cancelRequest}><input type="hidden" name="id" value={r.id} /><button className="btn-ghost">Trekk</button></form>
                  )}
                </div>
                {ctx.isAdmin && r.warnings?.length > 0 && (
                  <ul className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                    {r.warnings.map((w, i) => <li key={i}>⚠ {w.message}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section className="card p-0">
          <h2 className="h2 px-4 pt-4">Behandlet</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {done.slice(0, 20).map((r) => {
              const [label, cls] = STATUS[r.status];
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <span>{ctx.isAdmin && <b>{names.get(r.employee_id)} · </b>}{when(r)}</span>
                  <span className={`badge ${cls}`}>{label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p className="text-sm text-muted">Søknad om fri og vaktbytte kommer i neste del.</p>
    </div>
  );
}
