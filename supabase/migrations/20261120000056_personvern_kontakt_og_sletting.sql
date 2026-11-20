-- Personvern: arbeidsgiverens kontakt for personvern (vises for ansatte), og sletting av nærmeste pårørende etter sluttdato.
alter table organizations add column if not exists privacy_contact text check (privacy_contact is null or length(privacy_contact) <= 300);

do $$
declare d text := pg_get_functiondef('run_retention()'::regprocedure);
begin
  if position('a as (delete from availability where employee_id in (select id from ended) returning 1),' in d) = 0 then
    raise exception 'Fant ikke slettingen i run_retention';
  end if;
  execute replace(d, 'a as (delete from availability where employee_id in (select id from ended) returning 1),',
    'a as (delete from availability where employee_id in (select id from ended) returning 1),
     k as (delete from emergency_contacts where employee_id in (select id from ended) returning 1),');
end $$;
