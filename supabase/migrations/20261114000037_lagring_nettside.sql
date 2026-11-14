-- Offentlig bøtte for bilder på nettsiden. Bare InnSpæll kan laste opp.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nettside', 'nettside', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "nettside plattform laster opp" on storage.objects;
create policy "nettside plattform laster opp" on storage.objects for insert to authenticated
  with check (bucket_id = 'nettside' and public.is_platform_admin());
drop policy if exists "nettside plattform sletter" on storage.objects;
create policy "nettside plattform sletter" on storage.objects for delete to authenticated
  using (bucket_id = 'nettside' and public.is_platform_admin());
