-- Tariffmotor fase 1:
-- A) Lagret lønnsgrunnlag ved låsing, og differanse/etterbetaling
-- B) Status og kilde på tariffversjoner (utkast → publisert)
-- D) Hendelser med fast beløp (f.eks. utlevering)
-- F) Tariff og gjennomsnittsberegning per ansatt
-- G) Lønnsarter per bedrift
-- H) Bekreftelse av tariff og satser
-- + tariffområder

-- A ---------------------------------------------------------------------------
alter table payroll_exports add column if not exists result jsonb;
alter table payroll_exports add column if not exists kind text not null default 'full';
do $$ begin
  alter table payroll_exports add constraint payroll_exports_kind check (kind in ('full', 'diff'));
exception when duplicate_object then null; end $$;

drop function if exists lock_pay_period(uuid, date, date, text, text);
create or replace function lock_pay_period(p_org uuid, p_from date, p_to date, p_format text, p_checksum text, p_result jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tz text; v_period uuid; v_export uuid;
begin
  if not is_admin(p_org) then raise exception 'Ikke tillatt.'; end if;
  select timezone into v_tz from organizations where id = p_org;
  if exists (select 1 from time_entries where org_id = p_org and status in ('draft', 'submitted')
             and (starts_at at time zone v_tz)::date between p_from and p_to) then
    raise exception 'Det finnes timer som ikke er godkjent i perioden. Godkjenn eller slett dem først.';
  end if;
  select id into v_period from pay_periods where org_id = p_org and starts_on = p_from and ends_on = p_to;
  if v_period is null then
    insert into pay_periods (org_id, starts_on, ends_on, status) values (p_org, p_from, p_to, 'exported') returning id into v_period;
  else
    update pay_periods set status = 'exported' where id = v_period;
  end if;
  insert into payroll_exports (org_id, pay_period_id, format, checksum, created_by, result, kind)
  values (p_org, v_period, p_format, p_checksum, auth.uid(), p_result, 'full') returning id into v_export;
  update time_entries set status = 'locked', payroll_export_id = v_export
  where org_id = p_org and status = 'approved' and (starts_at at time zone v_tz)::date between p_from and p_to;
  return v_export;
end $$;
revoke execute on function lock_pay_period(uuid, date, date, text, text, jsonb) from anon, public;
grant execute on function lock_pay_period(uuid, date, date, text, text, jsonb) to authenticated;

-- Etterbetaling/differanse er tatt ut: nytt utgangspunkt for neste sammenligning
create or replace function record_pay_difference(p_period uuid, p_checksum text, p_result jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare p pay_periods; v uuid;
begin
  select * into p from pay_periods where id = p_period;
  if not found or not is_admin(p.org_id) or p.status <> 'exported' then raise exception 'Ikke tillatt.'; end if;
  insert into payroll_exports (org_id, pay_period_id, format, checksum, created_by, result, kind)
  values (p.org_id, p.id, 'csv', p_checksum, auth.uid(), p_result, 'diff') returning id into v;
  insert into audit_log (org_id, table_name, row_id, action, changed_by) values (p.org_id, 'pay_periods', p.id, 'PAY_DIFFERENCE', auth.uid());
  return v;
end $$;
revoke execute on function record_pay_difference(uuid, text, jsonb) from anon, public;
grant execute on function record_pay_difference(uuid, text, jsonb) to authenticated;

-- B ---------------------------------------------------------------------------
alter table pay_rule_versions add column if not exists status text not null default 'published';
do $$ begin
  alter table pay_rule_versions add constraint pay_rule_versions_status check (status in ('draft', 'review', 'published'));
exception when duplicate_object then null; end $$;
alter table pay_rule_versions add column if not exists source_url text;
alter table pay_rule_versions add column if not exists source_text text;
alter table pay_rule_versions add column if not exists published_at timestamptz;
alter table pay_rule_versions add column if not exists published_by uuid references auth.users(id) on delete set null;

drop policy if exists "alle innloggede leser" on pay_rule_versions;
create policy "alle innloggede leser" on pay_rule_versions for select to authenticated
  using (is_platform_admin() or (status = 'published' and exists (
    select 1 from pay_rule_sets s where s.id = rule_set_id and (s.org_id is null or is_member(s.org_id)))));

create or replace function on_pay_rule_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare s pay_rule_sets;
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then return new; end if;
  select * into s from pay_rule_sets where id = new.rule_set_id;
  insert into notifications (org_id, user_id, kind, title, body, link)
  select distinct r.org_id, m.user_id, 'pay_rules_updated',
    'Nye satser: ' || s.name,
    'Gjelder fra ' || to_char(new.valid_from, 'DD.MM.YYYY') || '. Kontroller satsene og bekreft dem under Innstillinger › Lønnsregler.',
    '/innstillinger#lonnsregler'
  from org_pay_rules r join memberships m on m.org_id = r.org_id and m.role in ('owner', 'admin')
  where r.rule_set_id = new.rule_set_id
    and r.valid_from = (select max(x.valid_from) from org_pay_rules x where x.org_id = r.org_id and x.valid_from <= greatest(new.valid_from, current_date));
  return new;
end $$;
drop trigger if exists on_pay_rule_version on pay_rule_versions;
create trigger on_pay_rule_version after insert or update of status on pay_rule_versions for each row execute function on_pay_rule_version();

-- Tariffområder
alter table pay_rule_sets add column if not exists area text;
do $$ begin
  alter table pay_rule_sets add constraint pay_rule_sets_area check (area in ('ingen', 'bilutleie', 'handel', 'hotell_restaurant', 'renhold'));
exception when duplicate_object then null; end $$;
update pay_rule_sets set area = 'ingen' where key = 'aml' and area is null;
update pay_rule_sets set area = 'bilutleie', name = 'Overenskomsten for bilutleie (NHO Reiseliv – Fellesforbundet)' where key = 'bilutleie' and area is null;
update pay_rule_versions v set source_text = coalesce(v.source_text, 'Arbeidsmiljøloven §§ 10-4, 10-5, 10-6 og lov om 1. og 17. mai'),
  source_url = coalesce(v.source_url, 'https://lovdata.no/dokument/NL/lov/2005-06-17-62/KAPITTEL_10'), published_at = coalesce(v.published_at, v.created_at)
from pay_rule_sets s where s.id = v.rule_set_id and s.key = 'aml';
update pay_rule_versions v set source_text = coalesce(v.source_text, 'Overenskomsten for bilutleie 2024–2026, NHO Reiseliv – Fellesforbundet (forenklet)'),
  published_at = coalesce(v.published_at, v.created_at)
from pay_rule_sets s where s.id = v.rule_set_id and s.key = 'bilutleie';

-- H ---------------------------------------------------------------------------
alter table org_pay_rules add column if not exists confirmed_at timestamptz;
alter table org_pay_rules add column if not exists confirmed_by uuid references auth.users(id) on delete set null;

drop function if exists set_org_pay_rules(uuid, uuid, date);
create or replace function set_org_pay_rules(p_org uuid, p_rule_set uuid, p_from date, p_confirm boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare o organizations; s pay_rule_sets;
begin
  if not (is_admin(p_org) or is_platform_admin()) then raise exception 'Ikke tillatt.'; end if;
  select * into o from organizations where id = p_org;
  select * into s from pay_rule_sets where id = p_rule_set and (org_id is null or org_id = p_org);
  if not found then raise exception 'Ukjent regelsett.'; end if;
  if not exists (select 1 from pay_rule_versions where rule_set_id = p_rule_set and status = 'published') then
    raise exception 'Regelsettet har ingen publiserte satser ennå.';
  end if;
  if s.kind = 'tariff' and not p_confirm then
    raise exception 'Bekreft at bedriften følger denne avtalen.';
  end if;
  if exists (select 1 from time_entries t where t.org_id = p_org and t.status = 'locked'
             and t.starts_at >= (p_from::timestamp at time zone o.timezone)) then
    raise exception 'Det finnes låste lønnsperioder etter denne datoen. Velg en dato etter siste låste periode.';
  end if;
  delete from org_pay_rules where org_id = p_org and valid_from >= p_from;
  insert into org_pay_rules (org_id, valid_from, rule_set_id, created_by, confirmed_at, confirmed_by)
  values (p_org, p_from, p_rule_set, auth.uid(), case when p_confirm then now() end, case when p_confirm then auth.uid() end);
  insert into audit_log (org_id, table_name, row_id, action, changed_by, after)
  values (p_org, 'org_pay_rules', p_org, 'PAY_RULES', auth.uid(), jsonb_build_object('rule_set_id', p_rule_set, 'valid_from', p_from, 'confirmed', p_confirm));
end $$;
revoke execute on function set_org_pay_rules(uuid, uuid, date, boolean) from anon, public;
grant execute on function set_org_pay_rules(uuid, uuid, date, boolean) to authenticated;

-- Kunden bekrefter satsene i en versjon (InnSpæll publiserer, kunden kontrollerer)
create table if not exists pay_rule_confirmations (
  org_id uuid not null references organizations(id) on delete cascade,
  version_id uuid not null references pay_rule_versions(id) on delete cascade,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  primary key (org_id, version_id)
);
alter table pay_rule_confirmations enable row level security;
drop policy if exists "medlem leser" on pay_rule_confirmations;
create policy "medlem leser" on pay_rule_confirmations for select using (is_member(org_id) or is_platform_admin());
drop policy if exists "leder bekrefter" on pay_rule_confirmations;
create policy "leder bekrefter" on pay_rule_confirmations for insert with check (is_admin(org_id) and confirmed_by = auth.uid());

-- Æ e Trønder har valgt bilutleie tidligere: regnes som bekreftet
update org_pay_rules set confirmed_at = coalesce(confirmed_at, created_at) where confirmed_at is null;

-- F ---------------------------------------------------------------------------
alter table employment_terms add column if not exists pay_rule_set_id uuid references pay_rule_sets(id);
alter table employment_terms add column if not exists averaging_weeks int check (averaging_weeks is null or averaging_weeks between 2 and 52);
alter table employment_terms add column if not exists averaging_from date;

-- D ---------------------------------------------------------------------------
create table if not exists pay_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  date date not null,
  key text not null,
  count int not null default 1 check (count between 1 and 100),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists pay_events_org_date on pay_events (org_id, date);
alter table pay_events enable row level security;
drop policy if exists "leder og egen ser" on pay_events;
create policy "leder og egen ser" on pay_events for select using (is_admin(org_id) or employee_id = my_employee_id(org_id));
drop policy if exists "leder og egen registrerer" on pay_events;
create policy "leder og egen registrerer" on pay_events for insert
  with check ((is_admin(org_id) or employee_id = my_employee_id(org_id)) and created_by = auth.uid());
drop policy if exists "leder og egen sletter" on pay_events;
create policy "leder og egen sletter" on pay_events for delete using (is_admin(org_id) or (employee_id = my_employee_id(org_id) and created_by = auth.uid()));

create or replace function pay_events_not_locked() returns trigger
language plpgsql security definer set search_path = public as $$
declare r pay_events := coalesce(new, old);
begin
  if exists (select 1 from pay_periods p where p.org_id = r.org_id and p.status = 'exported' and r.date between p.starts_on and p.ends_on) then
    raise exception 'Lønnsperioden er låst. Be lederen åpne den igjen.';
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function pay_events_not_locked() from anon, public, authenticated;
drop trigger if exists pay_events_not_locked on pay_events;
create trigger pay_events_not_locked before insert or delete on pay_events for each row execute function pay_events_not_locked();

-- G ---------------------------------------------------------------------------
create table if not exists pay_code_mappings (
  org_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  wage_type text not null,
  primary key (org_id, code)
);
alter table pay_code_mappings enable row level security;
drop policy if exists "leder styrer" on pay_code_mappings;
create policy "leder styrer" on pay_code_mappings for all using (is_admin(org_id)) with check (is_admin(org_id));
