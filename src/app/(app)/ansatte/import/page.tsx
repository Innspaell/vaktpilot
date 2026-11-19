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
          Har du de ansatte i et regneark eller lønnssystem, kan du legge dem inn alle på én gang. Én ansatt per rad, og første rad må være overskrifter. Du ser alt før noe lagres.
        </p>
      </header>
      <section className="card grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <h2 className="font-semibold">Må med</h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li><b>Navn</b> (eller to kolonner: Fornavn og Etternavn)</li>
          </ul>
        </div>
        <div>
          <h2 className="font-semibold">Kan med</h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li><b>E-post</b>: trengs for at den ansatte kan logge inn</li>
            <li><b>Mobil</b> og <b>Ansattnummer</b></li>
            <li><b>Startdato</b>, <b>Stillingsprosent</b> og <b>Lønnstype</b>: mangler de, velger du én verdi for alle</li>
            <li><b>Turnus</b>: Ja eller Nei</li>
          </ul>
        </div>
      </section>
      <ImportEmployees today={today} />
    </div>
  );
}
