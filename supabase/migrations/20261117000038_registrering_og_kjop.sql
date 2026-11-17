-- Registrering og kjøp: nye bedrifter registrerer seg selv på vaktpilot.no/kom-i-gang.
-- Registreringen er stengt til InnSpæll åpner den på plattformsiden.
-- Supabase har «nye brukere» slått av, så e-posten bekreftes med vår egen kode, og brukeren opprettes her.

alter table platform_settings add column if not exists signup_open boolean not null default false;
alter table platform_settings add column if not exists trial_days int not null default 30 check (trial_days between 0 and 90);
alter table platform_settings add column if not exists launch_lock_months int not null default 12 check (launch_lock_months between 0 and 36);
-- Årlig betaling: prisen for så mange måneder (10 = to måneder gratis). 0 = ikke tilbudt.
alter table platform_settings add column if not exists annual_months int not null default 10 check (annual_months between 0 and 12);

alter table organizations add column if not exists invoice_email text;
alter table organizations add column if not exists trial_ends_at date;
alter table organizations add column if not exists trial_notified boolean not null default false;
alter table organizations add column if not exists signup_by uuid references auth.users(id) on delete set null;
alter table organizations add column if not exists signup_at timestamptz;
alter table organizations add column if not exists terms_version text;
alter table organizations add column if not exists terms_accepted_at timestamptz;
alter table organizations add column if not exists terms_accepted_by uuid references auth.users(id) on delete set null;
alter table organizations add column if not exists cancel_requested_at timestamptz;
alter table organizations add column if not exists cancel_requested_by uuid references auth.users(id) on delete set null;

-- Årlig betaling: fast pris for 12 måneder fra annual_start (første dag i en måned), forskuddsbetalt.
-- annual_end settes når kunden går tilbake til månedlig; året som er betalt, gjelder ut.
alter table organizations add column if not exists billing_interval text not null default 'month' check (billing_interval in ('month', 'year'));
alter table organizations add column if not exists annual_start date;
alter table organizations add column if not exists annual_end date;

alter table usage_months add column if not exists trial boolean not null default false;
-- Måneden prøveperioden slutter i: betales fra denne datoen, forholdsmessig (f.eks. 17.–31. desember)
alter table usage_months add column if not exists billed_from date;
alter table usage_months add column if not exists annual_covered boolean not null default false;  -- fastprisen er dekket av årsbetaling
alter table usage_months add column if not exists annual_charge numeric(10,2) not null default 0;  -- årsprisen faktureres i årets første måned

-- Lederne kan endre fakturaadressen selv, men ikke pris, prøveperiode, vilkår eller oppsigelse direkte
create or replace function protect_org_billing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Oppsigelse og betalingsform går gjennom egne funksjoner, som setter dette flagget for sin egen transaksjon
  if auth.uid() is not null and not is_platform_admin() and (
       new.price_base is distinct from old.price_base or new.price_included is distinct from old.price_included
    or new.price_per_extra is distinct from old.price_per_extra or new.price_locked_until is distinct from old.price_locked_until
    or new.active is distinct from old.active
    or new.trial_ends_at is distinct from old.trial_ends_at or new.trial_notified is distinct from old.trial_notified
    or new.signup_by is distinct from old.signup_by or new.signup_at is distinct from old.signup_at
    or new.terms_version is distinct from old.terms_version or new.terms_accepted_at is distinct from old.terms_accepted_at
    or new.terms_accepted_by is distinct from old.terms_accepted_by
    or (coalesce(current_setting('vaktpilot.cancel_ok', true), '') <> '1'
        and (new.cancel_requested_at is distinct from old.cancel_requested_at or new.cancel_requested_by is distinct from old.cancel_requested_by
          or new.billing_interval is distinct from old.billing_interval or new.annual_start is distinct from old.annual_start
          or new.annual_end is distinct from old.annual_end))) then
    raise exception 'Pris, prøveperiode og status kan bare endres av InnSpæll.';
  end if;
  return new;
end $$;

-- Koder for å bekrefte e-posten ved registrering. Ingen har tilgang til tabellen direkte.
create table if not exists signup_codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_count int not null default 1,
  window_start timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table signup_codes enable row level security;

