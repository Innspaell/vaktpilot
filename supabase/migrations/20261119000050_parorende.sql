-- Nærmeste pårørende: den ansatte legger inn selv (minst én), leder og administrator kan se.
create table if not exists emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  relation text check (relation is null or length(relation) <= 60),
  phone text not null check (length(trim(phone)) between 3 and 40),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists emergency_contacts_emp on emergency_contacts (employee_id);
create index if not exists emergency_contacts_org on emergency_contacts (org_id);
alter table emergency_contacts enable row level security;

create policy "egen, admin eller ansvarlig leder leser" on emergency_contacts for select using (
  employee_id = my_employee_id(org_id) or is_admin(org_id) or (is_manager(org_id) and manages_employee(org_id, employee_id)));
create policy "egen eller admin legger inn" on emergency_contacts for insert with check (
  (employee_id = my_employee_id(org_id) or is_admin(org_id))
  and exists (select 1 from employees e where e.id = employee_id and e.org_id = emergency_contacts.org_id));
create policy "egen eller admin endrer" on emergency_contacts for update
  using (employee_id = my_employee_id(org_id) or is_admin(org_id))
  with check (employee_id = my_employee_id(org_id) or is_admin(org_id));
create policy "egen eller admin sletter" on emergency_contacts for delete
  using (employee_id = my_employee_id(org_id) or is_admin(org_id));
grant select, insert, update, delete on emergency_contacts to authenticated;
