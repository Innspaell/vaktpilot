-- Varsler på e-post (av som standard, slås på per varseltype av leder), og status for innlogging/invitasjon.

do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net er ikke tilgjengelig her (lokal test).';
end $$;

alter table organizations add column if not exists email_prefs jsonb not null default '{}'::jsonb;
alter table memberships add column if not exists email_notifications boolean not null default true;
alter table notifications add column if not exists email_status text check (email_status in ('pending', 'sent', 'skipped'));
alter table notifications add column if not exists email_sent_at timestamptz;
create index if not exists notifications_email_pending on notifications (created_at) where email_status = 'pending';
alter table login_invites add column if not exists accepted_at timestamptz;

-- Varselvalg: slått av = sendes ikke. E-post på for typen + mottaker har ikke reservert seg = legges i e-postkø.
create or replace function notifications_respect_prefs() returns trigger
language plpgsql security definer set search_path = public as $$
declare o organizations;
begin
  select * into o from organizations where id = new.org_id;
  if (o.notification_prefs ->> new.kind) = 'false' then return null; end if;
  if (o.email_prefs ->> new.kind) = 'true'
     and exists (select 1 from memberships m where m.org_id = new.org_id and m.user_id = new.user_id and m.email_notifications) then
    new.email_status := 'pending';
  end if;
  return new;
end $$;
revoke execute on function notifications_respect_prefs() from anon, public, authenticated;

-- Leder lagrer e-postvalg. Blir noe slått på, får alle i bedriften beskjed i appen (p_announce = teksten).
create or replace function set_email_prefs(p_org uuid, p_prefs jsonb, p_announce text) returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := p_org; v_old jsonb; v_new_on boolean; n int := 0;
begin
  if v_org is null or not is_admin(v_org) then raise exception 'Ikke tillatt.'; end if;
  select email_prefs into v_old from organizations where id = v_org;
  select exists (select 1 from jsonb_each_text(p_prefs) x where x.value = 'true' and coalesce(v_old ->> x.key, 'false') <> 'true')
    into v_new_on;
  update organizations set email_prefs = coalesce(p_prefs, '{}'::jsonb) where id = v_org;
  if v_new_on and coalesce(p_announce, '') <> '' then
    insert into notifications (org_id, user_id, kind, title, body, link)
    select v_org, m.user_id, 'email_enabled', 'Varsler kommer nå også på e-post', p_announce, '/profil'
    from memberships m where m.org_id = v_org;
    get diagnostics n = row_count;
  end if;
  return n;
end $$;
revoke execute on function set_email_prefs(uuid, jsonb, text) from anon, public;
grant execute on function set_email_prefs(uuid, jsonb, text) to authenticated;

-- Den enkelte kan reservere seg mot e-post.
create or replace function set_my_email_notifications(p_org uuid, p_on boolean) returns void
language sql security definer set search_path = public as $$
  update memberships set email_notifications = p_on where org_id = p_org and user_id = auth.uid();
  update notifications set email_status = 'skipped' where org_id = p_org and user_id = auth.uid() and email_status = 'pending' and not p_on;
$$;
revoke execute on function set_my_email_notifications(uuid, boolean) from anon, public;
grant execute on function set_my_email_notifications(uuid, boolean) to authenticated;

-- Er e-postutsending koblet til (nøkkel i Vault)?
create or replace function email_sending_ready() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'resend_api_key' and coalesce(decrypted_secret, '') <> '');
$$;
revoke execute on function email_sending_ready() from anon, public;
grant execute on function email_sending_ready() to authenticated;

create or replace function html_esc(t text) returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

