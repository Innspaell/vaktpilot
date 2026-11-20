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
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'email', p_email, 'aal', 'aal2')::text, false);
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

-- Fravær: ansatt søker ferie og melder seg syk; begge må godkjennes av leder, som også frigjør vakt
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
insert into absence_requests (org_id, employee_id, absence_type_id, from_date, to_date)
select :'org_a', my_employee_id(:'org_a'), id, '2026-11-16', '2026-11-17' from absence_types where org_id = :'org_a' and key = 'ferie'
returning id as ferie_ola \gset
insert into absence_requests (org_id, employee_id, absence_type_id, from_date, to_date)
select :'org_a', my_employee_id(:'org_a'), id, '2026-11-25', '2026-11-25' from absence_types where org_id = :'org_a' and key = 'syk';
select pg_temp.check((select status from absence_requests where id = :'ferie_ola') = 'pending', 'ferie skal vente');
select pg_temp.check((select count(*) from absence_requests a join absence_types t on t.id = a.absence_type_id where t.key = 'syk' and a.status = 'pending' and a.from_date = '2026-11-25') = 1, 'sykefravær ble godkjent uten leder');
-- Ola kan ikke godkjenne selv
do $$ begin
  perform decide_absence((select id from absence_requests where status = 'pending' limit 1), true, false);
  raise exception 'FEIL: ansatt godkjente eget fravær';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if;
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select pg_temp.check((select count(*) from notifications where kind = 'absence_request') >= 1 and exists (select 1 from notifications where kind = 'sick_report' and email_status = 'pending'), 'leder fikk ikke varsel om fravær og sykdom');
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

-- Tofaktor: leder uten bekreftet tofaktor i økta har ikke lederrettigheter
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'email', 'leder@a.no', 'aal', 'aal1')::text, false);
select pg_temp.check(not is_admin(:'org_a'), 'leder er admin uten tofaktor');
select pg_temp.check(mfa_required(), 'leder må ha tofaktor');
select pg_temp.check(not exists (select 1 from pay_rule_requests), 'leder uten tofaktor ser lederdata');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select pg_temp.check(is_admin(:'org_a'), 'leder med tofaktor er ikke admin');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select pg_temp.check(not mfa_required(), 'ansatt krever tofaktor');
do $$ begin
  perform reset_mfa('00000000-0000-0000-0000-0000000000a1');
  raise exception 'FEIL: ansatt kunne nullstille lederens tofaktor';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
reset role;

-- Feilvarsling: samme feil telles opp, InnSpæll får ett varsel; vanlige brukere ser ikke feillisten
insert into platform_admin_emails values ('leder@b.no') on conflict do nothing;
set role anon;
select log_app_error('server', 'Testfeil', '/lonn/00000000-0000-0000-0000-000000000001');
select log_app_error('server', 'Testfeil', '/lonn/00000000-0000-0000-0000-000000000002');
reset role;
select pg_temp.check((select count from app_errors where message = 'Testfeil') = 2, 'feil ble ikke telt opp');
select pg_temp.check((select count(*) from notifications where kind = 'platform_error') = (select count(distinct user_id) from notifications where kind = 'platform_error') and exists (select 1 from notifications where kind = 'platform_error'), 'feil skal gi ett varsel per plattformadmin');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select pg_temp.check(not exists (select 1 from app_errors), 'kunde ser feillisten');
reset role;
delete from platform_admin_emails where email = 'leder@b.no';
select run_health_check();

-- Kapasitetssjekk kjører og lagrer måling
select run_capacity_check();
select run_capacity_check();
select pg_temp.check((select count(*) from capacity_snapshots) = 2, 'kapasitetsmåling ikke lagret');

-- Påminnelser og sletterutiner kjører uten feil; sluttet ansatt mister tilgang
update employees set start_date = current_date - 400, end_date = current_date - 1 where full_name = 'Kari Nordmann';
select run_reminders();
select run_retention();
select pg_temp.check(not exists (select 1 from memberships m join employees e on e.user_id = m.user_id where e.full_name = 'Kari Nordmann'), 'sluttet ansatt har fortsatt tilgang');

-- Registrering: stengt til InnSpæll åpner, kode på e-post, ny bruker og bedrift med prøveperiode
insert into vault.decrypted_secrets values ('resend_api_key', 're_test') on conflict (name) do update set decrypted_secret = 're_test';
\set skjema '{"name":"Ny Kafé AS","org_number":"987 654 321","full_name":"Nina Ny","phone":"91234567","accept":"true","terms_version":"2026-11","dpa_version":"2026-11"}'
set role anon;
select pg_temp.check(signup_request_code('nina@ny.no', :'skjema') ->> 'error' like '%ikke åpen%', 'registrering var åpen før InnSpæll åpnet');
reset role;
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
select platform_set_signup(true, 30, 12, 10);
reset role;
set role anon;
select pg_temp.check((signup_status() ->> 'open')::boolean, 'signup_status viser ikke åpen');
select pg_temp.check((signup_request_code('leder@a.no', :'skjema') ->> 'has_user')::boolean, 'eksisterende bruker fikk kode');
select pg_temp.check((signup_request_code('Nina@Ny.no', :'skjema') ->> 'ok')::boolean, 'kode ble ikke sendt');
reset role;
select substring(body ->> 'subject' from '(\d{6})') as kode from net.test_requests where body ->> 'to' like '%nina@ny.no%' order by id desc limit 1 \gset
set role anon;
select pg_temp.check(signup_complete('nina@ny.no', '000000', 'langtpassord1', :'skjema') ->> 'error' like 'Feil kode%' or :'kode' = '000000', 'feil kode ble godtatt');
select pg_temp.check(signup_complete('nina@ny.no', :'kode', 'kort', :'skjema') ->> 'error' like '%10 tegn%', 'kort passord ble godtatt');
select signup_complete('nina@ny.no', :'kode', 'langtpassord1', :'skjema') as res \gset
reset role;
select pg_temp.check((:'res'::jsonb ->> 'ok')::boolean, 'registrering feilet: ' || :'res');
select id as org_ny from organizations where org_number = '987654321' \gset
select pg_temp.check((select trial_ends_at = current_date + 30 and price_base = 299 and price_locked_until > current_date + 360
  and invoice_email = 'nina@ny.no' and terms_version = '2026-11' from organizations where id = :'org_ny'), 'prøveperiode/pris ble ikke satt');
