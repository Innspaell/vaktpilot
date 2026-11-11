-- Invitasjonssiden viser bedriftens logo.
drop function if exists invite_info(text);
create function invite_info(p_token text) returns table (full_name text, org_name text, email text, logo_url text)
language sql stable security definer set search_path = public, extensions as $$
  select e.full_name, o.name, i.email, o.logo_url
  from login_invites i join employees e on e.id = i.employee_id join organizations o on o.id = i.org_id
  where i.token_hash = encode(digest(p_token, 'sha256'), 'hex') and i.used_at is null and i.expires_at > now()
    and (e.end_date is null or e.end_date >= current_date);
$$;
revoke execute on function invite_info(text) from public;
grant execute on function invite_info(text) to anon, authenticated;