-- Det nettsiden trenger å vite: om registreringen er åpen, prisen og hvilke tariffer man kan velge
create or replace function signup_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', s.signup_open,
    'open_for_me', s.signup_open or is_platform_admin(),
    'email_ready', exists (select 1 from vault.decrypted_secrets where name = 'resend_api_key' and coalesce(decrypted_secret, '') <> ''),
    'base', s.base_price, 'included', s.included_employees, 'per', s.per_employee_price,
    'trial_days', s.trial_days, 'lock_months', s.launch_lock_months, 'annual_months', s.annual_months,
    'rule_sets', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'description', r.description, 'kind', r.kind, 'area', r.area)
                       order by r.kind, r.name)
      from pay_rule_sets r
      where r.org_id is null and r.kind = 'tariff'
        and exists (select 1 from pay_rule_versions v where v.rule_set_id = r.id and v.status = 'published')
    ), '[]'::jsonb))
  from platform_settings s where s.id = 1;
$$;
revoke execute on function signup_status() from public;
grant execute on function signup_status() to anon, authenticated;

-- Felles kontroll av opplysningene i skjemaet. Kaster feil med tekst som kan vises til brukeren.
create or replace function signup_validate(d jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_orgnr text := regexp_replace(coalesce(d ->> 'org_number', ''), '\D', '', 'g');
begin
  if not coalesce((select signup_open from platform_settings where id = 1), false) and not is_platform_admin() then
    raise exception 'Registreringen er ikke åpen ennå.';
  end if;
  if length(trim(coalesce(d ->> 'name', ''))) < 2 then raise exception 'Skriv inn navnet på bedriften.'; end if;
  if v_orgnr !~ '^\d{9}$' then raise exception 'Organisasjonsnummeret må ha 9 siffer.'; end if;
  if exists (select 1 from organizations where regexp_replace(coalesce(org_number, ''), '\D', '', 'g') = v_orgnr) then
    raise exception 'Bedriften er allerede registrert i Vaktpilot. Be lederen der om å invitere deg, eller ta kontakt med InnSpæll.';
  end if;
  if length(trim(coalesce(d ->> 'full_name', ''))) < 2 then raise exception 'Skriv inn navnet ditt.'; end if;
  if coalesce(d ->> 'invoice_email', '') <> '' and lower(trim(d ->> 'invoice_email')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'Fakturaadressen er ikke en gyldig e-postadresse.';
  end if;
  if coalesce(d ->> 'rule_set', '') <> '' and not exists (
    select 1 from pay_rule_sets r where r.id::text = d ->> 'rule_set' and r.org_id is null
      and exists (select 1 from pay_rule_versions v where v.rule_set_id = r.id and v.status = 'published')) then
    raise exception 'Ukjent tariffavtale.';
  end if;
  if coalesce(d ->> 'billing', 'month') not in ('month', 'year')
     or (d ->> 'billing' = 'year' and coalesce((select annual_months from platform_settings where id = 1), 0) = 0) then
    raise exception 'Velg månedlig eller årlig betaling.';
  end if;
  if coalesce(d ->> 'terms_version', '') = '' or coalesce(d ->> 'dpa_version', '') = '' or (d ->> 'accept') is distinct from 'true' then
    raise exception 'Du må godta vilkårene og databehandleravtalen.';
  end if;
end $$;
revoke execute on function signup_validate(jsonb) from anon, public, authenticated;

-- Første måned som faktureres: måneden som starter på eller etter at prøveperioden er over
create or replace function first_billable_month(p_trial_ends date) returns date
language sql immutable as $$
  select case when p_trial_ends is null then date_trunc('month', (now() at time zone 'Europe/Oslo'))::date
              else (date_trunc('month', p_trial_ends - 1) + interval '1 month')::date end;
$$;

-- Oppretter bedriften for en bruker som har bekreftet e-posten sin.
create or replace function create_signup_org(p_user uuid, p_email text, d jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s platform_settings; v_org uuid; v_name text := trim(d ->> 'name'); v_full text := trim(d ->> 'full_name');
  v_orgnr text := regexp_replace(d ->> 'org_number', '\D', '', 'g');
begin
  perform signup_validate(d);
  if (select count(*) from organizations where signup_by = p_user) >= 3 then
    raise exception 'Du har allerede registrert flere bedrifter. Ta kontakt med InnSpæll for flere.';
  end if;
  select * into s from platform_settings where id = 1;

  insert into organizations (name, org_number, address, postal_code, city, invoice_email,
    price_base, price_included, price_per_extra, price_locked_until, trial_ends_at,
    signup_by, signup_at, terms_version, terms_accepted_at, terms_accepted_by, billing_interval)
  values (v_name, v_orgnr, nullif(trim(d ->> 'address'), ''), nullif(trim(d ->> 'postal_code'), ''), nullif(trim(d ->> 'city'), ''),
    coalesce(nullif(lower(trim(d ->> 'invoice_email')), ''), lower(p_email)),
    -- Lanseringspris: prisen som gjelder i dag, fast i det antallet måneder InnSpæll har satt
    case when s.launch_lock_months > 0 then s.base_price end,
    case when s.launch_lock_months > 0 then s.included_employees end,
    case when s.launch_lock_months > 0 then s.per_employee_price end,
    case when s.launch_lock_months > 0 then (current_date + make_interval(months => s.launch_lock_months))::date end,
    case when s.trial_days > 0 then current_date + s.trial_days end,
    p_user, now(), d ->> 'terms_version', now(), p_user, coalesce(nullif(d ->> 'billing', ''), 'month'))
  returning id into v_org;
  -- Årlig: året starter første måned etter prøveperioden
  update organizations set annual_start = first_billable_month(trial_ends_at) where id = v_org and billing_interval = 'year';

  insert into memberships (org_id, user_id, role) values (v_org, p_user, 'owner');
  insert into employees (org_id, user_id, full_name, email, phone)
  values (v_org, p_user, v_full, lower(p_email), nullif(trim(d ->> 'phone'), ''));
  insert into absence_types (org_id, key, name, paid, counts_as_work, unit, is_sick, needs_approval) values
    (v_org, 'ferie', 'Ferie', true, true, 'day', false, true),
    (v_org, 'avspasering', 'Avspasering', true, true, 'hour', false, true),
    (v_org, 'velferd', 'Velferdspermisjon', true, true, 'day', false, true),
    (v_org, 'permisjon', 'Ulønnet permisjon', false, false, 'day', false, true),
    (v_org, 'annet', 'Annen fri', false, false, 'day', false, true),
    (v_org, 'syk', 'Sykefravær', true, true, 'day', true, false),
    (v_org, 'sykt_barn', 'Sykt barn', true, true, 'day', true, false);
  if coalesce(d ->> 'rule_set', '') <> '' then
    insert into org_pay_rules (org_id, valid_from, rule_set_id, created_by) values (v_org, date '2000-01-01', (d ->> 'rule_set')::uuid, p_user);
  end if;
  insert into dpa_acceptances (org_id, version, accepted_by, accepted_name, accepted_email)
  values (v_org, d ->> 'dpa_version', p_user, v_full, lower(p_email));
  insert into audit_log (org_id, table_name, row_id, action, changed_by, after)
  values (v_org, 'organizations', v_org, 'SIGNUP', p_user,
    jsonb_build_object('terms_version', d ->> 'terms_version', 'dpa_version', d ->> 'dpa_version', 'name', v_full, 'email', lower(p_email)));

  perform notify_platform_admins('signup', 'Ny bedrift: ' || v_name,
    v_full || ' registrerte ' || v_name || ' (org.nr. ' || v_orgnr || ').', '/plattform');
  return v_org;
end $$;
revoke execute on function create_signup_org(uuid, text, jsonb) from anon, public, authenticated;

-- Innlogget bruker (f.eks. ansatt i en annen bedrift) registrerer en ny bedrift
create or replace function signup_create(p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or v_email = '' then raise exception 'Du må være logget inn.'; end if;
  return create_signup_org(auth.uid(), v_email, p_data);
end $$;
revoke execute on function signup_create(jsonb) from anon, public;
grant execute on function signup_create(jsonb) to authenticated;

-- Steg 1 for nye brukere: send en kode til e-posten
create or replace function signup_request_code(p_email text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_key text; v_code text; c signup_codes;
begin
  begin
    perform signup_validate(p_data);
  exception when others then
    return jsonb_build_object('error', sqlerrm);
  end;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then return jsonb_build_object('error', 'Skriv inn en gyldig e-postadresse.'); end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    return jsonb_build_object('error', 'Du har allerede en bruker i Vaktpilot. Logg inn først, så kommer du tilbake hit.', 'has_user', true);
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
  if coalesce(v_key, '') = '' then return jsonb_build_object('error', 'Vi kan ikke sende e-post akkurat nå. Prøv igjen senere.'); end if;
  -- Vern mot misbruk: maks 5 koder per adresse og 60 totalt per time
  if (select count(*) from signup_codes where created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('error', 'Mange registrerer seg akkurat nå. Prøv igjen om en time.');
  end if;
  select * into c from signup_codes where email = v_email;
  if found and c.window_start > now() - interval '1 hour' and c.sent_count >= 5 then
    return jsonb_build_object('error', 'Du har bedt om mange koder. Vent en time og prøv igjen.');
  end if;

  v_code := lpad((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into signup_codes as s (email, code_hash, expires_at)
  values (v_email, encode(digest(v_email || ':' || v_code, 'sha256'), 'hex'), now() + interval '1 hour')
  on conflict (email) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = now(),
    sent_count = case when s.window_start > now() - interval '1 hour' then s.sent_count + 1 else 1 end,
    window_start = case when s.window_start > now() - interval '1 hour' then s.window_start else now() end;

  perform net.http_post(url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Vaktpilot <ikkesvar@vaktpilot.no>', 'to', jsonb_build_array(v_email),
      'subject', 'Koden din: ' || v_code,
      'text', 'Skriv inn denne koden for å registrere ' || trim(p_data ->> 'name') || E' i Vaktpilot:\n\n' || v_code
        || E'\n\nKoden gjelder i en time. Har du ikke bedt om den, kan du se bort fra denne e-posten.',
      'html', '<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
        || '<table role="presentation" style="width:100%"><tr><td style="padding:24px 12px">'
        || '<table role="presentation" style="max-width:480px;margin:0 auto;width:100%;background:#fff;border-radius:12px"><tr><td style="padding:24px">'
        || '<div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#1f5fbf">Vaktpilot</div>'
        || '<p style="color:#16202b;font-size:15px;margin:16px 0 8px">Skriv inn denne koden for å registrere ' || html_esc(trim(p_data ->> 'name')) || ':</p>'
        || '<div style="font-size:32px;font-weight:800;letter-spacing:.2em;color:#16202b">' || v_code || '</div>'
        || '<p style="color:#5b6773;font-size:13px;margin:16px 0 0">Koden gjelder i en time. Har du ikke bedt om den, kan du se bort fra denne e-posten.</p>'
        || '</td></tr></table></td></tr></table></body></html>'));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function signup_request_code(text, jsonb) from public;
grant execute on function signup_request_code(text, jsonb) to anon, authenticated;

-- Steg 2: riktig kode oppretter brukeren og bedriften. Etterpå logger nettsiden inn med passordet.
create or replace function signup_complete(p_email text, p_code text, p_password text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  c signup_codes; v_user uuid; v_org uuid;
begin
  select * into c from signup_codes where email = v_email for update;
  if not found or c.expires_at < now() or c.attempts >= 5 then
    return jsonb_build_object('error', 'Koden er utløpt. Be om en ny kode.');
  end if;
  if c.code_hash <> encode(digest(v_email || ':' || regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'sha256'), 'hex') then
    update signup_codes set attempts = attempts + 1 where email = v_email;
    return jsonb_build_object('error', 'Feil kode. Sjekk e-posten og prøv igjen.');
  end if;
  if p_password is null or length(p_password) < 10 then return jsonb_build_object('error', 'Passordet må ha minst 10 tegn.'); end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    return jsonb_build_object('error', 'Du har allerede en bruker i Vaktpilot. Logg inn først.', 'has_user', true);
  end if;

  begin
    v_user := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      crypt(p_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', trim(p_data ->> 'full_name')), now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), v_user, v_user::text, 'email',
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true, 'phone_verified', false), now(), now(), now());
    v_org := create_signup_org(v_user, v_email, p_data);
  exception when others then
    return jsonb_build_object('error', sqlerrm);
  end;
  delete from signup_codes where email = v_email;
  return jsonb_build_object('ok', true, 'org', v_org);
end $$;
revoke execute on function signup_complete(text, text, text, jsonb) from public;
grant execute on function signup_complete(text, text, text, jsonb) to anon, authenticated;

-- Aktive ansatte per måned: gratis i prøveperioden, forholdsmessig i måneden den slutter
create or replace function compute_usage(p_org uuid, p_month date, p_final boolean, p_notify boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  o organizations; s platform_settings;
  v_from timestamptz; v_to timestamptz; v_ids uuid[]; v_incl int; v_base numeric; v_per numeric; v_n int; v_trial boolean;
  v_covered boolean; v_annual numeric := 0; v_from_day date; v_fraction numeric := 1;
  v_month date := date_trunc('month', p_month)::date;
  v_names text[] := array['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
begin
  select * into o from organizations where id = p_org;
  select * into s from platform_settings where id = 1;
  if exists (select 1 from usage_months where org_id = p_org and month = v_month and final) then return; end if;
  v_from := v_month::timestamp at time zone o.timezone;
  v_to := (v_month + interval '1 month')::timestamp at time zone o.timezone;
  select coalesce(array_agg(distinct x.employee_id), '{}') into v_ids from (
    select sh.employee_id from shifts sh
      where sh.org_id = p_org and sh.employee_id is not null and sh.status = 'published' and sh.starts_at >= v_from and sh.starts_at < v_to
    union
    select t.employee_id from time_entries t where t.org_id = p_org and t.starts_at >= v_from and t.starts_at < v_to
  ) x;
  v_n := coalesce(array_length(v_ids, 1), 0);
  v_incl := coalesce(o.price_included, s.included_employees, 5);
  v_base := coalesce(o.price_base, s.base_price, 0);
  v_per := coalesce(o.price_per_extra, s.per_employee_price, 0);
  -- Prøveperioden er nøyaktig 30 dager. Hele måneder innenfor er gratis; måneden den slutter i betales fra sluttdatoen.
  v_trial := o.trial_ends_at is not null and (v_month + interval '1 month')::date <= o.trial_ends_at;
  if not v_trial and o.trial_ends_at is not null and o.trial_ends_at > v_month then
    v_from_day := o.trial_ends_at;
    v_fraction := ((v_month + interval '1 month')::date - o.trial_ends_at)::numeric / ((v_month + interval '1 month')::date - v_month);
  end if;
  -- Årlig betaling: fastprisen er dekket i årsperioden; årsprisen kommer på årets første måned
  v_covered := not v_trial and o.annual_start is not null and v_month >= o.annual_start and (o.annual_end is null or v_month < o.annual_end);
  if v_covered and (extract(year from age(v_month, o.annual_start)) * 12 + extract(month from age(v_month, o.annual_start)))::int % 12 = 0 then
    v_annual := v_base * coalesce(nullif(s.annual_months, 0), 10);
  end if;

  insert into usage_months as u (org_id, month, active_count, active_employee_ids, included, base_price, per_extra, amount, trial,
    annual_covered, annual_charge, final, computed_at, billed_from)
  values (p_org, v_month, v_n, v_ids, v_incl, v_base, v_per,
    case when v_trial then 0 else v_annual + round((case when v_covered then 0 else v_base end + greatest(v_n - v_incl, 0) * v_per) * v_fraction, 2) end,
    v_trial, v_covered, v_annual, p_final, now(), v_from_day)
  on conflict (org_id, month) do update set active_count = excluded.active_count, active_employee_ids = excluded.active_employee_ids,
    included = excluded.included, base_price = excluded.base_price, per_extra = excluded.per_extra, amount = excluded.amount,
    trial = excluded.trial, annual_covered = excluded.annual_covered, annual_charge = excluded.annual_charge, billed_from = excluded.billed_from,
    final = excluded.final, computed_at = now();

  if p_notify and not p_final and not v_trial and v_n > v_incl
     and not (select notified_over from usage_months where org_id = p_org and month = v_month) then
    insert into notifications (org_id, user_id, kind, title, body, link)
    select p_org, m.user_id, 'plan_over',
      'Flere enn ' || v_incl || ' aktive ansatte denne måneden',
      v_n || ' ansatte har vakter eller timer i ' || v_names[extract(month from v_month)::int] || '. ' || v_incl || ' er inkludert i prisen'
        || case when v_per > 0 then ', og hver ekstra ansatt koster ' || trim(to_char(v_per, '999G990')) || ' kr for måneden.' else '.' end,
      '/innstillinger/abonnement'
    from memberships m where m.org_id = p_org and m.role in ('owner', 'admin');
    update usage_months set notified_over = true where org_id = p_org and month = v_month;
  end if;
end $$;
revoke execute on function compute_usage(uuid, date, boolean, boolean) from anon, public, authenticated;

-- Fem dager før prøveperioden er over: si fra til lederne
create or replace function run_trial_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare o record; n int := 0;
begin
  for o in select * from organizations
           where active and trial_ends_at is not null and not trial_notified and cancel_requested_at is null
             and trial_ends_at - 5 <= (now() at time zone 'Europe/Oslo')::date
  loop
    insert into notifications (org_id, user_id, kind, title, body, link, email_status)
    select o.id, m.user_id, 'trial_ending', 'Prøveperioden er over ' || to_char(o.trial_ends_at, 'DD.MM.YYYY'),
      'Du trenger ikke gjøre noe for å fortsette. Vil du ikke fortsette, kan du si opp under Abonnement før da.',
      '/innstillinger/abonnement', 'pending'
    from memberships m where m.org_id = o.id and m.role in ('owner', 'admin');
    update organizations set trial_notified = true where id = o.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function run_trial_reminders() from anon, public, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vaktpilot_proveperiode';
    perform cron.schedule('vaktpilot_proveperiode', '0 8 * * *', 'select public.run_trial_reminders()');
  end if;
end $$;

-- Lederen sier opp (eller angrer). InnSpæll får beskjed og avslutter ved utgangen av måneden.
create or replace function request_cancellation(p_org uuid, p_cancel boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not is_admin(p_org) then raise exception 'Ikke tillatt.'; end if;
  select name into v_name from organizations where id = p_org;
  perform set_config('vaktpilot.cancel_ok', '1', true);
  update organizations set cancel_requested_at = case when p_cancel then now() end,
    cancel_requested_by = case when p_cancel then auth.uid() end where id = p_org;
  perform set_config('vaktpilot.cancel_ok', '', true);
  insert into audit_log (org_id, table_name, row_id, action, changed_by, after)
  values (p_org, 'organizations', p_org, case when p_cancel then 'CANCEL' else 'UNCANCEL' end, auth.uid(), null);
  perform notify_platform_admins('cancellation',
    case when p_cancel then 'Oppsigelse: ' else 'Angret oppsigelse: ' end || v_name,
    case when p_cancel then v_name || ' har sagt opp Vaktpilot. Avslutt ved utgangen av måneden.' else v_name || ' fortsetter likevel.' end,
    '/plattform');
end $$;
revoke execute on function request_cancellation(uuid, boolean) from anon, public;
grant execute on function request_cancellation(uuid, boolean) to authenticated;

-- Lederen bytter mellom månedlig og årlig betaling.
-- Til årlig: året starter neste måned (eller første måned etter prøveperioden).
-- Til månedlig: året som er betalt gjelder ut, deretter månedlig.
create or replace function set_billing_interval(p_org uuid, p_interval text) returns void
language plpgsql security definer set search_path = public as $$
declare o organizations; s platform_settings; v_now date := date_trunc('month', now() at time zone 'Europe/Oslo')::date; v_elapsed int;
begin
  if not is_admin(p_org) then raise exception 'Ikke tillatt.'; end if;
  if p_interval not in ('month', 'year') then raise exception 'Ukjent betalingsform.'; end if;
  select * into o from organizations where id = p_org;
  select * into s from platform_settings where id = 1;
  if p_interval = 'year' and s.annual_months = 0 then raise exception 'Årlig betaling tilbys ikke nå.'; end if;
  perform set_config('vaktpilot.cancel_ok', '1', true);
  if p_interval = 'year' then
    if o.annual_start is not null and (o.annual_end is null or o.annual_end > v_now) then
      -- Fortsatt i et betalt år: fortsett å fornye
      update organizations set billing_interval = 'year', annual_end = null where id = p_org;
    else
      update organizations set billing_interval = 'year', annual_end = null,
        annual_start = greatest(first_billable_month(o.trial_ends_at), (v_now + interval '1 month')::date) where id = p_org;
    end if;
  elsif o.annual_start is not null and o.annual_start > v_now then
    -- Året har ikke startet ennå: ingen årsbetaling
    update organizations set billing_interval = 'month', annual_start = null, annual_end = null where id = p_org;
  elsif o.annual_start is not null and o.annual_end is null then
    v_elapsed := (extract(year from age(v_now, o.annual_start)) * 12 + extract(month from age(v_now, o.annual_start)))::int;
    update organizations set billing_interval = 'month',
      annual_end = (o.annual_start + make_interval(months => (v_elapsed / 12 + 1) * 12))::date where id = p_org;
  else
    update organizations set billing_interval = 'month' where id = p_org;
  end if;
  perform set_config('vaktpilot.cancel_ok', '', true);
  insert into audit_log (org_id, table_name, row_id, action, changed_by, after)
  values (p_org, 'organizations', p_org, 'BILLING', auth.uid(), jsonb_build_object('interval', p_interval));
  perform notify_platform_admins('billing', o.name || case when p_interval = 'year' then ' går over til årlig betaling' else ' går over til månedlig betaling' end,
    'Endringen er registrert under Abonnement hos kunden.', '/plattform');
end $$;
revoke execute on function set_billing_interval(uuid, text) from anon, public;
grant execute on function set_billing_interval(uuid, text) to authenticated;

-- Fakturagrunnlag for én måned (for InnSpæll)
create or replace function platform_invoice_basis(p_month date)
returns table (org_id uuid, name text, org_number text, invoice_email text, address text, postal_code text, city text,
               month date, active_count int, included int, base_price numeric, per_extra numeric, extra int, amount numeric,
               trial boolean, final boolean, price_locked_until date, cancel_requested_at timestamptz, active boolean,
               billing_interval text, annual_covered boolean, annual_charge numeric, annual_end date, billed_from date)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.org_number, o.invoice_email, o.address, o.postal_code, o.city,
         u.month, u.active_count, u.included, u.base_price, u.per_extra, greatest(u.active_count - u.included, 0), u.amount,
         u.trial, u.final, o.price_locked_until, o.cancel_requested_at, o.active,
         o.billing_interval, u.annual_covered, u.annual_charge, o.annual_end, u.billed_from
  from usage_months u join organizations o on o.id = u.org_id
  where is_platform_admin() and u.month = date_trunc('month', p_month)::date
  order by o.name;
$$;
revoke execute on function platform_invoice_basis(date) from anon, public;
grant execute on function platform_invoice_basis(date) to authenticated;

-- Plattform: åpne eller stenge registreringen, og prøveperiode / lanseringspris for nye kunder
create or replace function platform_set_signup(p_open boolean, p_trial_days int, p_lock_months int, p_annual_months int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  update platform_settings set signup_open = p_open, trial_days = greatest(0, least(90, p_trial_days)),
    launch_lock_months = greatest(0, least(36, p_lock_months)), annual_months = greatest(0, least(12, p_annual_months)),
    updated_at = now() where id = 1;
end $$;
revoke execute on function platform_set_signup(boolean, int, int, int) from anon, public;
grant execute on function platform_set_signup(boolean, int, int, int) to authenticated;