select pg_temp.check(exists (select 1 from memberships m join auth.users u on u.id = m.user_id where m.org_id = :'org_ny' and u.email = 'nina@ny.no' and m.role = 'owner'), 'ny bruker ble ikke eier');
select pg_temp.check(exists (select 1 from employees where org_id = :'org_ny' and full_name = 'Nina Ny' and user_id is not null), 'ansattkort mangler');
select pg_temp.check(exists (select 1 from dpa_acceptances where org_id = :'org_ny'), 'databehandleravtale ikke godtatt');
select pg_temp.check(exists (select 1 from notifications where kind = 'signup'), 'InnSpæll fikk ikke varsel om ny bedrift');
select pg_temp.check(not exists (select 1 from signup_codes where email = 'nina@ny.no'), 'koden ble ikke slettet');
set role anon;
select pg_temp.check(signup_request_code('per@ny.no', :'skjema') ->> 'error' like '%allerede registrert%', 'samme orgnr to ganger');
reset role;
select compute_usage(:'org_ny', current_date, false, false);
select pg_temp.check((select trial and amount = 0 from usage_months where org_id = :'org_ny' and month = date_trunc('month', current_date)::date), 'prøvemåned ble fakturert');
-- Prøveperioden slutter 17. desember: desember betales forholdsmessig (17.–31. = 15 av 31 dager), januar fullt
update organizations set trial_ends_at = date '2027-12-17' where id = :'org_ny';
select compute_usage(:'org_ny', date '2027-11-01', false, false);
select compute_usage(:'org_ny', date '2027-12-01', false, false);
select compute_usage(:'org_ny', date '2028-01-01', false, false);
select pg_temp.check((select trial and amount = 0 from usage_months where org_id = :'org_ny' and month = date '2027-11-01'), 'november i prøveperioden');
select pg_temp.check((select not trial and billed_from = date '2027-12-17' and amount = round(299 * 15 / 31.0, 2) from usage_months where org_id = :'org_ny' and month = date '2027-12-01'), 'desember forholdsmessig');
select pg_temp.check((select amount = 299 and billed_from is null from usage_months where org_id = :'org_ny' and month = date '2028-01-01'), 'januar fullt');
update organizations set trial_ends_at = current_date + 30 where id = :'org_ny';

-- Innlogget bruker kan registrere egen bedrift; leder kan ikke endre prøveperioden selv, men kan si opp
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select signup_create('{"name":"Olas Bil","org_number":"912345678","full_name":"Ola Nordmann","accept":"true","terms_version":"2026-11","dpa_version":"2026-11"}') as org_ola \gset
select pg_temp.check(is_admin(:'org_ola'), 'innlogget bruker ble ikke eier');
do $$ begin
  update organizations set trial_ends_at = current_date + 365 where name = 'Olas Bil';
  raise exception 'FEIL: leder forlenget prøveperioden selv';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select request_cancellation(:'org_ola', true);
select pg_temp.check((select cancel_requested_at is not null from organizations where id = :'org_ola'), 'oppsigelse ble ikke lagret');
select pg_temp.check(not exists (select 1 from platform_invoice_basis(current_date)), 'kunde ser fakturagrunnlag');
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
select pg_temp.check(exists (select 1 from platform_invoice_basis(current_date) where name = 'Ny Kafé AS'), 'fakturagrunnlag mangler ny bedrift');
reset role;
-- Årlig betaling: fastprisen dekkes av årsprisen (10 måneder) i årets første måned, ekstra ansatte faktureres som før
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
update organizations set trial_ends_at = null where name = 'Olas Bil';
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select set_billing_interval(:'org_ola', 'year');
reset role;
select annual_start as aar_start from organizations where id = :'org_ola' \gset
select compute_usage(:'org_ola', :'aar_start', false, false);
select compute_usage(:'org_ola', (:'aar_start'::date + interval '1 month')::date, false, false);
select pg_temp.check((select annual_covered and annual_charge = 2990 and amount = 2990 from usage_months where org_id = :'org_ola' and month = :'aar_start'), 'årspris i første måned');
select pg_temp.check((select annual_covered and annual_charge = 0 and amount = 0 from usage_months where org_id = :'org_ola' and month = (:'aar_start'::date + interval '1 month')::date), 'måned i betalt år ble fakturert');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
do $$ begin
  update organizations set annual_start = null where name = 'Olas Bil';
  raise exception 'FEIL: leder endret årsperioden direkte';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select set_billing_interval(:'org_ola', 'month');
