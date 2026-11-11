-- Feriesaldo per ferieår, startsaldo/justeringer per ansatt, og skriftlig avtale om overføring av ferie.

-- Kommentar på bevegelser i ferie- og avspaseringsregnskapet
alter table leave_ledger add column if not exists note text;

-- Hvor mange dager (telt mandag–fredag) som kan overføres etter avtale. 10 = 12 virkedager etter ferieloven.
alter table organizations add column if not exists vacation_carryover_max_days numeric(5,2) not null default 10;

-- Introduksjonen vises første gang
alter table employees add column if not exists intro_seen_at timestamptz;

create or replace function mark_intro_seen(p_org uuid) returns void
language sql security definer set search_path = public as $$
  update employees set intro_seen_at = now() where org_id = p_org and user_id = auth.uid() and intro_seen_at is null;
$$;
revoke execute on function mark_intro_seen(uuid) from anon, public;
grant execute on function mark_intro_seen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Overføring av ferie til neste ferieår
-- reason: agreement = skriftlig avtale (ferieloven § 7 (3), maks 12 virkedager)
--         sick / parental = ferie som ikke kunne tas pga. arbeidsuførhet / foreldrepermisjon (§ 9)
--         employer = ikke avviklet av forhold arbeidsgiver har ansvaret for (§ 7 (2))
-- ---------------------------------------------------------------------------
create table if not exists vacation_carryovers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  from_year int not null check (from_year between 2000 and 2100),
  days numeric(5,2) not null check (days > 0 and days <= 60),
  reason text not null check (reason in ('agreement', 'sick', 'parental', 'employer')),
  note text,
  status text not null default 'pending' check (status in ('pending', 'signed', 'rejected', 'cancelled')),
  doc_version text not null default '2026-11',
  proposed_by uuid references auth.users(id) on delete set null,
  employee_accepted_at timestamptz,
  employee_accepted_by uuid references auth.users(id) on delete set null,
  employer_accepted_at timestamptz,
  employer_accepted_by uuid references auth.users(id) on delete set null,
  employer_name text,
  rejected_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists vacation_carryovers_emp on vacation_carryovers (employee_id, from_year);
alter table vacation_carryovers enable row level security;
drop policy if exists "egne eller admin" on vacation_carryovers;
create policy "egne eller admin" on vacation_carryovers for select
  using (is_admin(org_id) or employee_id = my_employee_id(org_id));
-- Endringer går bare via funksjonene under.

-- Når begge har godtatt: trekk fra i år, legg til neste år.
create or replace function carryover_book(c vacation_carryovers) returns void
language plpgsql security definer set search_path = public as $$
declare v_start int; v_label text;
begin
  select vacation_year_start_month into v_start from organizations where id = c.org_id;
  v_label := case c.reason when 'agreement' then 'Overført etter avtale'
                           when 'sick' then 'Overført pga. sykdom'
                           when 'parental' then 'Overført pga. foreldrepermisjon'
                           else 'Overført, ikke avviklet' end;
  insert into leave_ledger (org_id, employee_id, kind, amount, source, effective_date, note)
  values
    (c.org_id, c.employee_id, 'vacation', -c.days, 'carryover_out', make_date(c.from_year, coalesce(v_start, 1), 1), v_label || ' til ' || (c.from_year + 1)),
    (c.org_id, c.employee_id, 'vacation', c.days, 'carryover_in', make_date(c.from_year + 1, coalesce(v_start, 1), 1), v_label || ' fra ' || c.from_year);
end $$;
revoke execute on function carryover_book(vacation_carryovers) from anon, public, authenticated;

