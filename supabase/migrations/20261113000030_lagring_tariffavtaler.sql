-- Opplastede tariff- og lokalavtaler. Privat bøtte, mappe per bedrift: <org_id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tariffavtaler', 'tariffavtaler', false, 4194304,
  array['application/pdf', 'image/png', 'image/jpeg', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tariffavtale leder laster opp" on storage.objects;
create policy "tariffavtale leder laster opp" on storage.objects for insert to authenticated
  with check (bucket_id = 'tariffavtaler' and public.is_admin(((storage.foldername(name))[1])::uuid));
drop policy if exists "tariffavtale leder og plattform leser" on storage.objects;
create policy "tariffavtale leder og plattform leser" on storage.objects for select to authenticated
  using (bucket_id = 'tariffavtaler' and (public.is_admin(((storage.foldername(name))[1])::uuid) or public.is_platform_admin()));
