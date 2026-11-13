-- Påminnelser skal gå kl. 17 norsk tid hele året. pg_cron går i UTC, så jobben kjøres kl. 15 og 16 UTC
-- og gjør bare noe når klokka er 17 i Norge (16 UTC om sommeren, 15 UTC om vinteren).
create or replace function run_reminders_oslo() returns int
language plpgsql security definer set search_path = public as $$
begin
  if extract(hour from now() at time zone 'Europe/Oslo') <> 17 then return 0; end if;
  perform run_reminders();
  return 1;
end $$;
revoke execute on function run_reminders_oslo() from anon, public, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vaktpilot_paaminnelser';
    perform cron.schedule('vaktpilot_paaminnelser', '0 15,16 * * *', 'select public.run_reminders_oslo()');
  end if;
end $$;
