import { requirePlanner } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { loadDepartments } from "@/lib/departments";
import { addDepartment, renameDepartment, saveDepartmentMatrix, setDepartmentArchived, setDepartmentLeaders } from "./actions";

export default async function DepartmentsPage() {
  const ctx = await requirePlanner();
  const today = new Date().toISOString().slice(0, 10);
  const [deps, { data: emps }, { data: archived }, { data: leaders }, { data: links }] = await Promise.all([
    loadDepartments(ctx),
    ctx.supabase.from("employees").select("id, full_name, user_id, end_date").eq("org_id", ctx.org.id).order("full_name"),
    ctx.isAdmin
      ? ctx.supabase.from("departments").select("id, name").eq("org_id", ctx.org.id).not("archived_at", "is", null).order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ctx.isAdmin
      ? ctx.supabase.from("memberships").select("user_id").eq("org_id", ctx.org.id).eq("role", "manager")
      : Promise.resolve({ data: [] as { user_id: string }[] }),
    ctx.isAdmin
      ? ctx.supabase.from("manager_departments").select("user_id, department_id").eq("org_id", ctx.org.id)
      : Promise.resolve({ data: [] as { user_id: string; department_id: string }[] }),
  ]);
  const employees = (emps ?? []).filter((e) => !e.end_date || e.end_date >= today);
  const nameOfUser = new Map((emps ?? []).filter((e) => e.user_id).map((e) => [e.user_id as string, e.full_name]));
  const managerList = (leaders ?? []).map((l) => ({ id: l.user_id, name: nameOfUser.get(l.user_id) ?? "Leder uten ansattkort" }))
    .sort((a, b) => a.name.localeCompare(b.name, "nb"));
  const leadersOf = (dep: string) => new Set((links ?? []).filter((l) => l.department_id === dep).map((l) => l.user_id));
  const editable = new Set(deps.departments.filter((d) => deps.managed.has(d.id)).map((d) => d.id));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="h1">Avdelinger</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Avdelinger er valgfrie. Bruk dem hvis dere har flere steder eller lag med hver sin leder. Hver vakt og hvert bemanningsbehov kan høre til en avdeling,
          og en leder planlegger og godkjenner bare for avdelingene vedkommende har ansvar for. Alle ansatte ser fortsatt hele vaktplanen.
        </p>
      </header>

      {ctx.isAdmin && (
        <section className="card">
          <h2 className="h2">Avdelinger og ledere</h2>
          {deps.departments.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Ingen avdelinger ennå. Da gjelder alt hele bedriften, og ledere har ansvar for alle.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {deps.departments.map((d) => {
                const mine = leadersOf(d.id);
                return (
                  <li key={d.id} className="space-y-3 px-3 py-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <ActionForm action={renameDepartment} submitLabel="Lagre navn" className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={d.id} />
                        <Field label="Navn"><input name="name" defaultValue={d.name} required maxLength={60} className="input w-56" /></Field>
                      </ActionForm>
                      <form action={setDepartmentArchived} className="ml-auto">
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="archive" value="1" />
                        <button className="btn-ghost text-sm">Arkiver</button>
                      </form>
                    </div>
                    <ActionForm action={setDepartmentLeaders} submitLabel="Lagre ledere" className="space-y-2">
                      <input type="hidden" name="department_id" value={d.id} />
                      <span className="label">Ledere med ansvar</span>
                      {managerList.length === 0 ? (
                        <p className="text-sm text-muted">Ingen har tilgangen Leder ennå. Gi tilgangen på den ansattes side under Tilgang.</p>
                      ) : (
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {managerList.map((m) => (
                            <label key={m.id} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" name="leader" value={m.id} defaultChecked={mine.has(m.id)} className="h-4 w-4" /> {m.name}
                            </label>
                          ))}
                        </div>
                      )}
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          )}
          <ActionForm action={addDepartment} submitLabel="Legg til avdeling" className="mt-4 flex flex-wrap items-end gap-2">
            <Field label="Ny avdeling"><input name="name" required maxLength={60} placeholder="F.eks. Kjøkken eller Stjørdal" className="input w-64" /></Field>
          </ActionForm>
          {(archived ?? []).length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted">Arkiverte avdelinger ({archived!.length})</summary>
              <ul className="mt-2 space-y-1">
                {archived!.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3">
                    <span>{d.name}</span>
                    <form action={setDepartmentArchived}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="archive" value="0" />
                      <button className="text-brand">Hent fram igjen</button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {deps.departments.length > 0 && employees.length > 0 && (
        <section className="card">
          <h2 className="h2">Hvem kan jobbe hvor</h2>
          <p className="mt-1 text-sm text-muted">
            Kryss av for avdelingene hver ansatt kan jobbe i. Hjemmeavdelingen brukes som standard når du legger en ny vakt på den ansatte.
            {!ctx.isAdmin && " Du kan endre kolonnene for avdelingene du har ansvar for."}
          </p>
          <ActionForm action={saveDepartmentMatrix} submitLabel="Lagre" className="mt-3 space-y-3">
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="py-2 pr-3 font-semibold">Ansatt</th>
                    {deps.departments.map((d) => <th key={d.id} className="px-2 py-2 text-center font-semibold">{d.name}</th>)}
                    <th className="py-2 pl-3 font-semibold">Hjemmeavdeling</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {employees.map((e) => {
                    const work = deps.canWork.get(e.id) ?? new Set<string>();
                    const home = deps.homeOf.get(e.id) ?? "";
                    const homeLocked = Boolean(home && !editable.has(home));
                    return (
                      <tr key={e.id}>
                        <td className="py-2 pr-3">
                          <input type="hidden" name="employee" value={e.id} />
                          {e.full_name}
                        </td>
                        {deps.departments.map((d) => (
                          <td key={d.id} className="px-2 py-2 text-center">
                            <input type="checkbox" name={`work:${e.id}:${d.id}`} defaultChecked={work.has(d.id)} disabled={!editable.has(d.id)}
                              aria-label={`${e.full_name} kan jobbe i ${d.name}`} className="h-4 w-4" />
                          </td>
                        ))}
                        <td className="py-2 pl-3">
                          <select name={`home:${e.id}`} defaultValue={home} disabled={homeLocked} aria-label={`Hjemmeavdeling for ${e.full_name}`} className="input w-auto py-1">
                            <option value="">Ingen</option>
                            {deps.departments.filter((d) => editable.has(d.id) || d.id === home).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ActionForm>
        </section>
      )}
      {!ctx.isAdmin && deps.departments.length === 0 && (
        <p className="card text-sm text-muted">Bedriften bruker ikke avdelinger. Administrator kan legge dem inn her.</p>
      )}
    </div>
  );
}
