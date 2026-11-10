-- Fjern vakter i en periode. Utkast slettes. Publiserte vakter avlyses (historikken beholdes)
-- og de ansatte som mister vakter, får varsel. Vakter med registrerte timer røres ikke.
create or replace function clear_shifts(
  p_org uuid, p_from date, p_to date, p_employee uuid default null, p_include_published boolean default false
) returns table (deleted int, cancelled int)
language plpgsql security definer set search_path = public as $$
declare v_tz text; v_del int := 0; v_can int := 0;
begin
  if not is_admin(p_org) then raise exception 'Ikke tillatt.'; end if;
  select timezone into v_tz from organizations where id = p_org;

  delete from shifts s
  where s.org_id = p_org and s.status = 'draft'
    and (s.starts_at at time zone v_tz)::date between p_from and p_to
    and (p_employee is null or s.employee_id = p_employee)
    and not exists (select 1 from time_entries t where t.shift_id = s.id);
  get diagnostics v_del = row_count;

  if p_include_published then
    with c as (
      update shifts s set status = 'cancelled'
      where s.org_id = p_org and s.status = 'published'
        and (s.starts_at at time zone v_tz)::date between p_from and p_to
        and (p_employee is null or s.employee_id = p_employee)
        and not exists (select 1 from time_entries t where t.shift_id = s.id)
      returning s.employee_id
    ), n as (
      insert into notifications (org_id, user_id, kind, title, link)
      select distinct p_org, e.user_id, 'shifts_cancelled', 'Vakter i vaktplanen er endret', '/vaktplan'
      from c join employees e on e.id = c.employee_id where e.user_id is not null
      returning 1
    )
    select count(*) into v_can from c;
  end if;

  return query select v_del, v_can;
end $$;

revoke execute on function clear_shifts(uuid, date, date, uuid, boolean) from anon, public;
grant execute on function clear_shifts(uuid, date, date, uuid, boolean) to authenticated;
