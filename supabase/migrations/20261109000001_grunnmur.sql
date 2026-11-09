-- Vaktpilot – grunnmur
-- Flere bedrifter i én installasjon. Alle bedriftsdata har org_id og beskyttes med Row Level Security.
-- Tidspunkter lagres som timestamptz (UTC). "Dag" regnes i bedriftens tidssone (standard Europe/Oslo).

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Typer
-- ---------------------------------------------------------------------------
create type access_role as enum ('owner', 'admin', 'employee');
create type pay_type as enum ('fixed', 'hourly');
create type shift_status as enum ('draft', 'published', 'cancelled');
create type request_kind as enum ('open_shift', 'proposal');
create type request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type clock_kind as enum ('in', 'break_start', 'break_end', 'out');
create type entry_source as enum ('clock', 'manual', 'admin');
create type entry_status as enum ('draft', 'submitted', 'approved', 'locked');
create type time_category as enum (
  'ordinary', 'extra', 'overtime', 'supplement', 'holiday_work', 'holiday_pay', 'paid_absence', 'allowance'
);
create type absence_unit as enum ('day', 'hour');
create type availability_kind as enum ('available', 'unavailable', 'wants_extra');
create type period_status as enum ('open', 'checked', 'exported');

-- ---------------------------------------------------------------------------
-- Plattform og bedrift
-- ---------------------------------------------------------------------------
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_number text,
  timezone text not null default 'Europe/Oslo',
  full_time_hours_week numeric(5,2) not null default 37.5,
  vacation_days_year int not null default 25,          -- telt man–fre
  vacation_year_start_month int not null default 1 check (vacation_year_start_month between 1 and 12),
  staffing_slot_minutes int not null default 15 check (staffing_slot_minutes in (15, 30, 60)),
  auto_submit_clock_entries boolean not null default true,
  retention_years int not null default 5 check (retention_years >= 5),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table memberships (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role access_role not null default 'employee',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on memberships (user_id);

-- ---------------------------------------------------------------------------
-- Hjelpefunksjoner for tilgang (security definer, så RLS ikke går i ring)
-- ---------------------------------------------------------------------------
create or replace function is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid());
$$;

create or replace function is_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where org_id = p_org and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Regelsett (tariff eller egen avtale), med versjoner
-- ---------------------------------------------------------------------------
create table rule_sets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);
create index on rule_sets (org_id);

create table rule_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  rule_set_id uuid not null references rule_sets(id) on delete cascade,
  valid_from date not null,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (rule_set_id, valid_from)
);
create index on rule_versions (org_id);

-- ---------------------------------------------------------------------------
-- Ansatte
-- ---------------------------------------------------------------------------
create table employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  employee_number text,
  full_name text not null,
  email text,
  phone text,
  start_date date not null default current_date,
  end_date date,
  is_shift_worker boolean not null default false,       -- turnus/skift: gir turnustillegg
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  check (end_date is null or end_date >= start_date)
);
create index on employees (org_id);
create unique index employees_org_email on employees (org_id, lower(email)) where email is not null;

create or replace function my_employee_id(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from employees where org_id = p_org and user_id = auth.uid();
$$;

create table employment_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  valid_from date not null,
  valid_to date,
  position_pct numeric(5,2) not null default 100 check (position_pct > 0 and position_pct <= 100),
  hours_per_week numeric(5,2) not null default 37.5,
  pay_type pay_type not null default 'hourly',
  rule_set_id uuid references rule_sets(id) on delete set null,
  paid_holidays boolean not null default true,
  vacation_days int not null default 25,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (employee_id with =, daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&)
);
create index on employment_terms (org_id);

create table work_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  color text not null default '#2563eb',
  unique (org_id, name)
);

create table employee_work_roles (
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  work_role_id uuid not null references work_roles(id) on delete cascade,
  primary key (employee_id, work_role_id)
);
create index on employee_work_roles (org_id);

-- ---------------------------------------------------------------------------
-- Bemanning
-- ---------------------------------------------------------------------------
create table staffing_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),   -- 1 = mandag
  start_time time not null,
  end_time time not null,                                  -- 00:00 betyr midnatt
  work_role_id uuid references work_roles(id) on delete cascade,
  required int not null check (required >= 0)
);
create index on staffing_templates (org_id, weekday);

