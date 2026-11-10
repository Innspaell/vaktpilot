-- Admin setter en ansatt fraværende på en planlagt vakt.
-- Registrerer godkjent fravær for datoen og håndterer vakten:
--   'open'   = vakten blir ledig, så andre kan ta den
--   'cancel' = vakten fjernes
--   'keep'   = vakten står (f.eks. fravær bare deler av dagen)
create or replace function mark_absent(
  p_shift uuid, p_absence_type uuid, p_handle text default 'open',
  p_partial_hours numeric default null, p_comment text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare s shifts; v_tz text; v_date date; v_abs uuid; v_user uuid; v_type_name text;
begin
  select * into s from shifts where id = p_shift for update;
  if not found then raise exception 'Fant ikke vakten.'; end if;
  if not is_admin(s.org_id) then raise exception 'Ikke tillatt.'; end if;
  if s.employee_id is null then raise exception 'Vakten har ingen ansatt.'; end if;
  if p_handle not in ('open', 'cancel', 'keep') then raise exception 'Ugyldig valg.'; end if;
  select name into v_type_name from absence_types where id = p_absence_type and org_id = s.org_id;
  if v_type_name is null then raise exception 'Ukjent fraværstype.'; end if;
  if exists (select 1 from time_entries where shift_id = s.id) then
    raise exception 'Vakten har allerede registrerte timer. Rett timene i stedet.';
  end if;

  select timezone into v_tz from organizations where id = s.org_id;
  v_date := (s.starts_at at time zone v_tz)::date;

  -- Bruk eksisterende godkjent fravær den dagen om det finnes, ellers registrer nytt
  select id into v_abs from absence_requests
  where employee_id = s.employee_id and status = 'approved' and from_date <= v_date and to_date >= v_date
  limit 1;
  if v_abs is null then
    insert into absence_requests (org_id, employee_id, absence_type_id, from_date, to_date, partial_hours,
      status, comment, decided_by, decided_at, created_by_admin)
    values (s.org_id, s.employee_id, p_absence_type, v_date, v_date, p_partial_hours,
      'approved', p_comment, auth.uid(), now(), true)
    returning id into v_abs;
  end if;

  select user_id into v_user from employees where id = s.employee_id;

  if p_handle = 'open' then
    update shifts set employee_id = null where id = s.id;
  elsif p_handle = 'cancel' then
    if s.status = 'draft' then delete from shifts where id = s.id;
    else update shifts set status = 'cancelled' where id = s.id; end if;
  end if;

  if v_user is not null then
    insert into notifications (org_id, user_id, kind, title, link)
    values (s.org_id, v_user, 'absence_registered',
      'Leder har registrert ' || lower(v_type_name) || ' på deg ' || to_char(v_date, 'DD.MM'), '/foresporsler');
  end if;
  return v_abs;
end $$;

revoke execute on function mark_absent(uuid, uuid, text, numeric, text) from anon, public;
grant execute on function mark_absent(uuid, uuid, text, numeric, text) to authenticated;
