-- Sykefravær må alltid godkjennes av lederen. Bedriften velger om ansatte kan melde sykdom i appen
-- (som en forespørsel lederen godkjenner), eller om det bare er lederen som registrerer.

alter table organizations add column if not exists sick_self_report boolean not null default true;

update absence_types set needs_approval = true where is_sick and not needs_approval;

-- Sykefravær kan ikke settes til «uten godkjenning», heller ikke for nye bedrifter
create or replace function absence_type_sick_needs_approval() returns trigger
language plpgsql as $$
begin
  if new.is_sick then new.needs_approval := true; end if;
  return new;
end $$;
drop trigger if exists absence_type_sick_needs_approval on absence_types;
create trigger absence_type_sick_needs_approval before insert or update on absence_types
  for each row execute function absence_type_sick_needs_approval();

create or replace function absence_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare t absence_types;
begin
  select * into t from absence_types where id = new.absence_type_id and org_id = new.org_id;
  if not found then raise exception 'Ukjent fraværstype.'; end if;
  if t.is_sick and not new.created_by_admin
     and not coalesce((select sick_self_report from organizations where id = new.org_id), true) then
    raise exception 'Sykefravær registreres av lederen.';
  end if;
  if not t.needs_approval and new.status = 'pending' then
    new.status := 'approved';
    new.decided_at := now();
  end if;
  return new;
end $$;

-- Lederne får beskjed med en gang, også på e-post, når noen melder seg syk
create or replace function absence_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; v_sick boolean;
begin
  if new.created_by_admin then return new; end if;
  select full_name into v_name from employees where id = new.employee_id;
  select is_sick into v_sick from absence_types where id = new.absence_type_id;
  insert into notifications (org_id, user_id, kind, title, body, link, ref_id, email_status)
  select new.org_id, m.user_id, case when v_sick then 'sick_report' else 'absence_request' end,
    case when v_sick then coalesce(v_name, 'En ansatt') || ' har meldt seg syk'
         when new.status = 'pending' then coalesce(v_name, 'En ansatt') || ' har søkt om fri'
         else coalesce(v_name, 'En ansatt') || ' har registrert fravær' end,
    case when v_sick then 'Fra ' || to_char(new.from_date, 'DD.MM.') ||
      case when new.to_date <> new.from_date then ' til ' || to_char(new.to_date, 'DD.MM.') else '' end
      || '. Godkjenn under Forespørsler, og gjør vaktene ledige hvis det trengs.' end,
    '/foresporsler', new.id,
    case when v_sick then 'pending' else null end
  from memberships m where m.org_id = new.org_id and m.role in ('owner', 'admin');
  return new;
end $$;
