-- Stempling kan slås av per bedrift. Da bekrefter de ansatte vakta i stedet.
alter table organizations add column if not exists clock_enabled boolean not null default true;

create or replace function block_clock_when_disabled() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'clock' and exists (select 1 from organizations o where o.id = new.org_id and not o.clock_enabled) then
    raise exception 'Stempling er ikke i bruk i denne bedriften. Bekreft vakta under Timer i stedet.';
  end if;
  return new;
end $$;
revoke execute on function block_clock_when_disabled() from anon, public, authenticated;
drop trigger if exists block_clock_when_disabled on time_entries;
create trigger block_clock_when_disabled before insert on time_entries
  for each row execute function block_clock_when_disabled();
