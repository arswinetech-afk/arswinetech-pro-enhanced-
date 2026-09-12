# Supabase egress & storage audit — 2026-09-12

Analyzed: `client.js` (sync engine), `cloud-sync.js` (heartbeat/auto-push/pull), all 21
modules that call `ARSCloud.*`, `presence.js`, `trial.js`, `logo-custom.js`,
`reservation-certificate.js`, `production-control.js`, `app.js` (photo + quota handling).
Measured numbers for **your** data: run `qa/measure-supabase-usage.sql` in the SQL editor —
every figure below is a model, because this sandbox can only reach GitHub, not Supabase.

## Verdict

**Yes — the sync design is egress-expensive, and the cause is structural, not incidental.**
One number explains it: **every single record save re-downloads the entire farm dataset**, and
every other signed-in device then re-downloads it too. Images stored inside row payloads make
each of those downloads heavy. Disk growth is a separate, slower problem: three append-only
datasets are never pruned.

| Resource | Cost per unit | Why |
| --- | --- | --- |
| Database egress | **~1 full-farm read per save, per farm** + 1 per device per changed heartbeat | `pushFarm()` calls `listFarmRows()` as a conflict preflight (`client.js:712-716`) |
| Egress (idle) | ~0.3 KB per heartbeat per device, **0 if `/ars-head` KV is bound** | FIX 111 probe + FIX 124 edge cache (`client.js:1073-1128`) |
| Disk | every record = 1 row; base64 photos/logo live in `payload` | `buildRows()` (`client.js:607-673`) |
| Postgres CPU | `Prefer: count=exact` on every read + probe; index on `(farm_id, updated_at)` may not exist | `client.js:592`, `1079-1082` |
| API requests | 37 extra GETs each time the sync-diagnostics panel opens | `getFarmRecordCounts()` loops all 37 entity types (`client.js:391-403`) |

## 1. The dominant cost: full-dataset read before every write

`save()` (`app.js:680-706`) ends with `scheduleAutoPush(750)` → `pushFarm(..., {dirtyOnly:true})`.
Uploads are indeed dirty-only (good), but **before** writing, `pushFarm` runs:

```js
// client.js:710-716  "Re-read the server state before writing…"
serverRows = (await listFarmRows(farmId)).rows;      // ← the WHOLE farm, every entity type
```

`listFarmRows` (`client.js:582-604`) pages the entire `app_records` table for the farm
(`limit=1000`, `MAX_PAGES=1000`) **with the full `payload` column**. So:

- 1 tap of "Save" on one sow = 1 request that costs `S` bytes of egress, where `S` is the
  whole farm, no matter how small the change.
- `verifyFarmSave()` (13 call sites) and `syncFarmRecord()` (used by most modules) both funnel
  into the same path.
- Then every *other* device notices the changed head on its next heartbeat and calls
  `performBackgroundPull` → `pullFarm` → the same `listFarmRows` = another `S` each.

Deliberately **not** affected: work orders / biometric / subs-orders, which use explicit targeted
writes (`upsertCommerceRows`, `client.js:1136-1142`) — no full read. That's the pattern the rest
of the app should follow.

### Egress model

`reads/day/farm ≈ saves_per_day + (devices − 1) × pulls_per_device_per_day`
(pulls coalesce: several changes between two heartbeats = one pull; backgrounded devices skip
pulls entirely — `cloud-sync.js:347-357` only polls while visible.)

Free-plan budget: **5 GB uncached + 5 GB cached egress per month**, and **500 MB** database
size shared by *all* farms in the project.

| Farm size (`S` uncompressed) | 1 farm, 4 devices, 60 saves/day, 40 pulls/dev/day | × 5 farms | vs 5 GB/month |
| --- | --- | --- | --- |
| 1 MB | ~45 MB/day → **1.35 GB/mo** | 6.7 GB/mo | fits, 1 farm |
| 4 MB | ~180 MB/day → **5.4 GB/mo** | 27 GB/mo | **over** |
| 8 MB | ~360 MB/day → **10.8 GB/mo** | 54 GB/mo | **2× over** |
| 20 MB | ~900 MB/day → **27 GB/mo** | 135 GB/mo | **5× over** |

(Assumes ~4× gzip on JSON+base64. base64 JPEG compresses poorly, so photo-heavy farms sit near
the pessimistic end.)

## 2. What makes `S` big: images and logs inside `payload`

| Payload content | Where | Effect on `S` and disk |
| --- | --- | --- |
| Animal photos as base64 data URLs inside records | `app.js:3978` (`rec.photo = url`) via `arsCompressImage` ≤320 px JPEG q0.72 (`app.js:3935-3963`) | **15-40 KB each** — a farm with 300 photographed animals ≈ 5-12 MB of `S`, paid on *every* read. |
| Reservation photos, downscaled but not shrunk much | `reservation-certificate.js:416-419` → `arsDownscaleImage(r.result, **1000**, 0.8)` | **~100-250 KB each** at 1000 px. One photo on each of 50 reservations ≈ 5-12 MB, and `.catch(() => apply(r.result))` means a *failed* downscale stores the **raw up-to-3 MB** file. |
| Farm logo as base64 **PNG** in a synced row | `client.js:655-660` (`farm_logo` row), `logo-custom.js:95-100` | `arsDownscaleImage(…, 512, 0.85, keepPng=true)` → PNG stays large (100-400 KB); boot-time migration only shrinks it **above 500,000 chars** (`app.js:62`), so a 300 KB logo is permanent in every read. |
| Append-only, never pruned | `production-control.js:344` `f.auditLog.unshift(record)`; also `productionEvents`, `integrationEvents`, `populationSnapshots` | Each entry = 1 cloud row with `before`/`after` snapshots. Only the **UI** caps at 300 (`production-control.js:1461`); `rfid_scans` is the sole array with a real cap (100, `rfid-scanner.js:134`). This is your slow disk creep. |
| Redundant fields per row | `buildRows` stamps `_ars_cloud_local_id`, `farm_id`, `updated_at` **inside** the payload as well as in columns | ~60-80 bytes × every row × every read. |

