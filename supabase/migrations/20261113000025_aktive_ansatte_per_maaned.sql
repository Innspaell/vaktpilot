-- Aktive ansatte per måned, som grunnlag for pris. Aktiv = har hatt publisert vakt eller timer i måneden.
-- Standardpris: 299 kr/mnd med 5 aktive ansatte inkludert. Pris per ekstra ansatt settes på plattformsiden.

alter table platform_settings add column if not exists included_employees int not null default 5;
update platform_settings set base_price = 299, included_employees = 5 where id = 1 and base_price = 0;

-- Egen avtale per bedrift (tom = standardpris)
alter table organizations add column if not exists price_base numeric(10,2);
alter table organizations add column if not exists price_included int;
alter table organizations add column if not exists price_per_extra numeric(10,2);

create table if not exists usage_months (
  org_id uuid not null references organizations(id) on delete cascade,
  month date not null,                         -- første dag i måneden
  active_count int not null default 0,
  active_employee_ids uuid[] not null default '{}',
  included int not null,
  base_price numeric(10,2) not null,
  per_extra numeric(10,2) not null,
  amount numeric(10,2) not null,
  final boolean not null default false,        -- måneden er over, tallet endres ikke
  notified_over boolean not null default false,
  computed_at timestamptz not null default now(),
  primary key (org_id, month)
);
alter table usage_months enable row level security;
drop policy if exists "leder og plattform ser" on usage_months;
create policy "leder og plattform ser" on usage_months for select using (is_admin(org_id) or is_platform_admin());

