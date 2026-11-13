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
select create_organization('Æ e trønder AS', '123456789', 'Kirkegata 1', '7500', 'Stjørdal') as org_a \gset
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

-- Publisering varsler ansatte, og ledige vakter varsles
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into shifts (org_id, employee_id, starts_at, ends_at, status)
select :'org_a', id, '2026-11-16 08:00+01', '2026-11-16 16:00+01', 'draft' from employees where full_name = 'Ola Nordmann';
select publish_shifts(:'org_a', '2026-11-14 00:00+01', '2026-11-21 00:00+01') as published \gset
select pg_temp.check(:published = 2, 'publisering');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select pg_temp.check((select count(*) from notifications where kind = 'schedule_published') = 1, 'Ola fikk ikke varsel');
-- Ansatt kan ikke publisere
do $$ begin
  perform publish_shifts((select id from organizations limit 1), now() - interval '1 year', now() + interval '1 year');
  raise exception 'FEIL: ansatt publiserte';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
end $$;
-- Plattformadmin via e-post
reset role;
insert into platform_admin_emails values ('ny@innspaell.no');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000b1', 'ny@innspaell.no');
select pg_temp.check(is_platform_admin(), 'plattformadmin via e-post');

-- Fravær: ansatt søker ferie, sykefravær godkjennes automatisk, admin godkjenner og frigjør vakt
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
insert into absence_requests (org_id, employee_id, absence_type_id, from_date, to_date)
select :'org_a', my_employee_id(:'org_a'), id, '2026-11-16', '2026-11-17' from absence_types where org_id = :'org_a' and key = 'ferie'
returning id as ferie_ola \gset
insert into absence_requests (org_id, employee_id, absence_type_id, from_date, to_date)
select :'org_a', my_employee_id(:'org_a'), id, '2026-11-25', '2026-11-25' from absence_types where org_id = :'org_a' and key = 'syk';
select pg_temp.check((select status from absence_requests where id = :'ferie_ola') = 'pending', 'ferie skal vente');
select pg_temp.check((select count(*) from absence_requests a join absence_types t on t.id = a.absence_type_id where t.key = 'syk' and a.status = 'approved' and a.from_date = '2026-11-25') = 1, 'sykefravær ble ikke godkjent automatisk');
-- Ola kan ikke godkjenne selv
do $$ begin
  perform decide_absence((select id from absence_requests where status = 'pending' limit 1), true, false);
  raise exception 'FEIL: ansatt godkjente eget fravær';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select pg_temp.check((select count(*) from notifications where kind = 'absence_request') >= 2, 'leder fikk ikke varsel om fravær');
select decide_absence(:'ferie_ola', true, true) as released \gset
select pg_temp.check(:released = 1, 'vakten i ferien ble ikke ledig');

-- Fjerne vakter i en periode: ansatt kan ikke, admin sletter utkast og avlyser publiserte
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
do $$ begin
  perform clear_shifts((select id from organizations limit 1), '2026-01-01', '2026-12-31', null, true);
  raise exception 'FEIL: ansatt fjernet vakter';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into shifts (org_id, starts_at, ends_at, status) values (:'org_a', '2026-12-01 08:00+01', '2026-12-01 16:00+01', 'draft');
select pg_temp.check((select deleted from clear_shifts(:'org_a', '2026-12-01', '2026-12-01')) = 1, 'utkast ble ikke slettet');
-- Vakten med registrerte timer (Karis 13.11) skal ikke avlyses
select * from clear_shifts(:'org_a', '2026-11-01', '2026-11-30', null, true) \gset clr_
reset role;
select pg_temp.check((select status from shifts where id = :'shift_open') = 'published' or exists (select 1 from time_entries where shift_id = :'shift_open') = false, 'vakt med timer ble avlyst');
set role authenticated;

