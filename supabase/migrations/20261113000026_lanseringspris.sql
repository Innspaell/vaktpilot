-- Lanseringspris: 39 kr per ekstra aktiv ansatt, og fast pris i en periode for de første kundene.
update platform_settings set per_employee_price = 39 where id = 1 and per_employee_price = 0;
alter table organizations add column if not exists price_locked_until date;

create or replace function platform_set_org_price(p_org uuid, p_base numeric, p_included int, p_per numeric, p_locked_until date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  update organizations set price_base = p_base, price_included = p_included, price_per_extra = p_per, price_locked_until = p_locked_until
  where id = p_org;
  perform compute_usage(p_org, (now() at time zone 'Europe/Oslo')::date, false);
end $$;
revoke execute on function platform_set_org_price(uuid, numeric, int, numeric, date) from anon, public;
grant execute on function platform_set_org_price(uuid, numeric, int, numeric, date) to authenticated;
drop function if exists platform_set_org_price(uuid, numeric, int, numeric);

create or replace function protect_org_billing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_platform_admin() and (
       new.price_base is distinct from old.price_base or new.price_included is distinct from old.price_included
    or new.price_per_extra is distinct from old.price_per_extra or new.price_locked_until is distinct from old.price_locked_until
    or new.active is distinct from old.active) then
    raise exception 'Pris og status kan bare endres av InnSpæll.';
  end if;
  return new;
end $$;

-- Første kunde: lanseringsprisen låses i 12 måneder
update organizations set price_base = 299, price_included = 5, price_per_extra = 39, price_locked_until = date '2027-11-30'
where name = 'Æ e Trønder AS' and price_locked_until is null;

select run_usage();
