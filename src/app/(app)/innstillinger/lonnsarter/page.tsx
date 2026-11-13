import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { ActionForm } from "@/components/Form";
import { loadPayRules } from "@/lib/pay-rules-data";
import { localDate } from "@/lib/time";
import { saveWageTypes } from "./actions";

export default async function WageTypesPage() {
  const ctx = await requireAdmin();
  const today = localDate(new Date(), ctx.org.timezone);
  const [rules, { data: maps }, { data: absenceTypes }] = await Promise.all([
    loadPayRules(ctx),
    ctx.supabase.from("pay_code_mappings").select("code, wage_type").eq("org_id", ctx.org.id),
    ctx.supabase.from("absence_types").select("key, name").eq("org_id", ctx.org.id).order("name"),
  ]);
  const r = rules.resolve(today);
  const current = new Map((maps ?? []).map((m) => [m.code, m.wage_type]));
  const codes: [string, string][] = [
    ["ordinary", "Ordinære timer"],
    ["extra", "Mertid"],
    [`overtime_${r.overtimePercent}`, `Overtid ${r.overtimePercent} %`],
    ["overtime_100", "Overtid 100 %"],
    ...r.supplements.map((s) => [`supp_${s.key}`, s.label] as [string, string]),
    ...r.eventSupplements.map((s) => [`event_${s.key}`, s.label] as [string, string]),
    ["holiday_pay", "Helligdagsgodtgjørelse"],
    ...(absenceTypes ?? []).map((a) => [`absence_${a.key}`, a.name] as [string, string]),
  ];
  // Koder som er koblet tidligere, men ikke er i dagens regler (f.eks. etter bytte av tariff)
  for (const [c] of current) if (!codes.some(([k]) => k === c)) codes.push([c, c]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/innstillinger#lonnsregler" className="text-sm text-brand">‹ Innstillinger</Link>
        <h1 className="h1 mt-1">Lønnsarter</h1>
        <p className="mt-1 text-sm text-muted">
          Skriv inn lønnsartnummeret hver linje skal ha i regnskaps- eller lønnsprogrammet deres (for eksempel Fiken).
          Det kommer i kolonnen «Lønnsart» i lønnsgrunnlaget, så filen kan legges inn uten å sortere for hånd. Tomt felt = ingen lønnsart.
        </p>
      </div>
      <ActionForm action={saveWageTypes} submitLabel="Lagre" className="card space-y-1">
        <input type="hidden" name="codes" value={codes.map(([c]) => c).join(",")} />
        {codes.map(([code, label]) => (
          <label key={code} className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted">{code}</span>
            </span>
            <input name={`w_${code}`} defaultValue={current.get(code) ?? ""} placeholder="Lønnsart" className="input w-32" />
          </label>
        ))}
      </ActionForm>
    </div>
  );
}