-- Bekreft arbeidsdag: Ola bekrefter egen vakt i dag, ikke dobbelt, ikke andres, ikke fram i tid
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into shifts (org_id, employee_id, starts_at, ends_at, break_minutes, status)
select :'org_a', id, date_trunc('day', now()) + interval '5 hours', date_trunc('day', now()) + interval '13 hours', 30, 'published'
from employees where full_name = 'Ola Nordmann' returning id as ola_today \gset
insert into shifts (org_id, employee_id, starts_at, ends_at, status)
select :'org_a', id, now() + interval '3 days', now() + interval '3 days 8 hours', 'published'
from employees where full_name = 'Ola Nordmann' returning id as ola_future \gset
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select confirm_shift(:'ola_today', null, null, null, 'Som planlagt') as confirmed \gset
select pg_temp.check((select break_minutes from time_entries where id = :'confirmed') = 30, 'bekreftet pause');
select pg_temp.check((select status from time_entries where id = :'confirmed') = 'submitted', 'bekreftet status');
do $$ begin
  perform confirm_shift((select shift_id from time_entries where comment = 'Som planlagt'), null, null, null, null);
  raise exception 'FEIL: samme vakt bekreftet to ganger';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
end $$;
select pg_temp.check((select count(*) from time_entries where shift_id = :'ola_future') = 0, 'forutsetning');
do $$ begin
  perform confirm_shift((select id from shifts where starts_at > now() + interval '2 days' limit 1), null, null, null, null);
  raise exception 'FEIL: framtidig vakt bekreftet';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
end $$;
-- Manuell registrering: Ola kan registrere og rette før godkjenning
insert into time_entries (org_id, employee_id, starts_at, ends_at, break_minutes, source, status)
values (:'org_a', my_employee_id(:'org_a'), now() - interval '2 days', now() - interval '2 days' + interval '4 hours', 0, 'manual', 'submitted')
returning id as manual_entry \gset
update time_entries set break_minutes = 15 where id = :'manual_entry';
select pg_temp.check((select break_minutes from time_entries where id = :'manual_entry') = 15, 'retting av egne timer');
-- Ola kan ikke registrere som admin-kilde
do $$ begin
  insert into time_entries (org_id, employee_id, starts_at, ends_at, source, status)
  values ((select id from organizations limit 1), my_employee_id((select id from organizations limit 1)), now() - interval '1 day', now() - interval '20 hours', 'admin', 'submitted');
  raise exception 'FEIL: ansatt brukte admin-kilde';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
end $$;

-- Sett fraværende fra planen: fravær registreres, vakten blir ledig, ansatt varsles; ansatt kan ikke
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into shifts (org_id, employee_id, starts_at, ends_at, status)
select :'org_a', id, '2026-12-02 08:00+01', '2026-12-02 16:00+01', 'published' from employees where full_name = 'Kari Nordmann'
returning id as kari_dec \gset
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
do $$ begin
  perform mark_absent((select id from shifts where starts_at = '2026-12-02 08:00+01'), (select id from absence_types where key = 'syk' limit 1), 'open', null, null);
  raise exception 'FEIL: ansatt satte kollega fraværende';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select mark_absent(:'kari_dec', (select id from absence_types where org_id = :'org_a' and key = 'syk'), 'open', null, 'Ringte inn syk') as abs_id \gset
reset role;
select pg_temp.check((select employee_id from shifts where id = :'kari_dec') is null, 'vakten ble ikke ledig');
select pg_temp.check((select status from absence_requests where id = :'abs_id') = 'approved', 'fravær ikke godkjent');
select pg_temp.check((select from_date from absence_requests where id = :'abs_id') = '2026-12-02', 'feil fraværsdato');
select pg_temp.check(exists (select 1 from notifications n join employees e on e.user_id = n.user_id where e.full_name = 'Kari Nordmann' and n.kind = 'absence_registered'), 'Kari ble ikke varslet');

-- Oppslagstavle: alle skriver eget, bare admin setter fokus, egne/admin sletter
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
insert into board_posts (org_id, author_user, author_name, body) values (:'org_a', '00000000-0000-0000-0000-0000000000a3', 'Ola', 'Hei alle') returning id as post_ola \gset
do $$ begin
  insert into board_posts (org_id, author_user, author_name, body, pinned)
  values ((select id from organizations limit 1), '00000000-0000-0000-0000-0000000000a3', 'Ola', 'Viktig!', true);
  raise exception 'FEIL: ansatt satte fokus';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
delete from board_posts where id = :'post_ola';
reset role;
select pg_temp.check(exists (select 1 from board_posts where id = :'post_ola'), 'Kari slettet Olas innlegg');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
update board_posts set pinned = true where id = :'post_ola';
select pg_temp.check((select pinned from board_posts where id = :'post_ola'), 'admin fikk ikke satt fokus');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1', 'leder@b.no');
select pg_temp.check((select count(*) from board_posts) = 0, 'bedrift B ser tavlen til A');