-- Regn ut én bedrift for én måned (ikke låste måneder).
create or replace function compute_usage(p_org uuid, p_month date, p_final boolean, p_notify boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  o organizations; s platform_settings;
  v_from timestamptz; v_to timestamptz; v_ids uuid[]; v_incl int; v_base numeric; v_per numeric; v_n int;
  v_month date := date_trunc('month', p_month)::date;
  v_names text[] := array['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
begin
  select * into o from organizations where id = p_org;
  select * into s from platform_settings where id = 1;
  if exists (select 1 from usage_months where org_id = p_org and month = v_month and final) then return; end if;
  v_from := v_month::timestamp at time zone o.timezone;
  v_to := (v_month + interval '1 month')::timestamp at time zone o.timezone;
  select coalesce(array_agg(distinct x.employee_id), '{}') into v_ids from (
    select sh.employee_id from shifts sh
      where sh.org_id = p_org and sh.employee_id is not null and sh.status = 'published' and sh.starts_at >= v_from and sh.starts_at < v_to
    union
    select t.employee_id from time_entries t where t.org_id = p_org and t.starts_at >= v_from and t.starts_at < v_to
  ) x;
  v_n := coalesce(array_length(v_ids, 1), 0);
  v_incl := coalesce(o.price_included, s.included_employees, 5);
  v_base := coalesce(o.price_base, s.base_price, 0);
  v_per := coalesce(o.price_per_extra, s.per_employee_price, 0);

  insert into usage_months as u (org_id, month, active_count, active_employee_ids, included, base_price, per_extra, amount, final, computed_at)
  values (p_org, v_month, v_n, v_ids, v_incl, v_base, v_per, v_base + greatest(v_n - v_incl, 0) * v_per, p_final, now())
  on conflict (org_id, month) do update set active_count = excluded.active_count, active_employee_ids = excluded.active_employee_ids,
    included = excluded.included, base_price = excluded.base_price, per_extra = excluded.per_extra, amount = excluded.amount,
    final = excluded.final, computed_at = now();

  -- Første gang bedriften går over det inkluderte antallet i måneden: si fra til lederne
  if p_notify and not p_final and v_n > v_incl
     and not (select notified_over from usage_months where org_id = p_org and month = v_month) then
    insert into notifications (org_id, user_id, kind, title, body, link)
    select p_org, m.user_id, 'plan_over',
      'Flere enn ' || v_incl || ' aktive ansatte denne måneden',
      v_n || ' ansatte har vakter eller timer i ' || v_names[extract(month from v_month)::int] || '. ' || v_incl || ' er inkludert i prisen'
        || case when v_per > 0 then ', og hver ekstra ansatt koster ' || trim(to_char(v_per, '999G990')) || ' kr for måneden.' else '.' end,
      '/innstillinger/abonnement'
    from memberships m where m.org_id = p_org and m.role in ('owner', 'admin');
    update usage_months set notified_over = true where org_id = p_org and month = v_month;
  end if;
end $$;
revoke execute on function compute_usage(uuid, date, boolean, boolean) from anon, public, authenticated;

-- Hver time: oppdater inneværende måned. Forrige måned låses første gang jobben kjører i ny måned.
create or replace function run_usage() returns int
language plpgsql security definer set search_path = public as $$
declare o record; n int := 0; v_now date := (now() at time zone 'Europe/Oslo')::date;
begin
  for o in select id from organizations where active loop
    perform compute_usage(o.id, (date_trunc('month', v_now) - interval '1 month')::date, true);
    perform compute_usage(o.id, v_now, false);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function run_usage() from anon, public, authenticated;

-- Lederen åpner Abonnement: oppdater tallet for denne måneden med en gang.
create or replace function refresh_my_usage(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin(p_org) or is_platform_admin()) then raise exception 'Ikke tillatt.'; end if;
  perform compute_usage(p_org, (now() at time zone 'Europe/Oslo')::date, false);
end $$;
revoke execute on function refresh_my_usage(uuid) from anon, public;
grant execute on function refresh_my_usage(uuid) to authenticated;

-- Plattform: regn ut alle på nytt etter prisendring
create or replace function run_usage_now() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  return run_usage();
end $$;
revoke execute on function run_usage_now() from anon, public;
grant execute on function run_usage_now() to authenticated;

-- Plattform: egen pris for en bedrift (tomme felt = standard)
create or replace function platform_set_org_price(p_org uuid, p_base numeric, p_included int, p_per numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  update organizations set price_base = p_base, price_included = p_included, price_per_extra = p_per where id = p_org;
  perform compute_usage(p_org, (now() at time zone 'Europe/Oslo')::date, false);
end $$;
revoke execute on function platform_set_org_price(uuid, numeric, int, numeric) from anon, public;
grant execute on function platform_set_org_price(uuid, numeric, int, numeric) to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vaktpilot_aktive_ansatte';
    perform cron.schedule('vaktpilot_aktive_ansatte', '25 * * * *', 'select public.run_usage()');
  end if;
end $$;

-- Fyll inn forrige og inneværende måned med en gang
do $$ declare o record; begin
  for o in select id from organizations where active loop
    perform compute_usage(o.id, (date_trunc('month', now() at time zone 'Europe/Oslo') - interval '1 month')::date, true, false);
    perform compute_usage(o.id, (now() at time zone 'Europe/Oslo')::date, false, false);
  end loop;
  -- Ingen varsel for det som allerede er passert før denne funksjonen fantes
  update usage_months set notified_over = true where active_count > included;
end $$;

-- Bare InnSpæll kan endre pris og om bedriften er aktiv (bedriftens ledere kan ellers oppdatere egen bedrift)
create or replace function protect_org_billing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_platform_admin() and (
       new.price_base is distinct from old.price_base or new.price_included is distinct from old.price_included
    or new.price_per_extra is distinct from old.price_per_extra or new.active is distinct from old.active) then
    raise exception 'Pris og status kan bare endres av InnSpæll.';
  end if;
  return new;
end $$;
revoke execute on function protect_org_billing() from anon, public, authenticated;
drop trigger if exists protect_org_billing on organizations;
create trigger protect_org_billing before update on organizations for each row execute function protect_org_billing();