reset role;
select pg_temp.check((select billing_interval = 'month' and annual_start is null from organizations where id = :'org_ola'), 'tilbake til månedlig før året startet');
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
update organizations set trial_ends_at = current_date + 3 where id = :'org_ny';
select pg_temp.check(run_trial_reminders() >= 1, 'påminnelse om prøveperiode');

-- Fakturering: forskudd, forholdsmessig første faktura, ekstra ansatte etterskudd, purring og sperring
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
select pg_temp.check((select billing_enabled and billing_from = current_date from organizations where id = :'org_ny'), 'selvregistrert bedrift faktureres ikke');
select pg_temp.check(not (select billing_enabled from organizations where id = :'org_a'), 'eksisterende kunde ble fakturert uten videre');
-- Ny Kafé: registrert 17.11.2027, prøve til 17.12.2027
update organizations set billing_from = date '2027-11-17', trial_ends_at = date '2027-12-17', billed_through = null, cancel_requested_at = null where id = :'org_ny';
select pg_temp.check(generate_invoices(date '2027-12-16') = 0 or not exists (select 1 from invoices where org_id = :'org_ny'), 'faktura før prøveperioden var over');
select generate_invoices(date '2027-12-17');
select pg_temp.check((select count(*) = 1 and min(net) = round(299 * 15 / 31.0, 2) + 299 and min(period_to) = date '2028-01-31' and min(status) = 'ready'
  from invoices where org_id = :'org_ny'), 'første faktura skal dekke 17.–31. desember og januar');
select generate_invoices(date '2027-12-17');
select pg_temp.check((select count(*) = 1 from invoices where org_id = :'org_ny'), 'dobbel faktura samme dag');
-- 1. februar: februar på forskudd + ekstra ansatte i januar
insert into usage_months (org_id, month, active_count, included, base_price, per_extra, amount, final)
values (:'org_ny', date '2028-01-01', 7, 5, 299, 39, 377, true) on conflict (org_id, month) do update set active_count = 7, final = true, trial = false, billed_from = null;
select generate_invoices(date '2028-02-01');
select pg_temp.check((select net = 299 + 2 * (select per_extra from usage_months where org_id = :'org_ny' and month = date '2028-01-01') and period_to = date '2028-02-29' from invoices where org_id = :'org_ny' and issue_date = date '2028-02-01'), 'februar + ekstra i januar');
select pg_temp.check((select invoice_id is not null from usage_months where org_id = :'org_ny' and month = date '2028-01-01'), 'ekstra ansatte ble ikke knyttet til fakturaen');
-- Kunde ser egne fakturaer, ikke andres
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select pg_temp.check(not exists (select 1 from invoices where org_id = :'org_ny'), 'annen bedrift ser fakturaene');
reset role;
-- Jobben uten riktig hemmelighet
set role anon;
do $$ begin perform billing_run('feil'); raise exception 'FEIL: fakturajobb uten hemmelighet'; exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
reset role;
select decrypted_secret as hemmelighet from vault.decrypted_secrets where name = 'billing_job_secret' \gset
set role anon;
select pg_temp.check(jsonb_typeof(billing_run(:'hemmelighet') -> 'send') = 'array', 'fakturajobb med hemmelighet');
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
select id as faktura from invoices where org_id = :'org_ny' and issue_date = date '2027-12-17' \gset
select platform_invoice_action(:'faktura', 'approve');
select pg_temp.check(billing_step(:'hemmelighet', :'faktura', 'start'), 'kunne ikke starte sending');
select pg_temp.check(not billing_step(:'hemmelighet', :'faktura', 'start'), 'samme faktura startet to ganger');
select billing_step(:'hemmelighet', :'faktura', 'created', '{"fiken_invoice_id": 991, "invoice_number": "10001", "kid": "123455", "bank_account": "1234.56.78901"}');
select billing_step(:'hemmelighet', :'faktura', 'sent');
-- Forfalt 31.12, påminnelse 14.01, sperring 13.02
select run_billing_dunning(date '2028-01-01');
select pg_temp.check((select overdue_notified from invoices where id = :'faktura'), 'forfalt-varsel');
select run_billing_dunning(date '2028-01-14');
select pg_temp.check((select reminder_sent_at is not null from invoices where id = :'faktura'), 'påminnelse ikke sendt');
update invoices set reminder_sent_at = timestamptz '2028-01-14 08:00+01' where id = :'faktura';
select run_billing_dunning(date '2028-02-10');
select pg_temp.check((select block_warned from invoices where id = :'faktura') and exists (select 1 from notifications where kind = 'billing_block'), 'varsel før sperring');
select run_billing_dunning(date '2028-02-13');
select pg_temp.check((select blocked_at is not null from organizations where id = :'org_ny'), 'ikke sperret');
-- Sperret leder er ikke admin, men ser fakturaen
select user_id as nina from memberships where org_id = :'org_ny' and role = 'owner' \gset
set role authenticated;
select pg_temp.login(:'nina', 'nina@ny.no');
select pg_temp.check(not is_admin(:'org_ny') and is_org_leader(:'org_ny'), 'sperret leder er fortsatt admin');
select pg_temp.check(exists (select 1 from invoices where org_id = :'org_ny'), 'sperret leder ser ikke fakturaene');
reset role;
select billing_step(:'hemmelighet', :'faktura', 'paid');
select pg_temp.check((select blocked_at is null from organizations where id = :'org_ny'), 'ikke åpnet etter betaling');

