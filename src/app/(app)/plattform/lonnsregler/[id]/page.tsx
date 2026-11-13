import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { RulesEditor } from "@/components/RulesEditor";
import { ARBEIDSMILJOLOVEN, parseRules } from "@/lib/pay";
import { describeRules } from "@/lib/pay-rules-text";
import { deleteVersion, saveVersion, updateRuleSet } from "../actions";

export default async function RuleSetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string; ny?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) redirect("/");
  const [{ data: set }, { data: versions }] = await Promise.all([
    ctx.supabase.from("pay_rule_sets").select("*").eq("id", id).maybeSingle(),
    ctx.supabase.from("pay_rule_versions").select("id, valid_from, rules, note, created_at").eq("rule_set_id", id).order("valid_from", { ascending: false }),
  ]);
  if (!set) notFound();
  const list = versions ?? [];
  const selected = list.find((v) => v.id === sp.v) ?? list[0];
  const isNew = sp.ny === "1" || !selected;
  const rules = selected ? parseRules(selected.rules, set.key, set.name) : { ...ARBEIDSMILJOLOVEN, key: set.key, name: set.name };
  const fmt = (d: string) => d.split("-").reverse().join(".");

  return (
    <div className="space-y-4">
      <div>
        <Link href="/plattform/lonnsregler" className="text-sm text-brand">‹ Lønnsregler</Link>
        <h1 className="h1 mt-1">{set.name}</h1>
      </div>

      <section className="card">
        <ActionForm action={updateRuleSet} submitLabel="Lagre" className="grid gap-3 md:grid-cols-2">
          <input type="hidden" name="id" value={set.id} />
          <Field label="Navn"><input name="name" required defaultValue={set.name} className="input" /></Field>
          <Field label="Beskrivelse"><input name="description" defaultValue={set.description ?? ""} className="input" /></Field>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="h2">Versjoner</h2>
        {list.length === 0 ? <p className="mt-1 text-sm text-muted">Ingen satser ennå. Legg inn de første under.</p> : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {list.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`?v=${v.id}`} className={v.id === selected?.id && !isNew ? "font-semibold text-brand" : "text-brand"}>
                  Fra {fmt(v.valid_from)}{v.note ? ` · ${v.note}` : ""}
                </Link>
                {list.length > 1 && (
                  <form action={deleteVersion}><input type="hidden" name="rule_set_id" value={set.id} /><input type="hidden" name="version_id" value={v.id} /><button className="text-xs text-bad">Slett</button></form>
                )}
              </li>
            ))}
          </ul>
        )}
        <Link href="?ny=1" className="btn-primary mt-3 inline-flex">Nye satser fra en dato</Link>
      </section>

      <section className="card">
        <h2 className="h2">{isNew ? "Nye satser" : `Satser fra ${fmt(selected.valid_from)}`}</h2>
        <p className="mt-1 text-sm text-muted">
          {isNew
            ? "Feltene er fylt ut med siste versjon. Endre det som er nytt, og velg datoen satsene gjelder fra. Timer før datoen beregnes som før."
            : "Endringer her gjelder alle timer fra denne datoen, også i perioder som er beregnet før. Ved nye satser etter et lønnsoppgjør: lag heller en ny versjon."}
        </p>
        <ActionForm action={saveVersion} submitLabel={isNew ? "Legg inn nye satser" : "Lagre endringer"} className="mt-4 space-y-5">
          <input type="hidden" name="rule_set_id" value={set.id} />
          {!isNew && <input type="hidden" name="version_id" value={selected.id} />}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Gjelder fra"><input name="valid_from" type="date" required defaultValue={isNew ? "" : selected.valid_from} className="input" /></Field>
            <Field label="Merknad"><input name="note" defaultValue={isNew ? "" : selected.note ?? ""} placeholder="F.eks. Lønnsoppgjøret 2026" className="input" /></Field>
          </div>
          <RulesEditor rules={rules} />
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="h2">Slik ser kunden reglene</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{describeRules(rules).map((l) => <li key={l}>{l}</li>)}</ul>
      </section>
    </div>
  );
}