-- Vaktbytte: Kari tilbyr vakt til Ola, Ola sier ja, leder godkjenner
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into shifts (org_id, employee_id, starts_at, ends_at, status)
select :'org_a', id, now() + interval '20 days', now() + interval '20 days 8 hours', 'published' from employees where full_name = 'Kari Nordmann'
returning id as swap_shift \gset
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
select propose_swap(:'swap_shift', (select id from org_colleagues(:'org_a') where full_name = 'Ola Nordmann'), 'Bursdag') as swap_id \gset
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
do $$ begin
  perform decide_swap((select id from shift_swaps where status = 'pending' limit 1), true);
  raise exception 'FEIL: godkjent før kollega svarte';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select respond_swap(:'swap_id', true);
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select decide_swap(:'swap_id', true);
reset role;
select pg_temp.check((select e.full_name from shifts s join employees e on e.id = s.employee_id where s.id = :'swap_shift') = 'Ola Nordmann', 'vakten ble ikke byttet');

-- Kalenderlenke: riktig token gir egne vakter, feil gir ingenting, også uten innlogging
select calendar_token as ola_token from employees where full_name = 'Ola Nordmann' \gset
set role anon;
select pg_temp.check((select count(*) from calendar_feed(:'ola_token')) >= 1, 'kalender tom');
select pg_temp.check((select count(*) from calendar_feed(gen_random_uuid())) = 0, 'kalender med feil lenke');
reset role;

-- Plattformside: bare plattformadmin
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
do $$ begin perform platform_overview(); raise exception 'FEIL: bedriftsleder så plattformsiden';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
select pg_temp.check((select count(*) from platform_overview()) = 2, 'plattformoversikt');

-- Lønnsperiode: kan ikke låses med ugodkjente timer; låses etter godkjenning; kan åpnes igjen
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
do $$ begin
  perform lock_pay_period((select id from organizations where name like 'Æ%'), current_date - 30, current_date, 'csv', 'x');
  raise exception 'FEIL: låst med ugodkjente timer';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
end $$;
select approve_time_entries(array(select id from time_entries where org_id = :'org_a' and status = 'submitted'));
select lock_pay_period(:'org_a', current_date - 30, current_date, 'csv', 'abc') as export_id \gset
reset role;
select pg_temp.check((select count(*) from time_entries where payroll_export_id = :'export_id' and status = 'locked') >= 1, 'timer ble ikke låst');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select reopen_pay_period((select pay_period_id from payroll_exports where id = :'export_id'));
reset role;
select pg_temp.check((select count(*) from time_entries where payroll_export_id = :'export_id' and status = 'locked') = 0, 'periode ble ikke åpnet');

-- Varsler: tildelt, endret, gjort ledig, og godkjente timer
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into shifts (org_id, employee_id, starts_at, ends_at, status)
select :'org_a', id, now() + interval '30 days', now() + interval '30 days 6 hours', 'published' from employees where full_name = 'Ola Nordmann'
returning id as note_shift \gset
update shifts set ends_at = ends_at + interval '1 hour' where id = :'note_shift';
update shifts set employee_id = null where id = :'note_shift';
insert into time_entries (org_id, employee_id, starts_at, ends_at, break_minutes, status, source)
select :'org_a', id, now() - interval '50 days', now() - interval '50 days' + interval '4 hours', 0, 'submitted', 'manual' from employees where full_name = 'Ola Nordmann'
returning id as note_entry \gset
select pg_temp.check(approve_time_entries(array[:'note_entry']::uuid[]) = 1, 'godkjenning telte feil');
reset role;
select pg_temp.check((select count(*) from notifications n join employees e on e.user_id = n.user_id
  where e.full_name = 'Ola Nordmann' and n.kind = 'shift_assigned' and n.title like 'Du har fått en vakt: ' || to_char((now() + interval '30 days') at time zone 'Europe/Oslo', 'DD.MM.') || '%') = 1, 'Ola fikk ikke varsel om ny vakt');
select pg_temp.check(exists (select 1 from notifications n join employees e on e.user_id = n.user_id
  where e.full_name = 'Ola Nordmann' and n.kind = 'shift_changed' and n.title like 'Vakta di er endret%'), 'Ola fikk ikke varsel om endret vakt');