-- Avslutning: oppsagt i februar → avsluttet etter februar, sletting 90 dager etter
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
update organizations set cancel_requested_at = timestamptz '2028-02-10 12:00+01', billed_through = date '2028-02-29' where id = :'org_ny';
select run_subscription_housekeeping(date '2028-02-29');
select pg_temp.check((select ended_at is null from organizations where id = :'org_ny'), 'avsluttet før perioden var over');
select run_subscription_housekeeping(date '2028-03-01');
select pg_temp.check((select ended_at = date '2028-02-29' and delete_after = date '2028-05-29' and not active from organizations where id = :'org_ny'), 'ikke avsluttet riktig');
do $$ begin perform platform_delete_org_data((select id from organizations where name = 'Ny Kafé AS'), 'feil navn'); raise exception 'FEIL: slettet uten riktig navn';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select platform_delete_org_data(:'org_ny', 'Ny Kafé AS');
select pg_temp.check(not exists (select 1 from organizations where id = :'org_ny') and not exists (select 1 from employees where org_id = :'org_ny'), 'data ble ikke slettet');
-- Prisendring må varsles minst 60 dager før
do $$ begin perform platform_announce_price(349, 5, 45, current_date + 30); raise exception 'FEIL: prisendring med for kort varsel';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select pg_temp.check(platform_announce_price(349, 5, 45, current_date + 61) >= 1, 'prisvarsel sendt til ingen');

-- Innspill: ansatt sender, ser bare egne; InnSpæll svarer og den ansatte får varsel
reset role;
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select submit_feedback(:'org_a', 'idea', 'Kan vi få vaktbytte med to klikk?', '/vaktplan') as innspill \gset
select pg_temp.check(exists (select 1 from feedback where id = :'innspill' and role = 'employee'), 'ansatt ser ikke eget innspill');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select pg_temp.check(not exists (select 1 from feedback where id = :'innspill'), 'andre ser innspillet');
do $$ begin perform platform_answer_feedback((select id from feedback limit 1), 'done', 'x'); raise exception 'FEIL: kunde svarte på innspill';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
select pg_temp.check(exists (select 1 from feedback where id = :'innspill'), 'InnSpæll ser ikke innspillet');
select platform_answer_feedback(:'innspill', 'planned', 'Godt forslag, vi lager det.');
reset role;
select pg_temp.check(exists (select 1 from notifications where kind = 'feedback_reply' and user_id = '00000000-0000-0000-0000-0000000000a3'), 'ingen varsel om svar');

-- Support: svar-adresse i e-postene fra InnSpæll; driftsmeldinger
reset role;
select pg_temp.check(pg_get_functiondef('signup_request_code(text,jsonb)'::regprocedure) like '%support_reply_to()%'
  and pg_get_functiondef('run_billing_dunning(date)'::regprocedure) like '%faktura@vaktpilot.no%'
  and pg_get_functiondef('send_signup_confirmation(uuid)'::regprocedure) like '%support_reply_to()%', 'svar-adresse mangler i e-postene');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
select platform_set_support('Hei@Vaktpilot.no', '73 00 00 00');
select pg_temp.check(platform_create_notice('Vedlikehold i kveld kl. 22–23.', 'warning', now(), now() + interval '2 hours', true) >= 1, 'driftsmelding ble ikke varslet');
set role anon;
select pg_temp.check(support_contact() ->> 'email' = 'hei@vaktpilot.no', 'support-e-post vises ikke');
select pg_temp.check(exists (select 1 from service_notices where ends_at > now()), 'driftsmelding ikke synlig');
reset role;
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
do $$ begin perform platform_create_notice('Hei hei', 'info', null, null, false); raise exception 'FEIL: kunde lagde driftsmelding';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;

-- Personalliste: stempling, føring i etterkant, rettelser og sletting med hvem og når
reset role;
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000c1', 'leder@c.no'),
  ('00000000-0000-0000-0000-0000000000c2', 'per@c.no'),
  ('00000000-0000-0000-0000-0000000000c3', 'siv@c.no');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
select create_organization('Kokkene AS', '987654321') as org_c \gset
insert into memberships values (:'org_c', '00000000-0000-0000-0000-0000000000c1', 'owner', now());
select pg_temp.login('00000000-0000-0000-0000-0000000000c1', 'leder@c.no');
insert into employees (org_id, full_name, email, employee_number) values
  (:'org_c', 'Per Kokk', 'per@c.no', '101'),
  (:'org_c', 'Siv Servitør', 'siv@c.no', null);
select pg_temp.login('00000000-0000-0000-0000-0000000000c2', 'per@c.no');
select claim_invites();
select pg_temp.login('00000000-0000-0000-0000-0000000000c3', 'siv@c.no');
select claim_invites();

-- Uten personalliste kan ansatte ikke se den
select pg_temp.login('00000000-0000-0000-0000-0000000000c2', 'per@c.no');
do $$ begin
  perform personnel_list((select id from organizations where name = 'Kokkene AS'), current_date);
  raise exception 'FEIL: ansatt så personallisten uten at den er slått på';
exception when insufficient_privilege then null;
end $$;

reset role;
update organizations set personnel_list = true where id = :'org_c';
set role authenticated;

-- Per stempler inn og ut
select pg_temp.login('00000000-0000-0000-0000-0000000000c2', 'per@c.no');
select clock(:'org_c', 'in') as per_entry \gset
select clock(:'org_c', 'out');

