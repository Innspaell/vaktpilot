import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { ImportEmployees } from "./ImportEmployees";

export const metadata = { title: "Importer ansatte – Vaktpilot" };

export default async function ImportPage() {
  await requireAdmin();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date());
  return (
    <div className="max-w-4xl space-y-4">
      <header>
        <Link href="/ansatte" className="text-sm text-brand">‹ Ansatte</Link>
        <h1 className="h1">Importer ansatte</h1>
        <p className="mt-1 text-muted">
          Har du de ansatte i et regneark eller lønnssystem, kan du legge dem inn alle på én gang. Første rad må være overskrifter.
          Vi kjenner igjen <b>Navn</b> (eller Fornavn og Etternavn), <b>E-post</b>, <b>Mobil</b>, <b>Ansattnummer</b>, <b>Startdato</b>, <b>Stillingsprosent</b>, <b>Lønnstype</b> og <b>Turnus</b>.
          Bare navn er påkrevd. Du ser alt før noe lagres.
        </p>
      </header>
      <ImportEmployees today={today} />
    </div>
  );
}
