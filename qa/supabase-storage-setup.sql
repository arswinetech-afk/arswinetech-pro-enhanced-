-- ============================================================================
-- ARSwineTech Pro — Supabase Storage setup for farm logos (item #3)
--
-- Run this ONCE in the Supabase SQL editor for project hgmrltewkxjmhlqevjrp.
-- It moves farm-logo image bytes out of the app_records JSONB column and into a
-- Storage bucket. The app degrades gracefully to the legacy base64 row if this
-- has not been run, so it is safe to apply whenever convenient.
--
-- IMPORTANT (multi-staff): logos are shared by every device on a farm, so the
-- bucket is PUBLIC-read (anyone with the URL can see a farm's logo — it is not
-- sensitive). Writes are restricted, via RLS, to authenticated users who are an
-- ACTIVE member of the farm whose ID is the first path segment of the object.
--
-- This policy assumes your membership table is:
--     public.farm_memberships(user_id uuid, farm_id text/uuid, is_active boolean, ...)
-- If your user column has a different name (e.g. auth_uid), change `user_id`
-- below to match. You can confirm with:  \d public.farm_memberships
-- ============================================================================

-- 1. The bucket. public = true so <img src> works without an auth header.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'farm-logos',
  'farm-logos',
  true,
  3 * 1024 * 1024,                       -- mirrors the app's 2 MB guard + headroom
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- 2. Anyone (incl. signed-out staff on the login-adjacent shell) may READ logos.
create policy "farm logos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'farm-logos');

-- 3. Only an active member of the target farm may CREATE a logo for it.
create policy "farm members upload their own logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'farm-logos'
    and exists (
      select 1 from public.farm_memberships fm
      where fm.farm_id = (storage.foldername(name))[1]
        and fm.user_id = auth.uid()
        and fm.is_active = true
    )
  );

-- 4. Same rule for replacing (upserting) an existing logo.
create policy "farm members replace their own logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'farm-logos'
    and exists (
      select 1 from public.farm_memberships fm
      where fm.farm_id = (storage.foldername(name))[1]
        and fm.user_id = auth.uid()
        and fm.is_active = true
    )
  );

-- 5. Members may delete their farm's logo (e.g. reverting to the official one).
create policy "farm members delete their own logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'farm-logos'
    and exists (
      select 1 from public.farm_memberships fm
      where fm.farm_id = (storage.foldername(name))[1]
        and fm.user_id = auth.uid()
        and fm.is_active = true
    )
  );
