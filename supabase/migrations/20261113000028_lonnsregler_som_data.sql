-- Lønnsregler som data: et bibliotek av regelsett (tariffer og arbeidsmiljøloven) med versjoner.
-- Hver bedrift velger regelsett med en fra-dato. Uten valg gjelder arbeidsmiljøloven.

create table if not exists pay_rule_sets (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  kind text not null default 'tariff' check (kind in ('law', 'tariff')),
  created_at timestamptz not null default now()
);
create table if not exists pay_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references pay_rule_sets(id) on delete cascade,
  valid_from date not null,
  rules jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  unique (rule_set_id, valid_from)
);
create table if not exists org_pay_rules (
  org_id uuid not null references organizations(id) on delete cascade,
  valid_from date not null,
  rule_set_id uuid not null references pay_rule_sets(id),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, valid_from)
);

alter table pay_rule_sets enable row level security;
alter table pay_rule_versions enable row level security;
alter table org_pay_rules enable row level security;
drop policy if exists "alle innloggede leser" on pay_rule_sets;
create policy "alle innloggede leser" on pay_rule_sets for select to authenticated using (true);
drop policy if exists "plattform endrer" on pay_rule_sets;
create policy "plattform endrer" on pay_rule_sets for all using (is_platform_admin()) with check (is_platform_admin());
drop policy if exists "alle innloggede leser" on pay_rule_versions;
create policy "alle innloggede leser" on pay_rule_versions for select to authenticated using (true);
drop policy if exists "plattform endrer" on pay_rule_versions;
create policy "plattform endrer" on pay_rule_versions for all using (is_platform_admin()) with check (is_platform_admin());
drop policy if exists "medlem leser" on org_pay_rules;
create policy "medlem leser" on org_pay_rules for select using (is_member(org_id) or is_platform_admin());

insert into pay_rule_sets (key, name, description, kind) values
  ('aml', 'Uten tariff (arbeidsmiljøloven)', 'Lovens minstekrav: overtid med minst 40 % tillegg over 9 timer per dag eller 40 timer per uke. Ingen faste tillegg.', 'law'),
  ('bilutleie', 'Overenskomsten for bilutleie', 'NHO Reiseliv / Fellesforbundet. Ordinær tid, overtid 50/100 %, turnustillegg og helligdagsgodtgjørelse.', 'tariff')
on conflict (key) do nothing;

insert into pay_rule_versions (rule_set_id, valid_from, rules, note)
select id, date '2000-01-01', $json${"ordinaryWindow": {"1": [0, 24], "2": [0, 24], "3": [0, 24], "4": [0, 24], "5": [0, 24], "6": [0, 24], "7": [0, 24]}, "overtimePercent": 40, "overtime100AfterHour": null, "saturday100AfterHour": null, "sundayHoliday100": false, "dailyOvertimeAfterHours": 9, "weeklyOvertimeAfterHours": 40, "calledOvertimeMinMinutes": 0, "shiftWorkersNoOvertime": false, "supplements": [], "holidayPay": {"minDays": 30, "onlyKinds": ["may"]}}$json$::jsonb, 'Arbeidsmiljøloven §§ 10-4, 10-6' from pay_rule_sets where key = 'aml'
on conflict do nothing;
insert into pay_rule_versions (rule_set_id, valid_from, rules, note)
select id, date '2024-05-01', $json${"ordinaryWindow": {"1": [6, 21], "2": [6, 21], "3": [6, 21], "4": [6, 21], "5": [6, 21], "6": [6, 15], "7": null}, "overtimePercent": 50, "overtime100AfterHour": 21, "saturday100AfterHour": 12, "sundayHoliday100": true, "dailyOvertimeAfterHours": null, "weeklyOvertimeAfterHours": null, "calledOvertimeMinMinutes": 120, "shiftWorkersNoOvertime": true, "supplements": [{"key": "evening", "label": "Kvelds-/nattillegg (kl. 18–06)", "ratePerHour": 21.5, "days": [1, 2, 3, 4, 5, 6, 7], "fromHour": 18, "toHour": 6, "holidays": "exclude", "appliesTo": "shift_workers"}, {"key": "saturday", "label": "Lørdagstillegg (etter kl. 12)", "ratePerHour": 31, "days": [6], "fromHour": 12, "toHour": 24, "holidays": "exclude", "appliesTo": "shift_workers"}, {"key": "holiday", "label": "Helligdagstillegg", "ratePerHour": 33, "days": [1, 2, 3, 4, 5, 6, 7], "fromHour": 0, "toHour": 24, "holidays": "only", "appliesTo": "shift_workers"}], "holidayPay": {"minDays": 30}}$json$::jsonb, 'Utgave 2024–2026, forenklet' from pay_rule_sets where key = 'bilutleie'
on conflict do nothing;

-- Bilutleieoverenskomsten gjelder bare Æ e Trønder AS
insert into org_pay_rules (org_id, valid_from, rule_set_id)
select o.id, date '2000-01-01', s.id from organizations o, pay_rule_sets s
where o.name = 'Æ e Trønder AS' and s.key = 'bilutleie'
on conflict do nothing;

-- Leder velger regelsett fra en dato. Ikke tillatt inn i en låst lønnsperiode.
create or replace function set_org_pay_rules(p_org uuid, p_rule_set uuid, p_from date) returns void
language plpgsql security definer set search_path = public as $$
declare o organizations;
begin
  if not (is_admin(p_org) or is_platform_admin()) then raise exception 'Ikke tillatt.'; end if;
  select * into o from organizations where id = p_org;
  if not exists (select 1 from pay_rule_sets where id = p_rule_set) then raise exception 'Ukjent regelsett.'; end if;
  if exists (select 1 from time_entries t where t.org_id = p_org and t.status = 'locked'
             and t.starts_at >= (p_from::timestamp at time zone o.timezone)) then
    raise exception 'Det finnes låste lønnsperioder etter denne datoen. Velg en dato etter siste låste periode.';
  end if;
  delete from org_pay_rules where org_id = p_org and valid_from >= p_from;
  insert into org_pay_rules (org_id, valid_from, rule_set_id, created_by) values (p_org, p_from, p_rule_set, auth.uid());
  insert into audit_log (org_id, table_name, row_id, action, changed_by, after)
  values (p_org, 'org_pay_rules', p_org, 'PAY_RULES', auth.uid(), jsonb_build_object('rule_set_id', p_rule_set, 'valid_from', p_from));
end $$;
revoke execute on function set_org_pay_rules(uuid, uuid, date) from anon, public;
grant execute on function set_org_pay_rules(uuid, uuid, date) to authenticated;
