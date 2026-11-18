-- Ønsker og innspill: alle innloggede kan foreslå funksjoner eller si fra om noe som ikke virker.
-- InnSpæll ser alt på plattformsiden, setter status og svarer. Den som sendte, får beskjed.

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete set null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'idea' check (kind in ('idea', 'problem', 'other')),
  body text not null check (length(trim(body)) between 3 and 4000),
  page text,
  role text,                       -- rollen da innspillet ble sendt (ansatt eller leder)
  status text not null default 'new' check (status in ('new', 'planned', 'done', 'declined')),
  reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists feedback_status on feedback (status, created_at desc);
create index if not exists feedback_user on feedback (user_id, created_at desc);

alter table feedback enable row level security;
drop policy if exists "egne og plattform leser" on feedback;
create policy "egne og plattform leser" on feedback for select using (user_id = auth.uid() or is_platform_admin());

-- Send innspill. Begrenset til 20 per døgn per person.
create or replace function submit_feedback(p_org uuid, p_kind text, p_body text, p_page text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_role text; v_org_name text;
begin
  if auth.uid() is null then raise exception 'Du må være logget inn.'; end if;
  if length(trim(coalesce(p_body, ''))) < 3 then raise exception 'Skriv litt mer, så vi forstår hva du mener.'; end if;
  if (select count(*) from feedback where user_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Du har sendt mange innspill i dag. Prøv igjen i morgen.';
  end if;
  if p_org is not null and not is_member(p_org) then p_org := null; end if;
  select m.role into v_role from memberships m where m.org_id = p_org and m.user_id = auth.uid();
  select name into v_org_name from organizations where id = p_org;
  insert into feedback (org_id, kind, body, page, role)
  values (p_org, case when p_kind in ('idea', 'problem', 'other') then p_kind else 'other' end, left(trim(p_body), 4000), left(p_page, 200), v_role)
  returning id into v_id;
  perform notify_platform_admins('feedback',
    case p_kind when 'problem' then 'Noe virker ikke' when 'idea' then 'Nytt ønske' else 'Nytt innspill' end || coalesce(' fra ' || v_org_name, ''),
    left(trim(p_body), 200), '/plattform/innspill');
  return v_id;
end $$;
revoke execute on function submit_feedback(uuid, text, text, text) from anon, public;
grant execute on function submit_feedback(uuid, text, text, text) to authenticated;

-- InnSpæll setter status og svarer. Den som sendte innspillet, får varsel når det er et svar eller ny status.
create or replace function platform_answer_feedback(p_id uuid, p_status text, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare f feedback; v_reply text := nullif(trim(coalesce(p_reply, '')), ''); v_status_text text;
begin
  if not is_platform_admin() then raise exception 'Ikke tillatt.'; end if;
  if p_status not in ('new', 'planned', 'done', 'declined') then raise exception 'Ukjent status.'; end if;
  select * into f from feedback where id = p_id for update;
  if not found then raise exception 'Finner ikke innspillet.'; end if;
  update feedback set status = p_status, reply = v_reply,
    replied_at = case when v_reply is distinct from f.reply then now() else replied_at end where id = p_id;
  if (p_status <> f.status or v_reply is distinct from f.reply) and f.org_id is not null
     and exists (select 1 from memberships where org_id = f.org_id and user_id = f.user_id) then
    v_status_text := case p_status when 'planned' then 'Vi skal lage det' when 'done' then 'Det er på plass' when 'declined' then 'Vi lager ikke dette nå' else 'Vi har sett det' end;
    insert into notifications (org_id, user_id, kind, title, body, link)
    values (f.org_id, f.user_id, 'feedback_reply', 'Svar på innspillet ditt: ' || v_status_text,
      coalesce(v_reply, '«' || left(f.body, 120) || case when length(f.body) > 120 then '…' else '' end || '»'), '/innspill');
  end if;
end $$;
revoke execute on function platform_answer_feedback(uuid, text, text) from anon, public;
grant execute on function platform_answer_feedback(uuid, text, text) to authenticated;