create table staffing_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  date date not null,
  closed boolean not null default false,
  start_time time,
  end_time time,
  work_role_id uuid references work_roles(id) on delete cascade,
  required int check (required >= 0),
  check (closed or (start_time is not null and end_time is not null and required is not null))
);
create index on staffing_overrides (org_id, date);

-- ---------------------------------------------------------------------------
-- Vakter
-- ---------------------------------------------------------------------------
create table shift_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 0 check (break_minutes >= 0),
  work_role_id uuid references work_roles(id) on delete set null
);
create index on shift_templates (org_id);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,   -- tom = ledig vakt
  work_role_id uuid references work_roles(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes int not null default 0 check (break_minutes >= 0),
  status shift_status not null default 'draft',
  auto_approve boolean not null default false,
  called_overtime boolean not null default false,   -- tilsagt overtid
  shifted_hours boolean not null default false,     -- forskjøvet arbeidstid
  series_id uuid,
  note text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours'),
  -- samme ansatt kan ikke ha to vakter som overlapper
  exclude using gist (employee_id with =, tstzrange(starts_at, ends_at) with &&)
    where (employee_id is not null and status <> 'cancelled')
);
create index on shifts (org_id, starts_at);
create index on shifts (employee_id, starts_at);

create table shift_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  kind request_kind not null,
  shift_id uuid references shifts(id) on delete cascade,
  requested_start timestamptz,
  requested_end timestamptz,
  work_role_id uuid references work_roles(id) on delete set null,
  status request_status not null default 'pending',
  warnings jsonb not null default '[]'::jsonb,
  comment text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (kind = 'open_shift' and shift_id is not null)
    or (kind = 'proposal' and requested_start is not null and requested_end > requested_start)
  )
);
create index on shift_requests (org_id, status);
create unique index one_pending_request_per_shift on shift_requests (shift_id, employee_id) where status = 'pending';

create table shift_swaps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  shift_id uuid not null references shifts(id) on delete cascade,
  from_employee_id uuid not null references employees(id) on delete cascade,
  to_employee_id uuid references employees(id) on delete cascade,
  status request_status not null default 'pending',
  comment text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index on shift_swaps (org_id, status);

create table availability (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  kind availability_kind not null,
  date date,
  weekday int check (weekday between 1 and 7),
  start_time time,
  end_time time,
  note text,
  check (date is not null or weekday is not null)
);
create index on availability (org_id);

-- ---------------------------------------------------------------------------
-- Timer
-- ---------------------------------------------------------------------------
create table clock_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  kind clock_kind not null,
  at timestamptz not null default now(),
  source text not null default 'mobile',
  time_entry_id uuid
);
create index on clock_events (employee_id, at);

create table pay_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  status period_status not null default 'open',
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  exclude using gist (org_id with =, daterange(starts_on, ends_on, '[]') with &&)
);

create table payroll_exports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  pay_period_id uuid not null references pay_periods(id) on delete restrict,
  format text not null,
  checksum text not null,
  file_path text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  shift_id uuid references shifts(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,                                -- tom mens man er stemplet inn
  break_minutes int not null default 0 check (break_minutes >= 0),
  source entry_source not null,
  status entry_status not null default 'draft',
  comment text,
  warnings jsonb not null default '[]'::jsonb,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  payroll_export_id uuid references payroll_exports(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (status in ('draft') or ends_at is not null)
);
create index on time_entries (org_id, starts_at);
create index on time_entries (employee_id, starts_at);
-- bare én åpen stempling per ansatt
create unique index one_open_entry on time_entries (employee_id) where ends_at is null;

alter table clock_events
  add constraint clock_events_entry_fk foreign key (time_entry_id) references time_entries(id) on delete set null;

create table time_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  time_entry_id uuid references time_entries(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  work_date date not null,
  category time_category not null,
  code text,                         -- f.eks. 'overtime_50', 'evening', 'meal_money'
  hours numeric(7,2) not null default 0,
  amount numeric(10,2),              -- kronebeløp for tillegg per hendelse
  rule_version_id uuid references rule_versions(id),
  created_at timestamptz not null default now()
);
create index on time_lines (org_id, work_date);
create index on time_lines (employee_id, work_date);

-- ---------------------------------------------------------------------------
-- Fravær og helligdager
-- ---------------------------------------------------------------------------
create table absence_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  key text not null,
  name text not null,
  paid boolean not null default false,
  counts_as_work boolean not null default false,
  unit absence_unit not null default 'day',
  is_sick boolean not null default false,
  needs_approval boolean not null default true,
  unique (org_id, key)
);

