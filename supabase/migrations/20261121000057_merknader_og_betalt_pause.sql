-- 1) Bedriften velger om pausen regnes som arbeidstid (aml. § 10-9: når den ansatte ikke fritt kan forlate
--    arbeidsplassen, eller det ikke finnes tilfredsstillende pauserom). Da trekkes pausen ikke fra.
alter table organizations add column if not exists paid_breaks boolean not null default false;

-- 2) Merknader fra den ansatte til en registrering eller vakt, som lederen tar stilling til.
create table if not exists entry_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  time_entry_id uuid references time_entries(id) on delete set null,
  shift_id uuid references shifts(id) on delete set null,
  date date not null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'done')),
  answer text check (answer is null or length(answer) <= 2000),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz
);
create index if not exists entry_notes_org_open on entry_notes (org_id) where status = 'open';
create index if not exists entry_notes_employee on entry_notes (employee_id, date);
alter table entry_notes enable row level security;

drop policy if exists "egen eller leder leser" on entry_notes;
create policy "egen eller leder leser" on entry_notes for select using (
  employee_id = my_employee_id(org_id) or is_admin(org_id) or (is_manager(org_id) and manages_employee(org_id, employee_id)));

drop policy if exists "ansatt skriver egen" on entry_notes;
create policy "ansatt skriver egen" on entry_notes for insert with check (
  employee_id = my_employee_id(org_id) and status = 'open' and answer is null and created_by = auth.uid()
  and (time_entry_id is null or exists (select 1 from time_entries t where t.id = time_entry_id and t.employee_id = entry_notes.employee_id))
  and (shift_id is null or exists (select 1 from shifts s where s.id = shift_id and s.employee_id = entry_notes.employee_id)));

drop policy if exists "leder svarer" on entry_notes;
create policy "leder svarer" on entry_notes for update
  using (is_admin(org_id) or (is_manager(org_id) and manages_employee(org_id, employee_id)))
  with check ((is_admin(org_id) or (is_manager(org_id) and manages_employee(org_id, employee_id)))
    and exists (select 1 from employees e where e.id = employee_id and e.org_id = entry_notes.org_id));
grant select, insert, update on entry_notes to authenticated;

-- Svar: hvem og når settes av databasen, og teksten i merknaden kan ikke endres
create or replace function entry_notes_on_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.body := old.body;
  new.employee_id := old.employee_id;
  new.org_id := old.org_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.status = 'done' and old.status = 'open' then
    new.resolved_by := auth.uid();
    new.resolved_at := now();
  elsif new.status = 'open' then
    new.resolved_by := null;
    new.resolved_at := null;
  end if;
  return new;
end $$;
revoke execute on function entry_notes_on_update() from anon, public, authenticated;
drop trigger if exists entry_notes_on_update on entry_notes;
create trigger entry_notes_on_update before update on entry_notes for each row execute function entry_notes_on_update();

-- Varsler: ny merknad til lederne, svar til den ansatte
create or replace function notify_entry_note() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_name text;
  v_d text := to_char(new.date, 'DD.MM.');
begin
  select e.user_id, e.full_name into v_user, v_name from employees e where e.id = new.employee_id;
  if tg_op = 'INSERT' then
    insert into notifications (org_id, user_id, kind, title, body, link, ref_id)
    select new.org_id, l.user_id, 'entry_note', coalesce(v_name, 'En ansatt') || ' har en merknad til ' || v_d,
      left(new.body, 300), '/', new.id
    from leaders_for(new.org_id, new.employee_id) l where l.user_id is distinct from new.created_by;
  elsif new.status = 'done' and old.status = 'open' then
    perform resolve_notifications(new.id, array['entry_note']);
    if v_user is not null and v_user is distinct from auth.uid() then
      insert into notifications (org_id, user_id, kind, title, body, link, ref_id)
      values (new.org_id, v_user, 'entry_note_answer', 'Lederen din har svart på merknaden for ' || v_d,
        coalesce(left(new.answer, 300), 'Merknaden er behandlet.'), '/timer', new.id);
    end if;
  end if;
  return new;
end $$;
revoke execute on function notify_entry_note() from anon, public, authenticated;
drop trigger if exists notify_entry_note on entry_notes;
create trigger notify_entry_note after insert or update on entry_notes for each row execute function notify_entry_note();

-- 3) Timer en leder fører eller endrer for en ansatt: den ansatte får beskjed og kan melde fra.
--    Flere dager på kort tid slås sammen til ett varsel.
create or replace function notify_entry_by_leader() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_tz text;
  v_d text;
  v_verb text;
begin
  if new.ends_at is null or auth.uid() is null then return new; end if;
  select e.user_id into v_user from employees e where e.id = new.employee_id;
  if v_user is null or v_user = auth.uid() then return new; end if;
  if tg_op = 'INSERT' then
    if new.source <> 'admin' then return new; end if;
    v_verb := 'ført';
  else
    if (new.starts_at, new.ends_at, new.break_minutes) is not distinct from (old.starts_at, old.ends_at, old.break_minutes) then return new; end if;
    v_verb := 'endret';
  end if;
  update notifications set title = 'Lederen din har ført eller endret timene dine for flere dager', ref_id = null
  where user_id = v_user and org_id = new.org_id and kind = 'entry_by_leader' and read_at is null
    and created_at > now() - interval '15 minutes';
  if found then return new; end if;
  select timezone into v_tz from organizations where id = new.org_id;
  v_d := to_char(new.starts_at at time zone coalesce(v_tz, 'Europe/Oslo'), 'DD.MM.');
  insert into notifications (org_id, user_id, kind, title, body, link, ref_id)
  values (new.org_id, v_user, 'entry_by_leader', 'Lederen din har ' || v_verb || ' timene dine for ' || v_d,
    'Se over timene, og meld fra hvis noe ikke stemmer.', '/timer', new.id);
  return new;
end $$;
revoke execute on function notify_entry_by_leader() from anon, public, authenticated;
drop trigger if exists notify_entry_by_leader on time_entries;
create trigger notify_entry_by_leader after insert or update on time_entries for each row execute function notify_entry_by_leader();

-- 4) «Å gjøre»: åpne merknader teller for lederne
do $$
declare
  v_old text := $q$      union all
      select 'vaktbytter venter på deg'$q$;
  v_new text := $q$      union all
      select 'merknader fra ansatte venter på svar', (select count(*) from entry_notes n where n.org_id = p_org and n.status = 'open' and n.employee_id in (select employee_id from led))
      union all
      select 'vaktbytter venter på deg'$q$;
  v_def text := pg_get_functiondef('todo_summary(uuid, uuid)'::regprocedure);
begin
  if position('merknader fra ansatte' in v_def) > 0 then return; end if;
  if position(v_old in v_def) = 0 then raise exception 'todo_summary: fant ikke teksten som skal byttes'; end if;
  execute replace(v_def, v_old, v_new);
end $$;
revoke execute on function todo_summary(uuid, uuid) from anon, public, authenticated;
