-- Fakturering via Fiken: Vaktpilot lager fakturaene, Fiken sender dem (EHF eller e-post) og registrerer betalingen.
-- Fastprisen faktureres på forskudd, ekstra ansatte etterskuddsvis på neste faktura.
-- Fast løp ved manglende betaling: forfalt → påminnelse etter 14 dager → lederne sperres 30 dager etter påminnelsen.

alter table platform_settings add column if not exists invoice_mode text not null default 'manual' check (invoice_mode in ('off', 'manual', 'auto'));
alter table platform_settings add column if not exists fiken_company text;
alter table platform_settings add column if not exists fiken_bank_account text;
alter table platform_settings add column if not exists payment_days int not null default 14 check (payment_days between 1 and 60);
alter table platform_settings add column if not exists reminder_days int not null default 14 check (reminder_days between 1 and 60);
alter table platform_settings add column if not exists block_days int not null default 30 check (block_days between 1 and 90);
alter table platform_settings add column if not exists app_url text not null default 'https://vaktpilot.no';

alter table organizations add column if not exists billing_enabled boolean not null default false;
alter table organizations add column if not exists billing_from date;
alter table organizations add column if not exists billed_through date;
alter table organizations add column if not exists fiken_contact_id bigint;
alter table organizations add column if not exists blocked_at timestamptz;
alter table organizations add column if not exists block_paused_until date;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  issue_date date not null,
  due_date date not null,
  period_to date,
  lines jsonb not null,           -- [{description, quantity, unit_price}] eks. mva., i kroner
  net numeric(10,2) not null,
  vat numeric(10,2) not null,
  gross numeric(10,2) not null,
  status text not null default 'ready' check (status in ('ready', 'approved', 'sending', 'sent', 'paid', 'void', 'failed')),
  fiken_invoice_id bigint,
  invoice_number text,
  kid text,
  bank_account text,
  sent_at timestamptz,
  paid_at timestamptz,
  overdue_notified boolean not null default false,
  reminder_sent_at timestamptz,
  block_warned boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists invoices_org on invoices (org_id, issue_date desc);
create index if not exists invoices_status on invoices (status);
alter table usage_months add column if not exists invoice_id uuid references invoices(id) on delete set null;

