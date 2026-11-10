import { requireOrg } from "@/lib/context";
import { Board } from "@/components/Board";

export default async function BoardPage() {
  const ctx = await requireOrg();
  return (
    <div className="space-y-4">
      <h1 className="h1">Oppslagstavle</h1>
      <p className="text-sm text-muted">Beskjeder til alle i {ctx.org.name}. Alle kan skrive og slette egne innlegg. Leder kan sette innlegg i fokus og slette alle.</p>
      <Board ctx={ctx} />
    </div>
  );
}
