-- Kalenderlenken med valg: hvem du jobber med (og når), fri/ferie og ledige vakter.
create or replace function calendar_feed_v2(p_token uuid, p_colleagues boolean, p_absence boolean, p_open boolean)
returns table (uid text, kind text, title text, starts_at timestamptz, ends_at timestamptz,
               from_date date, to_date date, break_minutes int, updated timestamptz, org_name text, tz text, note text)
language sql stable security definer set search_path = public as $$
  with e as (
    select emp.id, emp.org_id, o.name as org_name, o.timezone
    from employees emp join organizations o on o.id = emp.org_id
    where emp.calendar_token = p_token and (emp.end_date is null or emp.end_date >= current_date) and o.active
  )
  select s.id::text, 'shift', coalesce(r.name, 'Vakt'), s.starts_at, s.ends_at, null::date, null::date, s.break_minutes,
         s.created_at, e.org_name, e.timezone,
         case when p_colleagues then (
           select 'Med ' || string_agg(split_part(c.full_name, ' ', 1) || ' '
                    || to_char(o.starts_at at time zone e.timezone, 'HH24:MI') || '–' || to_char(o.ends_at at time zone e.timezone, 'HH24:MI'),
                    ', ' order by o.starts_at)
           from shifts o join employees c on c.id = o.employee_id
           where o.org_id = e.org_id and o.status = 'published' and o.employee_id <> e.id
             and (o.starts_at at time zone e.timezone)::date = (s.starts_at at time zone e.timezone)::date
         ) end
  from e join shifts s on s.employee_id = e.id
  left join work_roles r on r.id = s.work_role_id
  where s.status = 'published' and s.starts_at > now() - interval '60 days' and s.starts_at < now() + interval '365 days'
  union all
  select a.id::text, 'absence', t.name, null, null, a.from_date, a.to_date, 0, a.created_at, e.org_name, e.timezone, null
  from e join absence_requests a on a.employee_id = e.id join absence_types t on t.id = a.absence_type_id
  where p_absence and a.status = 'approved' and a.to_date > current_date - 60
  union all
  select s.id::text, 'open', 'Ledig vakt' || coalesce(': ' || r.name, ''), s.starts_at, s.ends_at, null, null, s.break_minutes,
         s.created_at, e.org_name, e.timezone, 'Meld deg i Vaktpilot hvis du kan ta den'
  from e join shifts s on s.org_id = e.org_id and s.employee_id is null
  left join work_roles r on r.id = s.work_role_id
  where p_open and s.status = 'published' and s.starts_at > now() and s.starts_at < now() + interval '60 days';
$$;
grant execute on function calendar_feed_v2(uuid, boolean, boolean, boolean) to anon, authenticated;
