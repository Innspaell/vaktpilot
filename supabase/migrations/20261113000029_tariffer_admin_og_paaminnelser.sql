-- Tariffer: egne regelsett for én bedrift (lokal avtale), forespørsler fra kunder, kontroll etter lønnsoppgjøret og varsler.

alter table pay_rule_sets add column if not exists org_id uuid references organizations(id) on delete cascade;
alter table pay_rule_sets add column if not exists checked_year int;

drop policy if exists "alle innloggede leser" on pay_rule_sets;
create policy "alle innloggede leser" on pay_rule_sets for select to authenticated
  using (org_id is null or is_member(org_id) or is_platform_admin());
drop policy if exists "alle innloggede leser" on pay_rule_versions;
create policy "alle innloggede leser" on pay_rule_versions for select to authenticated
  using (exists (select 1 from pay_rule_sets s where s.id = rule_set_id and (s.org_id is null or is_member(s.org_id) or is_platform_admin())));

-- Leder kan bare velge felles regelsett eller bedriftens egne
create or replace function set_org_pay_rules(p_org uuid, p_rule_set uuid, p_from date) returns void
language plpgsql security definer set search_path = public as $$
declare o organizations;
begin
  if not (is_admin(p_org) or is_platform_admin()) then raise exception 'Ikke tillatt.'; end if;
  select * into o from organizations where id = p_org;
  if not exists (select 1 from pay_rule_sets where id = p_rule_set and (org_id is null or org_id = p_org)) then
    raise exception 'Ukjent regelsett.';
  end if;
  if not exists (select 1 from pay_rule_versions where rule_set_id = p_rule_set) then
    raise exception 'Regelsettet har ingen satser ennå.';
  end if;
  if exists (select 1 from time_entries t where t.org_id = p_org and t.status = 'locked'
             and t.starts_at >= (p_from::timestamp at time zone o.timezone)) then
    raise exception 'Det finnes låste lønnsperioder etter denne datoen. Velg en dato etter siste låste periode.';
  end if;
  delete from org_pay_rules where org_id = p_org and valid_from >= p_from;
  insert into org_pay_rules (org_id, valid_from, rule_set_id, created_by) values (p_org, p_from, p_rule_set, auth.uid());
  insert into audit_log (org_id, table_name, row_id, action, changed_by, after)
  values (p_org, 'org_pay_rules', p_org, 'PAY_RULES', auth.uid(), jsonb_build_object('rule_set_id', p_rule_set, 'valid_from', p_from));
end $$;

-- Varsel til InnSpæll (plattformadministratorer). Varselet legges i en bedrift de er med i, og sendes også på e-post.
create or replace function notify_platform_admins(p_kind text, p_title text, p_body text, p_link text) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in
    select distinct on (u.id) u.id as user_id, m.org_id
    from auth.users u join memberships m on m.user_id = u.id
    where u.id in (select user_id from platform_admins)
       or lower(u.email) in (select lower(email) from platform_admin_emails)
    order by u.id, m.created_at
  loop
    insert into notifications (org_id, user_id, kind, title, body, link, email_status)
    values (r.org_id, r.user_id, p_kind, p_title, p_body, p_link, 'pending');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function notify_platform_admins(text, text, text, text) from anon, public, authenticated;

-- Kunden ber om en annen tariff eller lokal avtale (tekst og/eller fil)
create table if not exists pay_rule_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  message text not null default '',
  file_path text,
  file_name text,
  status text not null default 'new' check (status in ('new', 'done')),
  reply text,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
alter table pay_rule_requests enable row level security;
drop policy if exists "leder og plattform ser" on pay_rule_requests;
create policy "leder og plattform ser" on pay_rule_requests for select using (is_admin(org_id) or is_platform_admin());
drop policy if exists "leder sender" on pay_rule_requests;
create policy "leder sender" on pay_rule_requests for insert with check (is_admin(org_id) and created_by = auth.uid() and status = 'new');
drop policy if exists "plattform behandler" on pay_rule_requests;
create policy "plattform behandler" on pay_rule_requests for update using (is_platform_admin()) with check (is_platform_admin());

