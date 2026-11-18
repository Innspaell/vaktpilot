-- Kobling til Cateringflyt (InnSpæll) og retting av personallisten
--
-- * Ansatte kan stemple inn og ut fra Cateringflyt. Cateringflyts server kaller to funksjoner her med en hemmelig nøkkel
--   per bedrift. Nøkkelen lagres bare som sha256. Den ansatte finnes på e-post i bedriften.
-- * Lederen ser dagens arrangementer fra Cateringflyt når vaktene settes opp (adressen lagres her, data hentes fra Cateringflyt).
-- * Personallisten oppbevares i 3,5 år etter regnskapsårets slutt (bokføringsloven § 13).

-- ── Kobling per bedrift ──
create table if not exists org_integrations (
  org_id uuid primary key references organizations(id) on delete cascade,
  kind text not null default 'cateringflyt' check (kind in ('cateringflyt')),
  secret_hash text not null,
  partner_url text,
  partner_org text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table org_integrations enable row level security;
revoke all on org_integrations from anon, authenticated;

-- Ledere kan se om bedriften er koblet til Cateringflyt (men ikke nøkkelen)
create or replace function org_integration(p_org uuid)
returns table (kind text, partner_url text, partner_org text, enabled boolean)
language sql stable security definer set search_path = public as $$
  select i.kind, i.partner_url, i.partner_org, i.enabled from org_integrations i where i.org_id = p_org and is_member(p_org);
$$;
revoke execute on function org_integration(uuid) from public, anon;
grant execute on function org_integration(uuid) to authenticated;

-- InnSpæll kobler en bedrift (nøkkelen vises aldri igjen)
create or replace function platform_set_integration(p_org uuid, p_secret text, p_partner_url text, p_partner_org text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Bare InnSpæll kan koble bedrifter' using errcode = '42501'; end if;
  if length(coalesce(p_secret, '')) < 32 then raise exception 'Nøkkelen er for kort'; end if;
  insert into org_integrations (org_id, secret_hash, partner_url, partner_org)
  values (p_org, encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'), p_partner_url, p_partner_org)
  on conflict (org_id) do update set secret_hash = excluded.secret_hash, partner_url = excluded.partner_url,
    partner_org = excluded.partner_org, enabled = true;
end $$;
revoke execute on function platform_set_integration(uuid, text, text, text) from public, anon;
grant execute on function platform_set_integration(uuid, text, text, text) to authenticated;

-- ── Stempling for en bestemt ansatt (brukes av clock() og av koblingen) ──
create or replace function clock_as(p_org uuid, p_emp uuid, p_kind clock_kind, p_source text default 'mobile') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_entry time_entries; v_last clock_kind; v_break_start timestamptz; v_auto boolean;
begin
  if p_emp is null then raise exception 'Du er ikke registrert som ansatt her.'; end if;
  select * into v_entry from time_entries where employee_id = p_emp and ends_at is null for update;
  select kind, at into v_last, v_break_start from clock_events
    where time_entry_id = v_entry.id order by at desc limit 1;

  if p_kind = 'in' then
    if v_entry.id is not null then raise exception 'Du er allerede stemplet inn.'; end if;
    insert into time_entries (org_id, employee_id, starts_at, source, status)
    values (p_org, p_emp, date_trunc('minute', now()), 'clock', 'draft') returning * into v_entry;
  else
    if v_entry.id is null then raise exception 'Du er ikke stemplet inn.'; end if;
    if p_kind = 'break_start' and v_last = 'break_start' then raise exception 'Pausen er allerede startet.'; end if;
    if p_kind = 'break_end' and v_last is distinct from 'break_start' then raise exception 'Ingen pause å avslutte.'; end if;
    if p_kind in ('break_end', 'out') and v_last = 'break_start' then
      update time_entries
        set break_minutes = break_minutes + greatest(0, round(extract(epoch from now() - v_break_start) / 60))::int
        where id = v_entry.id;
    end if;
    if p_kind = 'out' then
      select auto_submit_clock_entries into v_auto from organizations where id = p_org;
      update time_entries set ends_at = greatest(date_trunc('minute', now()), starts_at + interval '1 minute'),
        status = case when v_auto then 'submitted'::entry_status else 'draft'::entry_status end
        where id = v_entry.id;
    end if;
  end if;

  insert into clock_events (org_id, employee_id, kind, time_entry_id, source) values (p_org, p_emp, p_kind, v_entry.id, p_source);
  return v_entry.id;
end $$;
revoke execute on function clock_as(uuid, uuid, clock_kind, text) from public, anon, authenticated;

create or replace function clock(p_org uuid, p_kind clock_kind) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return clock_as(p_org, my_employee_id(p_org), p_kind, 'mobile');
end $$;

-- ── Koblingen: sjekk nøkkel og finn den ansatte ──
create or replace function integration_employee(p_org uuid, p_secret text, p_email text)
returns employees language plpgsql stable security definer set search_path = public as $$
declare v employees;
begin
  if not exists (select 1 from org_integrations i
                  where i.org_id = p_org and i.enabled
                    and i.secret_hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex')) then
    raise exception 'Ugyldig kobling' using errcode = '42501';
  end if;
  select * into v from employees e
   where e.org_id = p_org and lower(e.email) = lower(trim(p_email))
     and (e.end_date is null or e.end_date >= (now() at time zone 'Europe/Oslo')::date);
  return v;
end $$;
revoke execute on function integration_employee(uuid, text, text) from public, anon, authenticated;

create or replace function integration_clock_state(p_org uuid, p_secret text, p_email text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v employees; v_open time_entries; v_last clock_kind; v_enabled boolean; v_tz text;
begin
  v := integration_employee(p_org, p_secret, p_email);
  if v.id is null then return jsonb_build_object('employee', false); end if;
  select clock_enabled, timezone into v_enabled, v_tz from organizations where id = p_org;
  select * into v_open from time_entries where employee_id = v.id and ends_at is null;
  if v_open.id is not null then
    select kind into v_last from clock_events where time_entry_id = v_open.id order by at desc limit 1;
  end if;
  return jsonb_build_object(
    'employee', true,
    'name', v.full_name,
    'clock_enabled', v_enabled,
    'state', case when v_open.id is null then 'out' when v_last = 'break_start' then 'on_break' else 'working' end,
    'since', case when v_open.id is not null then to_char(v_open.starts_at at time zone v_tz, 'HH24:MI') end);
end $$;
revoke execute on function integration_clock_state(uuid, text, text) from public;
grant execute on function integration_clock_state(uuid, text, text) to anon, authenticated;

create or replace function integration_clock(p_org uuid, p_secret text, p_email text, p_kind clock_kind)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v employees;
begin
  v := integration_employee(p_org, p_secret, p_email);
  if v.id is null then raise exception 'Du er ikke registrert som ansatt i vaktplanen. Spør lederen din.'; end if;
  -- endringsloggen skal vise den ansatte, ikke «systemet»
  if v.user_id is not null then
    perform set_config('request.jwt.claim.sub', v.user_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v.user_id, 'role', 'authenticated')::text, true);
  end if;
  perform clock_as(p_org, v.id, p_kind, 'cateringflyt');
  return integration_clock_state(p_org, p_secret, p_email);
end $$;
revoke execute on function integration_clock(uuid, text, text, clock_kind) from public;
grant execute on function integration_clock(uuid, text, text, clock_kind) to anon, authenticated;

-- ── Personallisten: utstempling er vanlig registrering, uansett hvor den kom fra ──
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
                      (l.before ->> 'starts_at') is distinct from (l.after ->> 'starts_at')
                   or ((l.before ->> 'ends_at') is not null and (l.before ->> 'ends_at') is distinct from (l.after ->> 'ends_at'))
                      -- slutt satt uten utstempling (f.eks. glemt å stemple ut og rettet av leder)
                   or ((l.before ->> 'ends_at') is null and (l.after ->> 'ends_at') is not null
                       and not exists (select 1 from clock_events ce where ce.time_entry_id = c.id and ce.kind = 'out'))))
              )), '[]'::jsonb)
    from cur c
    left join employees e on e.id = (c.row ->> 'employee_id')::uuid
    left join ins on ins.row_id = c.id
   order by (c.row ->> 'starts_at')::timestamptz, coalesce(e.full_name, '');
end $$;

-- ── Oppbevaring: personallisten i 3,5 år etter regnskapsårets slutt ──
-- En registrering fra år X oppbevares til 30. juni år X+4. Først da kan den ansatte slettes.
create or replace function guard_employee_delete_personnel_list() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from organizations o where o.id = old.org_id and o.personnel_list)
     and exists (select 1 from audit_log a
                  where a.org_id = old.org_id and a.table_name = 'time_entries'
                    and (a.after ->> 'employee_id' = old.id::text or a.before ->> 'employee_id' = old.id::text)
                    and date_trunc('year', coalesce((a.after ->> 'starts_at')::timestamptz, (a.before ->> 'starts_at')::timestamptz))
                        + interval '4 years 6 months' > now()) then
    raise exception 'Ansatte med registrert arbeidstid kan ikke slettes når bedriften fører personalliste. Personallisten oppbevares i 3,5 år etter regnskapsårets slutt. Sett sluttdato i stedet.'
      using errcode = 'P0001';
  end if;
  return old;
end $$;