-- Leder i bedriften, uavhengig av sperring (for abonnement, fakturaer og oppsigelse)
create or replace function is_org_leader(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select mfa_ok() and exists (select 1 from memberships where org_id = p_org and user_id = auth.uid() and role in ('owner', 'admin'));
$$;

-- Sperret bedrift: lederne har bare vanlig ansatt-tilgang til fakturaen er betalt
create or replace function is_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select mfa_ok() and exists (
    select 1 from memberships
    where org_id = p_org and user_id = auth.uid() and role in ('owner', 'admin')
  ) and not exists (select 1 from organizations where id = p_org and blocked_at is not null);
$$;

alter table invoices enable row level security;
drop policy if exists "leder og plattform leser" on invoices;
create policy "leder og plattform leser" on invoices for select using (is_org_leader(org_id) or is_platform_admin());

-- Feltene for fakturering kan bare endres av InnSpæll (eller av systemet selv)
create or replace function protect_org_invoicing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Fakturafunksjonene setter vaktpilot.billing_ok for sin egen transaksjon
  if auth.uid() is not null and not is_platform_admin() and coalesce(current_setting('vaktpilot.billing_ok', true), '') <> '1' and (
       new.billing_enabled is distinct from old.billing_enabled or new.billing_from is distinct from old.billing_from
    or new.billed_through is distinct from old.billed_through or new.fiken_contact_id is distinct from old.fiken_contact_id
    or new.blocked_at is distinct from old.blocked_at or new.block_paused_until is distinct from old.block_paused_until) then
    raise exception 'Fakturering kan bare endres av InnSpæll.';
  end if;
  return new;
end $$;
drop trigger if exists protect_org_invoicing on organizations;
create trigger protect_org_invoicing before update on organizations for each row execute function protect_org_invoicing();

-- Bedrifter som registrerer seg selv, faktureres fra registreringsdagen (prøveperioden kommer først)
create or replace function org_billing_defaults() returns trigger
language plpgsql as $$
begin
  if new.signup_by is not null then
    new.billing_enabled := true;
    new.billing_from := coalesce(new.billing_from, current_date);
  end if;
  return new;
end $$;
drop trigger if exists org_billing_defaults on organizations;
create trigger org_billing_defaults before insert on organizations for each row execute function org_billing_defaults();

create or replace function month_name(p date) returns text
language sql immutable as $$
  select (array['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'])[extract(month from p)::int]
         || ' ' || extract(year from p)::int;
$$;

-- Lager fakturaer som skal ut i dag. Trygg å kjøre flere ganger samme dag.
create or replace function generate_invoices(p_today date default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Europe/Oslo')::date);
  st platform_settings; o organizations; u record; n int := 0;
  v_lines jsonb; v_next date; v_end date; v_through date; v_m_end date; v_frac numeric;
  v_base numeric; v_per numeric; v_net numeric; v_inv uuid; v_usage date[];
begin
  perform set_config('vaktpilot.billing_ok', '1', true);
  perform pg_advisory_xact_lock(424242);
  select * into st from platform_settings where id = 1;
  if st.invoice_mode = 'off' then return 0; end if;

  for o in select * from organizations where active and billing_enabled and billing_from is not null loop
    v_lines := '[]'::jsonb; v_usage := '{}';
    v_base := coalesce(o.price_base, st.base_price, 0);
    v_per := coalesce(o.price_per_extra, st.per_employee_price, 0);
    v_through := o.billed_through;
    -- Oppsagt: fastprisen gjelder ut måneden det ble sagt opp (eller ut året som er betalt)
    v_end := case when o.cancel_requested_at is not null
                  then (date_trunc('month', o.cancel_requested_at at time zone 'Europe/Oslo') + interval '1 month' - interval '1 day')::date end;
    v_next := coalesce(o.billed_through + 1, greatest(o.billing_from, coalesce(o.trial_ends_at, o.billing_from)));

    if v_next <= v_today and (v_end is null or v_next <= v_end) then
      -- Resten av en påbegynt måned (etter prøveperioden): forholdsmessig, og neste måned kommer med på samme faktura
      if extract(day from v_next) <> 1 then
        v_m_end := (date_trunc('month', v_next) + interval '1 month' - interval '1 day')::date;
        v_frac := (v_m_end - v_next + 1)::numeric / extract(day from v_m_end);
        v_lines := v_lines || jsonb_build_object('description', 'Vaktpilot ' || to_char(v_next, 'DD.MM.') || '–' || to_char(v_m_end, 'DD.MM.YYYY'),
          'quantity', 1, 'unit_price', round(v_base * v_frac, 2));
        v_through := v_m_end;
        v_next := v_m_end + 1;
      end if;
      if (v_next <= v_today or jsonb_array_length(v_lines) > 0) and (v_end is null or v_next <= v_end) then
        if o.annual_start is not null and v_next >= o.annual_start and (o.annual_end is null or v_next < o.annual_end)
           and (extract(year from age(v_next, o.annual_start)) * 12 + extract(month from age(v_next, o.annual_start)))::int % 12 = 0 then
          v_lines := v_lines || jsonb_build_object('description',
            'Vaktpilot årsabonnement ' || month_name(v_next) || ' – ' || month_name((v_next + interval '11 months')::date),
            'quantity', 1, 'unit_price', v_base * coalesce(nullif(st.annual_months, 0), 10));
          v_through := (v_next + interval '12 months' - interval '1 day')::date;
        else
          v_lines := v_lines || jsonb_build_object('description', 'Vaktpilot ' || month_name(v_next), 'quantity', 1, 'unit_price', v_base);
          v_through := (v_next + interval '1 month' - interval '1 day')::date;
        end if;
      end if;
    end if;

    -- Ekstra aktive ansatte i måneder som er over (etterskuddsvis)
    if extract(day from v_today) = 1 or jsonb_array_length(v_lines) > 0 then
      perform compute_usage(o.id, (date_trunc('month', v_today) - interval '1 month')::date, true, false);
      for u in select * from usage_months
               where org_id = o.id and final and invoice_id is null and not trial and active_count > included
                 and month >= date_trunc('month', o.billing_from)::date and month < date_trunc('month', v_today)::date
               order by month loop
        v_frac := case when u.billed_from is not null
                       then ((u.month + interval '1 month')::date - u.billed_from)::numeric / ((u.month + interval '1 month')::date - u.month) else 1 end;
        v_lines := v_lines || jsonb_build_object('description',
          'Ekstra aktive ansatte ' || month_name(u.month) || ' (' || u.active_count || ' aktive, ' || u.included || ' inkludert)'
            || case when u.billed_from is not null then ', fra ' || to_char(u.billed_from, 'DD.MM.') else '' end,
          'quantity', u.active_count - u.included, 'unit_price', round(u.per_extra * v_frac, 2));
        v_usage := v_usage || u.month;
      end loop;
    end if;

    if jsonb_array_length(v_lines) > 0 then
      select coalesce(sum((l ->> 'quantity')::numeric * (l ->> 'unit_price')::numeric), 0) into v_net from jsonb_array_elements(v_lines) l;
      insert into invoices (org_id, issue_date, due_date, period_to, lines, net, vat, gross, status)
      values (o.id, v_today, v_today + st.payment_days, v_through, v_lines, round(v_net, 2), round(v_net * 0.25, 2), round(v_net * 1.25, 2),
              case when st.invoice_mode = 'auto' then 'approved' else 'ready' end)
      returning id into v_inv;
      update usage_months set invoice_id = v_inv where org_id = o.id and month = any(v_usage);
      if v_through is distinct from o.billed_through then
        update organizations set billed_through = v_through where id = o.id;
      end if;
      n := n + 1;
    end if;
  end loop;
  if n > 0 and st.invoice_mode = 'manual' then
    perform notify_platform_admins('invoices_ready', n || case when n = 1 then ' faktura' else ' fakturaer' end || ' venter på godkjenning',
      'Se over og godkjenn under Plattform › Fakturaer, så sendes de via Fiken.', '/plattform/fakturaer');
  end if;
  return n;
end $$;
revoke execute on function generate_invoices(date) from anon, public, authenticated;

-- Forfalt, påminnelse og sperring
create or replace function run_billing_dunning(p_today date default null) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Europe/Oslo')::date);
  st platform_settings; i record; n int := 0; v_key text; v_block date; v_amount text;
begin
  perform set_config('vaktpilot.billing_ok', '1', true);
  select * into st from platform_settings where id = 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
  for i in select inv.*, o.name as org_name, o.invoice_email, o.blocked_at, o.block_paused_until
           from invoices inv join organizations o on o.id = inv.org_id
           where inv.status = 'sent' and inv.due_date < v_today order by inv.due_date loop
    v_amount := trim(to_char(i.gross, 'FM999G999G990D00')) || ' kr';
    if not i.overdue_notified then
      insert into notifications (org_id, user_id, kind, title, body, link, email_status)
      select i.org_id, m.user_id, 'invoice_overdue', 'Faktura ' || coalesce(i.invoice_number, '') || ' har forfalt',
        v_amount || ' forfalt ' || to_char(i.due_date, 'DD.MM.YYYY') || coalesce('. KID ' || i.kid, '') || coalesce(', konto ' || i.bank_account, '')
          || '. Har dere betalt, kan dere se bort fra dette.', '/innstillinger/abonnement', 'pending'
      from memberships m where m.org_id = i.org_id and m.role in ('owner', 'admin');
      update invoices set overdue_notified = true where id = i.id;
      n := n + 1;
    end if;
    if i.reminder_sent_at is null and v_today >= i.due_date + st.reminder_days then
      if coalesce(v_key, '') <> '' and coalesce(i.invoice_email, '') <> '' then
        perform net.http_post(url := 'https://api.resend.com/emails',
          headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
          body := jsonb_build_object('from', 'Vaktpilot <faktura@vaktpilot.no>', 'to', jsonb_build_array(i.invoice_email),
            'subject', 'Påminnelse: faktura ' || coalesce(i.invoice_number, '') || ' fra Vaktpilot',
            'text', 'Hei!' || E'\n\n' || 'Vi finner ikke betaling for faktura ' || coalesce(i.invoice_number, '') || ' til ' || i.org_name || ', '
              || v_amount || ', som forfalt ' || to_char(i.due_date, 'DD.MM.YYYY') || '.' || E'\n\n'
              || 'Betal innen ' || to_char(v_today + 14, 'DD.MM.YYYY') || coalesce(' til konto ' || i.bank_account, '') || coalesce(' med KID ' || i.kid, '') || '.'
              || E'\n\n' || 'Er fakturaen ikke betalt ' || st.block_days || ' dager etter denne påminnelsen, sperres tilgangen for ledere i Vaktpilot til betalingen er registrert. '
              || 'De ansatte beholder tilgangen til sine vakter og timer.' || E'\n\n'
              || 'Har dere allerede betalt, kan dere se bort fra denne e-posten. Spørsmål? Svar på denne e-posten.' || E'\n\n' || 'Hilsen InnSpæll AS'));
      end if;
      insert into notifications (org_id, user_id, kind, title, body, link, email_status)
      select i.org_id, m.user_id, 'invoice_reminder', 'Påminnelse: faktura ' || coalesce(i.invoice_number, '') || ' er ikke betalt',
        v_amount || '. Ikke betalt innen ' || st.block_days || ' dager, sperres tilgangen for ledere til betalingen er registrert.',
        '/innstillinger/abonnement', 'skipped'
      from memberships m where m.org_id = i.org_id and m.role in ('owner', 'admin');
      update invoices set reminder_sent_at = now() where id = i.id;
      n := n + 1;
    elsif i.reminder_sent_at is not null and i.blocked_at is null and (i.block_paused_until is null or i.block_paused_until < v_today) then
      v_block := (i.reminder_sent_at at time zone 'Europe/Oslo')::date + st.block_days;
      if v_block < greatest(coalesce(i.block_paused_until, v_today), v_today) then v_block := v_today; end if;
      if not i.block_warned and v_today >= v_block - 3 then
        perform notify_platform_admins('billing_block', i.org_name || ' sperres ' || to_char(v_block, 'DD.MM.YYYY'),
          'Faktura ' || coalesce(i.invoice_number, '') || ', ' || v_amount || ', er ikke betalt. Du kan utsette sperringen under Plattform › Fakturaer.', '/plattform/fakturaer');
        insert into notifications (org_id, user_id, kind, title, body, link, email_status)
        select i.org_id, m.user_id, 'invoice_block_warning', 'Tilgangen for ledere sperres ' || to_char(v_block, 'DD.MM.YYYY'),
          'Faktura ' || coalesce(i.invoice_number, '') || ', ' || v_amount || ', er ikke betalt. Betal før da, så skjer ingenting.', '/innstillinger/abonnement', 'pending'
        from memberships m where m.org_id = i.org_id and m.role in ('owner', 'admin');
        update invoices set block_warned = true where id = i.id;
        n := n + 1;
      end if;
      if v_today >= v_block then
        update organizations set blocked_at = now() where id = i.org_id and blocked_at is null;
        perform notify_platform_admins('billing_blocked', i.org_name || ' er sperret',
          'Lederne har bare ansatt-tilgang til faktura ' || coalesce(i.invoice_number, '') || ' er betalt.', '/plattform/fakturaer');
        insert into notifications (org_id, user_id, kind, title, body, link, email_status)
        select i.org_id, m.user_id, 'invoice_blocked', 'Tilgangen for ledere er sperret',
          'Faktura ' || coalesce(i.invoice_number, '') || ', ' || v_amount || ', er ikke betalt. Tilgangen åpnes av seg selv når betalingen er registrert.',
          '/innstillinger/abonnement', 'pending'
        from memberships m where m.org_id = i.org_id and m.role in ('owner', 'admin');
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function run_billing_dunning(date) from anon, public, authenticated;

-- Hemmelighet som bare databasen og fakturajobben kjenner (sendes med når databasen starter jobben)
do $$ begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'billing_job_secret') then
    if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'vault' and p.proname = 'create_secret') then
      perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'billing_job_secret');
    else
      insert into vault.decrypted_secrets (name, decrypted_secret) values ('billing_job_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
    end if;
  end if;
end $$;

create or replace function billing_auth(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin() or (coalesce(p_secret, '') <> ''
    and p_secret = (select decrypted_secret from vault.decrypted_secrets where name = 'billing_job_secret'));
$$;
revoke execute on function billing_auth(text) from anon, public, authenticated;

-- Fakturajobben: lag nye fakturaer, kjør purreløpet, og si hva som skal sendes og sjekkes i Fiken
create or replace function billing_run(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st platform_settings; v_new int; v_dun int;
begin
  if not billing_auth(p_secret) then raise exception 'Ikke tillatt.'; end if;
  v_new := generate_invoices();
  v_dun := run_billing_dunning();
  select * into st from platform_settings where id = 1;
  return jsonb_build_object(
    'created', v_new, 'dunning', v_dun,
    'fiken', jsonb_build_object('company', st.fiken_company, 'bank_account', st.fiken_bank_account),
    'send', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'issue_date', i.issue_date, 'due_date', i.due_date, 'lines', i.lines,
        'period_to', i.period_to, 'org', jsonb_build_object('id', o.id, 'name', o.name, 'org_number', o.org_number, 'email', o.invoice_email,
          'address', o.address, 'postal_code', o.postal_code, 'city', o.city, 'fiken_contact_id', o.fiken_contact_id)) order by i.created_at)
      from invoices i join organizations o on o.id = i.org_id where i.status = 'approved'), '[]'::jsonb),
    'check', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'fiken_invoice_id', i.fiken_invoice_id))
      from invoices i where i.status = 'sent' and i.fiken_invoice_id is not null), '[]'::jsonb));
