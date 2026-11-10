import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOrg } from "@/lib/context";
import { colleagues } from "@/lib/data";
import { formatDateLong, formatHours, localDate, localTime, workedMinutes } from "@/lib/time";
import { AssignForm } from "@/components/AssignForm";
import { AbsentForm } from "@/components/AbsentForm";
import { assignShift, removeShiftAndBack } from "../../actions";

export default async function ShiftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tilbake?: string }> }) {
  const { id } = await params;
  const { tilbake } = await searchParams;
  const ctx = await requireOrg();
  if (!ctx.isAdmin) redirect("/vaktplan");
  const back = tilbake && tilbake.startsWith("/vaktplan") ? tilbake : "/vaktplan";
  const tz = ctx.org.timezone;

  const { data: s } = await ctx.supabase.from("shifts")
    .select("id, employee_id, work_role_id, starts_at, ends_at, break_minutes, status, note, work_roles(name, color)")
    .eq("id", id).eq("org_id", ctx.org.id).maybeSingle();
  if (!s || s.status === "cancelled") notFound();

  const date = localDate(new Date(s.starts_at), tz);
  const [names, { data: types }, { data: absence }, { data: entry }] = await Promise.all([
    colleagues(ctx),
    ctx.supabase.from("absence_types").select("id, name, key, is_sick").eq("org_id", ctx.org.id).order("name"),
    s.employee_id
      ? ctx.supabase.from("absence_requests").select("id, from_date, to_date, status, absence_types(name)")
          .eq("employee_id", s.employee_id).in("status", ["approved", "pending"]).lte("from_date", date).gte("to_date", date).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    ctx.supabase.from("time_entries").select("id, status").eq("shift_id", s.id).maybeSingle(),
  ]);
  const role = s.work_roles as unknown as { name: string; color: string } | null;
  const people = Array.from(names, ([pid, name]) => ({ id: pid, name }));
  const abs = absence as unknown as { status: string; absence_types: { name: string } | null } | null;
  // Vanligste årsaker først
  const order = ["syk", "sykt_barn", "ferie", "velferd", "avspasering", "permisjon", "annet"];
  const sortedTypes = [...(types ?? [])].sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99));

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href={back} className="text-sm font-medium text-brand">← Tilbake til vaktplanen</Link>

      <section className="card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="h1">{s.employee_id ? names.get(s.employee_id) ?? "Ukjent" : "Ledig vakt"}</h1>
            <p className="mt-1 capitalize text-muted">{formatDateLong(date)}</p>
          </div>
          {s.status === "draft" && <span className="badge bg-paper text-muted ring-1 ring-line">utkast</span>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-lg font-semibold tabular-nums">{localTime(new Date(s.starts_at), tz)}–{localTime(new Date(s.ends_at), tz)}</span>
          <span className="text-muted">{formatHours(workedMinutes(new Date(s.starts_at), new Date(s.ends_at), s.break_minutes))} · pause {s.break_minutes} min</span>
          {role && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: role.color }} />{role.name}</span>}
        </div>
        {abs && (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            {abs.status === "approved" ? "Har godkjent fravær denne dagen" : "Har søkt om fri denne dagen"}: {abs.absence_types?.name}
          </p>
        )}
      </section>

      {s.employee_id && (entry ? (
        <section className="card text-sm">
          Timene for denne vakten er allerede registrert. Endringer gjøres under <Link href="/timer?vis=alle" className="font-semibold text-brand">Timer</Link>.
        </section>
      ) : (
        <section className="card">
          <h2 className="h2">Sett fraværende</h2>
          <p className="mt-1 text-sm text-muted">Registrerer fraværet som godkjent. {names.get(s.employee_id)?.split(" ")[0]} får beskjed.</p>
          <AbsentForm shiftId={s.id} back={back} types={sortedTypes.map((t) => ({ id: t.id, name: t.name }))} />
        </section>
      ))}

      <section className="card space-y-3">
        <h2 className="h2">Endre vakten</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted">Bytt ansatt</span>
          <AssignForm action={assignShift} shiftId={s.id} current={s.employee_id} people={people} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <Link href={`/vaktplan/rediger?visning=dag&dato=${date}`} className="text-sm font-semibold text-brand">Åpne dagen i redigering</Link>
          <form action={removeShiftAndBack}>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="back" value={back} />
            <button className="btn-ghost text-bad">Fjern vakten</button>
          </form>
        </div>
      </section>
    </div>
  );
}
