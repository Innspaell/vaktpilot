-- Ledere og avdelinger.
-- Avdelinger er valgfrie. Uten avdelinger styrer en leder hele bedriften. Med avdelinger styrer lederen
-- avdelingene vedkommende har ansvar for, pluss ansatte og vakter som ikke hører til noen avdeling.
-- Alle ansatte ser fortsatt hele den publiserte vaktplanen.

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create index if not exists departments_org on departments (org_id);

-- Hvor den ansatte kan jobbe. is_home = hjemmeavdeling (brukes som standard på nye vakter).
create table if not exists employee_departments (
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  is_home boolean not null default false,
  primary key (employee_id, department_id)
);
create unique index if not exists employee_departments_one_home on employee_departments (employee_id) where is_home;
create index if not exists employee_departments_dept on employee_departments (department_id);

-- Avdelingene en leder har ansvar for
create table if not exists manager_departments (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  primary key (user_id, department_id)
);
create index if not exists manager_departments_org on manager_departments (org_id, user_id);

alter table shifts add column if not exists department_id uuid references departments(id) on delete set null;
alter table staffing_templates add column if not exists department_id uuid references departments(id) on delete cascade;
alter table staffing_overrides add column if not exists department_id uuid references departments(id) on delete cascade;
create index if not exists shifts_department on shifts (department_id) where department_id is not null;

-- ── Hvem styrer hva ──────────────────────────────────────────────────────────

