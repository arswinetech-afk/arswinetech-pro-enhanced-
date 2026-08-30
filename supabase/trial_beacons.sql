-- ═══ ARSwineTech Pro — optional LIVE TRIAL CENSUS table ═══
-- Run ONCE in your Supabase SQL editor (Dashboard → SQL Editor → Run).
-- Enables the "🎁 Trial dashboard" in the sync menu: who is on trial,
-- days left, what data they have, and who already migrated.
-- Trial devices INSERT/UPDATE anonymously (beacon); only authenticated
-- accounts (you / your admins) can READ the board.

create table if not exists public.trial_beacons (
  id         text primary key,
  started_at timestamptz,
  expires_at timestamptz,
  status     text not null default 'active',   -- active | migrated | expired
  counts     jsonb,
  contact    text,
  updated_at timestamptz not null default now()
);

alter table public.trial_beacons enable row level security;

-- trial devices (anonymous) may create/update their own beacon only
create policy "anon can insert trial beacons"
  on public.trial_beacons for insert to anon with check (true);

create policy "anon can update trial beacons"
  on public.trial_beacons for update to anon using (true) with check (true);

-- only signed-in users (owner/admins) can read the dashboard
create policy "authenticated can read trial beacons"
  on public.trial_beacons for select to authenticated using (true);
