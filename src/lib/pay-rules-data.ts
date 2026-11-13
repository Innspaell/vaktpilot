import "server-only";
import type { AppContext } from "./context";
import { ARBEIDSMILJOLOVEN, parseRules, type PayRules, type RuleResolver } from "./pay";

type Ctx = AppContext & { org: NonNullable<AppContext["org"]> };

export interface RuleSetInfo { id: string; key: string; name: string; description: string | null; kind: string; org_id: string | null; area: string | null }
export interface VersionInfo { id: string; rule_set_id: string; valid_from: string; rules: unknown; source_text: string | null; source_url: string | null }

export const AREAS: Record<string, string> = {
  ingen: "Ingen tariffavtale",
  bilutleie: "Bilutleie",
  handel: "Handel og butikk",
  hotell_restaurant: "Hotell, restaurant og catering",
  renhold: "Service og renhold",
};

/** Ansattes egen tariff (fra arbeidsvilkårene), med gyldighet. */
export type EmployeeRuleTerms = { employee_id: string; valid_from: string; valid_to: string | null; pay_rule_set_id: string | null }[];

/**
 * Lønnsreglene for bedriften: hvilket regelsett som gjelder fra når, og hvilken publisert versjon som gjelder en dato.
 * En ansatt kan ha egen tariff i arbeidsvilkårene. Uten valg gjelder arbeidsmiljøloven.
 */
export async function loadPayRules(ctx: Ctx, employeeTerms: EmployeeRuleTerms = []) {
  const [{ data: sets }, { data: versions }, { data: chosen }, { data: confirmed }] = await Promise.all([
    ctx.supabase.from("pay_rule_sets").select("id, key, name, description, kind, org_id, area").order("name"),
    ctx.supabase.from("pay_rule_versions").select("id, rule_set_id, valid_from, rules, source_text, source_url").eq("status", "published").order("valid_from"),
    ctx.supabase.from("org_pay_rules").select("valid_from, rule_set_id, confirmed_at").eq("org_id", ctx.org.id).order("valid_from"),
    ctx.supabase.from("pay_rule_confirmations").select("version_id, confirmed_at").eq("org_id", ctx.org.id),
  ]);
  const setList = (sets ?? []) as RuleSetInfo[];
  const byId = new Map(setList.map((s) => [s.id, s]));
  const aml = setList.find((s) => s.key === "aml");
  const vers = (versions ?? []) as VersionInfo[];
  const choices = (chosen ?? []) as { valid_from: string; rule_set_id: string; confirmed_at: string | null }[];
  const confirmedVersions = new Set((confirmed ?? []).map((c) => c.version_id as string));

  const cache = new Map<string, PayRules>();
  const versionFor = (setId: string, date: string) => {
    const list = vers.filter((v) => v.rule_set_id === setId);
    return [...list].reverse().find((v) => v.valid_from <= date) ?? list[0];
  };
  const orgSetFor = (date: string) => [...choices].reverse().find((c) => c.valid_from <= date)?.rule_set_id ?? aml?.id ?? null;
  const setFor = (date: string, employeeId?: string) => {
    if (employeeId) {
      const t = employeeTerms.find((x) => x.employee_id === employeeId && x.pay_rule_set_id && x.valid_from <= date && (!x.valid_to || x.valid_to >= date));
      if (t?.pay_rule_set_id && vers.some((v) => v.rule_set_id === t.pay_rule_set_id)) return t.pay_rule_set_id;
    }
    return orgSetFor(date);
  };

  const resolve: RuleResolver = (date, employeeId) => {
    const setId = setFor(date, employeeId);
    if (!setId) return ARBEIDSMILJOLOVEN;
    const v = versionFor(setId, date);
    if (!v) return ARBEIDSMILJOLOVEN;
    let r = cache.get(v.id);
    if (!r) {
      const s = byId.get(setId)!;
      r = parseRules(v.rules, s.key, s.name);
      cache.set(v.id, r);
    }
    return r;
  };

  return {
    resolve,
    sets: setList,
    hasVersions: (id: string) => vers.some((v) => v.rule_set_id === id),
    choices: choices.map((c) => ({ ...c, set: byId.get(c.rule_set_id) })),
    /** Regelsettet som gjelder bedriften på en dato */
    setOn: (date: string) => byId.get(orgSetFor(date) ?? "") ?? null,
    /** Versjonen som gjelder bedriften på en dato */
    versionOn: (date: string) => { const id = orgSetFor(date); return id ? versionFor(id, date) ?? null : null; },
    versionConfirmed: (versionId: string) => confirmedVersions.has(versionId),
    /** Regelsett som brukes av noen ansatte (egen tariff) */
    setName: (id: string) => byId.get(id)?.name ?? null,
  };
}
