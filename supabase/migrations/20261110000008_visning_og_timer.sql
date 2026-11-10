-- Rekkefølge på arbeidsroller i visningen (f.eks. Ledelse øverst).
alter table work_roles add column if not exists sort_order int not null default 100;

-- Standard arbeidsdag: 7,5 timer betalt + 30 min pause.
alter table organizations
  add column if not exists default_day_minutes int not null default 450 check (default_day_minutes between 60 and 780),
  add column if not exists default_break_minutes int not null default 30 check (default_break_minutes between 0 and 120);

-- Én timeregistrering per vakt (bekreft arbeidsdag kan ikke gi dobbelt).
create unique index if not exists one_entry_per_shift on time_entries (shift_id) where shift_id is not null;

-- Administrator kan rette godkjente timer så lenge de ikke er låst etter eksport.
-- (guard_time_entry tillater allerede dette for admin.)

-- Admin kan også registrere timer for ansatte; ansatte kan registrere manuelt.
drop policy if exists "ansatt registrerer egne" on time_entries;
create policy "ansatt registrerer egne" on time_entries for insert
  with check (
    employee_id = my_employee_id(org_id) and (
      (source = 'manual' and status in ('draft', 'submitted') and ends_at is not null)
      or (source = 'clock' and status = 'draft')
    )
  );

-- Bekreft arbeidsdag: lager timeregistrering fra en egen vakt. Tider kan justeres.
create or replace function confirm_shift(p_shift uuid, p_start timestamptz default null, p_end timestamptz default null,
  p_break int default null, p_comment text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare s shifts; v_id uuid; v_tz text;
begin
  select * into s from shifts where id = p_shift;
  if not found then raise exception 'Fant ikke vakten.'; end if;
  if s.status <> 'published' and not is_admin(s.org_id) then raise exception 'Vakten er ikke publisert.'; end if;
  if s.employee_id is null then raise exception 'Vakten har ingen ansatt.'; end if;
  if s.employee_id is distinct from my_employee_id(s.org_id) and not is_admin(s.org_id) then
    raise exception 'Ikke tillatt.';
  end if;
  select timezone into v_tz from organizations where id = s.org_id;
  if (s.starts_at at time zone v_tz)::date > (now() at time zone v_tz)::date then
    raise exception 'Du kan bekrefte arbeidsdagen samme dag eller senere.';
  end if;
  if exists (select 1 from time_entries where shift_id = s.id) then
    raise exception 'Denne vakten er allerede registrert.';
  end if;
  insert into time_entries (org_id, employee_id, shift_id, starts_at, ends_at, break_minutes, source, status, comment)
  values (s.org_id, s.employee_id, s.id, coalesce(p_start, s.starts_at), coalesce(p_end, s.ends_at),
    coalesce(p_break, s.break_minutes), 'manual', 'submitted', p_comment)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function confirm_shift(uuid, timestamptz, timestamptz, int, text) from anon, public;
grant execute on function confirm_shift(uuid, timestamptz, timestamptz, int, text) to authenticated;

-- clear_shifts ligger i 20261110000009_fjern_vakter.sql