-- Leder fører timer for Siv i etterkant, retter starttiden, og fører og sletter en feilregistrering
select pg_temp.login('00000000-0000-0000-0000-0000000000c1', 'leder@c.no');
select (now() at time zone 'Europe/Oslo')::date as d, (now() at time zone 'Europe/Oslo')::date - 1 as y \gset
insert into time_entries (org_id, employee_id, starts_at, ends_at, source)
  select :'org_c', id, (:'y' || ' 10:00')::timestamp at time zone 'Europe/Oslo', (:'y' || ' 14:00')::timestamp at time zone 'Europe/Oslo', 'admin'
    from employees where full_name = 'Siv Servitør'
  returning id as siv_entry \gset
update time_entries set starts_at = starts_at - interval '30 minutes' where id = :'siv_entry';
insert into time_entries (org_id, employee_id, starts_at, ends_at, source)
  select :'org_c', id, (:'y' || ' 07:00')::timestamp at time zone 'Europe/Oslo', (:'y' || ' 08:00')::timestamp at time zone 'Europe/Oslo', 'admin'
    from employees where full_name = 'Per Kokk'
  returning id as wrong_entry \gset
delete from time_entries where id = :'wrong_entry';

select pg_temp.check((select count(*) from personnel_list(:'org_c', :'d')) = 1, 'personallisten i dag har ikke Pers stempling');
select pg_temp.check((select count(*) from personnel_list(:'org_c', :'y')) = 2, 'personallisten i går har ikke to registreringer');
select pg_temp.check((select source = 'clock' and not deleted and jsonb_array_length(changes) = 0 and employee_number = '101' and ends_at is not null
                        from personnel_list(:'org_c', :'d') where entry_id = :'per_entry'), 'stemplingen vises ikke riktig');
select pg_temp.check((select source = 'admin' and registered_by = 'leder@c.no' and changes -> 0 ->> 'action' = 'UPDATE'
                        from personnel_list(:'org_c', :'y') where entry_id = :'siv_entry'), 'rettelsen vises ikke med hvem');
select pg_temp.check((select deleted and changes -> -1 ->> 'action' = 'DELETE' and full_name = 'Per Kokk'
                        from personnel_list(:'org_c', :'y') where entry_id = :'wrong_entry'), 'slettet registrering vises ikke');
select pg_temp.check((select name = 'Kokkene AS' and org_number = '987654321' from personnel_list_header(:'org_c')), 'bedriftsopplysninger mangler');

-- Alle ansatte kan vise listen (kontroll når leder ikke er der) – men ikke når det er slått av
select pg_temp.login('00000000-0000-0000-0000-0000000000c3', 'siv@c.no');
select pg_temp.check((select count(*) from personnel_list(:'org_c', :'y')) = 2, 'ansatt kan ikke vise personallisten');
reset role;
update organizations set personnel_list_staff_view = false where id = :'org_c';
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c3', 'siv@c.no');
do $$ begin
  perform personnel_list((select id from organizations o where o.name = 'Kokkene AS'), current_date);
  raise exception 'FEIL: ansatt så personallisten selv om bare ledere skal se den';
exception when insufficient_privilege then null;
end $$;

-- En annen bedrift ser ikke listen
select pg_temp.login('00000000-0000-0000-0000-0000000000b1', 'leder@b.no');
select set_config('test.org_c', :'org_c', false);
do $$ begin
  perform personnel_list(current_setting('test.org_c')::uuid, current_date);
  raise exception 'FEIL: annen bedrift så personallisten';
exception when insufficient_privilege then null;
end $$;

-- Ansatte med registrert arbeidstid kan ikke slettes
select pg_temp.login('00000000-0000-0000-0000-0000000000c1', 'leder@c.no');
do $$ begin
  delete from employees where full_name = 'Per Kokk';
  raise exception 'FEIL: ansatt med arbeidstid ble slettet';
exception when raise_exception then
  if sqlerrm like 'FEIL:%' then raise; end if;
end $$;
reset role;
select pg_temp.check(exists (select 1 from employees where full_name = 'Per Kokk'), 'ansatt med arbeidstid ble slettet');
-- Kobling til Cateringflyt: stempling med hemmelig nøkkel, uten innlogging i Vaktpilot
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'plattform@test.no');
select platform_set_integration(:'org_c', 'hemmelig-nokkel-som-er-lang-nok-1234567890', 'https://cateringflyt.example', '2kokker');
select pg_temp.login('00000000-0000-0000-0000-0000000000c1', 'leder@c.no');
do $$ begin
  perform platform_set_integration((select id from organizations where name = 'Kokkene AS'), repeat('x', 40), null, null);
  raise exception 'FEIL: kunde koblet selv';
exception when insufficient_privilege then null;
end $$;
select pg_temp.check((select enabled from org_integration(:'org_c')), 'lederen ser ikke koblingen');
reset role;
set role anon;
select set_config('request.jwt.claims', '{}', false);
select set_config('test.org_c', :'org_c', false);
do $$ begin
  perform integration_clock_state(current_setting('test.org_c')::uuid, 'feil-nokkel', 'per@c.no');
  raise exception 'FEIL: feil nøkkel ble godtatt';
