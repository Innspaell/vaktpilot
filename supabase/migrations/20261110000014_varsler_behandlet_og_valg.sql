-- 1) Varsler knyttes til saken de gjelder (ref_id), og merkes som lest av seg selv
--    når saken er løst et annet sted (godkjent, avslått, tatt, bekreftet, passert).
-- 2) Bedriften velger selv hvilke varsler som sendes (organizations.notification_prefs).

alter table notifications add column if not exists ref_id uuid;
create index if not exists notifications_ref_idx on notifications (ref_id) where read_at is null;
create index if not exists notifications_link_unread_idx on notifications (link) where read_at is null;

alter table organizations add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- Avslåtte varseltyper lagres ikke i det hele tatt.
create or replace function notifications_respect_prefs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from organizations o where o.id = new.org_id and (o.notification_prefs ->> new.kind) = 'false') then
    return null;
  end if;
  return new;
end $$;
revoke execute on function notifications_respect_prefs() from anon, public, authenticated;
drop trigger if exists notifications_respect_prefs on notifications;
create trigger notifications_respect_prefs before insert on notifications
  for each row execute function notifications_respect_prefs();

-- Hjelper: merk uleste varsler om en sak som lest, for alle mottakere.
create or replace function resolve_notifications(p_ref uuid, p_kinds text[]) returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where ref_id = p_ref and kind = any(p_kinds) and read_at is null;
$$;
revoke execute on function resolve_notifications(uuid, text[]) from anon, public, authenticated;

-- ---------------------------------------------------------------------------
-- Varsler som nå får ref_id
-- ---------------------------------------------------------------------------

create or replace function notify_admins_on_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    select new.org_id, m.user_id, 'shift_request', 'Ny vaktpåmelding venter', '/foresporsler', new.id
    from memberships m where m.org_id = new.org_id and m.role in ('owner', 'admin');
  end if;
  return new;
end $$;

create or replace function absence_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.created_by_admin then return new; end if;
  select full_name into v_name from employees where id = new.employee_id;
  insert into notifications (org_id, user_id, kind, title, link, ref_id)
  select new.org_id, m.user_id, 'absence_request',
    case when new.status = 'pending' then coalesce(v_name, 'En ansatt') || ' har søkt om fri'
         else coalesce(v_name, 'En ansatt') || ' har registrert fravær' end,
    '/foresporsler', new.id
  from memberships m where m.org_id = new.org_id and m.role in ('owner', 'admin');
  return new;
end $$;

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
      insert into notifications (org_id, user_id, kind, title, link, ref_id)
      values (s.org_id, v_to_user, 'swap_offer', coalesce(v_name, 'En kollega') || ' spør om du kan ta en vakt', '/foresporsler?vis=bytte', v_id);
    end if;
  else
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    select s.org_id, m.user_id, 'swap_request', coalesce(v_name, 'En ansatt') || ' vil gi bort en vakt', '/foresporsler?vis=bytte', v_id
    from memberships m where m.org_id = s.org_id and m.role in ('owner', 'admin');
  end if;
  return v_id;
end $$;

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
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    select w.org_id, m.user_id, 'swap_request', 'Vaktbytte venter på godkjenning', '/foresporsler?vis=bytte', w.id
    from memberships m where m.org_id = w.org_id and m.role in ('owner', 'admin');
  else
    update shift_swaps set status = 'rejected', decided_at = now() where id = w.id;
  end if;
  if v_from_user is not null then
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    values (w.org_id, v_from_user, 'swap_answer',
      coalesce(v_name, 'Kollegaen') || case when p_accept then ' kan ta vakten. Venter på leder.' else ' kan ikke ta vakten.' end,
      '/foresporsler?vis=bytte', w.id);
  end if;
end $$;

-- Ledige vakter: hver ny ledig vakt får ref_id = vakten
create or replace function notify_shift_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_when text;
  v_actor uuid := auth.uid();
  v_old_user uuid;
  v_new_user uuid;
begin
  select * into new from shifts where id = new.id;
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

  if v_new_user is not null and v_new_user = v_old_user and v_new_user is distinct from v_actor then
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    select new.org_id, v_new_user, 'shift_changed', 'Vakta di er endret: ' || v_when, '/vaktplan', new.id
    where not exists (select 1 from notifications where user_id = v_new_user and created_at = now());
  end if;

  if v_old_user is not null and v_old_user is distinct from v_new_user and v_old_user is distinct from v_actor then
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    select new.org_id, v_old_user, 'shift_changed', 'Du er tatt av vakta ' || to_char(old.starts_at at time zone coalesce(v_tz, 'Europe/Oslo'), 'DD.MM. "kl." HH24:MI'), '/vaktplan', new.id
    where not exists (select 1 from notifications where user_id = v_old_user and created_at = now());
  end if;

  if v_new_user is not null and v_new_user is distinct from v_old_user and v_new_user is distinct from v_actor then
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    select new.org_id, v_new_user, 'shift_assigned', 'Du har fått en vakt: ' || v_when, '/vaktplan', new.id
    where not exists (select 1 from notifications where user_id = v_new_user and created_at = now());
  end if;

  if new.employee_id is null and new.starts_at > now()
     and (tg_op = 'INSERT' or old.employee_id is not null) then
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    select new.org_id, e.user_id, 'open_shifts', 'Ledig vakt ' || v_when || ' – meld deg på', '/vaktplan', new.id
    from employees e
    where e.org_id = new.org_id and e.user_id is not null
      and e.user_id is distinct from v_actor and e.user_id is distinct from v_old_user
      and (e.end_date is null or e.end_date >= current_date)
      and not exists (select 1 from notifications n where n.user_id = e.user_id and n.created_at = now() and n.kind = 'open_shifts');
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Når saken løses
-- ---------------------------------------------------------------------------

