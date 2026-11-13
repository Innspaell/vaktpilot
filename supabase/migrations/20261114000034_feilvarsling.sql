-- Feilvarsling: feil fra appen (server og nettleser) og fra faste jobber samles, og InnSpæll får varsel (også på e-post).

create table if not exists app_errors (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('server', 'client', 'cron', 'email')),
  message text not null,
  path text,
  digest text,
  fingerprint text not null,
  count int not null default 1,
  user_id uuid,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists app_errors_fp on app_errors (fingerprint, last_seen desc);
alter table app_errors enable row level security;
drop policy if exists "plattform ser" on app_errors;
create policy "plattform ser" on app_errors for select using (is_platform_admin());
drop policy if exists "plattform løser" on app_errors;
create policy "plattform løser" on app_errors for update using (is_platform_admin()) with check (is_platform_admin());

-- Kan kalles fra appen uten innlogging (feil kan skje før innlogging). Begrenset: samme feil telles opp, maks 300 nye per time.
create or replace function log_app_error(p_source text, p_message text, p_path text default null, p_digest text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_fp text; v_id uuid; v_msg text := left(coalesce(nullif(trim(p_message), ''), 'Ukjent feil'), 1000);
begin
  if p_source not in ('server', 'client', 'cron', 'email') then return; end if;
  v_fp := encode(digest(p_source || '|' || v_msg || '|' || coalesce(regexp_replace(p_path, '[0-9a-f-]{36}', ':id', 'g'), ''), 'sha256'), 'hex');
  update app_errors set count = count + 1, last_seen = now(), resolved_at = null
  where id = (select id from app_errors where fingerprint = v_fp and last_seen > now() - interval '24 hours' order by last_seen desc limit 1)
  returning id into v_id;
  if v_id is not null then return; end if;
  if (select count(*) from app_errors where first_seen > now() - interval '1 hour') >= 300 then return; end if;
  insert into app_errors (source, message, path, digest, fingerprint, user_id)
  values (p_source, v_msg, left(p_path, 300), left(p_digest, 100), v_fp, auth.uid());
  -- Varsel: høyst 10 per time, så en feilstorm ikke fyller innboksen
  if (select count(*) from notifications where kind = 'platform_error' and created_at > now() - interval '1 hour') < 10 then
    perform notify_platform_admins('platform_error',
      'Feil i Vaktpilot (' || case p_source when 'server' then 'server' when 'client' then 'nettleser' when 'cron' then 'fast jobb' else 'e-post' end || ')',
      left(v_msg, 200) || coalesce(' · ' || p_path, ''), '/plattform#feil');
  end if;
end $$;
revoke execute on function log_app_error(text, text, text, text) from public;
grant execute on function log_app_error(text, text, text, text) to anon, authenticated;

-- Enkel helsesjekk for oppetidsovervåking
create or replace function ping() returns boolean language sql stable as $$ select true $$;
grant execute on function ping() to anon, authenticated;

-- Daglig: faste jobber som har feilet, og e-post som ikke ble levert
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
      select status_code, left(coalesce(content, error_msg, ''), 300) as msg, count(*) as c
      from net._http_response where created > now() - interval '24 hours' and (status_code >= 400 or error_msg is not null)
      group by 1, 2 $q$
    loop
      perform log_app_error('email', 'E-postutsending feilet ' || r.c || ' gang(er) (status ' || coalesce(r.status_code::text, '–') || '): ' || r.msg, null, null);
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function run_health_check() from anon, public, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vaktpilot_helsesjekk';
    perform cron.schedule('vaktpilot_helsesjekk', '10 6 * * *', 'select public.run_health_check()');
  end if;
end $$;