exception when insufficient_privilege then null;
end $$;
select pg_temp.check((integration_clock_state(:'org_c', 'hemmelig-nokkel-som-er-lang-nok-1234567890', 'ukjent@c.no') ->> 'employee')::boolean = false, 'ukjent e-post ble funnet');
select pg_temp.check(integration_clock_state(:'org_c', 'hemmelig-nokkel-som-er-lang-nok-1234567890', 'PER@c.no') ->> 'state' = 'out', 'Per står ikke utstemplet');
select pg_temp.check(integration_clock(:'org_c', 'hemmelig-nokkel-som-er-lang-nok-1234567890', 'per@c.no', 'in') ->> 'state' = 'working', 'stempling inn fra Cateringflyt virket ikke');
select pg_temp.check(integration_clock(:'org_c', 'hemmelig-nokkel-som-er-lang-nok-1234567890', 'per@c.no', 'out') ->> 'state' = 'out', 'stempling ut fra Cateringflyt virket ikke');
do $$ begin
  perform clock_as(current_setting('test.org_c')::uuid, gen_random_uuid(), 'in', 'x');
  raise exception 'FEIL: anon kunne kalle clock_as';
exception when insufficient_privilege then null;
end $$;
reset role;
select pg_temp.check((select count(*) from clock_events where org_id = :'org_c' and source = 'cateringflyt') = 2, 'stemplingene er ikke merket Cateringflyt');
select pg_temp.check((select changed_by from audit_log a join time_entries t on t.id = a.row_id
                       where a.org_id = :'org_c' and a.action = 'INSERT' and t.starts_at = (select max(starts_at) from time_entries where org_id = :'org_c')
                       order by a.at desc limit 1) = '00000000-0000-0000-0000-0000000000c2', 'endringsloggen viser ikke den ansatte');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1', 'leder@c.no');
select pg_temp.check((select bool_and(jsonb_array_length(changes) = 0) from personnel_list(:'org_c', :'d') where not deleted), 'utstempling fra Cateringflyt vises som rettelse');
reset role;

-- Når hele bedriften slettes (etter oppbevaringstiden), stopper ikke vernet slettingen
delete from organizations where id = :'org_c';
select pg_temp.check(not exists (select 1 from employees where full_name = 'Per Kokk'), 'bedriften med personalliste kunne ikke slettes');

-- Sykefravær: kan ikke settes uten godkjenning; bedriften kan slå av at ansatte melder selv
reset role;
update absence_types set needs_approval = false where key = 'syk';
select pg_temp.check(not exists (select 1 from absence_types where is_sick and not needs_approval), 'sykefravær uten godkjenning');
update organizations set sick_self_report = false where id = :'org_a';
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
do $$ begin
  insert into absence_requests (org_id, employee_id, absence_type_id, from_date, to_date)
  select o.id, my_employee_id(o.id), t.id, '2026-12-02', '2026-12-02' from organizations o join absence_types t on t.org_id = o.id and t.key = 'syk' where o.org_number = '123456789';
  raise exception 'FEIL: ansatt meldte seg syk selv om det er slått av';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
reset role;
update organizations set sick_self_report = true where id = :'org_a';

-- Leder og avdelinger: Kari blir leder for Værnes; Ola jobber på Stjørdal; Per på Værnes
reset role;
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into departments (org_id, name) values (:'org_a', 'Værnes') returning id as dep_v \gset
insert into departments (org_id, name) values (:'org_a', 'Stjørdal') returning id as dep_s \gset
insert into employees (org_id, full_name) values (:'org_a', 'Per Værnes') returning id as per \gset
select id as kari_emp from employees where org_id = :'org_a' and full_name = 'Kari Nordmann' \gset
select id as ola_emp from employees where org_id = :'org_a' and full_name = 'Ola Nordmann' \gset
insert into employee_departments (org_id, employee_id, department_id, is_home) values
  (:'org_a', :'per', :'dep_v', true), (:'org_a', :'ola_emp', :'dep_s', true), (:'org_a', :'kari_emp', :'dep_v', true);
delete from memberships where org_id = :'org_a' and user_id = '00000000-0000-0000-0000-0000000000a2';
insert into memberships (org_id, user_id, role) values (:'org_a', '00000000-0000-0000-0000-0000000000a2', 'manager');
update employees set user_id = '00000000-0000-0000-0000-0000000000a2' where id = :'kari_emp';
insert into manager_departments (org_id, user_id, department_id) values (:'org_a', '00000000-0000-0000-0000-0000000000a2', :'dep_v');

select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
select pg_temp.check(is_manager(:'org_a') and can_plan(:'org_a') and not is_admin(:'org_a') and mfa_required(), 'lederrolle');
select pg_temp.check((select count(*) from employees where org_id = :'org_a') >= 3, 'leder ser ikke de ansatte');
insert into shifts (org_id, employee_id, department_id, starts_at, ends_at, status)
values (:'org_a', :'per', :'dep_v', '2027-01-04 08:00+01', '2027-01-04 16:00+01', 'draft');
do $$ begin
  insert into shifts (org_id, employee_id, department_id, starts_at, ends_at, status)
  select o.id, e.id, d.id, '2027-01-04 08:00+01', '2027-01-04 16:00+01', 'draft'
  from organizations o join employees e on e.org_id = o.id and e.full_name = 'Ola Nordmann' join departments d on d.org_id = o.id and d.name = 'Stjørdal'
  where o.org_number = '123456789';
  raise exception 'FEIL: leder la vakt i annen avdeling';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select pg_temp.check(publish_shifts(:'org_a', '2027-01-01', '2027-01-31') = 1, 'leder publiserte ikke egen avdeling');