select pg_temp.check(exists (select 1 from notifications n join employees e on e.user_id = n.user_id
  where e.full_name = 'Ola Nordmann' and n.title like 'Du er tatt av vakta%'), 'Ola fikk ikke varsel om at han er tatt av');
select pg_temp.check(exists (select 1 from notifications n join employees e on e.user_id = n.user_id
  where e.full_name = 'Kari Nordmann' and n.kind = 'open_shifts' and n.title like 'Ledig vakt%'), 'Kari fikk ikke varsel om ledig vakt');
select pg_temp.check(not exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and kind in ('open_shifts', 'shift_changed') and created_at > now() - interval '1 minute'), 'lederen varslet seg selv');
select pg_temp.check(exists (select 1 from notifications n join employees e on e.user_id = n.user_id
  where e.full_name = 'Ola Nordmann' and n.kind = 'time_approved'), 'Ola fikk ikke varsel om godkjente timer');
-- Avspasering: leder kan registrere, ansatt ser bare egne
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into leave_ledger (org_id, employee_id, kind, amount, source, effective_date)
select :'org_a', id, 'time_off', 7.5, 'Overtid oktober', current_date from employees where full_name = 'Ola Nordmann';
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
select pg_temp.check((select count(*) from leave_ledger where kind = 'time_off') = 0, 'Kari ser Olas avspasering');
do $$ begin
  begin
    insert into leave_ledger (org_id, employee_id, kind, amount, source, effective_date)
    select org_id, id, 'time_off', 100, 'juks', current_date from employees limit 1;
    raise exception 'FEIL: ansatt kunne gi seg selv avspasering';
  exception when insufficient_privilege or check_violation then null;
    when others then if sqlerrm like 'FEIL:%' then raise; end if;
  end;
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select pg_temp.check((select sum(amount) from leave_ledger where kind = 'time_off') = 7.5, 'Ola ser ikke egen avspasering');
reset role;

-- Varsler merkes som lest når saken løses, og bedriften kan slå av varseltyper
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
-- ledig vakt -> Kari får varsel; når vakta blir tatt, er varselet lest
insert into shifts (org_id, employee_id, starts_at, ends_at, status)
values (:'org_a', null, now() + interval '40 days', now() + interval '40 days 5 hours', 'published')
returning id as open_shift \gset
reset role;
select pg_temp.check(exists (select 1 from notifications n join employees e on e.user_id = n.user_id
  where e.full_name = 'Kari Nordmann' and n.kind = 'open_shifts' and n.ref_id = :'open_shift' and n.read_at is null), 'Kari fikk ikke ledig vakt med ref');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
update shifts set employee_id = (select id from employees where full_name = 'Ola Nordmann') where id = :'open_shift';
reset role;
select pg_temp.check(not exists (select 1 from notifications where ref_id = :'open_shift' and kind = 'open_shifts' and read_at is null), 'ledig-vakt-varsel ble ikke lest når vakta ble tatt');
-- avslått varseltype lagres ikke
update organizations set notification_prefs = '{"shift_changed": false, "shift_assigned": false}' where id = :'org_a';
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
update shifts set ends_at = ends_at + interval '30 minutes' where id = :'open_shift';
reset role;
select pg_temp.check(not exists (select 1 from notifications where ref_id = :'open_shift' and kind = 'shift_changed'), 'avslått varseltype ble sendt likevel');
update organizations set notification_prefs = '{}' where id = :'org_a';
-- ansatt kan ikke endre varselvalg
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
update organizations set notification_prefs = '{"time_approved": false}' where id = :'org_a';
reset role;
select pg_temp.check((select notification_prefs from organizations where id = :'org_a') = '{}'::jsonb, 'ansatt endret varselvalg');
-- påminnelse om bekreftelse leses når timer registreres
insert into notifications (org_id, user_id, kind, title, link)
values (:'org_a', '00000000-0000-0000-0000-0000000000a3', 'reminder_confirm', 'Husk', '/timer?bekreft=' || :'open_shift');
insert into time_entries (org_id, employee_id, shift_id, starts_at, ends_at, break_minutes, status, source)
select :'org_a', id, :'open_shift', now() - interval '60 days', now() - interval '60 days' + interval '3 hours', 0, 'submitted', 'manual' from employees where full_name = 'Ola Nordmann';
select pg_temp.check(not exists (select 1 from notifications where link = '/timer?bekreft=' || :'open_shift' and read_at is null), 'påminnelse ble ikke lest etter bekreftelse');
select pg_temp.check(resolve_stale_notifications() >= 0, 'rydding feilet');

