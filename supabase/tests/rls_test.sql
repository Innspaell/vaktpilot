-- Tester tilgangsregler og vaktlogikk. Kjøres etter stub + migrering.
-- Feiler med exception hvis noe er galt.
\set ON_ERROR_STOP on
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'plattform@test.no'),
  ('00000000-0000-0000-0000-0000000000a1', 'leder@a.no'),
  ('00000000-0000-0000-0000-0000000000a2', 'kari@a.no'),
  ('00000000-0000-0000-0000-0000000000a3', 'ola@a.no'),
  ('00000000-0000-0000-0000-0000000000b1', 'leder@b.no');
insert into platform_admins values ('00000000-0000-0000-0000-00000000000a');

create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FEIL: %', msg; end if; end $$;

create or replace function pg_temp.login(p uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'email', p_email)::text, false);
end $$;

-- Plattformadmin lager to bedrifter og gir eierskap videre
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
select create_organization('Æ e trønder AS') as org_a \gset
select create_organization('Bedrift B') as org_b \gset
insert into memberships values (:'org_a', '00000000-0000-0000-0000-0000000000a1', 'owner', now());
insert into memberships values (:'org_b', '00000000-0000-0000-0000-0000000000b1', 'owner', now());

-- Vanlig bruker kan ikke lage bedrift
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
do $$ begin
  perform create_organization('Snik');
  raise exception 'FEIL: vanlig bruker fikk lage bedrift';
exception when others then
  if sqlerrm like 'FEIL:%' then raise; end if;
end $$;

-- Leder i A legger inn ansatte
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into employees (org_id, full_name, email, phone) values
  (:'org_a', 'Kari Nordmann', 'kari@a.no', '99999999'),
  (:'org_a', 'Ola Nordmann', 'ola@a.no', '88888888');

-- Kari logger inn og kobles til ansattkortet
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
select claim_invites() as n \gset
select pg_temp.check(:n = 1, 'claim_invites');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select claim_invites();

-- Kari ser bare seg selv i employees, men kolleger via org_colleagues (uten telefon)
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
do $$ begin
  if (select count(*) from employees) <> 1 then raise exception 'FEIL: ansatt ser andre ansattkort'; end if;
end $$;
select count(*) as c from org_colleagues(:'org_a') \gset
select pg_temp.check(:c = 2, 'kolleger');

-- Leder i B ser ingenting fra A
select pg_temp.login('00000000-0000-0000-0000-0000000000b1', 'leder@b.no');
do $$ begin
  if (select count(*) from employees) <> 0 then raise exception 'FEIL: bedrift B ser ansatte i A'; end if;
  if (select count(*) from organizations) <> 1 then raise exception 'FEIL: bedrift B ser bedrift A'; end if;
end $$;
select count(*) as c from org_colleagues(:'org_a') \gset
select pg_temp.check(:c = 0, 'B ser kolleger i A');

-- Leder i A lager en ledig vakt med auto-godkjenning og et utkast
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into shifts (org_id, starts_at, ends_at, status, auto_approve)
  values (:'org_a', '2026-11-13 12:00+01', '2026-11-13 18:00+01', 'published', true) returning id as shift_open \gset
insert into shifts (org_id, starts_at, ends_at, status)
  values (:'org_a', '2026-11-14 12:00+01', '2026-11-14 18:00+01', 'draft');

-- Kari ser bare publiserte vakter
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
do $$ begin
  if (select count(*) from shifts) <> 1 then raise exception 'FEIL: ansatt ser upubliserte vakter'; end if;
end $$;
-- Kari kan ikke tildele seg vakten direkte
update shifts set employee_id = my_employee_id(org_id);
do $$ begin
  if exists (select 1 from shifts where employee_id is not null) then raise exception 'FEIL: ansatt endret vakt'; end if;
end $$;

-- Både Kari og Ola melder seg; Kari først
insert into shift_requests (org_id, employee_id, kind, shift_id)
  values (:'org_a', my_employee_id(:'org_a'), 'open_shift', :'shift_open') returning id as req_kari \gset
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
insert into shift_requests (org_id, employee_id, kind, shift_id)
  values (:'org_a', my_employee_id(:'org_a'), 'open_shift', :'shift_open') returning id as req_ola \gset

select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
select approve_shift_request(:'req_kari');
-- Olas forespørsel er nå avslått
reset role;
select pg_temp.check((select status from shift_requests where id = :'req_ola') = 'rejected', 'Ola ble ikke avslått');
select pg_temp.check((select e.full_name from shifts s join employees e on e.id = s.employee_id where s.id = :'shift_open') = 'Kari Nordmann', 'feil person fikk vakten');
set role authenticated;

-- Overlapp blir stoppet
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
do $$ begin
  insert into shifts (org_id, employee_id, starts_at, ends_at, status)
  select org_id, employee_id, '2026-11-13 17:00+01', '2026-11-13 20:00+01', 'published' from shifts where employee_id is not null;
  raise exception 'FEIL: overlappende vakt ble lagret';
exception when exclusion_violation then null;
end $$;

-- Stempling: inn, pause, ut. Timer sendes inn automatisk.
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
select clock(:'org_a', 'in') as entry \gset
select clock(:'org_a', 'break_start');
select clock(:'org_a', 'break_end');
select clock(:'org_a', 'out');
select pg_temp.check((select status from time_entries where id = :'entry') = 'submitted', 'stempling ble ikke sendt inn');
-- Kari kan endre før godkjenning
update time_entries set comment = 'Glemte å stemple ut' where id = :'entry';
-- Kari kan ikke godkjenne selv
do $$ begin
  update time_entries set status = 'approved' where status = 'submitted';
exception when others then null;
end $$;
select pg_temp.check((select count(*) from time_entries where status = 'approved') = 0, 'ansatt godkjente egne timer');
-- Ola ser ikke Karis timer
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
do $$ begin if (select count(*) from time_entries) <> 0 then raise exception 'FEIL: Ola ser Karis timer'; end if; end $$;

-- Leder godkjenner; deretter kan ikke Kari endre
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select approve_time_entries(array[:'entry']::uuid[]);
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
update time_entries set comment = 'endret etter godkjenning' where id = :'entry';
reset role;
select pg_temp.check((select comment from time_entries where id = :'entry') <> 'endret etter godkjenning', 'ansatt endret godkjente timer');
select pg_temp.check((select count(*) from audit_log where table_name = 'time_entries') >= 3, 'endringer ble ikke logget');
set role authenticated;

-- Sykefravær: kolleger ser «Borte», ikke typen
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into absence_requests (org_id, employee_id, absence_type_id, from_date, to_date, status)
select :'org_a', e.id, t.id, '2026-11-20', '2026-11-21', 'approved'
from employees e, absence_types t where e.full_name = 'Kari Nordmann' and t.org_id = :'org_a' and t.key = 'syk';
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
do $$ begin
  if (select type_name from org_absences((select id from organizations limit 1), '2026-11-01', '2026-11-30')) <> 'Borte' then
    raise exception 'FEIL: kollega ser fraværstype';
  end if;
end $$;

reset role;
select 'ALLE DATABASETESTER OK' as resultat;