do $$ begin
  update organizations set name = 'Hacket' where org_number = '123456789';
  if exists (select 1 from organizations where name = 'Hacket') then raise exception 'FEIL: leder endret bedriften'; end if;
end $$;
do $$ begin
  update employees set full_name = 'Endret' where full_name = 'Ola Nordmann';
  if exists (select 1 from employees where full_name = 'Endret') then raise exception 'FEIL: leder endret ansattkort'; end if;
end $$;
-- Bemanningsbehov: bare egne avdelinger
insert into staffing_templates (org_id, weekday, start_time, end_time, required, department_id) values (:'org_a', 1, '08:00', '16:00', 1, :'dep_v');
do $$ begin
  insert into staffing_templates (org_id, weekday, start_time, end_time, required, department_id)
  select o.id, 1, '08:00', '16:00', 1, null from organizations o where o.org_number = '123456789';
  raise exception 'FEIL: leder la inn behov for hele bedriften';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;

-- Fravær: Per (Værnes) varsler Kari; Ola (Stjørdal, uten leder) varsler eier
reset role;
select pg_temp.check(exists (select 1 from leaders_for(:'org_a', :'per') l where l.user_id = '00000000-0000-0000-0000-0000000000a2')
  and not exists (select 1 from leaders_for(:'org_a', :'per') l where l.user_id = '00000000-0000-0000-0000-0000000000a1'), 'varsel til avdelingsleder');
select pg_temp.check(exists (select 1 from leaders_for(:'org_a', :'ola_emp') l where l.user_id = '00000000-0000-0000-0000-0000000000a1'), 'varsel til eier når avdelingen mangler leder');
insert into absence_requests (org_id, employee_id, absence_type_id, from_date, to_date)
select :'org_a', :'per', id, '2027-01-05', '2027-01-05' from absence_types where org_id = :'org_a' and key = 'ferie' returning id as per_ferie \gset
insert into absence_requests (org_id, employee_id, absence_type_id, from_date, to_date)
select :'org_a', :'ola_emp', id, '2027-01-06', '2027-01-06' from absence_types where org_id = :'org_a' and key = 'ferie' returning id as ola_ferie \gset
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
select decide_absence(:'per_ferie', true, false);
do $$ begin
  perform decide_absence((select id from absence_requests a join employees e on e.id = a.employee_id where e.full_name = 'Ola Nordmann' and a.from_date = '2027-01-06'), true, false);
  raise exception 'FEIL: leder godkjente fravær i annen avdeling';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
do $$ begin perform lock_pay_period((select id from organizations where org_number = '123456789'), '2027-01-01', '2027-01-31', 'x');
  raise exception 'FEIL: leder låste lønn';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
-- Pårørende: egen registrering; leder ser bare for ansatte i sine avdelinger
reset role;
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
insert into emergency_contacts (org_id, employee_id, name, relation, phone) values (:'org_a', :'ola_emp', 'Mor Nordmann', 'mor', '900 00 000');
select pg_temp.check((select count(*) from emergency_contacts) = 1, 'ansatt ser egne pårørende');
select set_config('t.per', :'per', false), set_config('t.org', :'org_a', false);
do $$ begin
  insert into emergency_contacts (org_id, employee_id, name, phone)
    values (current_setting('t.org')::uuid, current_setting('t.per')::uuid, 'Feil', '12345');
  raise exception 'FEIL: ansatt la inn pårørende for en annen';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into emergency_contacts (org_id, employee_id, name, phone) values (:'org_a', :'per', 'Kone Værnes', '911 11 111');
select pg_temp.check((select count(*) from emergency_contacts) = 2, 'admin ser alle pårørende');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
select pg_temp.check((select count(*) from emergency_contacts) = 1 and exists (select 1 from emergency_contacts where employee_id = :'per'), 'leder ser bare pårørende i egen avdeling');
delete from emergency_contacts where employee_id = :'per';
reset role;
select pg_temp.check((select count(*) from emergency_contacts) = 2, 'leder kan ikke slette pårørende');
-- Tilkalling: 0 % er bare lov med tilkalling
do $$ begin
  insert into employment_terms (org_id, employee_id, valid_from, position_pct, hours_per_week)
    values (current_setting('t.org')::uuid, current_setting('t.per')::uuid, '2030-01-01', 0, 0);
  raise exception 'FEIL: 0 %% uten tilkalling';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
insert into employment_terms (org_id, employee_id, valid_from, position_pct, hours_per_week, on_call)
  values (:'org_a', :'per', '2030-01-01', 0, 0, true);
delete from employment_terms where employee_id = :'per' and valid_from = '2030-01-01';

-- Uten avdelinger styrer lederen alt
reset role;
update departments set archived_at = now() where org_id = :'org_a';
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2', 'kari@a.no');
select pg_temp.check(manages_employee(:'org_a', :'ola_emp'), 'uten avdelinger styrer leder alle');
reset role;
update memberships set role = 'employee' where org_id = :'org_a' and user_id = '00000000-0000-0000-0000-0000000000a2';

