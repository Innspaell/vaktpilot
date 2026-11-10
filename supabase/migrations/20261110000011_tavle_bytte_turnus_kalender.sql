-- Oppslagstavle, vaktbytte, fast turnus, kalenderlenke, databehandleravtale, plattformside,
-- påminnelser, sletterutiner, lønnsperioder og legemeldt sykefravær.

-- ---------------------------------------------------------------------------
-- Oppslagstavle
-- ---------------------------------------------------------------------------
create table if not exists board_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  author_user uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  title text,
  body text not null check (length(body) between 1 and 4000),
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists board_posts_org on board_posts (org_id, pinned desc, created_at desc);
alter table board_posts enable row level security;

drop policy if exists "medlem leser" on board_posts;
create policy "medlem leser" on board_posts for select using (is_member(org_id));
drop policy if exists "medlem skriver eget" on board_posts;
create policy "medlem skriver eget" on board_posts for insert
  with check (is_member(org_id) and author_user = (select auth.uid()) and (pinned = false or is_admin(org_id)));
drop policy if exists "admin setter fokus" on board_posts;
create policy "admin setter fokus" on board_posts for update using (is_admin(org_id)) with check (is_admin(org_id));
drop policy if exists "egne eller admin sletter" on board_posts;
create policy "egne eller admin sletter" on board_posts for delete
  using (author_user = (select auth.uid()) or is_admin(org_id));

-- ---------------------------------------------------------------------------
-- Vaktbytte: A tilbyr egen vakt til B (eller gir den bort), B svarer, leder godkjenner.
-- ---------------------------------------------------------------------------
alter table shift_swaps add column if not exists to_accepted boolean not null default false;