-- Ferieoverføring: bare leder lager avtalen, begge signerer; grense og tilgang
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
do $$ begin
  begin
    perform propose_carryover((select id from employees where full_name = 'Ola Nordmann'), 2026, 5, 'agreement', null, 'data:image/png;base64,' || repeat('A', 300));
    raise exception 'FEIL: ansatt kunne lage avtale';
  exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
  end;
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
do $$ begin
  begin
    perform propose_carryover((select id from employees where full_name = 'Ola Nordmann'), 2026, 5, 'agreement', null, null);
    raise exception 'FEIL: avtale uten signatur';
  exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
  end;
  begin
    perform propose_carryover((select id from employees where full_name = 'Ola Nordmann'), 2026, 11, 'agreement', null, 'data:image/png;base64,' || repeat('A', 300));
    raise exception 'FEIL: kunne overføre mer enn 2 uker';
  exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
  end;
end $$;
select propose_carryover((select id from employees where full_name = 'Ola Nordmann'), 2026, 6, 'agreement', 'Langtur', 'data:image/png;base64,' || repeat('A', 300)) as co_id \gset
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
select pg_temp.check((select count(*) from vacation_carryovers) = 0, 'Kari ser Olas ferieavtale');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
do $$ begin
  begin
    perform answer_carryover((select id from vacation_carryovers limit 1), true, null);
    raise exception 'FEIL: signerte uten signatur';
  exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
  end;
end $$;
select pg_temp.check(answer_carryover(:'co_id', true, 'data:image/png;base64,' || repeat('A', 300)) = 'signed', 'avtalen ble ikke inngått');
reset role;
select pg_temp.check((select sum(amount) from leave_ledger where source = 'carryover_in' and effective_date = '2027-01-01') = 6, 'overføring ble ikke lagt til 2027');
select pg_temp.check((select sum(amount) from leave_ledger where source = 'carryover_out' and effective_date = '2026-01-01') = -6, 'overføring ble ikke trukket fra 2026');
select pg_temp.check(not exists (select 1 from notifications where ref_id = :'co_id' and kind = 'vacation_carryover' and read_at is null
  and user_id = '00000000-0000-0000-0000-0000000000a3' and title like '%venter%'), 'varselet til Ola ble ikke lest');
select pg_temp.check(exists (select 1 from vacation_carryovers where id = :'co_id' and employee_signature is not null and employer_signature is not null and employer_name is not null), 'signaturer mangler');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select mark_intro_seen(:'org_a');
reset role;
select pg_temp.check((select intro_seen_at is not null from employees where full_name = 'Ola Nordmann'), 'intro ble ikke merket');

-- Leder gir innlogging: e-post påkrevd, midlertidig passord eller invitasjonslenke
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into employees (org_id, full_name, start_date) values (:'org_a', 'Uten Epost', current_date) returning id as noemail \gset
do $$ begin
  begin
    perform admin_set_login((select id from employees where full_name = 'Uten Epost'), 'uten.epost', 'hemmelig123');
    raise exception 'FEIL: godtok innlogging uten e-post';
  exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
  end;
  begin
    perform admin_set_login((select id from employees where full_name = 'Uten Epost'), 'ny@a.no', 'kort');
    raise exception 'FEIL: godtok for kort passord';
  exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
  end;
end $$;
select pg_temp.check(admin_set_login(:'noemail', 'Ny@A.no', 'hemmelig123') = 'ny@a.no', 'e-post ble ikke brukt');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
do $$ begin
  begin
    perform admin_set_login((select id from employees where full_name = 'Kari Nordmann'), 'kari2@a.no', 'hemmelig123');
    raise exception 'FEIL: ansatt kunne sette passord';
  exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
  end;
end $$;
reset role;
select pg_temp.check((select u.encrypted_password = extensions.crypt('hemmelig123', u.encrypted_password) and u.email_confirmed_at is not null
  from auth.users u join employees e on e.user_id = u.id where e.full_name = 'Uten Epost'), 'passord eller bekreftelse feil');
