-- Ukentlig kapasitetssjekk: lagrer nøkkeltall om databasen og varsler InnSpæll når det nærmer seg tid for større maskin.
-- Prosessor og minne vises ikke fra SQL; tegn på minnemangel er lav treffprosent i hurtigminnet.

create table if not exists capacity_snapshots (
  id bigserial primary key,
  taken_at timestamptz not null default now(),
  db_bytes bigint not null,
  connections int not null,
  max_connections int not null,
  blks_hit bigint not null,
  blks_read bigint not null,
  cache_hit_pct numeric,          -- for perioden siden forrige måling
  slow_queries jsonb not null default '[]',
  warnings text[] not null default '{}'
);
alter table capacity_snapshots enable row level security;
drop policy if exists "plattform ser" on capacity_snapshots;
create policy "plattform ser" on capacity_snapshots for select using (is_platform_admin());

create or replace function run_capacity_check() returns text[]
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_size bigint := pg_database_size(current_database());
  v_conn int; v_max int; v_hit bigint; v_read bigint;
  p capacity_snapshots;
  v_ratio numeric; v_slow jsonb := '[]'; v_warn text[] := '{}';
  v_limit constant bigint := 8::bigint * 1024 * 1024 * 1024; -- inkludert disk i Pro
begin
  select count(*) into v_conn from pg_stat_activity where datname = current_database();
  v_max := current_setting('max_connections')::int;
  select coalesce(sum(blks_hit), 0), coalesce(sum(blks_read), 0) into v_hit, v_read from pg_stat_database where datname = current_database();
  select * into p from capacity_snapshots order by taken_at desc limit 1;
  -- Treffprosent siden forrige måling (tellerne kan være nullstilt: da brukes totalen)
  if p.id is not null and v_hit >= p.blks_hit and v_read >= p.blks_read and (v_hit - p.blks_hit + v_read - p.blks_read) > 0 then
    v_ratio := round(100.0 * (v_hit - p.blks_hit) / (v_hit - p.blks_hit + v_read - p.blks_read), 2);
  elsif v_hit + v_read > 0 then
    v_ratio := round(100.0 * v_hit / (v_hit + v_read), 2);
  end if;

  if to_regclass('extensions.pg_stat_statements') is not null then
    execute $q$
      select coalesce(jsonb_agg(x order by x->>'mean_ms' desc), '[]') from (
        select jsonb_build_object('query', left(regexp_replace(query, '\s+', ' ', 'g'), 160),
                                  'mean_ms', round(mean_exec_time::numeric, 0), 'calls', calls) as x
        from extensions.pg_stat_statements
        where calls >= 20 and mean_exec_time > 300 and query not ilike '%pg_stat%' and query not ilike '%pg_catalog%'
        order by mean_exec_time desc limit 5) s $q$ into v_slow;
  end if;

  if v_size > v_limit * 0.75 then
    v_warn := v_warn || ('Databasen er ' || pg_size_pretty(v_size) || ', over 75 % av de inkluderte 8 GB. Ekstra disk koster $0,125 per GB.');
  end if;
  if v_conn > v_max * 0.7 then
    v_warn := v_warn || (v_conn || ' av ' || v_max || ' tilkoblinger er i bruk. Vurder Small (90) eller sjekk om noe holder tilkoblinger åpne.');
  end if;
  if v_ratio is not null and v_ratio < 99 and (v_hit + v_read) > 100000 then
    v_warn := v_warn || ('Bare ' || v_ratio || ' % av lesingene ble funnet i minnet (bør være over 99 %). Det er et tegn på for lite minne: vurder Small (2 GB).');
  end if;
  if jsonb_array_length(v_slow) > 0 then
    v_warn := v_warn || (jsonb_array_length(v_slow) || ' spørring(er) bruker i snitt over 0,3 sekunder. Sjekk dem før dere oppgraderer: ofte holder det med en indeks.');
  end if;

  insert into capacity_snapshots (db_bytes, connections, max_connections, blks_hit, blks_read, cache_hit_pct, slow_queries, warnings)
  values (v_size, v_conn, v_max, v_hit, v_read, v_ratio, v_slow, v_warn);
  delete from capacity_snapshots where taken_at < now() - interval '2 years';

  if array_length(v_warn, 1) > 0 then
    perform notify_platform_admins('platform_capacity', 'Kapasitet: Vaktpilot-databasen trenger oppmerksomhet',
      array_to_string(v_warn, ' '), '/plattform#kapasitet');
  end if;
  return v_warn;
end $$;
revoke execute on function run_capacity_check() from anon, public, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vaktpilot_kapasitet';
    perform cron.schedule('vaktpilot_kapasitet', '20 6 * * 1', 'select public.run_capacity_check()');
  end if;
end $$;