create or replace function propose_swap(p_shift uuid, p_to uuid default null, p_comment text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare s shifts; v_me uuid; v_id uuid; v_to_user uuid; v_name text;
begin
  select * into s from shifts where id = p_shift;
  if not found then raise exception 'Fant ikke vakten.'; end if;
  v_me := my_employee_id(s.org_id);
  if v_me is null or s.employee_id is distinct from v_me then raise exception 'Du kan bare bytte egne vakter.'; end if;
  if s.status <> 'published' or s.starts_at < now() then raise exception 'Vakten kan ikke byttes.'; end if;
  if p_to is not null and not exists (select 1 from employees where id = p_to and org_id = s.org_id) then
    raise exception 'Ukjent kollega.';
  end if;
  if p_to = v_me then raise exception 'Velg en annen kollega.'; end if;
  if exists (select 1 from shift_swaps where shift_id = s.id and status = 'pending') then
    raise exception 'Det finnes allerede en forespørsel om bytte for denne vakten.';
  end if;
  insert into shift_swaps (org_id, shift_id, from_employee_id, to_employee_id, comment)
  values (s.org_id, s.id, v_me, p_to, p_comment) returning id into v_id;

  select full_name into v_name from employees where id = v_me;
  if p_to is not null then
    select user_id into v_to_user from employees where id = p_to;
    if v_to_user is not null then
      insert into notifications (org_id, user_id, kind, title, link)
      values (s.org_id, v_to_user, 'swap_offer', coalesce(v_name, 'En kollega') || ' spør om du kan ta en vakt', '/foresporsler?vis=bytte');
    end if;
  else
    insert into notifications (org_id, user_id, kind, title, link)
    select s.org_id, m.user_id, 'swap_request', coalesce(v_name, 'En ansatt') || ' vil gi bort en vakt', '/foresporsler?vis=bytte'
    from memberships m where m.org_id = s.org_id and m.role in ('owner', 'admin');
  end if;
  return v_id;
end $$;

-- Kollega svarer ja eller nei.
create or replace function respond_swap(p_swap uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare w shift_swaps; v_name text; v_from_user uuid;
begin
  select * into w from shift_swaps where id = p_swap for update;
  if not found or w.status <> 'pending' then raise exception 'Forespørselen er ikke aktiv.'; end if;
  if w.to_employee_id is distinct from my_employee_id(w.org_id) then raise exception 'Ikke tillatt.'; end if;
  select full_name into v_name from employees where id = w.to_employee_id;
  select user_id into v_from_user from employees where id = w.from_employee_id;
  if p_accept then
    update shift_swaps set to_accepted = true where id = w.id;
    insert into notifications (org_id, user_id, kind, title, link)
    select w.org_id, m.user_id, 'swap_request', 'Vaktbytte venter på godkjenning', '/foresporsler?vis=bytte'
    from memberships m where m.org_id = w.org_id and m.role in ('owner', 'admin');
  else
    update shift_swaps set status = 'rejected', decided_at = now() where id = w.id;
  end if;
  if v_from_user is not null then
    insert into notifications (org_id, user_id, kind, title, link)
    values (w.org_id, v_from_user, 'swap_answer',
      coalesce(v_name, 'Kollegaen') || case when p_accept then ' kan ta vakten. Venter på leder.' else ' kan ikke ta vakten.' end,
      '/foresporsler?vis=bytte');
  end if;
end $$;

-- Leder godkjenner eller avslår. Godkjent bytte flytter vakten; gitt bort blir den ledig.
create or replace function decide_swap(p_swap uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare w shift_swaps; v_user uuid;
begin
  select * into w from shift_swaps where id = p_swap for update;
  if not found or not is_admin(w.org_id) then raise exception 'Ikke tillatt.'; end if;
  if w.status <> 'pending' then raise exception 'Forespørselen er allerede behandlet.'; end if;
  if p_approve then
    if w.to_employee_id is not null and not w.to_accepted then
      raise exception 'Kollegaen har ikke svart ja ennå.';
    end if;
    begin
      update shifts set employee_id = w.to_employee_id where id = w.shift_id and employee_id = w.from_employee_id;
      if not found then raise exception 'Vakten er endret siden forespørselen ble sendt.'; end if;
    exception when exclusion_violation then
      raise exception 'Kollegaen har allerede en vakt som overlapper.';
    end;
  end if;
  update shift_swaps set status = case when p_approve then 'approved'::request_status else 'rejected'::request_status end,
    decided_by = auth.uid(), decided_at = now() where id = w.id;
  for v_user in select user_id from employees where id in (w.from_employee_id, w.to_employee_id) and user_id is not null loop
    insert into notifications (org_id, user_id, kind, title, link)
    values (w.org_id, v_user, 'swap_decided', case when p_approve then 'Vaktbyttet er godkjent' else 'Vaktbyttet ble ikke godkjent' end, '/vaktplan');
  end loop;
end $$;

-- Den som spurte, kan trekke forespørselen.
drop policy if exists "ansatt trekker egne bytter" on shift_swaps;
create policy "ansatt trekker egne bytter" on shift_swaps for update
  using (from_employee_id = my_employee_id(org_id) and status = 'pending')
  with check (status in ('pending', 'cancelled'));

-- ---------------------------------------------------------------------------
-- Fast turnus: mønster over N uker som kan legges inn i planen
-- ---------------------------------------------------------------------------
create table if not exists rotations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  weeks int not null default 1 check (weeks between 1 and 12),
  created_at timestamptz not null default now()
);
create table if not exists rotation_shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  rotation_id uuid not null references rotations(id) on delete cascade,
  week_index int not null check (week_index >= 1),
  weekday int not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 30 check (break_minutes >= 0),
  employee_id uuid references employees(id) on delete set null,
  work_role_id uuid references work_roles(id) on delete set null
);
create index if not exists rotation_shifts_rot on rotation_shifts (rotation_id, week_index, weekday);
alter table rotations enable row level security;
alter table rotation_shifts enable row level security;
drop policy if exists "admin" on rotations;
create policy "admin" on rotations for all using (is_admin(org_id)) with check (is_admin(org_id));
drop policy if exists "admin" on rotation_shifts;
create policy "admin" on rotation_shifts for all using (is_admin(org_id)) with check (is_admin(org_id));

-- ---------------------------------------------------------------------------
-- Kalenderlenke (iCal) per ansatt. Lenken er hemmelig og kan byttes.
-- ---------------------------------------------------------------------------
alter table employees add column if not exists calendar_token uuid not null default gen_random_uuid();
create unique index if not exists employees_calendar_token on employees (calendar_token);

create or replace function calendar_feed(p_token uuid)
returns table (uid text, kind text, title text, starts_at timestamptz, ends_at timestamptz,
               from_date date, to_date date, break_minutes int, updated timestamptz, org_name text, tz text)
language sql stable security definer set search_path = public as $$
  with e as (
    select emp.id, emp.org_id, o.name as org_name, o.timezone
    from employees emp join organizations o on o.id = emp.org_id
    where emp.calendar_token = p_token and (emp.end_date is null or emp.end_date >= current_date) and o.active
  )
  select s.id::text, 'shift', coalesce(r.name, 'Vakt'), s.starts_at, s.ends_at, null::date, null::date, s.break_minutes,
         s.created_at, e.org_name, e.timezone
  from e join shifts s on s.employee_id = e.id
  left join work_roles r on r.id = s.work_role_id
  where s.status = 'published' and s.starts_at > now() - interval '60 days' and s.starts_at < now() + interval '365 days'
  union all
  select a.id::text, 'absence', t.name, null, null, a.from_date, a.to_date, 0, a.created_at, e.org_name, e.timezone
  from e join absence_requests a on a.employee_id = e.id join absence_types t on t.id = a.absence_type_id
  where a.status = 'approved' and a.to_date > current_date - 60;
$$;

create or replace function reset_calendar_token(p_org uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := gen_random_uuid();
begin
  update employees set calendar_token = v where id = my_employee_id(p_org);
  if not found then raise exception 'Du er ikke registrert som ansatt her.'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Databehandleravtale: hvem som godtok, når og hvilken versjon
-- ---------------------------------------------------------------------------
create table if not exists dpa_acceptances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  version text not null,
  accepted_by uuid not null references auth.users(id),
  accepted_name text not null,
  accepted_email text not null,
  accepted_at timestamptz not null default now(),
  unique (org_id, version)
);
alter table dpa_acceptances enable row level security;
drop policy if exists "admin leser" on dpa_acceptances;
create policy "admin leser" on dpa_acceptances for select using (is_admin(org_id) or is_platform_admin());
drop policy if exists "admin godtar" on dpa_acceptances;
create policy "admin godtar" on dpa_acceptances for insert with check (is_admin(org_id) and accepted_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Plattformside for InnSpæll
-- ---------------------------------------------------------------------------
create table if not exists platform_settings (
  id int primary key default 1 check (id = 1),
  base_price numeric(10,2) not null default 0,
  per_employee_price numeric(10,2) not null default 0,
  updated_at timestamptz not null default now()
);
insert into platform_settings (id) values (1) on conflict do nothing;
alter table platform_settings enable row level security;
drop policy if exists "plattformadmin" on platform_settings;
create policy "plattformadmin" on platform_settings for all using (is_platform_admin()) with check (is_platform_admin());

create or replace function platform_overview()
returns table (org_id uuid, name text, org_number text, active boolean, created_at timestamptz,
               employees int, logged_in int, admins int, shifts_30d int, entries_30d int,
               last_activity timestamptz, dpa_version text, dpa_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  return query
  select o.id, o.name, o.org_number, o.active, o.created_at,
    (select count(*)::int from employees e where e.org_id = o.id and (e.end_date is null or e.end_date >= current_date)),
    (select count(*)::int from employees e where e.org_id = o.id and e.user_id is not null and (e.end_date is null or e.end_date >= current_date)),
    (select count(*)::int from memberships m where m.org_id = o.id and m.role in ('owner', 'admin')),
    (select count(*)::int from shifts s where s.org_id = o.id and s.starts_at > now() - interval '30 days' and s.status <> 'cancelled'),
    (select count(*)::int from time_entries t where t.org_id = o.id and t.starts_at > now() - interval '30 days'),
    (select max(a.at) from audit_log a where a.org_id = o.id),
    (select d.version from dpa_acceptances d where d.org_id = o.id order by d.accepted_at desc limit 1),
    (select d.accepted_at from dpa_acceptances d where d.org_id = o.id order by d.accepted_at desc limit 1)
  from organizations o order by o.name;
end $$;

-- Plattformadmin kan slå en bedrift av og på, og gå inn som eier ved behov (logges).
create or replace function platform_set_active(p_org uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  update organizations set active = p_active where id = p_org;
  insert into audit_log (org_id, table_name, row_id, action, changed_by, after)
  values (p_org, 'organizations', p_org, case when p_active then 'PLATFORM_ACTIVATE' else 'PLATFORM_DEACTIVATE' end, auth.uid(), null);
end $$;

create or replace function platform_join_org(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  insert into memberships (org_id, user_id, role) values (p_org, auth.uid(), 'admin')
  on conflict (org_id, user_id) do nothing;
  insert into audit_log (org_id, table_name, row_id, action, changed_by)
  values (p_org, 'memberships', p_org, 'PLATFORM_JOIN', auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- Legemeldt sykefravær som egen type (egenmelding = «syk»)
-- ---------------------------------------------------------------------------
insert into absence_types (org_id, key, name, paid, counts_as_work, unit, is_sick, needs_approval)
select o.id, 'sykmelding', 'Sykmelding (legemeldt)', true, true, 'day', true, false from organizations o
on conflict (org_id, key) do nothing;
update absence_types set name = 'Egenmelding' where key = 'syk' and name = 'Sykefravær';

create or replace function add_default_absence_types() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into absence_types (org_id, key, name, paid, counts_as_work, unit, is_sick, needs_approval)
  values (new.id, 'sykmelding', 'Sykmelding (legemeldt)', true, true, 'day', true, false)
  on conflict (org_id, key) do nothing;
  return new;
end $$;
drop trigger if exists add_default_absence_types on organizations;
create trigger add_default_absence_types after insert on organizations
  for each row execute function add_default_absence_types();

-- ---------------------------------------------------------------------------
-- Lønnsperioder: låsing etter eksport, og åpning igjen ved behov
-- ---------------------------------------------------------------------------
create or replace function lock_pay_period(p_org uuid, p_from date, p_to date, p_format text, p_checksum text) returns uuid
language plpgsql security definer set search_path = public as $$
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
  insert into payroll_exports (org_id, pay_period_id, format, checksum, created_by)
  values (p_org, v_period, p_format, p_checksum, auth.uid()) returning id into v_export;
  update time_entries set status = 'locked', payroll_export_id = v_export
  where org_id = p_org and status = 'approved' and (starts_at at time zone v_tz)::date between p_from and p_to;
  return v_export;
end $$;

create or replace function reopen_pay_period(p_period uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p pay_periods; v_tz text;
begin
  select * into p from pay_periods where id = p_period;
  if not found or not is_admin(p.org_id) then raise exception 'Ikke tillatt.'; end if;
  select timezone into v_tz from organizations where id = p.org_id;
  update time_entries set status = 'approved'
  where org_id = p.org_id and status = 'locked' and (starts_at at time zone v_tz)::date between p.starts_on and p.ends_on;
  update pay_periods set status = 'open' where id = p.id;
  insert into audit_log (org_id, table_name, row_id, action, changed_by) values (p.org_id, 'pay_periods', p.id, 'REOPEN', auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- Påminnelser (kjøres daglig): vakt i morgen, og ubekreftet arbeidsdag
-- ---------------------------------------------------------------------------
create or replace function run_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare v_count int := 0; n int;
begin
  -- Vakt i morgen
  insert into notifications (org_id, user_id, kind, title, link)
  select s.org_id, e.user_id, 'reminder_shift',
    'Påminnelse: vakt i morgen ' || to_char(s.starts_at at time zone o.timezone, 'HH24:MI') || '–' || to_char(s.ends_at at time zone o.timezone, 'HH24:MI'),
    '/vaktplan?vakt=' || s.id
  from shifts s join employees e on e.id = s.employee_id join organizations o on o.id = s.org_id
  where s.status = 'published' and e.user_id is not null and o.active
    and (s.starts_at at time zone o.timezone)::date = (now() at time zone o.timezone)::date + 1
    and not exists (select 1 from notifications n where n.user_id = e.user_id and n.link = '/vaktplan?vakt=' || s.id);
  get diagnostics n = row_count; v_count := v_count + n;

  -- Arbeidsdag i dag eller i går som ikke er bekreftet eller stemplet
  insert into notifications (org_id, user_id, kind, title, link)
  select s.org_id, e.user_id, 'reminder_confirm', 'Husk å bekrefte arbeidsdagen ' || to_char(s.starts_at at time zone o.timezone, 'DD.MM'),
    '/timer?bekreft=' || s.id
  from shifts s join employees e on e.id = s.employee_id join organizations o on o.id = s.org_id
  where s.status = 'published' and e.user_id is not null and o.active and s.ends_at < now()
    and (s.starts_at at time zone o.timezone)::date >= (now() at time zone o.timezone)::date - 1
    and not exists (select 1 from time_entries t where t.shift_id = s.id)
    and not exists (select 1 from time_entries t where t.employee_id = e.id
                    and (t.starts_at at time zone o.timezone)::date = (s.starts_at at time zone o.timezone)::date)
    and not exists (select 1 from notifications n where n.user_id = e.user_id and n.link = '/timer?bekreft=' || s.id);
  get diagnostics n = row_count; v_count := v_count + n;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Sletterutiner (kjøres daglig)
--  * Tilgang stenges dagen etter sluttdato
--  * Kontaktinfo, tilgjengelighet og varsler slettes 3 måneder etter sluttdato
--  * Etter oppbevaringstiden (minst 5 år etter utgangen av regnskapsåret) anonymiseres den ansatte
-- ---------------------------------------------------------------------------
create or replace function run_retention() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_access int; v_contact int; v_anon int;
begin
  delete from memberships m using employees e
  where m.org_id = e.org_id and m.user_id = e.user_id and m.role = 'employee'
    and e.end_date is not null and e.end_date < current_date;
  get diagnostics v_access = row_count;

  with ended as (
    select id, user_id, org_id from employees
    where end_date is not null and end_date < current_date - interval '3 months' and (phone is not null or email is not null)
  ), a as (delete from availability where employee_id in (select id from ended) returning 1),
     nt as (delete from notifications n using ended where n.user_id = ended.user_id and n.org_id = ended.org_id returning 1)
  update employees set phone = null, email = null, calendar_token = gen_random_uuid()
  where id in (select id from ended);
  get diagnostics v_contact = row_count;

  update employees e set full_name = 'Tidligere ansatt', employee_number = null, user_id = null
  from organizations o
  where o.id = e.org_id and e.end_date is not null and e.full_name <> 'Tidligere ansatt'
    and e.end_date < (date_trunc('year', current_date) - make_interval(years => o.retention_years))::date;
  get diagnostics v_anon = row_count;

  return jsonb_build_object('tilgang_stengt', v_access, 'kontaktinfo_slettet', v_contact, 'anonymisert', v_anon);
end $$;

-- ---------------------------------------------------------------------------
-- Rettigheter
-- ---------------------------------------------------------------------------
revoke execute on function propose_swap(uuid, uuid, text), respond_swap(uuid, boolean), decide_swap(uuid, boolean),
  calendar_feed(uuid), reset_calendar_token(uuid), platform_overview(), platform_set_active(uuid, boolean),
  platform_join_org(uuid), lock_pay_period(uuid, date, date, text, text), reopen_pay_period(uuid),
  run_reminders(), run_retention(), add_default_absence_types() from anon, public;
grant execute on function propose_swap(uuid, uuid, text), respond_swap(uuid, boolean), decide_swap(uuid, boolean),
  reset_calendar_token(uuid), platform_overview(), platform_set_active(uuid, boolean), platform_join_org(uuid),
  lock_pay_period(uuid, date, date, text, text), reopen_pay_period(uuid) to authenticated;
-- Kalenderen hentes av telefonens kalender-app uten innlogging; tilgang styres av den hemmelige lenken.
grant execute on function calendar_feed(uuid) to anon, authenticated;
revoke execute on function run_reminders(), run_retention() from authenticated;
