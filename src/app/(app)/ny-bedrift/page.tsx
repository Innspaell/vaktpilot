import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { ActionForm } from "@/components/Form";
import { CompanyLookup } from "@/components/CompanyLookup";
import { createOrganization } from "../actions";

export default async function NewOrgPage() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) redirect("/");
  return (
    <div className="card max-w-2xl">
      <h1 className="h1">Ny bedrift</h1>
      <p className="mt-1 text-sm text-muted">Du blir eier. Legg deretter inn daglig leder som ansatt og gi hen administratortilgang.</p>
      <ActionForm action={createOrganization} submitLabel="Opprett" className="mt-4 grid gap-4 md:grid-cols-2">
        <CompanyLookup />
      </ActionForm>
    </div>
  );
}
