-- Feilvarsling: skill e-post (Resend) fra faktureringsjobben, som også går via pg_net.
create or replace function run_health_check() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    for r in execute $q$
      select j.jobname, d.return_message, count(*) as c
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
      where d.status = 'failed' and d.start_time > now() - interval '24 hours'
      group by j.jobname, d.return_message $q$
    loop
      perform log_app_error('cron', 'Fast jobb feilet ' || r.c || ' gang(er): ' || r.jobname || ' – ' || left(coalesce(r.return_message, ''), 300), r.jobname, null);
      n := n + 1;
    end loop;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'net') and to_regclass('net._http_response') is not null then
    for r in execute $q$
      select status_code, left(coalesce(content, error_msg, ''), 300) as msg, count(*) as c,
        -- Resend svarer med statusCode/name; vår egen app (faktureringsjobben) med {"error": ...}
        coalesce(content, '') like '%"statusCode"%' or coalesce(content, '') ilike '%resend%' as is_email
      from net._http_response where created > now() - interval '24 hours' and (status_code >= 400 or error_msg is not null)
      group by 1, 2, 4 $q$
    loop
      if r.is_email then
        perform log_app_error('email', 'E-postutsending feilet ' || r.c || ' gang(er) (status ' || coalesce(r.status_code::text, '–') || '): ' || r.msg, null, null);
      else
        perform log_app_error('cron', 'Faktureringsjobben (kall til appen) feilet ' || r.c || ' gang(er) (status ' || coalesce(r.status_code::text, '–') || '): ' || r.msg, 'billing_kickoff', null);
      end if;
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function run_health_check() from anon, public, authenticated;

-- Feilen 20.11 var faktureringsjobben (videresending fra vaktpilot.no til www mistet nøkkelen), ikke e-post. Rettet.
update app_errors set resolved_at = now()
where resolved_at is null and message like 'E-postutsending feilet%' and message like '%Ikke tillatt%';