select pg_temp.check((select must_change_password and email = 'ny@a.no' from employees where full_name = 'Uten Epost'), 'bytt-passord-flagg eller e-post mangler');
-- Invitasjonslenke: ansatt lager passord selv
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into employees (org_id, full_name, start_date) values (:'org_a', 'Invitert Person', current_date) returning id as invemp \gset
select admin_create_invite(:'invemp', 'invitert@a.no') as invtoken \gset
reset role;
set role anon;
select pg_temp.check((select email from invite_info(:'invtoken')) = 'invitert@a.no', 'lenken viser ikke riktig person');
select pg_temp.check(accept_invite(:'invtoken', 'mittEgetPassord') = 'invitert@a.no', 'lenken virket ikke');
do $$ begin
  begin
    perform accept_invite(current_setting('vp.tok', true), 'annetPassord1');
    raise exception 'FEIL: lenken virket to ganger';
  exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
  end;
end $$;
select pg_temp.check(not exists (select 1 from invite_info(:'invtoken')), 'brukt lenke vises fortsatt');
reset role;
select pg_temp.check((select not must_change_password and user_id is not null from employees where full_name = 'Invitert Person'), 'invitert ble ikke koblet');
select pg_temp.check(not exists (select 1 from login_invites where token_hash = :'invtoken'), 'lenken er lagret i klartekst');
-- lederen selv er admin: kan ikke få passord satt av en annen
insert into employees (org_id, full_name, start_date, user_id) values (:'org_a', 'Annen Leder', current_date, '00000000-0000-0000-0000-0000000000a1') returning id as lederemp \gset
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
do $$ begin
  begin
    perform admin_set_login((select id from employees where full_name = 'Annen Leder'), 'sjefen', 'hemmelig123');
    raise exception 'FEIL: kunne sette passord på administrator';
  exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
  end;
end $$;
reset role;
delete from employees where full_name = 'Annen Leder';

-- «Når kan jeg jobbe»: den som har sagt «kan ikke» får ikke varsel om ledig vakt den dagen
update organizations set availability_enabled = true where id = :'org_a';
update employees set availability_enabled = true where full_name = 'Kari Nordmann';
insert into availability (org_id, employee_id, kind, date)
select :'org_a', id, 'unavailable', (now() + interval '50 days')::date from employees where full_name = 'Kari Nordmann';
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into shifts (org_id, employee_id, starts_at, ends_at, status)
values (:'org_a', null, ((now() + interval '50 days')::date + time '10:00') at time zone 'Europe/Oslo', ((now() + interval '50 days')::date + time '15:00') at time zone 'Europe/Oslo', 'published')
returning id as busy_shift \gset
reset role;
select pg_temp.check(not exists (select 1 from notifications n join employees e on e.user_id = n.user_id
  where e.full_name = 'Kari Nordmann' and n.ref_id = :'busy_shift'), 'Kari fikk varsel selv om hun ikke kan');
select pg_temp.check(exists (select 1 from notifications n join employees e on e.user_id = n.user_id
  where e.full_name = 'Ola Nordmann' and n.ref_id = :'busy_shift'), 'Ola fikk ikke varsel om ledig vakt');
update organizations set availability_enabled = false where id = :'org_a';

-- E-postvarsler: av som standard, slås på per type, den enkelte kan reservere seg
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
select set_my_email_notifications(:'org_a', false);
select pg_temp.login('00000000-0000-0000-0000-0000000000b1', 'leder@b.no');
do $$ begin
  perform set_email_prefs((select id from organizations where name = 'Æ e trønder AS'), '{"open_shifts": true}', 'x');
  raise exception 'FEIL: leder i annen bedrift kunne endre e-postvalg';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select pg_temp.check(set_email_prefs(:'org_a', '{"open_shifts": true}', 'Ledige vakter sendes nå på e-post.') > 0, 'ingen fikk beskjed om e-post');
select pg_temp.check(set_email_prefs(:'org_a', '{"open_shifts": true}', 'Ledige vakter sendes nå på e-post.') = 0, 'beskjed sendt på nytt uten endring');
insert into shifts (org_id, employee_id, starts_at, ends_at, status)
values (:'org_a', null, now() + interval '60 days', now() + interval '60 days 5 hours', 'published') returning id as mail_shift \gset
select pg_temp.check((select count(*) from employees_login_status(:'org_a')) > 0, 'leder ser ikke innloggingsstatus');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1', 'leder@b.no');
select pg_temp.check((select count(*) from employees_login_status(:'org_a')) = 0, 'annen bedrift ser innloggingsstatus');
reset role;
select pg_temp.check((select email_status from notifications n join employees e on e.user_id = n.user_id
  where e.full_name = 'Ola Nordmann' and n.ref_id = :'mail_shift') = 'pending', 'Olas varsel ble ikke lagt i e-postkø');
