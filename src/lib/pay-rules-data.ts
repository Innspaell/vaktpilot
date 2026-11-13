import "server-only";
import type { AppContext } from "./context";
import { ARBEIDSMILJOLOVEN, parseRules, type PayRules, type RuleResolver } from "./pay";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

export interface RuleSetInfo { id: string; key: string; name: string; description: string | null; kind: string }

/**
 * Lønnsreglene for bedriften: hvilket regelsett som gjelder fra når, og hvilken versjon som gjelder en dato.
 * Uten valg gjelder arbeidsmiljøloven.
 */
export async function loadPayRules(ctx: Ctx) {
  const [{ data: sets }, { data: versions }, { data: chosen }] = await Promise.all([
    ctx.supabase.from("pay_rule_sets").select("id, key, name, description, kind").order("kind").order("name"),
    ctx.supabase.from("pay_rule_versions").select("rule_set_id, valid_from, rules").order("valid_from"),
    ctx.supabase.from("org_pay_rules").select("valid_from, rule_set_id").eq("org_id", ctx.org.id).order("valid_from"),
  ]);
  const setList = (sets ?? []) as RuleSetInfo[];
  const byId = new Map(setList.map((s) => [s.id, s]));
  const aml = setList.find((s) => s.key === "aml");
  const vers = (versions ?? []) as { rule_set_id: string; valid_from: string; rules: unknown }[];
  const choices = (chosen ?? []) as { valid_from: string; rule_set_id: string }[];

  const cache = new Map<string, PayRules>();
  const versionFor = (setId: string, date: string) => {
    const list = vers.filter((v) => v.rule_set_id === setId);
    return [...list].reverse().find((v) => v.valid_from <= date) ?? list[0];
  };
  const setFor = (date: string) => [...choices].reverse().find((c) => c.valid_from <= date)?.rule_set_id ?? aml?.id ?? null;

  const resolve: RuleResolver = (date) => {
    const setId = setFor(date);
    if (!setId) return ARBEIDSMILJOLOVEN;
    const v = versionFor(setId, date);
    if (!v) return ARBEIDSMILJOLOVEN;
    const k = `${setId}|${v.valid_from}`;
    let r = cache.get(k);
    if (!r) {
      const s = byId.get(setId)!;
      r = parseRules(v.rules, s.key, s.name);
      cache.set(k, r);
    }
    return r;
  };

  return {
    resolve,
    sets: setList,
    choices: choices.map((c) => ({ ...c, set: byId.get(c.rule_set_id) })),
    /** Regelsettet som gjelder i dag (eller på en dato) */
    setOn: (date: string) => byId.get(setFor(date) ?? "") ?? null,
    versionOn: (date: string) => { const id = setFor(date); return id ? versionFor(id, date)?.valid_from ?? null : null; },
  };
}
