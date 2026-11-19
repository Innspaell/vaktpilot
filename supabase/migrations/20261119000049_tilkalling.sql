-- Tilkallingsvikar / ekstrahjelp: ingen avtalt arbeidstid, 0 % og 0 t/uke er lov.
alter table employment_terms add column if not exists on_call boolean not null default false;
do $$
declare c text;
begin
  for c in select conname from pg_constraint
    where conrelid = 'employment_terms'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%position_pct%'
  loop
    execute format('alter table employment_terms drop constraint %I', c);
  end loop;
end $$;
alter table employment_terms add constraint employment_terms_position_pct_check
  check (position_pct >= 0 and position_pct <= 100 and (on_call or position_pct > 0));
alter table employment_terms add constraint employment_terms_hours_check check (hours_per_week >= 0);
