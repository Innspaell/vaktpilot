import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { createOrganization } from "../actions";

export default async function NewOrgPage() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) redirect("/");
  return (
    <div className="card max-w-lg">
      <h1 className="h1">Ny bedrift</h1>
      <p className="mt-1 text-sm text-muted">Du blir eier. Legg deretter inn daglig leder som ansatt og gi hen administratortilgang.</p>
      <ActionForm action={createOrganization} submitLabel="Opprett" className="mt-4 space-y-4">
        <Field label="Navn"><input name="name" required className="input" /></Field>
        <Field label="Organisasjonsnummer"><input name="org_number" className="input" /></Field>
      </ActionForm>
    </div>
  );
}
