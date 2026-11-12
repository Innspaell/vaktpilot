-- «Når kan jeg jobbe» slås på per bedrift, og per ansatt (f.eks. ekstrahjelp og tilkalling).
alter table organizations add column if not exists availability_enabled boolean not null default false;
alter table employees add column if not exists availability_enabled boolean not null default false;

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
      and not exists (select 1 from notifications n where n.user_id = e.user_id and n.created_at = now() and n.kind = 'open_shifts')
      -- Når bedriften bruker «Når kan jeg jobbe»: ikke varsle dem som har sagt de ikke kan den dagen
      and not (
        coalesce((select o.availability_enabled from organizations o where o.id = new.org_id), false)
        and e.availability_enabled
        and exists (
          select 1 from availability a
          where a.employee_id = e.id and a.kind = 'unavailable'
            and (a.date = (new.starts_at at time zone coalesce(v_tz, 'Europe/Oslo'))::date
                 or (a.date is null and a.weekday = extract(isodow from new.starts_at at time zone coalesce(v_tz, 'Europe/Oslo'))))
        )
      );
  end if;
  return null;
end $$;

