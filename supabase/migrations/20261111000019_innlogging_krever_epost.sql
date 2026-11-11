-- Innlogging krever e-post (for varsler og gjenoppretting). Lederen setter et midlertidig passord.
-- Velkomst-e-post legges i en utboks når e-postutsending ikke er satt opp ennå.

-- Felles: lag eller oppdater innlogging (e-post + passord, bekreftet) og koble til den ansatte.
create or replace function link_login(p_employee uuid, p_email text, p_password text, p_must_change boolean) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare e employees; v_user uuid; v_other boolean; v_email text := lower(trim(p_email));
begin
  select * into e from employees where id = p_employee for update;
  if p_password is null or length(p_password) < 8 then raise exception 'Passordet må ha minst 8 tegn.'; end if;
  v_user := e.user_id;
  if v_user is null then select id into v_user from auth.users where lower(email) = v_email; end if;
  if v_user is not null then
    select exists (select 1 from memberships m where m.user_id = v_user and (m.org_id <> e.org_id or m.role <> 'employee'))
        or exists (select 1 from platform_admin_emails p join auth.users u on lower(u.email) = lower(p.email) where u.id = v_user)
      into v_other;
    if v_other then
      raise exception 'Denne brukeren er administrator eller tilhører en annen bedrift. Vedkommende må logge inn med kode og bytte passord selv.';
    end if;
    update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
    where id = v_user;
  else
    v_user := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      crypt(p_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', e.full_name), now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), v_user, v_user::text, 'email',
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true, 'phone_verified', false), now(), now(), now());
  end if;
  update employees set user_id = v_user, must_change_password = p_must_change, email = v_email where id = e.id;
  insert into memberships (org_id, user_id, role) values (e.org_id, v_user, 'employee') on conflict do nothing;
  return v_user;
end $$;
revoke execute on function link_login(uuid, text, text, boolean) from anon, public, authenticated;

-- Felles kontroll av e-post før innlogging gis.
create or replace function check_login_email(p_employee uuid, p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare e employees; v_email text := lower(trim(coalesce(p_email, '')));
begin
  select * into e from employees where id = p_employee;
  if not found or not is_admin(e.org_id) then raise exception 'Ikke tillatt.'; end if;
  if e.end_date is not null and e.end_date < current_date then raise exception 'Den ansatte har sluttet.'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then raise exception 'Skriv inn en gyldig e-postadresse. Den trengs for varsler og for å kunne få nytt passord.'; end if;
  if exists (select 1 from employees x where x.org_id = e.org_id and x.id <> e.id and lower(x.email) = v_email) then
    raise exception 'En annen ansatt i bedriften har allerede denne e-posten.';
  end if;
  if e.user_id is not null and exists (select 1 from auth.users where id = e.user_id and lower(email) <> v_email) then
    raise exception 'Den ansatte er allerede koblet til en annen e-post. Bruk den, eller endre e-post under Opplysninger.';
  end if;
  return v_email;
end $$;
revoke execute on function check_login_email(uuid, text) from anon, public, authenticated;

-- Leder setter midlertidig passord (må byttes ved første innlogging).
create or replace function admin_set_login(p_employee uuid, p_login text, p_password text) returns text
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  v_email := check_login_email(p_employee, p_login);
  perform link_login(p_employee, v_email, p_password, true);
  return v_email;
end $$;
revoke execute on function admin_set_login(uuid, text, text) from anon, public;
grant execute on function admin_set_login(uuid, text, text) to authenticated;

-- Utboks: e-post som venter på at utsending er satt opp. Passord lagres aldri her.
create table if not exists email_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  to_email text not null,
  subject text not null,
  html text not null,
  body_text text not null,
  kind text not null,
  status text not null default 'waiting' check (status in ('waiting', 'sent', 'failed')),
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table email_outbox enable row level security;
drop policy if exists "admin ser" on email_outbox;
create policy "admin ser" on email_outbox for select using (is_admin(org_id));
drop policy if exists "admin legger i kø" on email_outbox;
create policy "admin legger i kø" on email_outbox for insert with check (is_admin(org_id));

-- Invitasjonslenke: den ansatte lager passordet selv. Bare en hash av lenken lagres.
create table if not exists login_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table login_invites enable row level security;
drop policy if exists "admin ser" on login_invites;
create policy "admin ser" on login_invites for select using (is_admin(org_id));

create or replace function admin_create_invite(p_employee uuid, p_email text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_email text; v_token text; e employees;
begin
  v_email := check_login_email(p_employee, p_email);
  select * into e from employees where id = p_employee;
  -- Samme sikkerhetsregel som for passord: ikke for administratorer eller brukere i andre bedrifter
  if exists (select 1 from auth.users u join memberships m on m.user_id = u.id
             where (u.id = e.user_id or lower(u.email) = v_email) and (m.org_id <> e.org_id or m.role <> 'employee')) then
    raise exception 'Denne brukeren er administrator eller tilhører en annen bedrift. Vedkommende logger inn med kode.';
  end if;
  update employees set email = v_email where id = p_employee;
  update login_invites set used_at = now() where employee_id = p_employee and used_at is null; -- gamle lenker slutter å virke
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into login_invites (org_id, employee_id, email, token_hash, created_by)
  values (e.org_id, e.id, v_email, encode(digest(v_token, 'sha256'), 'hex'), auth.uid());
  return v_token;
end $$;
revoke execute on function admin_create_invite(uuid, text) from anon, public;
grant execute on function admin_create_invite(uuid, text) to authenticated;

-- Offentlig: hvem lenken gjelder (uten innlogging)
create or replace function invite_info(p_token text) returns table (full_name text, org_name text, email text)
language sql stable security definer set search_path = public, extensions as $$
  select e.full_name, o.name, i.email
  from login_invites i join employees e on e.id = i.employee_id join organizations o on o.id = i.org_id
  where i.token_hash = encode(digest(p_token, 'sha256'), 'hex') and i.used_at is null and i.expires_at > now()
    and (e.end_date is null or e.end_date >= current_date);
$$;
revoke execute on function invite_info(text) from public;
grant execute on function invite_info(text) to anon, authenticated;

create or replace function accept_invite(p_token text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare i login_invites;
begin
  select * into i from login_invites
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') and used_at is null and expires_at > now() for update;
  if not found then raise exception 'Lenken er brukt eller utløpt. Be lederen din om en ny.'; end if;
  perform link_login(i.employee_id, i.email, p_password, false);
  update login_invites set used_at = now() where id = i.id;
  return i.email;
end $$;
revoke execute on function accept_invite(text, text) from public;
grant execute on function accept_invite(text, text) to anon, authenticated;
