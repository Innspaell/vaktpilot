import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { addEmployee } from "../actions";
import { SelfEmployeeCard } from "@/components/SelfEmployeeCard";
import { loginStatus, TONE_CLASS, type LoginStatusRow } from "@/lib/login-status";

export default async function EmployeesPage() {
  const ctx = await requireAdmin();
  const [{ data: employees }, { data: statusRows }] = await Promise.all([
    ctx.supabase
      .from("employees")
      .select("id, full_name, email, user_id, end_date, auto_plan, must_change_password, employment_terms(position_pct, pay_type, valid_to)")
      .eq("org_id", ctx.org.id)
      .order("full_name"),
    ctx.supabase.rpc("employees_login_status", { p_org: ctx.org.id }),
  ]);
  const status = new Map(((statusRows ?? []) as LoginStatusRow[]).map((r) => [r.employee_id, r]));

  type Row = { id: string; full_name: string; email: string | null; user_id: string | null; end_date: string | null; auto_plan: boolean; must_change_password: boolean | null;
    employment_terms: { position_pct: number; pay_type: string; valid_to: string | null }[] };
  const rows = (employees ?? []) as Row[];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <h1 className="h1">Ansatte</h1>
      {!ctx.employeeId && <SelfEmployeeCard email={ctx.email} />}

      <section className="card p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted">Ingen ansatte ennå. Legg til den første under.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((e) => {
              const terms = e.employment_terms.find((t) => !t.valid_to);
              const ended = e.end_date && e.end_date < today;
              const ls = loginStatus(e, status.get(e.id));
              return (
                <li key={e.id}>
                  <Link href={`/ansatte/${e.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper">
                    <div className="min-w-0">
                      <div className="font-medium">{e.full_name}</div>
                      <div className="truncate text-sm text-muted">{e.email ?? "Ingen e-post"}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-sm">
                      {!e.auto_plan && <span className="badge bg-paper text-muted ring-1 ring-line">ikke i autoplan</span>}
                      {terms && <span className="text-muted">{Number(terms.position_pct)} % · {terms.pay_type === "fixed" ? "fast" : "time"}</span>}
                      {ended ? <span className="badge bg-paper text-muted">Sluttet</span>
                        : <span className={`badge ${TONE_CLASS[ls.tone]}`} title={ls.long}>{ls.short}</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="h2">Legg til ansatt</h2>
        <p className="mt-1 text-sm text-muted">Den ansatte logger inn med e-posten du skriver her, og kobles automatisk til kortet.</p>
        <ActionForm action={addEmployee} submitLabel="Legg til" className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Navn"><input name="full_name" required className="input" /></Field>
          <Field label="E-post"><input name="email" type="email" className="input" /></Field>
          <Field label="Telefon"><input name="phone" type="tel" className="input" /></Field>
          <Field label="Ansattnummer"><input name="employee_number" className="input" /></Field>
          <Field label="Startdato"><input name="start_date" type="date" defaultValue={today} className="input" /></Field>
          <Field label="Stillingsprosent"><input name="position_pct" type="number" min={1} max={100} step="0.5" defaultValue={100} className="input" /></Field>
          <Field label="Lønnstype">
            <select name="pay_type" className="input" defaultValue="hourly">
              <option value="hourly">Timelønn</option>
              <option value="fixed">Fastlønn</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-3 text-sm">
            <input type="checkbox" name="is_shift_worker" className="h-4 w-4" /> Jobber turnus eller skift
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
