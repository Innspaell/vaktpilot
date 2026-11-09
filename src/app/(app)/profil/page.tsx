import { getContext } from "@/lib/context";
import { signOut, switchOrganization } from "../actions";

export default async function ProfilePage() {
  const ctx = await getContext();
  return (
    <div className="space-y-4">
      <h1 className="h1">Profil</h1>
      <section className="card">
        <div className="text-sm text-muted">Innlogget som</div>
        <div className="font-medium">{ctx.email}</div>
      </section>
      {ctx.orgs.length > 1 && (
        <section className="card">
          <h2 className="h2">Bedrift</h2>
          <form action={switchOrganization} className="mt-3 flex gap-2">
            <select name="org" defaultValue={ctx.org?.id} className="input">
              {ctx.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button className="btn-ghost">Bytt</button>
          </form>
        </section>
      )}
      {ctx.isPlatformAdmin && (
        <section className="card">
          <a href="/ny-bedrift" className="font-medium text-brand">Opprett ny bedrift</a>
        </section>
      )}
      <form action={signOut}>
        <button className="btn-ghost w-full">Logg ut</button>
      </form>
    </div>
  );
}