select pg_temp.check((select email_status from notifications n join employees e on e.user_id = n.user_id
  where e.full_name = 'Kari Nordmann' and n.ref_id = :'mail_shift') is null, 'Kari får e-post selv om hun har reservert seg');
select pg_temp.check(send_notification_emails() = 0, 'sendte uten nøkkel');
insert into vault.decrypted_secrets values ('resend_api_key', 're_test');
select pg_temp.check(send_notification_emails() = 0, 'sendte før ventetiden');
update notifications set created_at = created_at - interval '5 minutes' where email_status = 'pending';
select pg_temp.check(send_notification_emails() >= 1, 'sendte ingen e-post');
select pg_temp.check(exists (select 1 from net.test_requests r, jsonb_array_elements(r.body) m
  where m -> 'to' ->> 0 = 'ola@a.no' and m ->> 'html' like '%/varsler/%'), 'e-post til Ola mangler');
select pg_temp.check((select email_status from notifications n join employees e on e.user_id = n.user_id
  where e.full_name = 'Ola Nordmann' and n.ref_id = :'mail_shift') = 'sent', 'Olas varsel ikke merket sendt');
select pg_temp.check(send_notification_emails() = 0, 'sendte samme e-post to ganger');
update organizations set email_prefs = '{}' where id = :'org_a';

-- Stempling slått av: kan ikke stemple inn
update organizations set clock_enabled = false where id = :'org_a';
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
do $$ begin
  perform clock((select id from organizations where name = 'Æ e trønder AS'), 'in');
  raise exception 'FEIL: kunne stemple selv om stempling er av';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
reset role;
update organizations set clock_enabled = true where id = :'org_a';

-- Aktive ansatte per måned
select set_config('request.jwt.claims', '{}', false);
update platform_settings set per_employee_price = 49, base_price = 299 where id = 1;
update organizations set price_included = 1 where id = :'org_a';
select run_usage();
select pg_temp.check((select active_count from usage_months where org_id = :'org_a' and month = date_trunc('month', now() at time zone 'Europe/Oslo')::date) >= 1, 'aktive ansatte ble ikke telt');
select pg_temp.check((select amount from usage_months where org_id = :'org_a' and month = date_trunc('month', now() at time zone 'Europe/Oslo')::date)
  = 299 + greatest((select active_count from usage_months where org_id = :'org_a' and month = date_trunc('month', now() at time zone 'Europe/Oslo')::date) - 1, 0) * 49, 'feil beløp');
select pg_temp.check((select final from usage_months where org_id = :'org_a' and month = (date_trunc('month', now() at time zone 'Europe/Oslo') - interval '1 month')::date), 'forrige måned ble ikke låst');
select run_usage();
select pg_temp.check((select count(*) from notifications where org_id = :'org_a' and kind = 'plan_over') = (select count(*) from memberships where org_id = :'org_a' and role in ('owner','admin')), 'varsel om over grensen ikke sendt nøyaktig én gang');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select pg_temp.check(not exists (select 1 from usage_months), 'ansatt ser abonnementstall');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1', 'leder@b.no');
select pg_temp.check(not exists (select 1 from usage_months where org_id = :'org_a'), 'annen bedrift ser abonnementstall');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
do $$ begin
  update organizations set price_base = 0 where name = 'Æ e trønder AS';
  raise exception 'FEIL: leder kunne endre egen pris';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
reset role;
select set_config('request.jwt.claims', '{}', false);
update organizations set price_included = null where id = :'org_a';

-- Lønnsregler: leder velger, andre kan ikke
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
do $$ begin
  perform set_org_pay_rules((select id from organizations where name = 'Æ e trønder AS'), (select id from pay_rule_sets where key = 'bilutleie'), date '2026-01-01');
  raise exception 'FEIL: tariff valgt uten bekreftelse';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select set_org_pay_rules(:'org_a', (select id from pay_rule_sets where key = 'bilutleie'), date '2026-01-01', true);
