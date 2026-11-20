-- Betalt helligdag uten vakt: lederen markerer at en timelønnet skal ha lønn for en helligdag
-- (f.eks. 1. eller 17. mai når vedkommende ellers ville jobbet), uten at det blir en vakt i planen.
create table if not exists holiday_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  date date not null,
  hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (employee_id, date)
);
create index if not exists holiday_payments_org_date on holiday_payments (org_id, date);
alter table holiday_payments enable row level security;

drop policy if exists "egen eller leder leser" on holiday_payments;
create policy "egen eller leder leser" on holiday_payments for select using (
  employee_id = my_employee_id(org_id) or is_admin(org_id) or (is_manager(org_id) and manages_employee(org_id, employee_id)));
drop policy if exists "leder skriver" on holiday_payments;
create policy "leder skriver" on holiday_payments for all
  using (is_admin(org_id) or (is_manager(org_id) and manages_employee(org_id, employee_id)))
  with check ((is_admin(org_id) or (is_manager(org_id) and manages_employee(org_id, employee_id)))
    and exists (select 1 from employees e where e.id = employee_id and e.org_id = holiday_payments.org_id));
grant select, insert, update, delete on holiday_payments to authenticated;
