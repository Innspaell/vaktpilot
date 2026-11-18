-- Personalliste (bokføringsforskriften § 8-5-6 / Skatteetaten)
-- Gjelder blant annet servering og catering, frisør og skjønnhetspleie, og bilverksted og bilpleie.
--
-- Listen bygges av stemplingene og timene som allerede finnes, og av endringsloggen (audit_log):
--  * hver registrering med inn- og utstempling,
--  * om timene er ført i etterkant i stedet for stemplet,
--  * alle rettelser og slettinger, med hvem og når.
-- Kode i stedet for fødselsnummer: ansattnummeret. Kodeoversikten (ansattnummer ↔ fødselsnummer) ligger i lønnssystemet.

alter table organizations
  add column if not exists personnel_list boolean not null default false,
  add column if not exists personnel_list_staff_view boolean not null default true;

comment on column organizations.personnel_list is 'Bedriften har plikt til å føre personalliste';
comment on column organizations.personnel_list_staff_view is 'Alle ansatte kan vise personallisten (for kontroll når leder ikke er til stede)';

-- Kan innlogget bruker se personallisten?
create or replace function can_view_personnel_list(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin(p_org)
      or (is_member(p_org) and exists (
            select 1 from organizations o
             where o.id = p_org and o.personnel_list and o.personnel_list_staff_view));
$$;
revoke execute on function can_view_personnel_list(uuid) from public, anon;
grant execute on function can_view_personnel_list(uuid) to authenticated;

-- Navn på den som gjorde en endring
create or replace function actor_name(p_org uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.full_name from employees e where e.org_id = p_org and e.user_id = p_user),
    (select u.email from auth.users u where u.id = p_user),
    case when p_user is null then 'systemet' else 'ukjent' end);
$$;
revoke execute on function actor_name(uuid, uuid) from public, anon, authenticated;

-- Personallisten for én dag (dato i bedriftens tidssone)
create or replace function personnel_list(p_org uuid, p_date date)
returns table (
  entry_id uuid,
  employee_id uuid,
  employee_number text,
  full_name text,
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
  select timezone into v_tz from organizations where id = p_org;

  return query
  with log as (
    select a.row_id, a.action, a.at, a.changed_by, a.before, a.after
      from audit_log a
     where a.org_id = p_org and a.table_name = 'time_entries'
  ),
  ids as (
    -- alle registreringer som på et tidspunkt har startet denne dagen
    select distinct l.row_id as id from log l
     where ((l.after ->> 'starts_at')::timestamptz at time zone v_tz)::date = p_date
        or ((l.before ->> 'starts_at')::timestamptz at time zone v_tz)::date = p_date
    union
    select t.id from time_entries t
     where t.org_id = p_org and (t.starts_at at time zone v_tz)::date = p_date
  ),
  cur as (
    select i.id,
           coalesce(to_jsonb(t), (select l.before from log l where l.row_id = i.id and l.action = 'DELETE' order by l.at desc limit 1)) as row,
           t.id is null as deleted
      from ids i left join time_entries t on t.id = i.id
  ),
  ins as (
    select distinct on (l.row_id) l.row_id, l.at, l.changed_by
      from log l where l.action = 'INSERT' order by l.row_id, l.at
  )
  select c.id,
         (c.row ->> 'employee_id')::uuid,
         e.employee_number,
         coalesce(e.full_name, 'Ukjent ansatt'),
         (c.row ->> 'starts_at')::timestamptz,
         (c.row ->> 'ends_at')::timestamptz,
         c.row ->> 'source',
         c.deleted,
         coalesce(ins.at, (c.row ->> 'created_at')::timestamptz),
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
            where l.row_id = c.id
              and (
                l.action = 'DELETE'
                or (l.action = 'UPDATE' and (
                      -- flyttet start
                      (l.before ->> 'starts_at') is distinct from (l.after ->> 'starts_at')
                      -- endret slutt som allerede var satt
                   or ((l.before ->> 'ends_at') is not null and (l.before ->> 'ends_at') is distinct from (l.after ->> 'ends_at'))
                      -- slutt satt av en annen enn den ansatte selv (f.eks. glemt å stemple ut)
                   or ((l.before ->> 'ends_at') is null and (l.after ->> 'ends_at') is not null
                       and l.changed_by is distinct from e.user_id)))
              )), '[]'::jsonb)
    from cur c
    left join employees e on e.id = (c.row ->> 'employee_id')::uuid
    left join ins on ins.row_id = c.id
   order by (c.row ->> 'starts_at')::timestamptz, coalesce(e.full_name, '');
end $$;
revoke execute on function personnel_list(uuid, date) from public, anon;
grant execute on function personnel_list(uuid, date) to authenticated;

-- Bedriftsopplysninger til toppen av listen (for dem som ikke kan lese organizations direkte)
create or replace function personnel_list_header(p_org uuid)
returns table (name text, org_number text, address text, postal_code text, city text, staff_view boolean, enabled boolean)
language sql stable security definer set search_path = public as $$
  select o.name, o.org_number, o.address, o.postal_code, o.city, o.personnel_list_staff_view, o.personnel_list
    from organizations o where o.id = p_org and can_view_personnel_list(p_org);
$$;
revoke execute on function personnel_list_header(uuid) from public, anon;
grant execute on function personnel_list_header(uuid) to authenticated;

-- Ansatte med registrert arbeidstid kan ikke slettes når bedriften fører personalliste
create or replace function guard_employee_delete_personnel_list() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from organizations o where o.id = old.org_id and o.personnel_list)
     and exists (select 1 from audit_log a where a.org_id = old.org_id and a.table_name = 'time_entries'
                   and (a.after ->> 'employee_id' = old.id::text or a.before ->> 'employee_id' = old.id::text)) then
    raise exception 'Ansatte med registrert arbeidstid kan ikke slettes når bedriften fører personalliste. Sett sluttdato i stedet.'
      using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke execute on function guard_employee_delete_personnel_list() from public, anon, authenticated;
create or replace trigger employees_personnel_list_guard before delete on employees
  for each row execute function guard_employee_delete_personnel_list();
