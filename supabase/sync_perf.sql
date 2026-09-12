-- ═══════════════════════════════════════════════════════════════════════════
-- ARSwineTech Pro — [FIX 186] OPTIONAL SYNC-PERFORMANCE SQL (run once, ~10 s)
--
-- NOTHING HERE IS REQUIRED. The app behaves correctly without it; every change in
-- the app auto-detects these objects and falls back to its previous behaviour.
--   * If you skip it: the sync diagnostics panel keeps using its 37 small count
--     queries, and every heartbeat head probe counts the farm's rows without a
--     dedicated index (fine up to a few thousand rows per farm).
--   * If you run it: 1 request instead of 37, and the probe becomes an index-only
--     scan instead of a scan of the farm's rows.
--
-- Safe to re-run any number of times. No data is modified or deleted.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Indexes ─────────────────────────────────────────────────────────────────
-- The heartbeat probe is:
--   GET /rest/v1/app_records?farm_id=eq.X&select=updated_at
--       &order=updated_at.desc&limit=1     (Prefer: count=exact)
-- which is exactly what this index serves: newest row for one farm, plus the
-- row count for that farm.
create index if not exists app_records_farm_updated_idx
  on public.app_records (farm_id, updated_at desc);

-- [FIX 186] The narrowed write preflight reads versions for specific local_ids:
--   GET /rest/v1/app_records?farm_id=eq.X&local_id=in.(...)
create index if not exists app_records_farm_local_idx
  on public.app_records (farm_id, local_id);

-- NOTE ON BIG TABLES: `create index` takes a brief write lock. On a table already
-- holding tens of thousands of rows, run each statement on its own WITHOUT this
-- file's transaction, using the concurrently variant instead:
--   create index concurrently if not exists app_records_farm_updated_idx
--     on public.app_records (farm_id, updated_at desc);
-- (Supabase's SQL editor wraps a script in a transaction, so run CONCURRENTLY
-- statements one at a time in the SQL editor, which allows them.)

-- 2) One-call record counts for the sync diagnostics panel ──────────────────
-- Replaces 37 per-entity count requests with a single RPC. Farm scoping is
-- enforced by the table's own RLS policies (this runs as the calling member).
create or replace function public.ars_farm_record_counts(p_farm_id text)
returns table(entity_type text, n bigint)
language plpgsql
stable
set search_path = public
as $$
begin
  -- farm_id may be uuid or text depending on how the legacy table was created;
  -- %L emits a quoted literal so Postgres resolves it against the column's own
  -- type, which keeps the index usable either way.
  return query execute format(
    'select a.entity_type::text, count(*)::bigint
       from public.app_records a
      where a.farm_id = %L
      group by 1
      order by 1',
    p_farm_id
  );
end;
$$;

-- Members of a farm may count their own farm; the RLS policies on app_records
-- already decide which rows this can see. Grant execution to both roles the app
-- signs in with.
grant execute on function public.ars_farm_record_counts(text) to authenticated;
grant execute on function public.ars_farm_record_counts(text) to anon;

-- 3) Verify ──────────────────────────────────────────────────────────────────
-- (a) both indexes exist:
select indexname from pg_indexes
 where tablename = 'app_records'
   and indexname in ('app_records_farm_updated_idx', 'app_records_farm_local_idx')
 order by 1;

-- (b) the RPC answers (paste one of your farm UUIDs in place of the placeholder;
--     expect one row per entity type, and it should return 0 rows for an unknown
--     farm rather than an error):
-- select * from public.ars_farm_record_counts('00000000-0000-0000-0000-000000000000');
