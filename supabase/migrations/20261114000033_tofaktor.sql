-- Tofaktor (TOTP med kodeapp). Ledere og InnSpæll må ha bekreftet tofaktor i økta (aal2) for å bruke lederrettigheter.
-- Kravet ligger i databasen, så det gjelder også om noen går forbi appen.

create or replace function mfa_ok() returns boolean
language sql stable set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
grant execute on function mfa_ok() to authenticated;

create or replace function is_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select mfa_ok() and exists (
    select 1 from memberships
    where org_id = p_org and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select mfa_ok() and (
    exists (select 1 from platform_admins where user_id = auth.uid())
    or exists (select 1 from platform_admin_emails where email = lower(coalesce(auth.jwt() ->> 'email', ''))));
$$;

-- Må brukeren ha tofaktor? (leder i en bedrift eller InnSpæll, uavhengig av om økta er bekreftet)
create or replace function mfa_required() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and role in ('owner', 'admin'))
      or exists (select 1 from platform_admins where user_id = auth.uid())
      or exists (select 1 from platform_admin_emails where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke execute on function mfa_required() from anon, public;
grant execute on function mfa_required() to authenticated;

-- Nullstill tofaktor (mistet mobil). InnSpæll kan nullstille alle; en leder kan nullstille vanlige ansatte i egen bedrift.
create or replace function reset_mfa(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if is_platform_admin() then
    null;
  else
    if exists (select 1 from memberships where user_id = p_user and role in ('owner', 'admin'))
       or exists (select 1 from platform_admins where user_id = p_user) then
      raise exception 'Tofaktor for ledere kan bare nullstilles av InnSpæll.';
    end if;
    select m.org_id into v_org from memberships m where m.user_id = p_user and is_admin(m.org_id) limit 1;
    if v_org is null then raise exception 'Ikke tillatt.'; end if;
  end if;
  delete from auth.mfa_factors where user_id = p_user;
  insert into audit_log (org_id, table_name, row_id, action, changed_by)
  select m.org_id, 'auth.mfa_factors', p_user, 'MFA_RESET', auth.uid() from memberships m where m.user_id = p_user;
end $$;
revoke execute on function reset_mfa(uuid) from anon, public;
grant execute on function reset_mfa(uuid) to authenticated;

-- Hvem har tofaktor (for leder og plattform)
create or replace function users_mfa_status(p_users uuid[]) returns table (user_id uuid, has_mfa boolean)
language sql stable security definer set search_path = public as $$
  select u, exists (select 1 from auth.mfa_factors f where f.user_id = u and f.status = 'verified')
  from unnest(p_users) u
  where is_platform_admin() or exists (select 1 from memberships m where m.user_id = u and is_admin(m.org_id));
$$;
revoke execute on function users_mfa_status(uuid[]) from anon, public;
grant execute on function users_mfa_status(uuid[]) to authenticated;

-- InnSpæll: nullstill tofaktor for en bruker med e-post (f.eks. leder som har mistet mobilen)
create or replace function platform_reset_mfa_by_email(p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  select id into v from auth.users where lower(email) = lower(trim(p_email));
  if v is null then return false; end if;
  perform reset_mfa(v);
  return true;
end $$;
revoke execute on function platform_reset_mfa_by_email(text) from anon, public;
grant execute on function platform_reset_mfa_by_email(text) to authenticated;