-- Morgenliste: sammendrag for leder og ansatt, og bare egen bruker kan slå den på
reset role;
select pg_temp.check((select count(*) from todo_summary(:'org_a', '00000000-0000-0000-0000-0000000000a1')) >= 0, 'sammendrag for leder');
select pg_temp.check((select count(*) from todo_summary(:'org_a', '00000000-0000-0000-0000-0000000000a3') where label like 'nærmeste%') = 0, 'ansatt med pårørende får ikke påminnelse');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select set_my_todo_digest(:'org_a', true);
reset role;
select pg_temp.check((select todo_digest from memberships where org_id = :'org_a' and user_id = '00000000-0000-0000-0000-0000000000a3'), 'morgenliste slått på');
select pg_temp.check((select count(*) from memberships where todo_digest) = 1, 'bare egen morgenliste endres');

-- Betalt helligdag: leder markerer, ansatt kan ikke
reset role;
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
do $$ begin
  insert into holiday_payments (org_id, employee_id, date, hours) values (current_setting('t.org')::uuid, current_setting('t.per')::uuid, '2027-05-17', 7.5);
  raise exception 'FEIL: ansatt markerte betalt helligdag';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into holiday_payments (org_id, employee_id, date, hours) values (:'org_a', :'per', '2027-05-17', 7.5);
select pg_temp.check((select count(*) from holiday_payments) = 1, 'leder markerer betalt helligdag');


-- Timer ført av leder: den ansatte får beskjed, kan melde fra, og lederen svarer
reset role;
select set_config('t.ola', :'ola_emp', false);
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
insert into time_entries (org_id, employee_id, starts_at, ends_at, break_minutes, source, status)
  values (:'org_a', :'ola_emp', '2027-03-01 07:00+00', '2027-03-01 15:00+00', 30, 'admin', 'approved');
insert into time_entries (org_id, employee_id, starts_at, ends_at, break_minutes, source, status)
  values (:'org_a', :'ola_emp', '2027-03-02 07:00+00', '2027-03-02 15:00+00', 30, 'admin', 'approved');
reset role;
select pg_temp.check((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000a3' and kind = 'entry_by_leader') = 1, 'to dager ført av leder gir ett samlet varsel');
select pg_temp.check((select title from notifications where user_id = '00000000-0000-0000-0000-0000000000a3' and kind = 'entry_by_leader') like '%flere dager%', 'samlet varsel sier flere dager');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
insert into entry_notes (org_id, employee_id, time_entry_id, date, body)
  select :'org_a', :'ola_emp', id, '2027-03-01', 'Jeg gikk 17:30, ikke 16:00' from time_entries where employee_id = :'ola_emp' and starts_at = '2027-03-01 07:00+00';
do $$ begin
  insert into entry_notes (org_id, employee_id, date, body) values (current_setting('t.org')::uuid, current_setting('t.per')::uuid, '2027-03-01', 'Ikke min');
  raise exception 'FEIL: ansatt skrev merknad på en annen';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
update entry_notes set status = 'done', answer = 'Selvgodkjent';
select pg_temp.check((select count(*) from entry_notes where status = 'open') = 1, 'ansatt kan ikke lukke sin egen merknad');
reset role;
select pg_temp.check((select count(*) from notifications where kind = 'entry_note' and user_id = '00000000-0000-0000-0000-0000000000a1') = 1, 'lederen får varsel om merknaden');
select pg_temp.check((select n from todo_summary(:'org_a', '00000000-0000-0000-0000-0000000000a1') where label like 'merknader%') = 1, 'merknaden står i Å gjøre');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
update entry_notes set status = 'done', answer = 'Rettet til 17:30', body = 'endret tekst';
reset role;
select pg_temp.check((select body from entry_notes) = 'Jeg gikk 17:30, ikke 16:00', 'lederen kan ikke endre teksten i merknaden');
select pg_temp.check((select resolved_by from entry_notes) = '00000000-0000-0000-0000-0000000000a1', 'hvem som behandlet lagres');
select pg_temp.check((select count(*) from notifications where kind = 'entry_note_answer' and user_id = '00000000-0000-0000-0000-0000000000a3') = 1, 'den ansatte får svaret');
select pg_temp.check((select count(*) from notifications where kind = 'entry_note' and read_at is null) = 0, 'lederens varsel lukkes når merknaden er behandlet');


-- Gradert fravær: graden vises for leder, ikke for kolleger, og kan ikke kombineres med klokkeslett
reset role;
insert into absence_requests (org_id, employee_id, absence_type_id, from_date, to_date, percent, status)
  select :'org_a', :'per', id, '2027-04-05', '2027-04-16', 50, 'approved' from absence_types where org_id = :'org_a' and key = 'syk';
do $$ begin
  insert into absence_requests (org_id, employee_id, absence_type_id, from_date, to_date, percent, from_time, to_time, partial_hours, status)
    select current_setting('t.org')::uuid, current_setting('t.per')::uuid, id, '2027-04-20', '2027-04-20', 50, '10:00', '12:00', 2, 'approved' from absence_types where key = 'syk' limit 1;
  raise exception 'FEIL: grad med klokkeslett';
exception when others then if sqlerrm like 'FEIL:%' then raise; end if; end $$;
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'leder@a.no');
select pg_temp.check((select percent from org_absences(:'org_a', '2027-04-05', '2027-04-05') where employee_id = :'per') = 50, 'leder ser graden');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 'ola@a.no');
select pg_temp.check((select percent is null and type_name = 'Delvis borte' from org_absences(:'org_a', '2027-04-05', '2027-04-05') where employee_id = :'per'), 'kollega ser ikke graden');

reset role;
select 'ALLE DATABASETESTER OK' as resultat;
