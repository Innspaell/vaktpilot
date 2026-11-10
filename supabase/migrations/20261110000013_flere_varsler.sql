-- Varsler som manglet:
--   * en publisert vakt endres (tid, pause eller ansatt)
--   * en ny ledig vakt legges ut etter at planen er publisert
--   * timer blir godkjent
-- Triggeren kjøres ved slutten av transaksjonen, slik at varsler som funksjonene
-- selv lager (vaktbytte, godkjent påmelding, avlysning) kommer først og ikke dobles.

create or replace function notify_shift_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_when text;
  v_actor uuid := auth.uid();
  v_old_user uuid;
  v_new_user uuid;
begin
  -- raden kan være endret igjen i samme transaksjon; bruk siste versjon
  select * into new from shifts where id = new.id;
  -- ingen varsler for avlyste, upubliserte eller passerte vakter
  if not found or new.status <> 'published' or new.ends_at < now() then return null; end if;

  select timezone into v_tz from organizations where id = new.org_id;
  v_when := to_char(new.starts_at at time zone coalesce(v_tz, 'Europe/Oslo'), 'DD.MM. "kl." HH24:MI') || '–'
         || to_char(new.ends_at at time zone coalesce(v_tz, 'Europe/Oslo'), 'HH24:MI');

  if tg_op = 'UPDATE' then
    if old.status <> 'published' then return null; end if;
    if old.starts_at = new.starts_at and old.ends_at = new.ends_at and old.break_minutes = new.break_minutes
       and old.employee_id is not distinct from new.employee_id then
      return null;
    end if;
    select user_id into v_old_user from employees where id = old.employee_id;
  end if;
  select user_id into v_new_user from employees where id = new.employee_id;

  -- Samme ansatt, ny tid
  if v_new_user is not null and v_new_user = v_old_user and v_new_user is distinct from v_actor then
    insert into notifications (org_id, user_id, kind, title, link)
    select new.org_id, v_new_user, 'shift_changed', 'Vakta di er endret: ' || v_when, '/vaktplan'
    where not exists (select 1 from notifications where user_id = v_new_user and created_at = now());
  end if;

  -- Tatt av vakta
  if v_old_user is not null and v_old_user is distinct from v_new_user and v_old_user is distinct from v_actor then
    insert into notifications (org_id, user_id, kind, title, link)
    select new.org_id, v_old_user, 'shift_changed', 'Du er tatt av vakta ' || to_char(old.starts_at at time zone coalesce(v_tz, 'Europe/Oslo'), 'DD.MM. "kl." HH24:MI'), '/vaktplan'
    where not exists (select 1 from notifications where user_id = v_old_user and created_at = now());
  end if;

  -- Satt på vakta
  if v_new_user is not null and v_new_user is distinct from v_old_user and v_new_user is distinct from v_actor then
    insert into notifications (org_id, user_id, kind, title, link)
    select new.org_id, v_new_user, 'shift_assigned', 'Du har fått en vakt: ' || v_when, '/vaktplan'
    where not exists (select 1 from notifications where user_id = v_new_user and created_at = now());
  end if;

  -- Ny ledig vakt (opprettet ledig, eller gjort ledig)
  if new.employee_id is null and new.starts_at > now()
     and (tg_op = 'INSERT' or old.employee_id is not null) then
    insert into notifications (org_id, user_id, kind, title, link)
    select new.org_id, e.user_id, 'open_shifts', 'Ledig vakt ' || v_when || ' – meld deg på', '/vaktplan'
    from employees e
    where e.org_id = new.org_id and e.user_id is not null
      and e.user_id is distinct from v_actor and e.user_id is distinct from v_old_user
      and (e.end_date is null or e.end_date >= current_date)
      and not exists (select 1 from notifications n where n.user_id = e.user_id and n.created_at = now() and n.kind = 'open_shifts');
  end if;
  return null;
end $$;

revoke execute on function notify_shift_change() from anon, public, authenticated;

drop trigger if exists shifts_notify_change on shifts;
create constraint trigger shifts_notify_change
  after insert or update on shifts
  deferrable initially deferred
  for each row execute function notify_shift_change();

-- Godkjenning av timer varsler den ansatte (ett varsel per ansatt).
create or replace function approve_time_entries(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with done as (
    update time_entries set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = any(p_ids) and status in ('draft', 'submitted') and ends_at is not null and is_admin(org_id)
    returning org_id, employee_id
  ), per as (
    select org_id, employee_id, count(*) as n from done group by org_id, employee_id
  ), notified as (
    insert into notifications (org_id, user_id, kind, title, link)
    select per.org_id, e.user_id, 'time_approved',
      case when per.n = 1 then '1 timeregistrering er godkjent' else per.n || ' timeregistreringer er godkjent' end, '/timer'
    from per join employees e on e.id = per.employee_id
    where e.user_id is not null and e.user_id is distinct from auth.uid()
    returning 1
  )
  select coalesce(sum(n), 0) into v_count from per;
  return v_count;
end $$;

revoke execute on function approve_time_entries(uuid[]) from anon, public;
grant execute on function approve_time_entries(uuid[]) to authenticated;