end $$;
revoke execute on function billing_run(text) from public;
grant execute on function billing_run(text) to anon, authenticated;

-- Steg i sendingen. Hver funksjon sjekker hemmeligheten (eller at det er InnSpæll).
create or replace function billing_step(p_secret text, p_invoice uuid, p_step text, p jsonb default '{}') returns boolean
language plpgsql security definer set search_path = public as $$
declare i invoices; v_org organizations;
begin
  if not billing_auth(p_secret) then raise exception 'Ikke tillatt.'; end if;
  perform set_config('vaktpilot.billing_ok', '1', true);
  select * into i from invoices where id = p_invoice for update;
  if not found then return false; end if;
  select * into v_org from organizations where id = i.org_id;
  if p_step = 'start' then
    -- Bare én sending per faktura: godkjent → sender
    update invoices set status = 'sending', error = null where id = p_invoice and status = 'approved';
    return found;
  elsif p_step = 'contact' then
    update organizations set fiken_contact_id = (p ->> 'contact_id')::bigint where id = i.org_id;
  elsif p_step = 'created' then
    update invoices set fiken_invoice_id = (p ->> 'fiken_invoice_id')::bigint, invoice_number = p ->> 'invoice_number',
      kid = p ->> 'kid', bank_account = p ->> 'bank_account' where id = p_invoice;
  elsif p_step = 'sent' then
    update invoices set status = 'sent', sent_at = now(), error = null where id = p_invoice;
  elsif p_step = 'failed' then
    update invoices set status = 'failed', error = left(p ->> 'error', 1000) where id = p_invoice;
    perform notify_platform_admins('invoice_failed', 'Faktura til ' || v_org.name || ' ble ikke sendt',
      left(coalesce(p ->> 'error', 'Ukjent feil'), 300) || case when i.fiken_invoice_id is not null or p ? 'fiken_invoice_id'
        then ' Fakturaen finnes i Fiken; send den derfra og merk den som sendt.' else '' end, '/plattform/fakturaer');
  elsif p_step = 'paid' then
    if i.status <> 'sent' then return false; end if;
    update invoices set status = 'paid', paid_at = now() where id = p_invoice;
    -- Alt betalt: åpne igjen
    if v_org.blocked_at is not null and not exists (
      select 1 from invoices where org_id = i.org_id and status = 'sent' and reminder_sent_at is not null) then
      update organizations set blocked_at = null where id = i.org_id;
      insert into notifications (org_id, user_id, kind, title, body, link)
      select i.org_id, m.user_id, 'invoice_unblocked', 'Takk for betalingen', 'Tilgangen for ledere er åpnet igjen.', '/'
      from memberships m where m.org_id = i.org_id and m.role in ('owner', 'admin');
    end if;
  else
    raise exception 'Ukjent steg.';
  end if;
  return true;