## 3. Device memory (the other half of your question)

Not Supabase, but the same payload design causes it: `save()` serializes the whole `DB` into
localStorage `arswine-db-v1` (`app.js:700-704`), `client.js:948` and `cloud-sync.js:707` do the
same with **no `QuotaExceededError` guard**, and every cloud-authoritative pull also writes a
full clone as a recovery snapshot (`saveLocalRecovery`, `client.js:522-546`) — so the bucket exists
~3× in a ~5 MB quota. That is exactly why the quota-recovery/compress path (`app.js:66-84`)
exists, and why PR #1's `ARSPersistDbSafely` matters. Moving images to Supabase Storage shrinks
the quota problem and `S` with one change.

## 4. Costs that are fine (don't touch)

- Head probe + Cloudflare KV edge cache (FIX 111/124): idle polling is effectively free.
- Dirty-only uploads with `return=minimal`, 50-row chunked upserts, merge-duplicates.
- Offline-first: reads are local; no per-screen SQL like most apps do.
- Pagination guard + "read incomplete" hard failure (`client.js:597-602`) — correct over clever.
- `upsertCommerceRows` targeted writes; explicit delete queue (FIX C3).

## 5. Ranked fixes

| # | Fix | Est. saving | Effort |
| --- | --- | --- | --- |
| **1** | **Don't read the whole farm to write.** In `pushFarm`, replace `listFarmRows()` with (a) `farmSyncHead` reuse — if `count`/`maxUpdated` still match this device's baseline, skip the conflict check entirely; else (b) read only the dirty keys: `select=updated_at&farm_id=eq.X&or=(entity_type.eq.a,local_id.eq.b),…`. | **−33% egress** (60 of 180 reads) and one less round-trip latency per save | small, ~25 lines |
| **2** | **Get images out of `app_records`.** Farm logos → `farm-logos` Storage bucket with a `{url,v}` reference (PR #1 ships `client.js` +319 lines of this and `qa/supabase-storage-setup.sql`); animal photos → `photo_key` in the row, fetched lazily when a detail modal opens. | **−50 to −85% of `S`** → multiplies across *all* reads | medium (needs bucket + migration of existing rows) |
| **3** | **Prune the append-only logs.** Cap `auditLog`/`productionEvents` at e.g. 1,000 in the synced bucket and archive older rows to a table never read by `listFarmRows` (or exclude `audit_event` from the sync `select`). | Stops unbounded disk creep + shrinks `S` permanently | small |
| **4** | **Row-level delta instead of whole-farm pull.** Subscribe to `postgres_changes` on `app_records` (or poll `updated_at > last_verified` **patch-style**, upserting into the local bucket instead of rebuilding it — the reason the code refuses incremental reads, `client.js:856-860`, disappears if deletes become tombstones instead of absence). | Removes the `(devices−1) × pulls` term = **−66%** | medium |
| **5** | **Shrink the images that stay.** Reservation photos: `arsDownscaleImage(x, 1000, 0.8)` → `600, 0.72`, and drop the `catch(() => apply(r.result))` fallback that stores a raw up-to-3 MB file when downscaling fails (`reservation-certificate.js:416-419`). Farm logo: save JPEG instead of PNG (`logo-custom.js` passes `keepPng=true`), and lower the boot-time migration threshold from 500 KB to ~120 KB. | −0.3 to −0.6 MB of `S` per farm, and removes the worst-case 3 MB row | trivial |
| **6** | **One RPC for counts** instead of 37 requests in `getFarmRecordCounts`; drop `Prefer: count=exact` from the heartbeat probe (or keep KV bound so the probe never reaches Postgres). | −36 requests per diagnostics open; less CPU | trivial |
| **7** | **Add the index** `create index on app_records (farm_id, updated_at desc);` if §7 of the SQL shows it missing. | probe latency/CPU | trivial |

Doing **#1 + #2 + #3** typically takes a photo-heavy farm from ~10 GB/month to ~1-2 GB/month —
i.e. from "over free tier" to "comfortably inside it", with no plan upgrade.

## 6. Where to read the real numbers

- Supabase Dashboard → **Reports → Database / Network**: rows returned, `Disk space`,
  `Network bandwidth sent`. **Billing → Usage** for the monthly egress meter (log retention on
  free is only 1-7 days, so don't plan from Logs Explorer alone).
- Supabase Dashboard → **Table Editor → SQL** → run `qa/measure-supabase-usage.sql` (read-only).
  §6 prints `S` and the projected month for *your* farm sizes.
- Verify the edge head cache is live: `GET https://arswine-tech-pro.pages.dev/ars-head?farm=test`
  → `404 {"missing":true}` = worker deployed, KV bound, empty; `503 {"error":"KV namespace not
  bound"}` = `_worker.js` uploaded but no KV binding → every device is hammering the direct
  probe instead (CPU, not egress).
