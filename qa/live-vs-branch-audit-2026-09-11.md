# Live app ↔ GitHub branch audit — 2026-09-11

Live site: `https://arswine-tech-pro.pages.dev/`

## Verdict

| Question | Answer |
|---|---|
| Does the **working branch** (`b450914`, pushed on GitHub as `arena/01a03835-arswinetech-pro-enhanced`) match the live app? | **Yes** — every file checked matches, including the newest fix (FIX 184) |
| Does the **default branch `main`** (`f178999`, "Add files via upload", 2026-08-25) match the live app? | **No at audit time — `main` was the older v110 snapshot, ~114 service-worker releases behind. Fixed during this audit: `main` now points at `b450914` and matches live exactly (see "Follow-ups" §1).** |
| Does open **PR #1** (`arena/01a08b78-…`, `1d7c8b7`, 2026-09-11) match the live app? | **No** — it is rebased on the stale v110 tree; merging + deploying it would regress production |

## Evidence

1. **Service worker identity (strongest signal).** Live `sw.js` reports
   `const CACHE_NAME = 'arswinetech-pro-v224-exactunit-2026-09-10'` — identical to branch HEAD,
   and `CACHE_NAME` is bumped on every release. `main` still says
   `'arswinetech-pro-v110-fattener-live-2026-08-25'`.
   The live `APP_SHELL` precache list (63 entries) and the network-first / `/ars-head` bypass
   handlers match the branch file line-for-line.
2. **Newest fix is live.** Live `js/batch-costing.js` contains
   `/* FIX 184: exact unit price, no misleading rounding */` plus the `[FIX 183]`
   movement-matching block — the exact change of `b450914`.
3. **Branch-only code is live.** `js/medicine.js` on the site contains the
   `[REBUILD FIX 71]` guard `if (!window.__arsMedInventoryLoaded) page()`; `main` has a bare
   `page()` there. Rendering the live page executes `js/work-orders.js` (Work Order Dashboard),
   a module that does not exist in `main`.
4. **The deployable artifact equals the branch tree.** `releases/arswinetech-pro-latest.zip`
   (72 files) is byte-identical to the branch working tree, and
   `bash qa/build-deploy-layout.sh` regenerates that same layout from the branch — so the branch
   *is* the uploaded build, reproduced exactly.
5. **Tree comparison branch HEAD vs `main`:** 81 vs 55 files; 23 identical, 32 differing,
   26 present only on the branch (`work-orders.js`, `presence.js`, `trial.js`, `biometric.js`,
   `batch-costing.js`, `_worker.js`, `supabase/*.sql`, `qa/`, `releases/`, icons, marketing/);
   **0** files exist only in `main`. Nothing was deleted by the newer line — `main` is strictly
   behind, just also divergent in the 32 shared files (e.g. `app.js` 160 KB → 201 KB,
   `reservations.js` 82 KB → 121 KB, `pedigree.js` 58 KB → 92 KB).

## Caveats

- Sandbox egress is limited to GitHub hosts, so live files were read through a page-fetch tool
  (which re-encodes markdown) rather than hashed. Verification is therefore
  "exact on sw.js + high-confidence marker/content matching on spot-checked modules", not a
  byte-hash of all 47 live JS modules. Deployment is a whole-folder upload, so partial skew is
  unlikely.
- `main` and the working branch share **no merge base** — each is its own root commit
  ("Add files via upload" workflow). A normal merge/rebase is not possible; treat one tree as the
  source of truth and replace the other.
- There is no reliable deploy fingerprint: `window.ARS_APP_VERSION` (`sync-safe-2026-08-20.1`) is
  identical in both branches and `window.ARS_DEPLOYMENT_ID` is an empty string. The SW
  `CACHE_NAME` was the only usable marker.

## PR #1 disposition (`1d7c8b7`, branched off v110 `main`)

Checked line-by-line which of PR #1's changes already exist on the v224 line:

| PR #1 change | Needed on v224? | Notes |
|---|---|---|
| `qa/build-deploy-layout.sh` hardened (73 lines) | **Yes — highest value** | Auto-bumps `CACHE_NAME` with a UTC stamp and aborts the build when any `src`/`href` in `index.html` or any `'./…'` entry in `sw.js` does not resolve. The branch's 48-line copy does neither. |
| `client.js` `window.ARSPersistDbSafely` quota guard | **Yes** | v224 saves with bare `STORE.setItem('arswine-db-v1', …)` at `client.js:948`, `cloud-sync.js:707`, `app.js:76,698` — no `QuotaExceededError` handling, so a base64 farm logo can silently break local persistence. |
| `sw.js` cross-origin cache for `/storage/v1/object/public/` | **Yes, if logos move to Storage** | `sw.js:96` returns for every cross-origin request, so Supabase-Storage logos are never available offline. |
| `qa/supabase-storage-setup.sql` + `qa/test-egress-fixes.mjs` | Optional | Storage `farm-logos` bucket + a stub-Supabase test harness; useful, but the bucket must exist before logos stop being stored in `app_records`. |
| `client.js` version probe (`lastFarmVersion`, `ifChanged`, `count=exact`) | **No — redundant** | v224 already ships the `/ars-head` edge head-cache (FIX 124, `client.js:1091-1120`) which is the same idea done at the edge with zero DB egress, plus a Supabase fallback. |
| `.gitignore`, `README-DEPLOY.md` notes | Minor | Documentation/hygiene only. |

Merging PR #1 into the v224 tree as-is would **delete** `work-orders.js`, `trial.js`,
`presence.js`, `biometric.js`, `batch-costing.js` and `_worker.js` — it must be cherry-picked,
not merged.

## Suggested follow-ups

1. ~~Promote the v224 tree to `main`~~ **DONE 2026-09-11** — `main` force-updated
   `f178999 → b450914`, so `main` is now byte-identical to the deployed site (81 files,
   `sw.js` = v224). The old v110 snapshot is preserved as tag **`archive-v110-2026-08-25`**
   (annotated, pushed) and stays reachable from PR #1's head branch, so nothing is lost.
   Consequence: future work on this line can fast-forward `main` instead of diverging from it.
2. Do **not** merge PR #1 as-is; its `client.js` egress / storage-logo / deploy-layout fixes need
   to be transplanted onto the v224 tree first (it also re-adds `qa/build-deploy-layout.sh`,
   `qa/test-egress-fixes.mjs` and `.gitignore`).
3. Stamp the build: write the short git SHA into `window.ARS_DEPLOYMENT_ID` from
   `qa/build-deploy-layout.sh` and bump `CACHE_NAME` in the same step, so "does live == repo?"
   becomes a single `curl`/fetch of `sw.js` + `supabase/config.js`.
