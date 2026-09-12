-- ═══════════════════════════════════════════════════════════════════════════
-- ARSwineTech Pro — SUPABASE EGRESS & STORAGE AUDIT (READ-ONLY)
-- Run in Supabase Dashboard → SQL Editor. Nothing here writes or deletes.
-- Pair with: qa/supabase-usage-audit-2026-09-12.md
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) TOTAL DATABASE SIZE vs the plan ceiling (free = 500 MB, read-only above it)
select
  pg_size_pretty(pg_database_size(current_database()))                    as db_size,
  pg_database_size(current_database())                                    as db_bytes,
  round(100.0 * pg_database_size(current_database()) / 524288000, 1)      as pct_of_500mb_free,
  pg_size_pretty(pg_total_relation_size('public.app_records'))            as app_records_total,
  pg_size_pretty(pg_relation_size('public.app_records'))                  as app_records_heap,
  pg_size_pretty(pg_indexes_size('public.app_records'))                   as app_records_indexes,
  pg_size_pretty(pg_total_relation_size('public.app_records')
               - pg_relation_size('public.app_records')
               - pg_indexes_size('public.app_records'))                    as toast_and_other;

-- 2) ROWS + BYTES PER ENTITY TYPE  (this is what every full read re-downloads)
--    "one_sync_read_bytes" = the uncompressed JSON this type contributes to a
--    single listFarmRows()/pullFarm() download.
select
  entity_type,
  count(*)                                          as rows,
  pg_size_pretty(sum(octet_length(payload::text)))  as payload_bytes,
  round(avg(octet_length(payload::text)))           as avg_row_bytes,
  max(octet_length(payload::text))                   as largest_row_bytes,
  round(100.0 * sum(octet_length(payload::text))
        / nullif((select sum(octet_length(payload::text)) from app_records),0), 2) as pct_of_one_read
from public.app_records
group by entity_type
order by sum(octet_length(payload::text)) desc;

-- 3) HOW MUCH OF THE READ IS BASE64 IMAGES (photos + farm logo)
--    These are the bytes that gzip barely shrinks, so they dominate real egress.
--    (payload may be json or jsonb on this legacy table — everything below
--     casts explicitly so it works either way.)
select
  count(*) filter (where left(coalesce(payload::jsonb->>'photo',''),5) = 'data:')  as rows_with_photo,
  pg_size_pretty(coalesce(sum(octet_length(payload::jsonb->>'photo'))
        filter (where left(coalesce(payload::jsonb->>'photo',''),5) = 'data:'), 0)) as photo_bytes,
  count(*) filter (where entity_type = 'farm_logo')                        as logo_rows,
  pg_size_pretty(coalesce(sum(octet_length(payload->>'dataUrl'))
                          filter (where entity_type = 'farm_logo'), 0))     as logo_bytes,
  pg_size_pretty(coalesce(sum(octet_length(payload::text))
        filter (where entity_type in ('audit_event','production_event',
                                      'integration_event','population_snapshot','rfid_scan')), 0))
                                                                            as append_only_log_bytes
from public.app_records;

-- 4) THE 20 BIGGEST ROWS  (paste these ids into the review list; a single row
--    over ~100 KB is a permanent tax on every sync of that farm)
select farm_id, entity_type, local_id,
       octet_length(payload::text) as bytes,
       left(payload->>'record_label', 40) as label,
       left(coalesce(payload->>'name', payload->>'description', payload->>'item_name', ''), 40) as name,
       updated_at
from public.app_records
order by octet_length(payload::text) desc
limit 20;

-- 5) PER-FARM TOTALS  (you are multi-tenant: 500 MB and the egress quota are
--    shared by EVERY farm in this project, not per farm)
select
  farm_id,
  count(*)                                              as rows,
  pg_size_pretty(sum(octet_length(payload::text)))       as payload_bytes,
  pg_size_pretty(sum(octet_length(payload::text)) / 4)   as est_wire_bytes_gz4x,
  max(updated_at)                                        as last_change
from public.app_records
group by farm_id
order by sum(octet_length(payload::text)) desc;

-- 6) YOUR "S" — the size one sync read costs — and the monthly egress bill.
--    Model (from the code, see audit doc):
--      * every save  → pushFarm preflight downloads the WHOLE farm  (1 × S)
--      * every other visible device, on the heartbeat that notices the change
--        → pullFarm downloads the WHOLE farm                        (1 × S)
--    Edit the three numbers below to match how your team actually works.
with params as (
  select 4::numeric  as devices,          -- staff devices signed in per farm
         60::numeric as saves_per_day,    -- record saves per farm per day
         40::numeric as pulls_per_day_dev, -- heartbeat pulls per device per day
         4::numeric  as compression,       -- JSON+base64 gzip ratio (~3-6; 4 = typical)
         1::numeric  as farms              -- farms hosted in this project
),
farm_size as (
  select farm_id, sum(octet_length(payload::text)) as raw_bytes
  from public.app_records group by farm_id
),
per_farm as (
  select f.farm_id, f.raw_bytes,
         (f.raw_bytes / p.compression)                            as s_bytes,
         (saves_per_day + (devices - 1) * pulls_per_day_dev)      as reads_per_day,
         f.raw_bytes / p.compression
           * (saves_per_day + (devices - 1) * pulls_per_day_dev)  as egress_day
  from farm_size f cross join params p
)
select
  p.devices, p.saves_per_day, p.pulls_per_day_dev, p.farms,
  pg_size_pretty(max(pf.s_bytes))                                  as s_per_sync_read,
  pg_size_pretty(sum(pf.egress_day) * p.farms)                      as egress_per_day,
  pg_size_pretty(sum(pf.egress_day) * p.farms * 30)                 as egress_per_month,
  round(sum(pf.egress_day) * p.farms * 30 / 5368709120.0, 2)        as x_of_5gb_free_quota
from per_farm pf cross join params p
group by p.devices, p.saves_per_day, p.pulls_per_day_dev, p.farms;

-- 7) INDEX CHECK for the heartbeat probe. The probe is
--    .../app_records?farm_id=eq.X&select=updated_at&order=updated_at.desc&limit=1
--    plus Prefer: count=exact. Without this index every probe scans + sorts the
--    farm's rows (CPU/latency, not egress).
select i.indexname, i.indexdef
from pg_indexes i where i.tablename = 'app_records'
order by 1;
-- If there is no index covering (farm_id, updated_at desc), create it:
--   create index if not exists app_records_farm_updated_idx
--     on public.app_records (farm_id, updated_at desc);
-- and the count the probe asks for on every poll:
--   create index if not exists app_records_farm_idx
--     on public.app_records (farm_id);

-- 8) TABLE BLOAT (dead tuples) — upserts every save, so this grows; it inflates
--    pg_total_relation_size without adding real data.
select relname,
       n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) as dead_pct,
       last_autovacuum, last_autoanalyze
from pg_stat_user_tables
order by n_dead_tup desc limit 10;

-- 9) UNBOUNDED APPEND-ONLY GROWTH — audit/event/log rows are never pruned in
--    the app (only the UI slices to 300). Watch this number month over month.
select entity_type, count(*) as rows,
       min((payload->>'occurred_at')) as oldest,
       max((payload->>'occurred_at')) as newest
from public.app_records
where entity_type in ('audit_event','production_event','integration_event',
                      'population_snapshot','rfid_scan','feed_duplicate_recovery')
group by entity_type order by 2 desc;
