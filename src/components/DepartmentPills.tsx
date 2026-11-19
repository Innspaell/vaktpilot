import Link from "next/link";
import type { Department } from "@/lib/departments";

/** Velg avdeling i vaktplanen. «Alle» viser hele bedriften. */
export function DepartmentPills({ departments, selected, hrefFor }: { departments: Department[]; selected: string | null; hrefFor: (id: string | null) => string }) {
  const pill = (id: string | null, label: string) => (
    <Link key={id ?? "alle"} href={hrefFor(id)} aria-current={selected === id ? "true" : undefined}
      className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ${selected === id ? "bg-brand text-white ring-brand" : "bg-white text-ink ring-line hover:ring-brand"}`}>
      {label}
    </Link>
  );
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Avdeling">
      {pill(null, "Alle avdelinger")}
      {departments.map((d) => pill(d.id, d.name))}
    </nav>
  );
}
