-- Adresse fra Brønnøysundregistrene. create_organization tar imot den ved opprettelse.
alter table organizations
  add column if not exists address text,
  add column if not exists postal_code text,
  add column if not exists city text;

create or replace function create_organization(
  p_name text, p_org_number text default null,
  p_address text default null, p_postal_code text default null, p_city text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if not is_platform_admin() then
    raise exception 'Bare InnSpæll kan opprette nye bedrifter.';
  end if;
  if p_org_number is not null and exists (select 1 from organizations where org_number = p_org_number) then
    raise exception 'Det finnes allerede en bedrift med dette organisasjonsnummeret.';
  end if;
  insert into organizations (name, org_number, address, postal_code, city)
  values (p_name, p_org_number, p_address, p_postal_code, p_city) returning id into v_org;
  insert into memberships (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  insert into absence_types (org_id, key, name, paid, counts_as_work, unit, is_sick, needs_approval) values
    (v_org, 'ferie', 'Ferie', true, true, 'day', false, true),
    (v_org, 'avspasering', 'Avspasering', true, true, 'hour', false, true),
    (v_org, 'velferd', 'Velferdspermisjon', true, true, 'day', false, true),
    (v_org, 'permisjon', 'Ulønnet permisjon', false, false, 'day', false, true),
    (v_org, 'annet', 'Annen fri', false, false, 'day', false, true),
    (v_org, 'syk', 'Sykefravær', true, true, 'day', true, false),
    (v_org, 'sykt_barn', 'Sykt barn', true, true, 'day', true, false);
  return v_org;
end $$;

drop function if exists create_organization(text, text);
revoke execute on function create_organization(text, text, text, text, text) from anon, public;
grant execute on function create_organization(text, text, text, text, text) to authenticated;
