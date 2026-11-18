import { createClient } from "@/lib/supabase/server";

/** Kontaktinfo til InnSpæll. Vises ikke før e-post eller telefon er lagt inn under Plattform. */
export async function SupportContact({ intro = "Trenger du hjelp?", className = "text-sm text-muted" }: { intro?: string; className?: string }) {
  const { data } = await (await createClient()).rpc("support_contact");
  const c = data as { email: string | null; phone: string | null } | null;
  if (!c?.email && !c?.phone) return null;
  return (
    <p className={className}>
      {intro}{" "}
      {c.email && <a href={`mailto:${c.email}`} className="font-semibold text-brand">{c.email}</a>}
      {c.email && c.phone && " eller "}
      {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="font-semibold text-brand">{c.phone}</a>}
    </p>
  );
}