create or replace function propose_carryover(p_employee uuid, p_from_year int, p_days numeric, p_reason text default 'agreement', p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e employees; v_admin boolean; v_self boolean; v_max numeric; v_used numeric; v_id uuid; v_name text; v_user uuid;
  c vacation_carryovers;
begin
  select * into e from employees where id = p_employee;
  if not found then raise exception 'Fant ikke den ansatte.'; end if;
  v_admin := is_admin(e.org_id);
  v_self := e.user_id = auth.uid();
  if not v_admin and not v_self then raise exception 'Ikke tillatt.'; end if;
  if p_reason not in ('agreement', 'sick', 'parental', 'employer') then raise exception 'Ukjent grunn.'; end if;
  if p_reason <> 'agreement' and not v_admin then raise exception 'Bare leder kan registrere overføring på grunn av sykdom, permisjon eller arbeidsgivers forhold.'; end if;
  if p_days is null or p_days <= 0 then raise exception 'Oppgi antall dager.'; end if;

  if p_reason = 'agreement' then
    select vacation_carryover_max_days into v_max from organizations where id = e.org_id;
    select coalesce(sum(days), 0) into v_used from vacation_carryovers
      where employee_id = e.id and from_year = p_from_year and reason = 'agreement' and status in ('pending', 'signed');
    if v_used + p_days > v_max then
      raise exception 'Etter avtale kan maks % dager overføres fra %. % er allerede avtalt eller foreslått.', v_max, p_from_year, v_used;
    end if;
  end if;

  insert into vacation_carryovers (org_id, employee_id, from_year, days, reason, note, proposed_by,
    employee_accepted_at, employee_accepted_by, employer_accepted_at, employer_accepted_by, employer_name)
  values (e.org_id, e.id, p_from_year, p_days, p_reason, nullif(trim(p_note), ''), auth.uid(),
    case when v_self then now() end, case when v_self then auth.uid() end,
    case when v_admin and not v_self then now() end, case when v_admin and not v_self then auth.uid() end,
    case when v_admin and not v_self then (select coalesce(nullif(ee.full_name, ''), u.email) from auth.users u left join employees ee on ee.user_id = u.id and ee.org_id = e.org_id where u.id = auth.uid()) end)
  returning * into c;
  v_id := c.id;

  -- Lovbestemt overføring (sykdom, permisjon, arbeidsgivers forhold) trenger ikke avtale
  if p_reason <> 'agreement' then
    update vacation_carryovers set status = 'signed' where id = v_id returning * into c;
    perform carryover_book(c);
    if e.user_id is not null and e.user_id <> auth.uid() then
      insert into notifications (org_id, user_id, kind, title, link, ref_id)
      values (e.org_id, e.user_id, 'vacation_carryover', p_days || ' feriedager er overført fra ' || p_from_year || ' til ' || (p_from_year + 1), '/ferie/overforing/' || v_id, v_id);
    end if;
    return v_id;
  end if;

  -- Varsle den andre parten
  if v_self then
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    select e.org_id, m.user_id, 'vacation_carryover', e.full_name || ' ber om å overføre ' || p_days || ' feriedager til ' || (p_from_year + 1), '/ferie/overforing/' || v_id, v_id
    from memberships m where m.org_id = e.org_id and m.role in ('owner', 'admin') and m.user_id <> auth.uid();
  elsif e.user_id is not null and not v_self then
    insert into notifications (org_id, user_id, kind, title, link, ref_id)
    values (e.org_id, e.user_id, 'vacation_carryover', 'Avtale om å overføre ' || p_days || ' feriedager til ' || (p_from_year + 1) || ' venter på deg', '/ferie/overforing/' || v_id, v_id);
  end if;
  return v_id;
end $$;
revoke execute on function propose_carryover(uuid, int, numeric, text, text) from anon, public;
grant execute on function propose_carryover(uuid, int, numeric, text, text) to authenticated;

create or replace function answer_carryover(p_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare c vacation_carryovers; e employees; v_admin boolean; v_self boolean; v_user uuid;
begin
  select * into c from vacation_carryovers where id = p_id for update;
  if not found or c.status <> 'pending' then raise exception 'Avtalen er ikke aktiv.'; end if;
  select * into e from employees where id = c.employee_id;
  v_admin := is_admin(c.org_id);
  v_self := e.user_id = auth.uid();
  if not v_admin and not v_self then raise exception 'Ikke tillatt.'; end if;

  if not p_accept then
    -- Den som foreslo kan trekke, den andre kan avslå
    update vacation_carryovers set status = case when proposed_by = auth.uid() then 'cancelled' else 'rejected' end, rejected_at = now()
    where id = c.id;
    perform resolve_notifications(c.id, array['vacation_carryover']);
    v_user := case when v_self then null else e.user_id end;
    if v_user is not null then
      insert into notifications (org_id, user_id, kind, title, link, ref_id)
      values (c.org_id, v_user, 'vacation_carryover', 'Overføring av ferie til ' || (c.from_year + 1) || ' ble ikke avtalt', '/ferie/overforing/' || c.id, c.id);
    end if;
    return 'rejected';
  end if;

  if v_self and c.employee_accepted_at is null then
    update vacation_carryovers set employee_accepted_at = now(), employee_accepted_by = auth.uid() where id = c.id;
  end if;
  -- Arbeidsgiver godtar. En leder kan ikke godta på vegne av bedriften for seg selv,
  -- med mindre vedkommende er eneste administrator.
  if v_admin and c.employer_accepted_at is null and (not v_self or not exists (
      select 1 from memberships m where m.org_id = c.org_id and m.role in ('owner', 'admin') and m.user_id <> auth.uid())) then
    update vacation_carryovers set employer_accepted_at = now(), employer_accepted_by = auth.uid(),
      employer_name = (select coalesce(nullif(ee.full_name, ''), u.email) from auth.users u left join employees ee on ee.user_id = u.id and ee.org_id = c.org_id where u.id = auth.uid())
    where id = c.id;
  end if;
  select * into c from vacation_carryovers where id = c.id;
  if c.employee_accepted_at is not null and c.employer_accepted_at is not null then
    update vacation_carryovers set status = 'signed' where id = c.id returning * into c;
    perform carryover_book(c);
    perform resolve_notifications(c.id, array['vacation_carryover']);
    if e.user_id is not null and e.user_id <> auth.uid() then
      insert into notifications (org_id, user_id, kind, title, link, ref_id)
      values (c.org_id, e.user_id, 'vacation_carryover', 'Avtalen er inngått: ' || c.days || ' feriedager overføres til ' || (c.from_year + 1), '/ferie/overforing/' || c.id, c.id);
    end if;
    return 'signed';
  end if;
  return 'pending';
end $$;
revoke execute on function answer_carryover(uuid, boolean) from anon, public;
grant execute on function answer_carryover(uuid, boolean) to authenticated;