create or replace function is_manager(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select mfa_ok() and exists (select 1 from memberships where org_id = p_org and user_id = auth.uid() and role = 'manager')
    and not exists (select 1 from organizations where id = p_org and blocked_at is not null);
$$;

create or replace function org_has_departments(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from departments where org_id = p_org and archived_at is null);
$$;

-- Kan planlegge og godkjenne (administrator eller leder)
create or replace function can_plan(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin(p_org) or is_manager(p_org);
$$;

-- Bemanningsbehov og annet som hører til en avdeling. Uten avdeling (gjelder hele bedriften) = administrator,
-- med mindre bedriften ikke har avdelinger.
create or replace function manages_department(p_org uuid, p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin(p_org) or (is_manager(p_org) and (
    not org_has_departments(p_org)
    or exists (select 1 from manager_departments md where md.user_id = auth.uid() and md.org_id = p_org and md.department_id = p_dept)));
$$;

-- En ansatt: lederen har ansvar for en av avdelingene vedkommende kan jobbe i, eller vedkommende har ingen avdeling
create or replace function manages_employee(p_org uuid, p_emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin(p_org) or (is_manager(p_org) and (
    not org_has_departments(p_org)
    or not exists (select 1 from employee_departments ed where ed.employee_id = p_emp)
    or exists (select 1 from employee_departments ed
               join manager_departments md on md.department_id = ed.department_id and md.user_id = auth.uid()
               where ed.employee_id = p_emp)));
$$;

-- En vakt: avdelingen avgjør; vakter uten avdeling følger den ansatte (ledige vakter uten avdeling: alle ledere)
create or replace function manages_shift(p_org uuid, p_dept uuid, p_emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin(p_org) or (is_manager(p_org) and (
    not org_has_departments(p_org)
    or (p_dept is not null and exists (select 1 from manager_departments md where md.user_id = auth.uid() and md.department_id = p_dept))
    or (p_dept is null and (p_emp is null or manages_employee(p_org, p_emp)))));
$$;

-- Hvem som skal varsles om en ansatt: lederne med ansvar for vedkommende, ellers eier og administratorer
create or replace function leaders_for(p_org uuid, p_emp uuid) returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  with mgr as (
    select m.user_id from memberships m
    where m.org_id = p_org and m.role = 'manager' and (
      not org_has_departments(p_org) or p_emp is null
      or not exists (select 1 from employee_departments ed where ed.employee_id = p_emp)
      or exists (select 1 from employee_departments ed join manager_departments md
                 on md.department_id = ed.department_id and md.user_id = m.user_id where ed.employee_id = p_emp))
  )
  select user_id from mgr
  union
  select m.user_id from memberships m where m.org_id = p_org and m.role in ('owner', 'admin') and not exists (select 1 from mgr);
$$;

revoke execute on function leaders_for(uuid, uuid) from anon, public, authenticated;
grant execute on function is_manager(uuid), can_plan(uuid), manages_department(uuid, uuid), manages_employee(uuid, uuid),
  manages_shift(uuid, uuid, uuid), org_has_departments(uuid) to authenticated;
revoke execute on function is_manager(uuid), can_plan(uuid), manages_department(uuid, uuid), manages_employee(uuid, uuid),
  manages_shift(uuid, uuid, uuid), org_has_departments(uuid) from anon, public;

-- ── Tilgangsregler ───────────────────────────────────────────────────────────

alter table departments enable row level security;
alter table employee_departments enable row level security;
alter table manager_departments enable row level security;

drop policy if exists "medlem leser" on departments;
create policy "medlem leser" on departments for select using (is_member(org_id));
drop policy if exists "admin skriver" on departments;
create policy "admin skriver" on departments for all using (is_admin(org_id)) with check (is_admin(org_id));

drop policy if exists "medlem leser" on employee_departments;
create policy "medlem leser" on employee_departments for select using (is_member(org_id));
-- Leder kan velge hvem som kan jobbe i sine avdelinger
drop policy if exists "leder styrer egne avdelinger" on employee_departments;
create policy "leder styrer egne avdelinger" on employee_departments for all
  using (manages_department(org_id, department_id)) with check (manages_department(org_id, department_id)
    and exists (select 1 from departments d where d.id = department_id and d.org_id = employee_departments.org_id)
    and exists (select 1 from employees e where e.id = employee_id and e.org_id = employee_departments.org_id));

drop policy if exists "egne eller admin" on manager_departments;
create policy "egne eller admin" on manager_departments for select using (user_id = auth.uid() or is_admin(org_id));
drop policy if exists "admin skriver" on manager_departments;
create policy "admin skriver" on manager_departments for all using (is_admin(org_id)) with check (is_admin(org_id)
  and exists (select 1 from departments d where d.id = department_id and d.org_id = manager_departments.org_id)
  and exists (select 1 from memberships m where m.user_id = manager_departments.user_id and m.org_id = manager_departments.org_id));

-- Leder: planlegger og godkjenner innenfor sitt ansvar (administrator har egne regler fra før)
drop policy if exists "leder skriver" on shifts;
create policy "leder skriver" on shifts for all
  using (is_manager(org_id) and manages_shift(org_id, department_id, employee_id))
  with check (is_manager(org_id) and manages_shift(org_id, department_id, employee_id));

drop policy if exists "leder leser" on employees;
create policy "leder leser" on employees for select using (is_manager(org_id));
drop policy if exists "leder leser" on employment_terms;
create policy "leder leser" on employment_terms for select using (is_manager(org_id) and manages_employee(org_id, employee_id));

drop policy if exists "leder styrer" on absence_requests;
create policy "leder styrer" on absence_requests for all
  using (is_manager(org_id) and manages_employee(org_id, employee_id)) with check (is_manager(org_id) and manages_employee(org_id, employee_id));
drop policy if exists "leder leser" on leave_ledger;
create policy "leder leser" on leave_ledger for select using (is_manager(org_id) and manages_employee(org_id, employee_id));
drop policy if exists "leder leser" on vacation_carryovers;
create policy "leder leser" on vacation_carryovers for select using (is_manager(org_id) and manages_employee(org_id, employee_id));

drop policy if exists "leder styrer" on time_entries;
create policy "leder styrer" on time_entries for all
  using (is_manager(org_id) and manages_employee(org_id, employee_id)) with check (is_manager(org_id) and manages_employee(org_id, employee_id));
drop policy if exists "leder leser" on time_lines;
create policy "leder leser" on time_lines for select using (is_manager(org_id) and manages_employee(org_id, employee_id));
drop policy if exists "leder leser" on clock_events;
create policy "leder leser" on clock_events for select using (is_manager(org_id) and manages_employee(org_id, employee_id));

drop policy if exists "leder styrer" on shift_requests;
create policy "leder styrer" on shift_requests for all
  using (is_manager(org_id) and manages_employee(org_id, employee_id)) with check (is_manager(org_id) and manages_employee(org_id, employee_id));
drop policy if exists "leder styrer" on shift_swaps;
create policy "leder styrer" on shift_swaps for all
  using (is_manager(org_id) and manages_employee(org_id, from_employee_id)) with check (is_manager(org_id) and manages_employee(org_id, from_employee_id));

drop policy if exists "leder leser" on availability;
create policy "leder leser" on availability for select using (is_manager(org_id));

drop policy if exists "leder skriver" on staffing_templates;
create policy "leder skriver" on staffing_templates for all
  using (is_manager(org_id) and manages_department(org_id, department_id)) with check (is_manager(org_id) and manages_department(org_id, department_id));
drop policy if exists "leder skriver" on staffing_overrides;
create policy "leder skriver" on staffing_overrides for all
  using (is_manager(org_id) and manages_department(org_id, department_id)) with check (is_manager(org_id) and manages_department(org_id, department_id));

drop policy if exists "leder leser" on pay_events;
create policy "leder leser" on pay_events for select using (is_manager(org_id) and manages_employee(org_id, employee_id));

-- ── Funksjoner som planlegger og godkjenner: leder innenfor sitt ansvar ──────

do $$
declare
  r record;
begin
  for r in select * from (values
    ('decide_absence(uuid,boolean,boolean)', 'not is_admin(a.org_id)', 'not manages_employee(a.org_id, a.employee_id)'),
    ('decide_swap(uuid,boolean)', 'not is_admin(w.org_id)', 'not manages_employee(w.org_id, w.from_employee_id)'),
    ('approve_time_entries(uuid[])', 'is_admin(org_id)', 'manages_employee(org_id, employee_id)'),
    ('approve_shift_request(uuid)', 'is_admin(r.org_id)', 'manages_employee(r.org_id, r.employee_id)'),
    ('reject_shift_request(uuid,text)', 'is_admin(r.org_id)', 'manages_employee(r.org_id, r.employee_id)'),
    ('confirm_shift(uuid,timestamptz,timestamptz,integer,text)', 'is_admin(s.org_id)', 'manages_shift(s.org_id, s.department_id, s.employee_id)'),
    ('org_absences(uuid,date,date)', 'is_admin(p_org)', 'manages_employee(p_org, a.employee_id)'),
    ('employees_login_status(uuid)', 'is_admin(p_org)', 'can_plan(p_org)'),
    ('publish_shifts(uuid,timestamptz,timestamptz)', 'if not is_admin(p_org) then', 'if not can_plan(p_org) then'),
    ('publish_shifts(uuid,timestamptz,timestamptz)', 'where org_id = p_org and status = ''draft'' and starts_at >= p_from and starts_at < p_to',
       'where org_id = p_org and status = ''draft'' and starts_at >= p_from and starts_at < p_to and manages_shift(org_id, department_id, employee_id)'),
    ('clear_shifts(uuid,date,date,uuid,boolean)', 'if not is_admin(p_org) then', 'if not can_plan(p_org) then'),
    ('clear_shifts(uuid,date,date,uuid,boolean)', 'where s.org_id = p_org and s.status = ''draft''',
       'where s.org_id = p_org and s.status = ''draft'' and manages_shift(s.org_id, s.department_id, s.employee_id)'),
    ('clear_shifts(uuid,date,date,uuid,boolean)', 'where s.org_id = p_org and s.status = ''published''',
       'where s.org_id = p_org and s.status = ''published'' and manages_shift(s.org_id, s.department_id, s.employee_id)'),
    ('mfa_required()', 'role in (''owner'', ''admin'')', 'role in (''owner'', ''admin'', ''manager'')'),
    -- Varsler går til lederen med ansvar for den ansatte
    ('absence_after_insert()', 'from memberships m where m.org_id = new.org_id and m.role in (''owner'', ''admin'')', 'from leaders_for(new.org_id, new.employee_id) m'),
    ('notify_admins_on_request()', 'from memberships m where m.org_id = new.org_id and m.role in (''owner'', ''admin'')', 'from leaders_for(new.org_id, new.employee_id) m'),
    ('propose_swap(uuid,uuid,text)', 'from memberships m where m.org_id = s.org_id and m.role in (''owner'', ''admin'')', 'from leaders_for(s.org_id, s.employee_id) m'),
    ('respond_swap(uuid,boolean)', 'from memberships m where m.org_id = w.org_id and m.role in (''owner'', ''admin'')', 'from leaders_for(w.org_id, w.from_employee_id) m')
  ) as x(fn, old_text, new_text) loop
    if position(r.old_text in pg_get_functiondef(r.fn::regprocedure)) = 0 then
      raise exception 'Fant ikke «%» i %', r.old_text, r.fn;
    end if;
    execute replace(pg_get_functiondef(r.fn::regprocedure), r.old_text, r.new_text);
  end loop;
end $$;

-- Timer: leder kan rette og godkjenne timer for sine ansatte (låste timer er fortsatt bare for administrator)
do $$
declare d text := pg_get_functiondef('guard_time_entry()'::regprocedure);
begin
  if position('if not is_admin(old.org_id) then' in d) = 0 then raise exception 'Fant ikke sjekken i guard_time_entry'; end if;
  execute replace(d, 'if not is_admin(old.org_id) then', 'if not manages_employee(old.org_id, old.employee_id) then');
end $$;
