-- Fravær: søknad, godkjenning, sykefravær uten godkjenning, varsler og frigjøring av vakter.

-- Fraværstyper som ikke trenger godkjenning (sykefravær) blir godkjent med en gang.
create or replace function absence_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_needs boolean;
begin
  select needs_approval into v_needs from absence_types where id = new.absence_type_id and org_id = new.org_id;
  if v_needs is null then raise exception 'Ukjent fraværstype.'; end if;
  if not v_needs and new.status = 'pending' then
    new.status := 'approved';
    new.decided_at := now();
  end if;
  return new;
end $$;
drop trigger if exists absence_before_insert on absence_requests;
create trigger absence_before_insert before insert on absence_requests
  for each row execute function absence_before_insert();

-- Varsle administratorer om nye søknader og registrert sykefravær.
create or replace function absence_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.created_by_admin then return new; end if;
  select full_name into v_name from employees where id = new.employee_id;
  insert into notifications (org_id, user_id, kind, title, link)
  select new.org_id, m.user_id, 'absence_request',
    case when new.status = 'pending' then coalesce(v_name, 'En ansatt') || ' har søkt om fri'
         else coalesce(v_name, 'En ansatt') || ' har registrert fravær' end,
    '/foresporsler'
  from memberships m where m.org_id = new.org_id and m.role in ('owner', 'admin');
  return new;
end $$;

alter table absence_requests add column if not exists created_by_admin boolean not null default false;

drop trigger if exists absence_after_insert on absence_requests;
create trigger absence_after_insert after insert on absence_requests
  for each row execute function absence_after_insert();

-- Godkjenn eller avslå. Ved godkjenning kan vakter i perioden gjøres ledige.
create or replace function decide_absence(p_id uuid, p_approve boolean, p_release_shifts boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare a absence_requests; v_user uuid; v_tz text; v_released int := 0;
begin
  select * into a from absence_requests where id = p_id for update;
  if not found or not is_admin(a.org_id) then raise exception 'Ikke tillatt.'; end if;
  if a.status <> 'pending' then raise exception 'Søknaden er allerede behandlet.'; end if;

  update absence_requests set status = case when p_approve then 'approved'::request_status else 'rejected'::request_status end,
    decided_by = auth.uid(), decided_at = now() where id = a.id;

  if p_approve and p_release_shifts then
    select timezone into v_tz from organizations where id = a.org_id;
    update shifts set employee_id = null
    where employee_id = a.employee_id and status <> 'cancelled'
      and (starts_at at time zone v_tz)::date between a.from_date and a.to_date;
    get diagnostics v_released = row_count;
  end if;

  select user_id into v_user from employees where id = a.employee_id;
  if v_user is not null then
    insert into notifications (org_id, user_id, kind, title, link)
    values (a.org_id, v_user, 'absence_decided',
      case when p_approve then 'Fravær godkjent' else 'Søknad om fri ble ikke godkjent' end, '/foresporsler');
  end if;
  return v_released;
end $$;

revoke execute on function absence_before_insert(), absence_after_insert() from authenticated, anon, public;
revoke execute on function decide_absence(uuid, boolean, boolean) from anon, public;
grant execute on function decide_absence(uuid, boolean, boolean) to authenticated;

-- Ansatte kan registrere fravær som ikke trenger godkjenning (blir godkjent av triggeren over).
drop policy if exists "ansatt søker" on absence_requests;
create policy "ansatt søker" on absence_requests for insert
  with check (
    employee_id = my_employee_id(org_id) and created_by_admin = false and (
      status = 'pending'
      or (status = 'approved' and exists (
        select 1 from absence_types t where t.id = absence_type_id and t.org_id = absence_requests.org_id and not t.needs_approval))
    )
  );
