-- Gradert fravær (f.eks. 50 % sykmeldt) over hele dager. Tomt = 100 %.
alter table absence_requests add column if not exists percent smallint;
alter table absence_requests drop constraint if exists absence_percent_range;
alter table absence_requests add constraint absence_percent_range check (
  percent is null or (percent between 1 and 99 and from_time is null and partial_hours is null));

-- Fravær i planen: graden vises for lederen og den ansatte selv; kolleger ser «Delvis borte»
drop function if exists org_absences(uuid, date, date);
create function org_absences(p_org uuid, p_from date, p_to date)
returns table (employee_id uuid, from_date date, to_date date, type_name text, percent smallint)
language sql stable security definer set search_path = public as $$
  select a.employee_id, a.from_date, a.to_date,
         case when manages_employee(p_org, a.employee_id) or a.employee_id = my_employee_id(p_org)
              then t.name || case when a.percent is not null then ' ' || a.percent || ' %' else '' end
              else case when a.percent is not null then 'Delvis borte' else 'Borte' end end,
         case when manages_employee(p_org, a.employee_id) or a.employee_id = my_employee_id(p_org) then a.percent end
  from absence_requests a join absence_types t on t.id = a.absence_type_id
  where a.org_id = p_org and is_member(p_org) and a.status = 'approved'
    and a.from_date <= p_to and a.to_date >= p_from;
$$;
revoke execute on function org_absences(uuid, date, date) from anon, public;
grant execute on function org_absences(uuid, date, date) to authenticated;
