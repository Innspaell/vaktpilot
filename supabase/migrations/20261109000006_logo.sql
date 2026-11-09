-- Logo per bedrift. Filene ligger i Storage-bøtta "logos" under <org_id>/.
alter table organizations add column if not exists logo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Alle kan se logoer (offentlig bøtte). Bare administrator i bedriften kan laste opp, endre og slette.
drop policy if exists "logo admin insert" on storage.objects;
create policy "logo admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.is_admin(((storage.foldername(name))[1])::uuid));
drop policy if exists "logo admin update" on storage.objects;
create policy "logo admin update" on storage.objects for update to authenticated
  using (bucket_id = 'logos' and public.is_admin(((storage.foldername(name))[1])::uuid));
drop policy if exists "logo admin delete" on storage.objects;
create policy "logo admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and public.is_admin(((storage.foldername(name))[1])::uuid));
