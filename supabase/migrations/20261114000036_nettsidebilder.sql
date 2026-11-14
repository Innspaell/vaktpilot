-- Bilder på vaktpilot.no som InnSpæll kan bytte selv (Plattform › Nettsiden). Tom = standardbildet i appen.
create table if not exists site_images (
  slot text primary key check (slot in ('hero', 'tavle', 'syk')),
  url text not null,
  alt text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table site_images enable row level security;
drop policy if exists "alle leser" on site_images;
create policy "alle leser" on site_images for select to anon, authenticated using (true);
drop policy if exists "plattform endrer" on site_images;
create policy "plattform endrer" on site_images for all to authenticated using (is_platform_admin()) with check (is_platform_admin());
grant select on site_images to anon;