-- Sender ventende e-postvarsler. Kjøres hvert minutt.
-- Venter 2 minutter (leses varselet i appen før det, sendes ingen e-post), og samler flere varsler til én e-post.
create or replace function send_notification_emails() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text;
  v_base constant text := 'https://vaktpilot.no';
  r record;
  it record;
  v_list_html text; v_list_text text; v_head text; v_subject text; v_html text; v_text text;
  v_batch jsonb := '[]'::jsonb;
  v_ids uuid[] := '{}';
  v_count int := 0;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
  if coalesce(v_key, '') = '' then return 0; end if;

  -- Allerede lest, eller for gammelt: ingen e-post
  update notifications set email_status = 'skipped'
  where email_status = 'pending' and (read_at is not null or created_at < now() - interval '1 day');

  for r in
    select n.org_id, n.user_id, u.email, o.name as org_name, o.logo_url, array_agg(n.id order by n.created_at) as ids
    from notifications n
    join auth.users u on u.id = n.user_id
    join organizations o on o.id = n.org_id
    where n.email_status = 'pending' and n.read_at is null and n.created_at <= now() - interval '2 minutes'
      and coalesce(u.email, '') like '%@%'
    group by n.org_id, n.user_id, u.email, o.name, o.logo_url
    limit 500
  loop
    v_list_html := ''; v_list_text := '';
    for it in select id, title, body from notifications where id = any(r.ids) order by created_at loop
      v_list_html := v_list_html ||
        '<tr><td style="padding:12px 0;border-top:1px solid #e3e7ec">'
        || '<a href="' || v_base || '/varsler/' || it.id || '" style="color:#16202b;font-weight:700;font-size:15px;text-decoration:none">' || html_esc(it.title) || '</a>'
        || case when coalesce(it.body, '') <> '' then '<div style="color:#5b6773;font-size:14px;margin-top:2px">' || html_esc(it.body) || '</div>' else '' end
        || '</td></tr>';
      v_list_text := v_list_text || '• ' || it.title || case when coalesce(it.body, '') <> '' then E'\n  ' || it.body else '' end
        || E'\n  ' || v_base || '/varsler/' || it.id || E'\n\n';
    end loop;

    v_subject := case when array_length(r.ids, 1) = 1
      then (select title from notifications where id = r.ids[1])
      else array_length(r.ids, 1) || ' nye varsler fra ' || r.org_name end;

    v_head := case when r.logo_url ~ '^https://' and r.logo_url !~* '\.svg(\?|$)'
      then '<img src="' || html_esc(r.logo_url) || '" alt="' || html_esc(r.org_name) || '" style="display:block;max-height:56px;max-width:220px;border:0">'
      else '<div style="font-size:16px;font-weight:700;color:#16202b">' || html_esc(r.org_name) || '</div>' end;

    v_html := '<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
      || '<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px">'
      || '<table role="presentation" style="max-width:560px;margin:0 auto;width:100%;background:#fff;border-radius:12px;border-collapse:collapse"><tr><td style="padding:24px">'
      || '<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td>' || v_head || '</td>'
      || '<td style="text-align:right;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#1f5fbf">Vaktpilot</td></tr></table>'
      || '<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:16px">' || v_list_html || '</table>'
      || '<p style="margin:20px 0 0"><a href="' || v_base || '/varsler" style="display:inline-block;background:#1f5fbf;color:#fff;font-weight:700;padding:12px 20px;border-radius:8px;text-decoration:none">Åpne Vaktpilot</a></p>'
      || '</td></tr></table>'
      || '<p style="max-width:560px;margin:12px auto 0;color:#8a95a1;font-size:12px;line-height:1.5">Du får denne e-posten fordi ' || html_esc(r.org_name)
      || ' sender varsler fra Vaktpilot på e-post. Du kan slå av e-post under <a href="' || v_base || '/profil" style="color:#8a95a1">Profil</a>. Ikke svar på denne e-posten.</p>'
      || '</td></tr></table></body></html>';
    v_text := v_list_text || 'Åpne Vaktpilot: ' || v_base || E'/varsler\n\n'
      || 'Du får denne e-posten fordi ' || r.org_name || ' sender varsler fra Vaktpilot på e-post. Du kan slå av e-post under Profil: ' || v_base || '/profil';

    v_batch := v_batch || jsonb_build_object(
      'from', '"' || replace(replace(r.org_name, '"', ''), '\', '') || ' via Vaktpilot" <ikkesvar@vaktpilot.no>',
      'to', jsonb_build_array(r.email), 'subject', v_subject, 'html', v_html, 'text', v_text);
    v_ids := v_ids || r.ids;
    v_count := v_count + 1;

    -- Resend tar inntil 100 e-poster per kall
    if jsonb_array_length(v_batch) = 100 then
      perform net.http_post(url := 'https://api.resend.com/emails/batch', body := v_batch,
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'));
      update notifications set email_status = 'sent', email_sent_at = now() where id = any(v_ids);
      v_batch := '[]'::jsonb; v_ids := '{}';
    end if;
  end loop;

  if jsonb_array_length(v_batch) > 0 then
    perform net.http_post(url := 'https://api.resend.com/emails/batch', body := v_batch,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'));
    update notifications set email_status = 'sent', email_sent_at = now() where id = any(v_ids);
  end if;

  -- Mottakere uten e-post
  update notifications n set email_status = 'skipped'
  where n.email_status = 'pending' and n.created_at <= now() - interval '2 minutes'
    and not exists (select 1 from auth.users u where u.id = n.user_id and coalesce(u.email, '') like '%@%');
  return v_count;
end $$;
revoke execute on function send_notification_emails() from anon, public, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vaktpilot_epostvarsler';
    perform cron.schedule('vaktpilot_epostvarsler', '* * * * *', 'select public.send_notification_emails()');
  end if;
end $$;

-- Invitasjon tatt i bruk (skiller fra lenker som ble erstattet av en ny)
create or replace function accept_invite(p_token text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare i login_invites;
begin
  select * into i from login_invites
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') and used_at is null and expires_at > now() for update;
  if not found then raise exception 'Lenken er brukt eller utløpt. Be lederen din om en ny.'; end if;
  perform link_login(i.employee_id, i.email, p_password, false);
  update login_invites set used_at = now(), accepted_at = now() where id = i.id;
  return i.email;
end $$;
revoke execute on function accept_invite(text, text) from public;
grant execute on function accept_invite(text, text) to anon, authenticated;

-- Innloggingsstatus for alle ansatte i bedriften (for leder)
create or replace function employees_login_status(p_org uuid)
returns table (employee_id uuid, last_sign_in_at timestamptz, invite_email text, invite_created_at timestamptz,
               invite_expires_at timestamptz, invite_accepted_at timestamptz, invite_open boolean)
language sql stable security definer set search_path = public as $$
  select e.id, u.last_sign_in_at, li.email, li.created_at, li.expires_at, li.accepted_at,
         (li.id is not null and li.used_at is null and li.expires_at > now())
  from employees e
  left join auth.users u on u.id = e.user_id
  left join lateral (select * from login_invites i where i.employee_id = e.id order by i.created_at desc limit 1) li on true
  where e.org_id = p_org and is_admin(p_org);
$$;
revoke execute on function employees_login_status(uuid) from anon, public;
grant execute on function employees_login_status(uuid) to authenticated;