select pg_temp.check((select count(*) from org_pay_rules where org_id = :'org_a') = 1, 'regelvalg ikke lagret');
select pg_temp.check((select count(*) from pay_rule_versions) >= 2, 'regelsett ikke synlige');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1', 'leder@b.no');
do $$ begin
  perform set_org_pay_rules((select id from organizations where name = 'Æ e trønder AS'), (select id from pay_rule_sets where key = 'aml'), date '2026-01-01');
  raise exception 'FEIL: annen bedrift kunne velge lønnsregler';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select pg_temp.check(not exists (select 1 from org_pay_rules where org_id = :'org_a'), 'annen bedrift ser regelvalg');
reset role;

-- Lokal avtale, forespørsel og varsel om nye satser
insert into platform_admin_emails values ('leder@b.no') on conflict do nothing;
insert into pay_rule_sets (key, name, kind, org_id) values ('lokal_a', 'Lokal avtale A', 'tariff', :'org_a');
insert into pay_rule_versions (rule_set_id, valid_from, rules) select id, '2026-01-01', '{}' from pay_rule_sets where key = 'lokal_a';
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select set_org_pay_rules(:'org_a', (select id from pay_rule_sets where key = 'lokal_a'), date '2026-02-01', true);
insert into pay_rule_requests (org_id, created_by, message) values (:'org_a', '00000000-0000-0000-0000-0000000000a1', 'Vi har Reiselivsoverenskomsten');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select pg_temp.check(not exists (select 1 from pay_rule_requests), 'ansatt ser forespørsler');
reset role;
select set_config('request.jwt.claims', '{}', false);
select pg_temp.check(exists (select 1 from notifications where kind = 'platform_tariff_request'), 'InnSpæll fikk ikke varsel om forespørsel');
insert into pay_rule_versions (rule_set_id, valid_from, rules) select id, '2026-06-01', '{}' from pay_rule_sets where key = 'lokal_a';
select pg_temp.check(exists (select 1 from notifications where kind = 'pay_rules_updated' and org_id = :'org_a'), 'leder fikk ikke varsel om nye satser');
-- Bedrift B kan ikke velge A sin lokale avtale
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000b1', 'leder@b.no');
do $$ begin
  perform set_org_pay_rules((select id from organizations where name = 'Bedrift B'), (select id from pay_rule_sets where key = 'lokal_a'), date '2026-02-01', true);
  raise exception 'FEIL: annen bedrift kunne velge lokal avtale';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
reset role;
delete from platform_admin_emails where email = 'leder@b.no';

-- Utkast er usynlige for kunder; hendelser kan ikke registreres i låst periode
insert into pay_rule_versions (rule_set_id, valid_from, rules, status) select id, '2027-01-01', '{}', 'draft' from pay_rule_sets where key = 'lokal_a';
select pg_temp.check(not exists (select 1 from notifications where kind = 'pay_rules_updated' and body like '%01.01.2027%'), 'varsel sendt for utkast');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select pg_temp.check(not exists (select 1 from pay_rule_versions where status = 'draft'), 'kunde ser utkast');
reset role;
select set_config('request.jwt.claims', '{}', false);
update pay_rule_versions set status = 'published' where status = 'draft' and valid_from = '2027-01-01';
select pg_temp.check(exists (select 1 from notifications where kind = 'pay_rules_updated' and body like '%01.01.2027%'), 'ikke varsel ved publisering');
insert into pay_periods (org_id, starts_on, ends_on, status) values (:'org_a', '2025-01-01', '2025-01-31', 'exported');
do $$ begin
  insert into pay_events (org_id, employee_id, date, key) select org_id, id, '2025-01-10', 'utlevering' from employees where full_name = 'Ola Nordmann';
  raise exception 'FEIL: hendelse registrert i låst periode';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;

-- Påminnelser og sletterutiner kjører uten feil; sluttet ansatt mister tilgang
update employees set start_date = current_date - 400, end_date = current_date - 1 where full_name = 'Kari Nordmann';
select run_reminders();
select run_retention();
select pg_temp.check(not exists (select 1 from memberships m join employees e on e.user_id = m.user_id where e.full_name = 'Kari Nordmann'), 'sluttet ansatt har fortsatt tilgang');

reset role;
select 'ALLE DATABASETESTER OK' as resultat;