end $$;
revoke execute on function billing_step(text, uuid, text, jsonb) from public;
grant execute on function billing_step(text, uuid, text, jsonb) to anon, authenticated;

-- Databasen starter fakturajobben hver morgen
create or replace function billing_kickoff() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text; v_url text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'billing_job_secret';
  select app_url into v_url from platform_settings where id = 1;
  if (select invoice_mode from platform_settings where id = 1) = 'off' or v_secret is null then return; end if;
  perform net.http_post(url := v_url || '/api/fakturering',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
end $$;
revoke execute on function billing_kickoff() from anon, public, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vaktpilot_fakturering';
    perform cron.schedule('vaktpilot_fakturering', '15 6 * * *', 'select public.billing_kickoff()');
  end if;
end $$;

-- Plattform: innstillinger, fakturering per bedrift, og handlinger på fakturaer og sperring
create or replace function platform_billing_settings(p_mode text, p_company text, p_bank text, p_payment_days int, p_reminder_days int, p_block_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  update platform_settings set invoice_mode = p_mode, fiken_company = nullif(trim(p_company), ''), fiken_bank_account = nullif(trim(p_bank), ''),
    payment_days = p_payment_days, reminder_days = p_reminder_days, block_days = p_block_days, updated_at = now() where id = 1;
end $$;
revoke execute on function platform_billing_settings(text, text, text, int, int, int) from anon, public;
grant execute on function platform_billing_settings(text, text, text, int, int, int) to authenticated;

create or replace function platform_set_org_billing(p_org uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  -- Eksisterende kunder: første faktura 1. neste måned
  update organizations set billing_enabled = p_enabled,
    billing_from = case when p_enabled then coalesce(billing_from, (date_trunc('month', now() at time zone 'Europe/Oslo') + interval '1 month')::date) else billing_from end
  where id = p_org;
end $$;
revoke execute on function platform_set_org_billing(uuid, boolean) from anon, public;
grant execute on function platform_set_org_billing(uuid, boolean) to authenticated;

create or replace function platform_invoice_action(p_invoice uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare i invoices;
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  select * into i from invoices where id = p_invoice for update;
  if p_action = 'approve' and i.status = 'ready' then
    update invoices set status = 'approved' where id = p_invoice;
  elsif p_action = 'void' and i.status in ('ready', 'failed') and i.fiken_invoice_id is null then
    update invoices set status = 'void' where id = p_invoice;  -- perioden regnes som gratis
  elsif p_action = 'retry' and i.status = 'failed' and i.fiken_invoice_id is null then
    update invoices set status = 'approved', error = null where id = p_invoice;
  elsif p_action = 'mark_sent' and i.status in ('failed', 'sending') then
    update invoices set status = 'sent', sent_at = now(), error = null where id = p_invoice;
  elsif p_action = 'mark_paid' and i.status in ('sent', 'failed') then
    update invoices set status = 'sent' where id = p_invoice;
    perform billing_step(null, p_invoice, 'paid');
  else
    raise exception 'Det går ikke med denne fakturaen.';
  end if;
end $$;
revoke execute on function platform_invoice_action(uuid, text) from anon, public;
grant execute on function platform_invoice_action(uuid, text) to authenticated;

create or replace function platform_block_action(p_org uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  if p_action = 'pause' then
    update organizations set blocked_at = null, block_paused_until = (now() at time zone 'Europe/Oslo')::date + 14 where id = p_org;
    update invoices set block_warned = false where org_id = p_org and status = 'sent';
  elsif p_action = 'block' then
    update organizations set blocked_at = now() where id = p_org;
  else
    raise exception 'Ukjent handling.';
  end if;
end $$;
revoke execute on function platform_block_action(uuid, text) from anon, public;
grant execute on function platform_block_action(uuid, text) to authenticated;

-- Abonnement, oppsigelse og betalingsform må virke også når lederne er sperret
create or replace function refresh_my_usage(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_org_leader(p_org) or is_platform_admin()) then raise exception 'Ikke tillatt.'; end if;
  perform compute_usage(p_org, (now() at time zone 'Europe/Oslo')::date, false);
end $$;

do $$
declare f text;
begin
  -- Bytt is_admin med is_org_leader i oppsigelse og betalingsform
  for f in select unnest(array['request_cancellation(uuid,boolean)', 'set_billing_interval(uuid,text)']) loop
    execute (select replace(pg_get_functiondef(f::regprocedure), 'if not is_admin(p_org) then', 'if not is_org_leader(p_org) then'));
  end loop;
end $$;

drop policy if exists "leder og plattform ser" on usage_months;
create policy "leder og plattform ser" on usage_months for select using (is_org_leader(org_id) or is_platform_admin());

-- ── Ordrebekreftelse, «Kom i gang», avslutning og sletting, prisendring ─────────────────────

alter table organizations add column if not exists onboarding_hidden_at timestamptz;
alter table organizations add column if not exists ended_at date;           -- abonnementet er avsluttet (etter oppsigelse)
alter table organizations add column if not exists delete_after date;       -- data kan slettes fra denne datoen
alter table platform_settings add column if not exists next_price jsonb;    -- {base, included, per, from}: varslet prisendring

-- Ordrebekreftelse på e-post rett etter registrering. Er også bevis på avtalen.
create or replace function send_signup_confirmation(p_org uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare o organizations; st platform_settings; v_key text; v_to text[]; v_body text; v_owner text; v_first date; v_annual text := '';
begin
  select * into o from organizations where id = p_org;
  select * into st from platform_settings where id = 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
  if coalesce(v_key, '') = '' then return; end if;
  select lower(u.email) into v_owner from auth.users u where u.id = o.signup_by;
  v_to := array_remove(array[v_owner, case when lower(o.invoice_email) is distinct from v_owner then lower(o.invoice_email) end], null);
  v_first := coalesce(o.trial_ends_at, current_date);
  if o.billing_interval = 'year' then
    v_annual := E'\nBetaling: årlig, ' || trim(to_char(coalesce(o.price_base, st.base_price) * coalesce(nullif(st.annual_months, 0), 10), 'FM999G990')) || ' kr eks. mva. for 12 måneder, fra ' || to_char(o.annual_start, 'DD.MM.YYYY') || '.';
  end if;
  v_body := 'Hei!' || E'\n\n' || 'Takk for at ' || o.name || ' har valgt Vaktpilot. Dette er bekreftelsen på avtalen.' || E'\n\n'
    || 'Bedrift: ' || o.name || coalesce(' (org.nr. ' || o.org_number || ')', '') || E'\n'
    || 'Registrert: ' || to_char(coalesce(o.signup_at, now()) at time zone 'Europe/Oslo', 'DD.MM.YYYY') || coalesce(' av ' || v_owner, '') || E'\n'
    || case when o.trial_ends_at is not null then 'Gratis prøveperiode til og med ' || to_char(o.trial_ends_at - 1, 'DD.MM.YYYY') || E'.\n' else '' end
    || 'Pris: ' || trim(to_char(coalesce(o.price_base, st.base_price), 'FM999G990')) || ' kr per måned eks. mva. med '
      || coalesce(o.price_included, st.included_employees) || ' aktive ansatte inkludert, og ' || trim(to_char(coalesce(o.price_per_extra, st.per_employee_price), 'FM999G990'))
      || ' kr per ekstra aktive ansatt.' || coalesce(' Prisen er fast til ' || to_char(o.price_locked_until, 'DD.MM.YYYY') || '.', '')
    || v_annual || E'\n'
    || 'Første faktura: ' || to_char(v_first, 'DD.MM.YYYY') || ', til ' || coalesce(o.invoice_email, v_owner) || '.' || E'\n'
    || 'Vilkår og databehandleravtale (versjon ' || coalesce(o.terms_version, '') || '): ' || st.app_url || '/vilkar' || E'\n\n'
    || 'Slik kommer dere i gang:' || E'\n'
    || '1. Legg inn de ansatte under Ansatte.' || E'\n'
    || '2. Sjekk tariff og innstillinger under Innstillinger.' || E'\n'
    || '3. Lag og publiser den første vaktplanen.' || E'\n'
    || '4. Inviter de ansatte, så får de vaktene på mobilen.' || E'\n\n'
    || 'Ingen bindingstid. Dere kan si opp under Innstillinger › Abonnement.' || E'\n\n'
    || 'Spørsmål? Svar på denne e-posten.' || E'\n\n' || 'Hilsen InnSpæll AS';
  perform net.http_post(url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', 'Vaktpilot <hei@vaktpilot.no>', 'to', to_jsonb(v_to),
      'subject', 'Velkommen til Vaktpilot, ' || o.name, 'text', v_body));
end $$;
revoke execute on function send_signup_confirmation(uuid) from anon, public, authenticated;

do $$ begin
  execute (select replace(pg_get_functiondef('create_signup_org(uuid,text,jsonb)'::regprocedure),
    E'  return v_org;\nend', E'  perform send_signup_confirmation(v_org);\n  return v_org;\nend'));
end $$;

-- Daglig: avslutt oppsagte abonnement, si fra før sletting, la fast pris løpe ut, og innfør varslet prisendring
create or replace function run_subscription_housekeeping(p_today date default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_today date := coalesce(p_today, (now() at time zone 'Europe/Oslo')::date); o organizations; st platform_settings; n int := 0; v_end date;
begin
  perform set_config('vaktpilot.billing_ok', '1', true);
  perform set_config('vaktpilot.cancel_ok', '1', true);
  select * into st from platform_settings where id = 1;
  for o in select * from organizations where cancel_requested_at is not null and ended_at is null loop
    v_end := greatest((date_trunc('month', o.cancel_requested_at at time zone 'Europe/Oslo') + interval '1 month' - interval '1 day')::date,
                      coalesce(o.billed_through, '1900-01-01'::date));
    if v_today > v_end then
      update organizations set ended_at = v_end, delete_after = v_end + 90, active = false, billing_enabled = false where id = o.id;
      insert into notifications (org_id, user_id, kind, title, body, link, email_status)
      select o.id, m.user_id, 'subscription_ended', 'Abonnementet er avsluttet',
        'Takk for at dere brukte Vaktpilot. Dataene slettes etter ' || to_char(v_end + 90, 'DD.MM.YYYY') || '. Last ned det dere vil ta vare på før det, under Rapporter og Personvern.',
        '/rapporter', 'pending'
      from memberships m where m.org_id = o.id and m.role in ('owner', 'admin');
      perform notify_platform_admins('subscription_ended', o.name || ' er avsluttet', 'Data kan slettes fra ' || to_char(v_end + 90, 'DD.MM.YYYY') || '.', '/plattform');
      n := n + 1;
    end if;
  end loop;
  for o in select * from organizations where delete_after is not null and delete_after = v_today + 14 loop
    insert into notifications (org_id, user_id, kind, title, body, link, email_status)
    select o.id, m.user_id, 'data_deletion_soon', 'Dataene slettes om 14 dager',
      'Alt om ' || o.name || ' i Vaktpilot slettes ' || to_char(o.delete_after, 'DD.MM.YYYY') || '. Last ned det dere trenger før det.', '/rapporter', 'pending'
    from memberships m where m.org_id = o.id and m.role in ('owner', 'admin');
    n := n + 1;
  end loop;
  for o in select * from organizations where delete_after is not null and delete_after = v_today loop
    perform notify_platform_admins('data_deletion_due', 'Slett data for ' || o.name,
      'Avsluttet ' || to_char(o.ended_at, 'DD.MM.YYYY') || '. Vilkårene sier sletting innen 90 dager. Slett under Plattform.', '/plattform');
    n := n + 1;
  end loop;
  -- Fast pris (lanseringspris eller egen avtale) løper ut: standardprisen gjelder fra dagen etter
  update organizations set price_base = null, price_included = null, price_per_extra = null, price_locked_until = null
  where price_locked_until is not null and price_locked_until < v_today;
  -- Varslet prisendring trer i kraft
  if st.next_price is not null and (st.next_price ->> 'from')::date <= v_today then
    update platform_settings set base_price = (st.next_price ->> 'base')::numeric, included_employees = (st.next_price ->> 'included')::int,
      per_employee_price = (st.next_price ->> 'per')::numeric, next_price = null, updated_at = now() where id = 1;
    n := n + 1;
  end if;
  return n;
end $$;
revoke execute on function run_subscription_housekeeping(date) from anon, public, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vaktpilot_abonnement';
    perform cron.schedule('vaktpilot_abonnement', '5 5 * * *', 'select public.run_subscription_housekeeping()');
  end if;
end $$;

-- Plattform: varsle alle kunder om ny pris (minst 60 dager før). Kunder med fast pris beholder den til den løper ut.
create or replace function platform_announce_price(p_base numeric, p_included int, p_per numeric, p_from date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  if p_from < (now() at time zone 'Europe/Oslo')::date + 60 then raise exception 'Prisendringer må varsles minst 60 dager før.'; end if;
  update platform_settings set next_price = jsonb_build_object('base', p_base, 'included', p_included, 'per', p_per, 'from', p_from), updated_at = now() where id = 1;
  insert into notifications (org_id, user_id, kind, title, body, link, email_status)
  select o.id, m.user_id, 'price_change', 'Ny pris fra ' || to_char(p_from, 'DD.MM.YYYY'),
    'Vaktpilot koster ' || trim(to_char(p_base, 'FM999G990')) || ' kr per måned eks. mva. med ' || p_included || ' aktive ansatte inkludert, og '
      || trim(to_char(p_per, 'FM999G990')) || ' kr per ekstra aktive ansatt, fra ' || to_char(p_from, 'DD.MM.YYYY') || '.'
      || case when o.price_locked_until is not null and o.price_locked_until >= p_from then ' Dere har fast pris til ' || to_char(o.price_locked_until, 'DD.MM.YYYY') || ', og får den nye prisen etter det.' else '' end
      || ' Ønsker dere ikke å fortsette, kan dere si opp under Abonnement før endringen.',
    '/innstillinger/abonnement', 'pending'
  from organizations o join memberships m on m.org_id = o.id and m.role in ('owner', 'admin')
  where o.active and o.cancel_requested_at is null and (o.price_base is null or o.price_locked_until is not null);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function platform_announce_price(numeric, int, numeric, date) from anon, public;
grant execute on function platform_announce_price(numeric, int, numeric, date) to authenticated;

-- Plattform: slett alle data for en avsluttet bedrift. Krever at navnet skrives inn.
create or replace function platform_delete_org_data(p_org uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = public as $$
declare o organizations;
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  select * into o from organizations where id = p_org;
  if not found then raise exception 'Finner ikke bedriften.'; end if;
  if o.ended_at is null then raise exception 'Bare avsluttede abonnement kan slettes.'; end if;
  if trim(p_confirm_name) <> o.name then raise exception 'Skriv inn navnet på bedriften nøyaktig for å bekrefte.'; end if;
  -- Fakturaene ligger i Fiken (regnskapet); kopien her slettes sammen med resten
  delete from invoices where org_id = p_org;
  delete from organizations where id = p_org;
  perform notify_platform_admins('data_deleted', 'Data slettet: ' || o.name, 'Alle data om ' || o.name || ' er slettet fra Vaktpilot.', '/plattform');
end $$;
revoke execute on function platform_delete_org_data(uuid, text) from anon, public;
grant execute on function platform_delete_org_data(uuid, text) to authenticated;