create table absence_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  absence_type_id uuid not null references absence_types(id),
  from_date date not null,
  to_date date not null,
  partial_hours numeric(5,2),        -- satt når det gjelder deler av dag
  status request_status not null default 'pending',
  comment text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index on absence_requests (org_id, from_date);

create table leave_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  kind text not null check (kind in ('vacation', 'time_off')),   -- feriedager / avspasering i timer
  amount numeric(7,2) not null,
  source text not null,
  absence_request_id uuid references absence_requests(id) on delete set null,
  effective_date date not null,
  created_at timestamptz not null default now()
);
create index on leave_ledger (employee_id, kind);

create table holiday_rules (
  org_id uuid not null references organizations(id) on delete cascade,
  holiday_key text not null,          -- f.eks. 'langfredag', '17mai'
  is_open boolean not null default false,
  paid_fixed boolean not null default true,
  paid_hourly boolean not null default true,
  primary key (org_id, holiday_key)
);

-- ---------------------------------------------------------------------------
-- Varsler og logg
-- ---------------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);

create table audit_log (
  id bigint generated always as identity primary key,
  org_id uuid,
  table_name text not null,
  row_id uuid,
  action text not null,
  changed_by uuid,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index on audit_log (org_id, at desc);

create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (org_id, table_name, row_id, action, changed_by, before, after)
  values (
    coalesce(new.org_id, old.org_id),
    tg_table_name,
    coalesce(new.id, old.id),
    tg_op,
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_shifts after insert or update or delete on shifts for each row execute function audit_trigger();
create trigger audit_time_entries after insert or update or delete on time_entries for each row execute function audit_trigger();
create trigger audit_absence after insert or update or delete on absence_requests for each row execute function audit_trigger();
create trigger audit_terms after insert or update or delete on employment_terms for each row execute function audit_trigger();
create trigger audit_employees after insert or update or delete on employees for each row execute function audit_trigger();
create trigger audit_shift_requests after insert or update or delete on shift_requests for each row execute function audit_trigger();

-- Godkjente og låste timer kan ikke endres av ansatte. Låste timer kan bare åpnes av administrator.
create or replace function guard_time_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if old.status = 'locked' and not (is_admin(old.org_id) and new.status = 'approved'
       and new.starts_at = old.starts_at and new.ends_at = old.ends_at
       and new.break_minutes = old.break_minutes) then
    raise exception 'Timene er låst etter eksport. Åpne perioden først.';
  end if;
  if not is_admin(old.org_id) then
    if old.status in ('approved', 'locked') then
      raise exception 'Godkjente timer kan bare endres av administrator.';
    end if;
    if new.status in ('approved', 'locked') then
      raise exception 'Bare administrator kan godkjenne timer.';
    end if;
    if new.employee_id <> old.employee_id or new.org_id <> old.org_id then
      raise exception 'Ikke tillatt.';
    end if;
  end if;
  return new;
end $$;
create trigger guard_time_entries before update on time_entries for each row execute function guard_time_entry();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table platform_admins enable row level security;
alter table organizations enable row level security;
alter table memberships enable row level security;
alter table rule_sets enable row level security;
alter table rule_versions enable row level security;
alter table employees enable row level security;
alter table employment_terms enable row level security;
alter table work_roles enable row level security;
alter table employee_work_roles enable row level security;
alter table staffing_templates enable row level security;
alter table staffing_overrides enable row level security;
alter table shift_templates enable row level security;
alter table shifts enable row level security;
alter table shift_requests enable row level security;
alter table shift_swaps enable row level security;
alter table availability enable row level security;
alter table clock_events enable row level security;
alter table pay_periods enable row level security;
alter table payroll_exports enable row level security;
alter table time_entries enable row level security;
alter table time_lines enable row level security;
alter table absence_types enable row level security;
alter table absence_requests enable row level security;
alter table leave_ledger enable row level security;
alter table holiday_rules enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;

create policy "egen rad" on platform_admins for select using (user_id = (select auth.uid()));

create policy "medlem leser" on organizations for select using (is_member(id));
create policy "admin endrer" on organizations for update using (is_admin(id)) with check (is_admin(id));

create policy "les eget eller som admin" on memberships for select
  using (user_id = (select auth.uid()) or is_admin(org_id));
create policy "admin styrer" on memberships for all using (is_admin(org_id)) with check (is_admin(org_id));

-- Felles oppslagstabeller: alle medlemmer leser, admin skriver
do $$
declare t text;
begin
  foreach t in array array[
    'rule_sets', 'rule_versions', 'work_roles', 'employee_work_roles', 'staffing_templates',
    'staffing_overrides', 'shift_templates', 'absence_types', 'holiday_rules'
  ] loop
    execute format('create policy "medlem leser" on %I for select using (is_member(org_id))', t);
    execute format('create policy "admin skriver" on %I for all using (is_admin(org_id)) with check (is_admin(org_id))', t);
  end loop;
end $$;

-- Ansatte: admin ser alle, ansatt ser seg selv. Kolleger hentes via org_colleagues() uten kontaktinfo.
create policy "admin eller seg selv" on employees for select
  using (is_admin(org_id) or user_id = (select auth.uid()));
create policy "admin skriver" on employees for all using (is_admin(org_id)) with check (is_admin(org_id));

create policy "admin eller egen avtale" on employment_terms for select
  using (is_admin(org_id) or employee_id = my_employee_id(org_id));
create policy "admin skriver" on employment_terms for all using (is_admin(org_id)) with check (is_admin(org_id));

-- Vakter: alle medlemmer ser publiserte vakter, admin ser og endrer alt
create policy "publisert eller admin" on shifts for select
  using (is_admin(org_id) or (is_member(org_id) and status = 'published'));
create policy "admin skriver" on shifts for all using (is_admin(org_id)) with check (is_admin(org_id));

create policy "egne eller admin" on shift_requests for select
  using (is_admin(org_id) or employee_id = my_employee_id(org_id));
create policy "ansatt sender egne" on shift_requests for insert
  with check (employee_id = my_employee_id(org_id) and status = 'pending');
create policy "ansatt trekker egne" on shift_requests for update
  using (employee_id = my_employee_id(org_id) and status = 'pending')
  with check (status in ('pending', 'cancelled'));
create policy "admin styrer" on shift_requests for all using (is_admin(org_id)) with check (is_admin(org_id));

create policy "involvert eller admin" on shift_swaps for select
  using (is_admin(org_id) or from_employee_id = my_employee_id(org_id) or to_employee_id = my_employee_id(org_id));
create policy "ansatt foreslår bytte av egen vakt" on shift_swaps for insert
  with check (from_employee_id = my_employee_id(org_id) and status = 'pending');
create policy "admin styrer" on shift_swaps for all using (is_admin(org_id)) with check (is_admin(org_id));

create policy "egen eller admin" on availability for select
  using (is_admin(org_id) or employee_id = my_employee_id(org_id));
create policy "ansatt styrer egen" on availability for all
  using (employee_id = my_employee_id(org_id)) with check (employee_id = my_employee_id(org_id));

create policy "egne eller admin" on clock_events for select
  using (is_admin(org_id) or employee_id = my_employee_id(org_id));

create policy "egne eller admin" on time_entries for select
  using (is_admin(org_id) or employee_id = my_employee_id(org_id));
create policy "ansatt registrerer egne" on time_entries for insert
  with check (employee_id = my_employee_id(org_id) and status in ('draft', 'submitted') and source <> 'admin');
create policy "ansatt endrer egne ugodkjente" on time_entries for update
  using (employee_id = my_employee_id(org_id) and status in ('draft', 'submitted'))
  with check (employee_id = my_employee_id(org_id) and status in ('draft', 'submitted'));
create policy "ansatt sletter egne utkast" on time_entries for delete
  using (employee_id = my_employee_id(org_id) and status in ('draft', 'submitted'));
create policy "admin styrer" on time_entries for all using (is_admin(org_id)) with check (is_admin(org_id));

create policy "egne eller admin" on time_lines for select
  using (is_admin(org_id) or employee_id = my_employee_id(org_id));
create policy "admin styrer" on time_lines for all using (is_admin(org_id)) with check (is_admin(org_id));

create policy "admin" on pay_periods for all using (is_admin(org_id)) with check (is_admin(org_id));
create policy "admin" on payroll_exports for all using (is_admin(org_id)) with check (is_admin(org_id));

create policy "egne eller admin" on absence_requests for select
  using (is_admin(org_id) or employee_id = my_employee_id(org_id));
create policy "ansatt søker" on absence_requests for insert
  with check (employee_id = my_employee_id(org_id) and status = 'pending');
create policy "ansatt trekker egne" on absence_requests for update
  using (employee_id = my_employee_id(org_id) and status = 'pending')
  with check (status in ('pending', 'cancelled'));
create policy "admin styrer" on absence_requests for all using (is_admin(org_id)) with check (is_admin(org_id));

create policy "egne eller admin" on leave_ledger for select
  using (is_admin(org_id) or employee_id = my_employee_id(org_id));
create policy "admin styrer" on leave_ledger for all using (is_admin(org_id)) with check (is_admin(org_id));

create policy "egne" on notifications for select using (user_id = (select auth.uid()));
create policy "marker lest" on notifications for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "admin leser" on audit_log for select using (is_admin(org_id));

-- ---------------------------------------------------------------------------
-- Funksjoner appen kaller
-- ---------------------------------------------------------------------------

-- Kolleger: navn og arbeidsroller, ingen kontaktinfo
create or replace function org_colleagues(p_org uuid)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select e.id, e.full_name from employees e
  where e.org_id = p_org and is_member(p_org)
    and (e.end_date is null or e.end_date >= current_date)
  order by e.full_name;
$$;

-- Fravær i kalenderen: kolleger ser at noen er borte, men ikke hvorfor
create or replace function org_absences(p_org uuid, p_from date, p_to date)
returns table (employee_id uuid, from_date date, to_date date, type_name text)
language sql stable security definer set search_path = public as $$
  select a.employee_id, a.from_date, a.to_date,
         case when is_admin(p_org) or a.employee_id = my_employee_id(p_org) then t.name else 'Borte' end
  from absence_requests a join absence_types t on t.id = a.absence_type_id
  where a.org_id = p_org and is_member(p_org) and a.status = 'approved'
    and a.from_date <= p_to and a.to_date >= p_from;
$$;

-- Ny bedrift (bare plattformadmin i InnSpæll). Lager standard fraværstyper.
create or replace function create_organization(p_name text, p_org_number text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if not is_platform_admin() then
    raise exception 'Bare InnSpæll kan opprette nye bedrifter.';
  end if;
  insert into organizations (name, org_number) values (p_name, p_org_number) returning id into v_org;
  insert into memberships (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  insert into absence_types (org_id, key, name, paid, counts_as_work, unit, is_sick, needs_approval) values
    (v_org, 'ferie', 'Ferie', true, true, 'day', false, true),
    (v_org, 'avspasering', 'Avspasering', true, true, 'hour', false, true),
    (v_org, 'velferd', 'Velferdspermisjon', true, true, 'day', false, true),
    (v_org, 'permisjon', 'Ulønnet permisjon', false, false, 'day', false, true),
    (v_org, 'annet', 'Annen fri', false, false, 'day', false, true),
    (v_org, 'syk', 'Sykefravær', true, true, 'day', true, false),
    (v_org, 'sykt_barn', 'Sykt barn', true, true, 'day', true, false);
  return v_org;
end $$;

-- Kobler innlogget bruker til ansattkort med samme e-post. Kalles etter innlogging.
create or replace function claim_invites() returns int
language plpgsql security definer set search_path = public as $$
declare v_email text; v_count int := 0; r record;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_email = '' then return 0; end if;
  for r in
    select id, org_id from employees
    where user_id is null and lower(email) = v_email
      and (end_date is null or end_date >= current_date)
  loop
    update employees set user_id = auth.uid() where id = r.id;
    insert into memberships (org_id, user_id, role) values (r.org_id, auth.uid(), 'employee')
      on conflict do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Tildel en ledig vakt. Låser vakten, så bare én får den.
create or replace function approve_shift_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r shift_requests; s shifts; v_user uuid; v_new_shift uuid;
begin
  select * into r from shift_requests where id = p_request for update;
  if not found then raise exception 'Fant ikke forespørselen.'; end if;
  if r.status <> 'pending' then raise exception 'Forespørselen er allerede behandlet.'; end if;

  if r.kind = 'open_shift' then
    select * into s from shifts where id = r.shift_id for update;
    if not (is_admin(r.org_id) or (s.auto_approve and r.employee_id = my_employee_id(r.org_id))) then
      raise exception 'Ikke tillatt.';
    end if;
    if s.status <> 'published' then raise exception 'Vakten er ikke åpen.'; end if;
    if s.employee_id is not null then
      update shift_requests set status = 'rejected', decided_at = now(),
        comment = coalesce(comment, '') || ' (vakten var allerede tatt)' where id = r.id;
      return;
    end if;
    begin
      update shifts set employee_id = r.employee_id where id = s.id;
    exception when exclusion_violation then
      raise exception 'Den ansatte har allerede en vakt som overlapper.';
    end;
    update shift_requests set status = 'rejected', decided_at = now(), decided_by = auth.uid()
      where shift_id = s.id and status = 'pending' and id <> r.id;
  else
    if not is_admin(r.org_id) then raise exception 'Ikke tillatt.'; end if;
    begin
      insert into shifts (org_id, employee_id, work_role_id, starts_at, ends_at, status)
      values (r.org_id, r.employee_id, r.work_role_id, r.requested_start, r.requested_end, 'published')
      returning id into v_new_shift;
    exception when exclusion_violation then
      raise exception 'Den ansatte har allerede en vakt som overlapper.';
    end;
    update shift_requests set shift_id = v_new_shift where id = r.id;
  end if;

  update shift_requests set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = r.id;

  select user_id into v_user from employees where id = r.employee_id;
  if v_user is not null then
    insert into notifications (org_id, user_id, kind, title, link)
    values (r.org_id, v_user, 'shift_approved', 'Du har fått vakten', '/vaktplan');
  end if;
end $$;

-- Stempling. Lager og avslutter timeregistreringen i samme operasjon.
create or replace function clock(p_org uuid, p_kind clock_kind) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_entry time_entries; v_last clock_kind; v_break_start timestamptz; v_auto boolean;
begin
  v_emp := my_employee_id(p_org);
  if v_emp is null then raise exception 'Du er ikke registrert som ansatt her.'; end if;
  select * into v_entry from time_entries where employee_id = v_emp and ends_at is null for update;
  select kind, at into v_last, v_break_start from clock_events
    where time_entry_id = v_entry.id order by at desc limit 1;

  if p_kind = 'in' then
    if v_entry.id is not null then raise exception 'Du er allerede stemplet inn.'; end if;
    insert into time_entries (org_id, employee_id, starts_at, source, status)
    values (p_org, v_emp, date_trunc('minute', now()), 'clock', 'draft') returning * into v_entry;
  else
    if v_entry.id is null then raise exception 'Du er ikke stemplet inn.'; end if;
    if p_kind = 'break_start' and v_last = 'break_start' then raise exception 'Pausen er allerede startet.'; end if;
    if p_kind = 'break_end' and v_last is distinct from 'break_start' then raise exception 'Ingen pause å avslutte.'; end if;
    if p_kind in ('break_end', 'out') and v_last = 'break_start' then
      update time_entries
        set break_minutes = break_minutes + greatest(0, round(extract(epoch from now() - v_break_start) / 60))::int
        where id = v_entry.id;
    end if;
    if p_kind = 'out' then
      select auto_submit_clock_entries into v_auto from organizations where id = p_org;
      update time_entries set ends_at = greatest(date_trunc('minute', now()), starts_at + interval '1 minute'),
        status = case when v_auto then 'submitted'::entry_status else 'draft'::entry_status end
        where id = v_entry.id;
    end if;
  end if;

  insert into clock_events (org_id, employee_id, kind, time_entry_id) values (p_org, v_emp, p_kind, v_entry.id);
  return v_entry.id;
end $$;

-- Godkjenn timer (admin)
create or replace function approve_time_entries(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update time_entries set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = any(p_ids) and status in ('draft', 'submitted') and ends_at is not null and is_admin(org_id);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Funksjonene skal bare kunne kalles av innloggede brukere
revoke execute on all functions in schema public from anon, public;
grant execute on function is_member(uuid), is_admin(uuid), is_platform_admin(), my_employee_id(uuid),
  org_colleagues(uuid), org_absences(uuid, date, date), create_organization(text, text), claim_invites(),
  approve_shift_request(uuid), clock(uuid, clock_kind), approve_time_entries(uuid[]) to authenticated;
