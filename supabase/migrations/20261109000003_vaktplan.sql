-- Vaktplan: publisering med varsler, avslag, og plattformadmin via e-post.

-- Plattformadmin kan også angis med e-post før personen har logget inn første gang.
create table if not exists platform_admin_emails (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table platform_admin_emails enable row level security;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
      or exists (select 1 from platform_admin_emails where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- Publiser alle utkast i et tidsrom og varsle de ansatte som får vakter.
create or replace function publish_shifts(p_org uuid, p_from timestamptz, p_to timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not is_admin(p_org) then raise exception 'Ikke tillatt.'; end if;
  with pub as (
    update shifts set status = 'published'
    where org_id = p_org and status = 'draft' and starts_at >= p_from and starts_at < p_to
    returning employee_id
  ), counted as (
    select count(*) as n from pub
  ), notified as (
    insert into notifications (org_id, user_id, kind, title, link)
    select distinct p_org, e.user_id, 'schedule_published', 'Ny vaktplan er publisert', '/vaktplan'
    from pub join employees e on e.id = pub.employee_id
    where e.user_id is not null
    returning 1
  )
  select n into v_count from counted;
  -- varsle om ledige vakter
  if exists (select 1 from shifts where org_id = p_org and status = 'published' and employee_id is null
             and starts_at >= p_from and starts_at < p_to) then
    insert into notifications (org_id, user_id, kind, title, link)
    select p_org, e.user_id, 'open_shifts', 'Det er ledige vakter du kan melde deg på', '/vaktplan'
    from employees e
    where e.org_id = p_org and e.user_id is not null and (e.end_date is null or e.end_date >= current_date);
  end if;
  return v_count;
end $$;

-- Avslå en vaktforespørsel og varsle den ansatte.
create or replace function reject_shift_request(p_request uuid, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r shift_requests; v_user uuid;
begin
  select * into r from shift_requests where id = p_request for update;
  if not found or not is_admin(r.org_id) then raise exception 'Ikke tillatt.'; end if;
  if r.status <> 'pending' then raise exception 'Forespørselen er allerede behandlet.'; end if;
  update shift_requests set status = 'rejected', decided_at = now(), decided_by = auth.uid(),
    comment = coalesce(p_comment, comment) where id = r.id;
  select user_id into v_user from employees where id = r.employee_id;
  if v_user is not null then
    insert into notifications (org_id, user_id, kind, title, link)
    values (r.org_id, v_user, 'shift_rejected', 'Vaktpåmeldingen din ble ikke godkjent', '/foresporsler');
  end if;
end $$;

-- Ved godkjenning av forespørsel: varsle også administratorer når en ansatt melder seg (ikke auto).
create or replace function notify_admins_on_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    insert into notifications (org_id, user_id, kind, title, link)
    select new.org_id, m.user_id, 'shift_request', 'Ny vaktpåmelding venter', '/foresporsler'
    from memberships m where m.org_id = new.org_id and m.role in ('owner', 'admin');
  end if;
  return new;
end $$;
drop trigger if exists notify_admins_on_request on shift_requests;
create trigger notify_admins_on_request after insert on shift_requests
  for each row execute function notify_admins_on_request();

revoke execute on function notify_admins_on_request() from authenticated, anon, public;
revoke execute on function publish_shifts(uuid, timestamptz, timestamptz), reject_shift_request(uuid, text) from anon, public;
grant execute on function publish_shifts(uuid, timestamptz, timestamptz), reject_shift_request(uuid, text) to authenticated;
