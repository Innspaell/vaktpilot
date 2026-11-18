-- Support-kontakt og driftsmeldinger.
-- E-poster fra InnSpæll (kode, ordrebekreftelse, påminnelse) får svar-adresse til support.

alter table platform_settings add column if not exists support_email text;
alter table platform_settings add column if not exists support_phone text;

create or replace function support_reply_to() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(support_email), ''), 'ikkesvar@vaktpilot.no') from platform_settings where id = 1;
$$;
revoke execute on function support_reply_to() from anon, public, authenticated;

create or replace function platform_set_support(p_email text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  if coalesce(trim(p_email), '') <> '' and lower(trim(p_email)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'Ugyldig e-postadresse.';
  end if;
  update platform_settings set support_email = nullif(lower(trim(p_email)), ''), support_phone = nullif(trim(p_phone), ''), updated_at = now() where id = 1;
end $$;
revoke execute on function platform_set_support(text, text) from anon, public;
grant execute on function platform_set_support(text, text) to authenticated;

-- Svar-adresse i e-postene som InnSpæll sender
do $$
declare f text;
begin
  for f in select unnest(array['signup_request_code(text,jsonb)', 'send_signup_confirmation(uuid)', 'run_billing_dunning(date)']) loop
    execute (select regexp_replace(pg_get_functiondef(f::regprocedure),
      $re$jsonb_build_object\((\s*)'from', 'Vaktpilot <$re$, $rp$jsonb_build_object(\1'reply_to', support_reply_to(), 'from', 'Vaktpilot <$rp$, 'g'));
  end loop;
end $$;

-- Kontaktinfo til nettsiden og appen (sammen med pris og tariffer)
create or replace function support_contact() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('email', support_email, 'phone', support_phone) from platform_settings where id = 1;
$$;
revoke execute on function support_contact() from public;
grant execute on function support_contact() to anon, authenticated;

-- Driftsmeldinger: vises øverst for alle (og på innloggingssiden) mens de gjelder
create table if not exists service_notices (
  id uuid primary key default gen_random_uuid(),
  message text not null check (length(trim(message)) between 3 and 500),
  level text not null default 'info' check (level in ('info', 'warning', 'down')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table service_notices enable row level security;
drop policy if exists "alle leser" on service_notices;
create policy "alle leser" on service_notices for select to anon, authenticated using (true);
grant select on service_notices to anon;

create or replace function platform_create_notice(p_message text, p_level text, p_starts_at timestamptz, p_ends_at timestamptz, p_notify boolean) returns int
language plpgsql security definer set search_path = public as $$
declare v_id uuid; n int := 0;
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  if p_ends_at is not null and p_ends_at <= coalesce(p_starts_at, now()) then raise exception 'Slutt må være etter start.'; end if;
  insert into service_notices (message, level, starts_at, ends_at, created_by)
  values (trim(p_message), p_level, coalesce(p_starts_at, now()), p_ends_at, auth.uid()) returning id into v_id;
  -- Varsel på e-post til lederne i alle aktive bedrifter (f.eks. planlagt vedlikehold)
  if p_notify then
    insert into notifications (org_id, user_id, kind, title, body, link, email_status)
    select o.id, m.user_id, 'service_notice',
      case p_level when 'down' then 'Driftsavbrudd i Vaktpilot' when 'warning' then 'Viktig om Vaktpilot' else 'Melding fra Vaktpilot' end,
      trim(p_message) || case when coalesce(p_starts_at, now()) > now() + interval '1 hour'
        then ' (' || to_char(p_starts_at at time zone 'Europe/Oslo', 'DD.MM. "kl." HH24:MI')
          || coalesce('–' || to_char(p_ends_at at time zone 'Europe/Oslo', 'HH24:MI'), '') || ')' else '' end,
      '/', 'pending'
    from organizations o join memberships m on m.org_id = o.id and m.role in ('owner', 'admin') where o.active;
    get diagnostics n = row_count;
  end if;
  return n;
end $$;
revoke execute on function platform_create_notice(text, text, timestamptz, timestamptz, boolean) from anon, public;
grant execute on function platform_create_notice(text, text, timestamptz, timestamptz, boolean) to authenticated;

create or replace function platform_end_notice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  update service_notices set ends_at = now() where id = p_id and (ends_at is null or ends_at > now());
end $$;
revoke execute on function platform_end_notice(uuid) from anon, public;
grant execute on function platform_end_notice(uuid) to authenticated;
