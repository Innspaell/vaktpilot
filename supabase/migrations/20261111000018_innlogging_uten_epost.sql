-- Lederen gir ansatte innlogging direkte: brukernavn eller e-post + startpassord.
-- Ingen e-postbekreftelse. Den ansatte bytter passord første gang.

alter table employees add column if not exists must_change_password boolean not null default false;
alter table employees add column if not exists username text;
create unique index if not exists employees_username_unique on employees (lower(username)) where username is not null;

-- Brukernavn blir en intern e-postadresse som aldri får e-post.
create or replace function login_email(p_login text) returns text
language sql immutable as $$
  select case when position('@' in p_login) > 0 then lower(trim(p_login))
              else lower(trim(p_login)) || '@ansatt.vaktpilot.no' end;
$$;

create or replace function admin_set_login(p_employee uuid, p_login text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  e employees;
  v_email text;
  v_user uuid;
  v_other boolean;
begin
  select * into e from employees where id = p_employee for update;
  if not found or not is_admin(e.org_id) then raise exception 'Ikke tillatt.'; end if;
  if e.end_date is not null and e.end_date < current_date then raise exception 'Den ansatte har sluttet.'; end if;
  if p_password is null or length(p_password) < 8 then raise exception 'Passordet må ha minst 8 tegn.'; end if;
  if p_login is null or trim(p_login) = '' then raise exception 'Skriv inn brukernavn eller e-post.'; end if;
  if position('@' in p_login) = 0 and trim(lower(p_login)) !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then
    raise exception 'Brukernavn kan ha 3–30 tegn: bokstaver a–z, tall, punktum, bindestrek og understrek.';
  end if;
  v_email := login_email(p_login);

  v_user := e.user_id;
  if v_user is null then
    select id into v_user from auth.users where lower(email) = v_email;
  end if;

  if v_user is not null then
    -- Sikkerhet: lederen kan bare sette passord for brukere som kun er ansatt i denne bedriften,
    -- aldri for andre administratorer eller brukere i andre bedrifter.
    select exists (
      select 1 from memberships m where m.user_id = v_user and (m.org_id <> e.org_id or m.role <> 'employee')
    ) or exists (select 1 from platform_admin_emails p join auth.users u on lower(u.email) = lower(p.email) where u.id = v_user)
    into v_other;
    if v_other then
      raise exception 'Denne brukeren er administrator eller tilhører en annen bedrift. Vedkommende må logge inn med kode og bytte passord selv.';
    end if;
    update auth.users
      set encrypted_password = crypt(p_password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now()
      where id = v_user;
  else
    v_user := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      crypt(p_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', e.full_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), v_user, v_user::text, 'email',
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true, 'phone_verified', false), now(), now(), now());
  end if;

  update employees set
    user_id = v_user,
    must_change_password = true,
    username = case when position('@' in p_login) = 0 then lower(trim(p_login)) else username end,
    email = case when position('@' in p_login) > 0 and email is null then v_email else email end
  where id = e.id;
  insert into memberships (org_id, user_id, role) values (e.org_id, v_user, 'employee') on conflict do nothing;
  return v_email;
end $$;
revoke execute on function admin_set_login(uuid, text, text) from anon, public;
grant execute on function admin_set_login(uuid, text, text) to authenticated;

create or replace function password_changed() returns void
language sql security definer set search_path = public as $$
  update employees set must_change_password = false where user_id = auth.uid();
$$;
revoke execute on function password_changed() from anon, public;
grant execute on function password_changed() to authenticated;
