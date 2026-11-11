-- Ferieoverføring: bare leder starter avtalen, grense 12 dager, og signatur tegnet med finger/mus.

alter table vacation_carryovers add column if not exists employee_signature text
  check (employee_signature is null or (employee_signature like 'data:image/png;base64,%' and length(employee_signature) < 300000));
alter table vacation_carryovers add column if not exists employer_signature text
  check (employer_signature is null or (employer_signature like 'data:image/png;base64,%' and length(employer_signature) < 300000));

alter table organizations alter column vacation_carryover_max_days set default 12;
update organizations set vacation_carryover_max_days = 12 where vacation_carryover_max_days = 10;

create or replace function valid_signature(p text) returns boolean
language sql immutable as $$
  select p is not null and p like 'data:image/png;base64,%' and length(p) between 200 and 300000;
$$;

drop function if exists propose_carryover(uuid, int, numeric, text, text);
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
    select vacation_carryover_max_days into v_max from organizations where id = e.org_id;
    select coalesce(sum(days), 0) into v_used from vacation_carryovers
      where employee_id = e.id and from_year = p_from_year and reason = 'agreement' and status in ('pending', 'signed');
    if v_used + p_days > v_max then
      raise exception 'Etter avtale kan inntil % dager overføres fra %. % er allerede avtalt eller foreslått.', v_max, p_from_year, v_used;
    end if;
  end if;

  select coalesce(nullif(ee.full_name, ''), u.email) into v_signer
  from auth.users u left join employees ee on ee.user_id = u.id and ee.org_id = e.org_id where u.id = auth.uid();

  -- Leder signerer for bedriften. Er lederen selv den ansatte, signerer vedkommende som ansatt,
  -- og en annen administrator signerer for bedriften (eller lederen selv, om vedkommende er eneste administrator).
  insert into vacation_carryovers (org_id, employee_id, from_year, days, reason, note, proposed_by,
    employee_accepted_at, employee_accepted_by, employee_signature,
    employer_accepted_at, employer_accepted_by, employer_name, employer_signature)
  values (e.org_id, e.id, p_from_year, p_days, p_reason, nullif(trim(p_note), ''), auth.uid(),
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

drop function if exists answer_carryover(uuid, boolean);
create or replace function answer_carryover(p_id uuid, p_accept boolean, p_signature text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c vacation_carryovers; e employees; v_admin boolean; v_self boolean; v_user uuid; v_signed boolean := false;
begin
  select * into c from vacation_carryovers where id = p_id for update;
  if not found or c.status <> 'pending' then raise exception 'Avtalen er ikke aktiv.'; end if;
  select * into e from employees where id = c.employee_id;
  v_admin := is_admin(c.org_id);
  v_self := e.user_id = auth.uid();
  if not v_admin and not v_self then raise exception 'Ikke tillatt.'; end if;

  if not p_accept then
    update vacation_carryovers set status = case when proposed_by = auth.uid() then 'cancelled' else 'rejected' end, rejected_at = now()
    where id = c.id;
    perform resolve_notifications(c.id, array['vacation_carryover']);
    v_user := case when v_self then null else e.user_id end;
    if v_user is not null then
      insert into notifications (org_id, user_id, kind, title, link, ref_id)
      values (c.org_id, v_user, 'vacation_carryover', 'Overføring av ferie til ' || (c.from_year + 1) || ' ble ikke avtalt', '/ferie/overforing/' || c.id, c.id);
    end if;
    if v_self and c.proposed_by <> auth.uid() then
      insert into notifications (org_id, user_id, kind, title, link, ref_id)
      values (c.org_id, c.proposed_by, 'vacation_carryover', e.full_name || ' avslo avtalen om å overføre ferie til ' || (c.from_year + 1), '/ferie/overforing/' || c.id, c.id);
    end if;
    return 'rejected';
  end if;

  if not valid_signature(p_signature) then raise exception 'Signer i signaturfeltet før du godtar.'; end if;

  if v_self and c.employee_accepted_at is null then
    update vacation_carryovers set employee_accepted_at = now(), employee_accepted_by = auth.uid(), employee_signature = p_signature where id = c.id;
    v_signed := true;
  elsif v_admin and c.employer_accepted_at is null and (not v_self or not exists (
      select 1 from memberships m where m.org_id = c.org_id and m.role in ('owner', 'admin') and m.user_id <> auth.uid())) then
    update vacation_carryovers set employer_accepted_at = now(), employer_accepted_by = auth.uid(), employer_signature = p_signature,
      employer_name = (select coalesce(nullif(ee.full_name, ''), u.email) from auth.users u left join employees ee on ee.user_id = u.id and ee.org_id = c.org_id where u.id = auth.uid())
    where id = c.id;
    v_signed := true;
  end if;
  if not v_signed then raise exception 'Du har allerede signert, eller avtalen venter på en annen.'; end if;

  select * into c from vacation_carryovers where id = c.id;
  if c.employee_accepted_at is not null and c.employer_accepted_at is not null then
    update vacation_carryovers set status = 'signed' where id = c.id returning * into c;
    perform carryover_book(c);
    perform resolve_notifications(c.id, array['vacation_carryover']);
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    select c.org_id, u, 'vacation_carryover', 'Avtalen er signert: ' || c.days || ' feriedager overføres til ' || (c.from_year + 1), '/ferie/overforing/' || c.id, c.id
    from unnest(array[e.user_id, c.proposed_by]) u where u is not null and u <> auth.uid()
    group by u;
    return 'signed';
  end if;
  return 'pending';
end $$;
revoke execute on function answer_carryover(uuid, boolean, text) from anon, public;
grant execute on function answer_carryover(uuid, boolean, text) to authenticated;