create or replace function on_pay_rule_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform notify_platform_admins('platform_tariff_request',
      'Ny forespørsel om lønnsregler fra ' || (select name from organizations where id = new.org_id),
      left(coalesce(nullif(new.message, ''), 'Se vedlagt fil.'), 300), '/plattform/lonnsregler');
  elsif new.status = 'done' and old.status <> 'done' then
    insert into notifications (org_id, user_id, kind, title, body, link)
    select new.org_id, m.user_id, 'pay_rules_request_done', 'Forespørselen om lønnsregler er behandlet',
      coalesce(nullif(new.reply, ''), 'Se Innstillinger › Lønnsregler.'), '/innstillinger#lonnsregler'
    from memberships m where m.org_id = new.org_id and m.role in ('owner', 'admin');
  end if;
  return new;
end $$;
revoke execute on function on_pay_rule_request() from anon, public, authenticated;
drop trigger if exists on_pay_rule_request on pay_rule_requests;
create trigger on_pay_rule_request after insert or update on pay_rule_requests for each row execute function on_pay_rule_request();

-- Nye satser: si fra til lederne i bedrifter som bruker regelsettet
create or replace function on_pay_rule_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare s pay_rule_sets;
begin
  select * into s from pay_rule_sets where id = new.rule_set_id;
  insert into notifications (org_id, user_id, kind, title, body, link)
  select distinct r.org_id, m.user_id, 'pay_rules_updated',
    'Nye satser: ' || s.name,
    'Gjelder fra ' || to_char(new.valid_from, 'DD.MM.YYYY') || '. Lønnsgrunnlaget beregnes med de nye satsene fra denne datoen. Kontroller dem gjerne mot avtalen.',
    '/innstillinger#lonnsregler'
  from org_pay_rules r join memberships m on m.org_id = r.org_id and m.role in ('owner', 'admin')
  where r.rule_set_id = new.rule_set_id
    and r.valid_from = (select max(x.valid_from) from org_pay_rules x where x.org_id = r.org_id and x.valid_from <= greatest(new.valid_from, current_date));
  return new;
end $$;
revoke execute on function on_pay_rule_version() from anon, public, authenticated;
drop trigger if exists on_pay_rule_version on pay_rule_versions;
create trigger on_pay_rule_version after insert on pay_rule_versions for each row execute function on_pay_rule_version();

-- Etter lønnsoppgjøret: fra 15. juni minner vi InnSpæll om å kontrollere tariffer i bruk som ikke er kontrollert i år.
create or replace function run_tariff_check_reminder() returns int
language plpgsql security definer set search_path = public as $$
declare v_year int := extract(year from now() at time zone 'Europe/Oslo'); v_list text; n int;
begin
  if (now() at time zone 'Europe/Oslo')::date <> make_date(v_year, 6, 15) then return 0; end if;
  select string_agg(s.name, ', ' order by s.name), count(*) into v_list, n
  from pay_rule_sets s
  where s.kind = 'tariff' and coalesce(s.checked_year, 0) < v_year
    and exists (select 1 from org_pay_rules r where r.rule_set_id = s.id);
  if coalesce(n, 0) = 0 then return 0; end if;
  perform notify_platform_admins('platform_tariff_check', 'Sjekk tariffsatsene etter lønnsoppgjøret',
    'Disse tariffene er i bruk og ikke kontrollert i ' || v_year || ': ' || v_list || '. Legg inn nye satser, eller marker dem som kontrollert.',
    '/plattform/lonnsregler');
  return n;
end $$;
revoke execute on function run_tariff_check_reminder() from anon, public, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vaktpilot_tariffkontroll';
    perform cron.schedule('vaktpilot_tariffkontroll', '0 7 15 6 *', 'select public.run_tariff_check_reminder()');
  end if;
end $$;

-- Hvor mange bedrifter som bruker hvert regelsett nå (for plattformsiden)
create or replace function pay_rule_usage() returns table (rule_set_id uuid, org_id uuid, org_name text, valid_from date)
language sql stable security definer set search_path = public as $$
  select r.rule_set_id, r.org_id, o.name, r.valid_from
  from org_pay_rules r join organizations o on o.id = r.org_id
  where is_platform_admin()
    and r.valid_from = (select max(x.valid_from) from org_pay_rules x where x.org_id = r.org_id and x.valid_from <= current_date);
$$;
revoke execute on function pay_rule_usage() from anon, public;
grant execute on function pay_rule_usage() to authenticated;
