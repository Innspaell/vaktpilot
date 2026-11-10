-- Faste jobber (bare i Supabase): påminnelser kl. 17 UTC (18/19 norsk tid) og sletterutiner kl. 02 UTC.
create extension if not exists pg_cron;
select cron.unschedule(jobname) from cron.job where jobname in ('vaktpilot_paaminnelser', 'vaktpilot_sletting');
select cron.schedule('vaktpilot_paaminnelser', '0 17 * * *', 'select public.run_reminders()');
select cron.schedule('vaktpilot_sletting', '0 2 * * *', 'select public.run_retention()');
