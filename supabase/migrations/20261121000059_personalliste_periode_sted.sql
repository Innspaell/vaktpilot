-- Personallisten: hele perioder, egen liste per arbeidssted, hvem som føres, og innleide/ulønnede.

-- Innleide og ulønnede (eier, familie) skal stå i personallisten, men ikke ha lønn eller avtalt tid
alter table employees add column if not exists worker_type text not null default 'employee';
alter table employees drop constraint if exists employees_worker_type_check;
alter table employees add constraint employees_worker_type_check check (worker_type in ('employee', 'hired', 'unpaid'));
-- Bedrifter med både virksomhet med og uten plikt: bare de som omfattes, føres i listen
alter table employees add column if not exists in_personnel_list boolean not null default true;

-- Avdeling som eget arbeidssted: egen personalliste med egen adresse
alter table departments add column if not exists is_worksite boolean not null default false;
alter table departments add column if not exists address text check (address is null or length(address) <= 200);

/**
 * Personallisten for en periode (høyst ett år), i datoorden, med arbeidssted per registrering.
 * Arbeidsstedet er avdelingen på vakten hvis den er et arbeidssted, ellers den ansattes (hoved)avdeling som er et arbeidssted.
 * p_site avgrenser til ett arbeidssted.
 */
create or replace function personnel_list_range(p_org uuid, p_from date, p_to date, p_site uuid default null)
returns table (
  work_date date,
  site_id uuid,
  site_name text,
  entry_id uuid,
  employee_id uuid,
  employee_number text,
  full_name text,
  worker_type text,
  starts_at timestamptz,
  ends_at timestamptz,
  source text,
  deleted boolean,
  registered_at timestamptz,
  registered_by text,
  changes jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_tz text;
begin
  if not can_view_personnel_list(p_org) then
    raise exception 'Ingen tilgang til personallisten' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Velg en periode på høyst ett år' using errcode = '22023';
  end if;
  select o.timezone into v_tz from organizations o where o.id = p_org;

  return query
  with log as (
    select a.row_id, a.action, a.at, a.changed_by, a.before, a.after
      from audit_log a
     where a.org_id = p_org and a.table_name = 'time_entries'
  ),
  ids as (
    select distinct l.row_id as id from log l
     where ((l.after ->> 'starts_at')::timestamptz at time zone v_tz)::date between p_from and p_to
        or ((l.before ->> 'starts_at')::timestamptz at time zone v_tz)::date between p_from and p_to
    union
    select t.id from time_entries t
     where t.org_id = p_org and (t.starts_at at time zone v_tz)::date between p_from and p_to
  ),
  cur as (
    select i.id,
           coalesce(to_jsonb(t), (select l.before from log l where l.row_id = i.id and l.action = 'DELETE' order by l.at desc limit 1)) as row,
           t.id is null as is_deleted
      from ids i left join time_entries t on t.id = i.id
  ),
  base as (
    select c.id, c.row, c.is_deleted,
           (c.row ->> 'employee_id')::uuid as emp,
           (c.row ->> 'starts_at')::timestamptz as st,
           nullif(c.row ->> 'shift_id', '')::uuid as sh
      from cur c
  ),
  sited as (
    select b.*, coalesce(
             (select d.id from shifts s join departments d on d.id = s.department_id and d.is_worksite where s.id = b.sh),
             (select d.id from employee_departments ed join departments d on d.id = ed.department_id and d.is_worksite
               where ed.employee_id = b.emp order by ed.is_home desc, d.sort_order, d.name limit 1)) as site
      from base b
  ),
  ins as (
    select distinct on (l.row_id) l.row_id, l.at, l.changed_by
      from log l where l.action = 'INSERT' order by l.row_id, l.at
  )
  select (b.st at time zone v_tz)::date,
         b.site,
         d.name,
         b.id,
         b.emp,
         e.employee_number,
         coalesce(e.full_name, 'Ukjent ansatt'),
         coalesce(e.worker_type, 'employee'),
         b.st,
         (b.row ->> 'ends_at')::timestamptz,
         b.row ->> 'source',
         b.is_deleted,
         coalesce(ins.at, (b.row ->> 'created_at')::timestamptz),
         actor_name(p_org, ins.changed_by),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'at', l.at,
                    'by', actor_name(p_org, l.changed_by),
                    'action', l.action,
                    'from_start', l.before ->> 'starts_at',
                    'from_end', l.before ->> 'ends_at',
                    'to_start', l.after ->> 'starts_at',
                    'to_end', l.after ->> 'ends_at') order by l.at)
             from log l
            where l.row_id = b.id
              and (
                l.action = 'DELETE'
                or (l.action = 'UPDATE' and (
                      (l.before ->> 'starts_at') is distinct from (l.after ->> 'starts_at')
                   or ((l.before ->> 'ends_at') is not null and (l.before ->> 'ends_at') is distinct from (l.after ->> 'ends_at'))
                   or ((l.before ->> 'ends_at') is null and (l.after ->> 'ends_at') is not null
                       and not exists (select 1 from clock_events ce where ce.time_entry_id = b.id and ce.kind = 'out'))))
              )), '[]'::jsonb)
    from sited b
    left join departments d on d.id = b.site
    left join employees e on e.id = b.emp
    left join ins on ins.row_id = b.id
   where coalesce(e.in_personnel_list, true)
     and (p_site is null or b.site = p_site)
   order by 1, d.name nulls first, b.st, coalesce(e.full_name, '');
end $$;
revoke execute on function personnel_list_range(uuid, date, date, uuid) from public, anon;
grant execute on function personnel_list_range(uuid, date, date, uuid) to authenticated;

-- Arbeidssteder til topptekst og valg (alle som kan se listen)
create or replace function personnel_list_sites(p_org uuid)
returns table (id uuid, name text, address text)
language sql stable security definer set search_path = public as $$
  select d.id, d.name, d.address from departments d
   where d.org_id = p_org and d.is_worksite and d.archived_at is null and can_view_personnel_list(p_org)
   order by d.sort_order, d.name;
$$;
revoke execute on function personnel_list_sites(uuid) from public, anon;
grant execute on function personnel_list_sites(uuid) to authenticated;
