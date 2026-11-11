-- Ferie etter ferieloven: arbeidsdager per uke styrer omregningen fra lovens uker/virkedager,
-- femte ferieuke etter tariff, ekstra uke fra 60 år, og overføringsgrense på 2 uker (12 virkedager).

alter table employment_terms add column if not exists days_per_week numeric(3,1) not null default 5
  check (days_per_week between 1 and 6);
alter table employees add column if not exists birth_year int check (birth_year between 1900 and 2100);
alter table organizations add column if not exists vacation_fifth_week boolean not null default true;
alter table organizations add column if not exists vacation_fifth_week_transferable boolean not null default false;
alter table vacation_carryovers add column if not exists days_per_week numeric(3,1);

-- Overføringsgrense i den ansattes arbeidsdager: 2 uker, pluss avtalefestet ferie om tariffen tillater det.
create or replace function vacation_carryover_limit(p_employee uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select 2 * d + case when o.vacation_fifth_week and o.vacation_fifth_week_transferable then greatest(d - 1, 0) else 0 end
  from employees e
  join organizations o on o.id = e.org_id
  cross join lateral (select coalesce((select days_per_week from employment_terms t where t.employee_id = e.id and t.valid_to is null limit 1), 5) as d) x
  where e.id = p_employee;
$$;
revoke execute on function vacation_carryover_limit(uuid) from anon, public;
grant execute on function vacation_carryover_limit(uuid) to authenticated;

create or replace function propose_carryover(p_employee uuid, p_from_year int, p_days numeric, p_reason text default 'agreement',
  p_note text default null, p_signature text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e employees; v_self boolean; v_max numeric; v_used numeric; v_id uuid; v_signer text;
  c vacation_carryovers;
begin
  select * into e from employees where id = p_employee;
  if not found then raise exception 'Fant ikke den ansatte.'; end if;
  if not is_admin(e.org_id) then raise exception 'Bare leder kan lage avtale om overføring av ferie.'; end if;
  v_self := e.user_id = auth.uid();
  if p_reason not in ('agreement', 'sick', 'parental', 'employer') then raise exception 'Ukjent grunn.'; end if;
  if p_days is null or p_days <= 0 then raise exception 'Oppgi antall dager.'; end if;

  if p_reason = 'agreement' then
    if not valid_signature(p_signature) then raise exception 'Signer avtalen i signaturfeltet.'; end if;
    v_max := vacation_carryover_limit(e.id);
    select coalesce(sum(days), 0) into v_used from vacation_carryovers
      where employee_id = e.id and from_year = p_from_year and reason = 'agreement' and status in ('pending', 'signed');
    if v_used + p_days > v_max then
      raise exception 'Etter ferieloven kan inntil 2 uker (12 virkedager) overføres etter avtale. For denne ansatte er det % arbeidsdager fra %, og % er allerede avtalt eller foreslått.', v_max, p_from_year, v_used;
    end if;
  end if;

  select coalesce(nullif(ee.full_name, ''), u.email) into v_signer
  from auth.users u left join employees ee on ee.user_id = u.id and ee.org_id = e.org_id where u.id = auth.uid();

  -- Leder signerer for bedriften. Er lederen selv den ansatte, signerer vedkommende som ansatt,
  -- og en annen administrator signerer for bedriften (eller lederen selv, om vedkommende er eneste administrator).
  insert into vacation_carryovers (org_id, employee_id, from_year, days, days_per_week, reason, note, proposed_by,
    employee_accepted_at, employee_accepted_by, employee_signature,
    employer_accepted_at, employer_accepted_by, employer_name, employer_signature)
  values (e.org_id, e.id, p_from_year, p_days,
    coalesce((select days_per_week from employment_terms t where t.employee_id = e.id and t.valid_to is null limit 1), 5),
    p_reason, nullif(trim(p_note), ''), auth.uid(),
    case when v_self and p_reason = 'agreement' then now() end, case when v_self and p_reason = 'agreement' then auth.uid() end,
    case when v_self and p_reason = 'agreement' then p_signature end,
    case when not v_self or p_reason <> 'agreement' then now() end, case when not v_self or p_reason <> 'agreement' then auth.uid() end,
    case when not v_self or p_reason <> 'agreement' then v_signer end,
    case when not v_self and p_reason = 'agreement' then p_signature end)
  returning * into c;
  v_id := c.id;

  if p_reason <> 'agreement' then
    update vacation_carryovers set status = 'signed' where id = v_id returning * into c;
    perform carryover_book(c);
    if e.user_id is not null and e.user_id <> auth.uid() then
      insert into notifications (org_id, user_id, kind, title, link, ref_id)
      values (e.org_id, e.user_id, 'vacation_carryover', p_days || ' feriedager er overført fra ' || p_from_year || ' til ' || (p_from_year + 1), '/ferie/overforing/' || v_id, v_id);
    end if;
    return v_id;
  end if;

  if v_self then
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    select e.org_id, m.user_id, 'vacation_carryover', e.full_name || ' vil overføre ' || p_days || ' feriedager til ' || (p_from_year + 1) || ' – signer for bedriften', '/ferie/overforing/' || v_id, v_id
    from memberships m where m.org_id = e.org_id and m.role in ('owner', 'admin') and m.user_id <> auth.uid();
  elsif e.user_id is not null then
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    values (e.org_id, e.user_id, 'vacation_carryover', 'Avtale om å overføre ' || p_days || ' feriedager til ' || (p_from_year + 1) || ' venter på signaturen din', '/ferie/overforing/' || v_id, v_id);
  end if;
  return v_id;
end $$;
revoke execute on function propose_carryover(uuid, int, numeric, text, text, text) from anon, public;
grant execute on function propose_carryover(uuid, int, numeric, text, text, text) to authenticated;


alter table organizations drop column if exists vacation_carryover_max_days;