-- Vaktpåmelding godkjent eller avslått
create or replace function resolve_on_shift_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'pending' then perform resolve_notifications(new.id, array['shift_request']); end if;
  return null;
end $$;
drop trigger if exists resolve_on_shift_request on shift_requests;
create trigger resolve_on_shift_request after update of status on shift_requests
  for each row when (old.status = 'pending') execute function resolve_on_shift_request();

-- Søknad om fri behandlet eller trukket
create or replace function resolve_on_absence() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform resolve_notifications(old.id, array['absence_request']);
  elsif new.status <> 'pending' then
    perform resolve_notifications(new.id, array['absence_request']);
  end if;
  return null;
end $$;
drop trigger if exists resolve_on_absence on absence_requests;
create trigger resolve_on_absence after update of status or delete on absence_requests
  for each row execute function resolve_on_absence();

-- Vaktbytte: kollega har svart, eller leder har avgjort / byttet er trukket
create or replace function resolve_on_swap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform resolve_notifications(old.id, array['swap_offer', 'swap_request', 'swap_answer']);
    return null;
  end if;
  if new.to_accepted or new.status <> 'pending' then
    perform resolve_notifications(new.id, array['swap_offer']);
  end if;
  if new.status <> 'pending' then
    perform resolve_notifications(new.id, array['swap_request', 'swap_answer']);
  end if;
  return null;
end $$;
drop trigger if exists resolve_on_swap on shift_swaps;
create trigger resolve_on_swap after update or delete on shift_swaps
  for each row execute function resolve_on_swap();

-- Ledig vakt er tatt, avlyst, slettet eller passert
create or replace function resolve_on_shift() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if tg_op = 'DELETE' then
    perform resolve_notifications(old.id, array['open_shifts', 'shift_changed', 'shift_assigned']);
    update notifications set read_at = now() where read_at is null
      and link in ('/vaktplan?vakt=' || old.id, '/timer?bekreft=' || old.id);
    v_org := old.org_id;
  else
    if new.employee_id is not null or new.status <> 'published' then
      perform resolve_notifications(new.id, array['open_shifts']);
    end if;
    if new.status = 'cancelled' then
      update notifications set read_at = now() where read_at is null
        and link in ('/vaktplan?vakt=' || new.id, '/timer?bekreft=' || new.id);
    end if;
    v_org := new.org_id;
  end if;
  -- Det samlede varselet «Det er ledige vakter» når ingen ledige vakter er igjen
  if not exists (select 1 from shifts where org_id = v_org and status = 'published' and employee_id is null and starts_at > now()) then
    update notifications set read_at = now()
    where org_id = v_org and kind = 'open_shifts' and ref_id is null and read_at is null;
  end if;
  return null;
end $$;
drop trigger if exists resolve_on_shift on shifts;
create trigger resolve_on_shift after update of employee_id, status or delete on shifts
  for each row execute function resolve_on_shift();

-- Arbeidsdagen er bekreftet eller stemplet
create or replace function resolve_on_time_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.shift_id is not null then
    update notifications set read_at = now()
    where read_at is null and kind = 'reminder_confirm' and link = '/timer?bekreft=' || new.shift_id;
  end if;
  return null;
end $$;
drop trigger if exists resolve_on_time_entry on time_entries;
create trigger resolve_on_time_entry after insert or update of shift_id on time_entries
  for each row execute function resolve_on_time_entry();

-- Rydding som ikke utløses av en endring: passerte vakter
create or replace function resolve_stale_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare n int; total int := 0;
begin
  -- ledige vakter som har startet
  update notifications nt set read_at = now()
  from shifts s where nt.read_at is null and nt.kind = 'open_shifts' and nt.ref_id = s.id and s.starts_at < now();
  get diagnostics n = row_count; total := total + n;
  -- «vakt i morgen» når vakta er over
  update notifications nt set read_at = now()
  from shifts s where nt.read_at is null and nt.kind = 'reminder_shift' and nt.link = '/vaktplan?vakt=' || s.id and s.ends_at < now();
  get diagnostics n = row_count; total := total + n;
  -- samlet «det er ledige vakter» når ingen gjenstår
  update notifications nt set read_at = now()
  where nt.read_at is null and nt.kind = 'open_shifts' and nt.ref_id is null
    and not exists (select 1 from shifts s where s.org_id = nt.org_id and s.status = 'published' and s.employee_id is null and s.starts_at > now());
  get diagnostics n = row_count; total := total + n;
  return total;
end $$;
revoke execute on function resolve_stale_notifications() from anon, public, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vaktpilot_rydd_varsler';
    perform cron.schedule('vaktpilot_rydd_varsler', '15 * * * *', 'select public.resolve_stale_notifications()');
  end if;
end $$;

-- Rydd det som allerede ligger ute
select resolve_stale_notifications();
update notifications n set read_at = now()
where n.read_at is null and n.kind = 'reminder_confirm'
  and exists (select 1 from time_entries t where n.link = '/timer?bekreft=' || t.shift_id);
