-- Arbeidslisten «Å gjøre»: lønnsfrister per bedrift, og morgenliste på e-post (valgfritt per bruker).

alter table organizations add column if not exists payroll_approve_day int not null default 1 check (payroll_approve_day between 1 and 28);
alter table organizations add column if not exists payroll_pay_day int not null default 10 check (payroll_pay_day between 1 and 28);
alter table memberships add column if not exists todo_digest boolean not null default false;

create or replace function set_my_todo_digest(p_org uuid, p_on boolean) returns void
language sql security definer set search_path = public as $$
  update memberships set todo_digest = p_on where org_id = p_org and user_id = auth.uid();
$$;
revoke execute on function set_my_todo_digest(uuid, boolean) from anon, public;
grant execute on function set_my_todo_digest(uuid, boolean) to authenticated;

-- Ansatte en leder har ansvar for (samme regel som manages_employee, men for en gitt bruker uten innlogging)
create or replace function employees_led_by(p_org uuid, p_user uuid) returns table (employee_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id from employees e
  join memberships m on m.org_id = p_org and m.user_id = p_user
  where e.org_id = p_org and (
    m.role in ('owner', 'admin')
    or (m.role = 'manager' and (
      not exists (select 1 from departments d where d.org_id = p_org and d.archived_at is null)
      or not exists (select 1 from employee_departments ed where ed.employee_id = e.id)
      or exists (select 1 from employee_departments ed join manager_departments md
                 on md.department_id = ed.department_id and md.user_id = p_user where ed.employee_id = e.id))));
$$;
revoke execute on function employees_led_by(uuid, uuid) from anon, public, authenticated;

-- Hva som venter på en bruker, som tall (brukes i morgenlisten). Ledere får sine saker pluss egne.
create or replace function todo_summary(p_org uuid, p_user uuid) returns table (label text, n int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
  v_emp uuid;
  v_tz text;
  v_today date;
begin
  select role::text into v_role from memberships where org_id = p_org and user_id = p_user;
  select id into v_emp from employees where org_id = p_org and user_id = p_user;
  select timezone into v_tz from organizations where id = p_org;
  v_today := (now() at time zone coalesce(v_tz, 'Europe/Oslo'))::date;

  if v_role in ('owner', 'admin', 'manager') then
    return query
    with led as (select employee_id from employees_led_by(p_org, p_user))
    select x.label, x.n::int from (
      select 'søknader om fri eller sykefravær' as label, (select count(*) from absence_requests a where a.org_id = p_org and a.status = 'pending' and a.employee_id in (select employee_id from led)) as n
      union all
      select 'timeregistreringer venter på godkjenning', (select count(*) from time_entries t where t.org_id = p_org and t.status in ('submitted', 'draft') and t.ends_at is not null and t.employee_id in (select employee_id from led))
      union all
      select 'vakter er ikke bekreftet av den ansatte', (select count(*) from shifts s where s.org_id = p_org and s.status = 'published' and s.employee_id in (select employee_id from led)
          and s.ends_at < now() and s.starts_at > now() - interval '45 days' and not exists (select 1 from time_entries t where t.shift_id = s.id))
      union all
      select 'vaktbytter venter på deg', (select count(*) from shift_swaps w where w.org_id = p_org and w.status = 'pending' and (w.to_employee_id is null or w.to_accepted) and w.from_employee_id in (select employee_id from led))
      union all
      select 'påmeldinger til ledige vakter', (select count(*) from shift_requests r where r.org_id = p_org and r.status = 'pending' and r.employee_id in (select employee_id from led))
      union all
      select 'vakter de neste fire ukene er ikke publisert', (select count(*) from shifts s where s.org_id = p_org and s.status = 'draft' and s.starts_at >= now() and s.starts_at < now() + interval '28 days'
          and (s.employee_id is null or s.employee_id in (select employee_id from led)))
    ) x where x.n > 0;
  end if;

  if v_emp is not null then
    return query
    select x.label, x.n::int from (
      select 'av vaktene dine mangler bekreftede timer' as label, (select count(*) from shifts s where s.employee_id = v_emp and s.status = 'published' and s.starts_at < now()
          and s.starts_at > now() - interval '14 days' and not exists (select 1 from time_entries t where t.shift_id = s.id)
          and v_role not in ('owner', 'admin', 'manager')) as n
      union all
      select 'kollegaer spør om du kan ta en vakt', (select count(*) from shift_swaps w where w.to_employee_id = v_emp and w.status = 'pending' and not w.to_accepted)
      union all
      select 'avtaler om ferieoverføring venter på signaturen din', (select count(*) from vacation_carryovers c where c.employee_id = v_emp and c.status = 'pending' and c.employee_accepted_at is null)
      union all
      select 'nærmeste pårørende mangler', case when exists (select 1 from emergency_contacts k where k.employee_id = v_emp) then 0 else 1 end
    ) x where x.n > 0;
  end if;
end $$;
revoke execute on function todo_summary(uuid, uuid) from anon, public, authenticated;

-- Morgenliste: kl. 06 norsk tid til dem som har slått den på, bare når noe venter.
create or replace function run_todo_digest() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text;
  v_base constant text := 'https://vaktpilot.no';
  r record;
  it record;
  v_items text; v_text text; v_html text; v_total int;
  v_batch jsonb := '[]'::jsonb;
  v_count int := 0;
begin
  if extract(hour from now() at time zone 'Europe/Oslo') <> 6 then return 0; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
  if coalesce(v_key, '') = '' then return 0; end if;

  for r in
    select m.org_id, m.user_id, u.email, o.name as org_name
    from memberships m join auth.users u on u.id = m.user_id join organizations o on o.id = m.org_id
    where m.todo_digest and coalesce(u.email, '') like '%@%' and o.blocked_at is null
  loop
    v_items := ''; v_text := ''; v_total := 0;
    for it in select * from todo_summary(r.org_id, r.user_id) loop
      v_total := v_total + it.n;
      v_items := v_items || '<tr><td style="padding:10px 0;border-top:1px solid #e3e7ec;font-size:15px;color:#16202b"><b>' || it.n || '</b> ' || html_esc(it.label) || '</td></tr>';
      v_text := v_text || '• ' || it.n || ' ' || it.label || E'\n';
    end loop;
    continue when v_total = 0;

    v_html := '<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
      || '<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px">'
      || '<table role="presentation" style="max-width:560px;margin:0 auto;width:100%;background:#fff;border-radius:12px;border-collapse:collapse"><tr><td style="padding:24px">'
      || '<div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#1f5fbf">Vaktpilot · ' || html_esc(r.org_name) || '</div>'
      || '<h1 style="margin:10px 0 4px;font-size:20px;color:#16202b">Dette venter på deg i dag</h1>'
      || '<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:8px">' || v_items || '</table>'
      || '<p style="margin:20px 0 0"><a href="' || v_base || '/" style="display:inline-block;background:#1f5fbf;color:#fff;font-weight:700;padding:12px 20px;border-radius:8px;text-decoration:none">Åpne listen</a></p>'
      || '</td></tr></table>'
      || '<p style="max-width:560px;margin:12px auto 0;color:#8a95a1;font-size:12px;line-height:1.5">Du får denne morgenlisten fordi du har slått den på. Slå den av under <a href="' || v_base || '/profil" style="color:#8a95a1">Profil</a>. Ikke svar på denne e-posten.</p>'
      || '</td></tr></table></body></html>';

    v_batch := v_batch || jsonb_build_object(
      'from', '"' || replace(replace(r.org_name, '"', ''), '\', '') || ' via Vaktpilot" <ikkesvar@vaktpilot.no>',
      'to', jsonb_build_array(r.email),
      'subject', 'Å gjøre i dag: ' || v_total || case when v_total = 1 then ' sak' else ' saker' end,
      'html', v_html,
      'text', E'Dette venter på deg i dag:\n\n' || v_text || E'\nÅpne listen: ' || v_base || E'/\n\nSlå av morgenlisten under Profil: ' || v_base || '/profil');
    v_count := v_count + 1;
    if jsonb_array_length(v_batch) = 100 then
      perform net.http_post(url := 'https://api.resend.com/emails/batch', body := v_batch,
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'));
      v_batch := '[]'::jsonb;
    end if;
  end loop;
  if jsonb_array_length(v_batch) > 0 then
    perform net.http_post(url := 'https://api.resend.com/emails/batch', body := v_batch,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'));
  end if;
  return v_count;
end $$;
revoke execute on function run_todo_digest() from anon, public, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vaktpilot_morgenliste';
    perform cron.schedule('vaktpilot_morgenliste', '0 4,5 * * *', 'select public.run_todo_digest()');
  end if;
end $$;
