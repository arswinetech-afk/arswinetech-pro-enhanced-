# FIX 188 — Reseller order links (v230)

> Your question: *"Is it possible to send a link where this link will have like an ordering
> counter page, whereas the reseller can simply place their order and once they click
> 'order' it will notify a small badge in 'registered reseller' and upon clicking it, if
> there is an order it will show whose reseller had made or placed an order? Just like in
> food panda?"*
>
> Yes. That is what v230 is. Build `v230-reseller-order-links-2026-09-12`.

## What is new

| | |
|---|---|
| **A page only your reseller has** | `order.html?k=<their-token>` — no app, no login, no password. It lists **your** semen batches: boar, batch no, breed, **₱/bottle today**, **bottles left**. They tap `− ＋` (or type a count) and press **Place order**. |
| **The badge you asked for** | In Semen Reseller Center, the box labelled **REGISTERED RESELLERS** gets an amber, softly flashing `🛒 2 new orders` pill. Tap it → the order inbox: **whose** order it is, what they asked, the pesos, their note, when they want it, how long ago. |
| **Accept = your existing form, prefilled** | `✓ Accept & create pick-up` opens **📦 Record Semen Pickup** with the lines already in it, then you confirm. Declining records a short reason that shows on their page. `👁 Seen` acknowledges without deciding. |
| **One link per reseller, revocable** | Per reseller: **🛒 Order link** → copy it, send it (Messenger/Share sheet), or show a QR. **🔄 New link** replaces it at once (a leaked screenshot stops working); **⏸ Pause link** closes it without issuing another. |

Your four decisions, as built: **pending request only** (nothing touches stock or balances
until you save the pick-up) · **catalog live from Semen Inventory** with the batch's current
₱/bottle and bottles-left (your price indicator) · **one private link per reseller, no PIN,
revocable** · **Phase 1 now**.

## Why a saved order still cannot be wrong

1. **Their page cannot price anything.** It sends item keys and counts only —
   `p_lines: [{k:"SEM-LW",qty:4}]`. No `price`, `rate`, `amount` or `total` ever leaves the
   browser, so a tampered or stale page cannot bill itself a discount.
2. **The farm's own SQL does the money.** `ars_place_order()` reads the batch, takes
   today's `price_per_dose`, clamps each count to the on-hand you actually have, and stamps
   the row with `total`, `bottles` and a `clamped` list. If they asked 12 and you have 3, the
   order arrives as 3 with `only what is left was reserved` next to it — on their screen too.
3. **Accepting re-reads again.** A batch repriced from ₱400 to ₱450 after they ordered is
   accepted at ₱450; a batch that has since run out is dropped and said out loud
   (*"Stock moved since they ordered: B1 Large White: asked 8, only 3 left"*). And the
   prefilled pick-up still goes through `saveResellerPickup`, which re-validates stock before
   it deducts — the same guard as a manual pick-up.
4. **Inbox money is exact, not rounded.** The app's `peso()` rounds to whole pesos (right for
   a receipt footer, wrong for a queue), so the inbox uses its own formatter: a ₱350.50 line
   shows `₱350.50`, a whole amount stays `₱1,200`.

## Files touched (v230)

| File | Change |
|---|---|
| `order.html` *(new, root)* | The reseller's ordering page. Own `<style>` on purpose: a future `app.css` change can never break a link you already handed out. |
| `order-page.js` → `js/order-page.js` *(new)* | Token parsing, cart maths, clamping with a stated reason, the quantity-only `rpc` calls, their own status list. |
| `supabase/reseller_orders.sql` *(new)* | The install you paste once: 2 partial indexes + 4 `security definer` functions. No new table. |
| `semen-sales.js` | Badge in the Registered Resellers KPI box · `🛒 Order link` per reseller · the order inbox · link create/pause/supersede + QR/copy/share · `acceptResellerOrder` → prefilled pick-up (one-shot `pendingPickupPrefill`) · decline with a reason · `👁 Seen`. |
| `client.js` | `entityMap` += `semenResellerOrders: 'semen_reseller_order'`, `semenResellerOrderLinks: 'semen_reseller_order_link'` — so orders and links sync, back up and restore like every other record. |
| `app.js` | `sanitizeFarm` initialises the two buckets, as it does for all the others. |
| `sw.js` | `/order.html` and `/js/order-page.js` bypass the app cache (a reseller must never get yesterday's page, and offline must not hand them your login screen). |
| `_headers`, `config.js` | `order.html` served `no-cache` + `X-Robots-Tag: noindex`; version `v230-reseller-order-links-2026-09-12`. |
| `qa/build-deploy-layout.sh`, `qa/test-reseller-orders.mjs` | the page is copied into the deploy layout; 138 checks. |

No `_worker.js` change is needed: it only special-cases `/ars-head` and otherwise falls
through to `env.ASSETS.fetch(request)`, so `/order.html` is served as a static asset.

## One-time install (Supabase → SQL editor → Paste)

Paste **`supabase/reseller_orders.sql`** once. It is idempotent — every statement is
`create or replace` / `create index if not exists`, so pasting it twice is safe, and it
installs nothing else. It creates **no table and deletes no row**: orders and links are
ordinary `app_records` rows, the same table your app already uses.

Then run the verify query at the bottom of the file. Expected: **4 rows, `security_definer =
t`**, `owner` = the role you pasted with, `token_index_present ≥ 1`.

Those functions are what let a reseller place an order at all: `app_records`' row-level
security still says an anonymous visitor may read nothing, and the functions do their one
job as the owner. That is also why **no secret key is anywhere in this build** — the page
uses the same publishable key your app already ships in `supabase/config.js`, and nothing was
added to Cloudflare's env vars.

**If the badge never lights up:** in the SQL editor run
`select payload from app_records where entity_type='semen_reseller_order' order by updated_at desc limit 3;`
— a row there means the order arrived and the badge follows the sync you already run (a new
row moves `count` *and* `max(updated_at)`, so each phone picks it up on its next head probe,
about 30 s). No row means the link is not installed or was paused.

## Using it

**You (the farm):**
1. Semen Reseller Center → open a reseller (tap their name) → **🛒 Order link**.
2. First time: **🛒 Create their order link**. It copies itself — paste into Messenger/SMS.
   Or let them scan the QR on the same sheet.
3. An order arrives: `🛒 N new orders` on **Registered Resellers** → tap →
   **✓ Accept & create pick-up** → check the lines (edit any qty, `✕` drops a line) → **Save**.
   That save is the moment bottles and balance move.
4. Can't fill it: **✕ Decline** and type why — they see your note on their page.
5. Busy: **👁 Seen** (the flash stops, the request stays waiting — seeing is not deciding).
6. **🔗 Links** shows every link in the farm and how many orders each brought.

**Your reseller:** open the link → the batches and today's prices appear → tap `＋` → their
total shows at the bottom → (optional) note + wanted date → **Place order**. Their page then
lists their own recent orders as `Waiting for the farm` / `Accepted — ready to pick up` /
`Declined`, and it tells them honestly if a count was cut to what you have.

## Checks that ran

`node qa/test-reseller-orders.mjs` → **138/138** (page arithmetic; the payload that leaves
the phone; the fake-browser end-to-end incl. the copy that is sent; link lifecycle incl.
supersede and pause; badge incl. the quiet door; re-pricing at accept; stock-short
re-derivation; accept → prefilled form → save → **₱1,350 billed and 10 → 7 bottles**;
refusals; every sheet's markup linted against `app.css`; the sync contract; the shipped
files and the SQL's shape). `qa/test-reseller-return.mjs` still **167/167** and
`qa/test-sync-preflight.mjs` still **27/27**, so the return/replace money and the sync
preflight are untouched.

`ARS_DUMP_SHEETS=1 node qa/test-reseller-orders.mjs` writes `/tmp/order-*.html` if you want
to read a sheet's markup without a phone.

## Deliberately not in this build

A phone-number OTP or account for resellers; payment on delivery; auto-notify by SMS/Telegram
when an order lands; letting a reseller see their consignment balance; per-reseller quantity
caps or price tiers; order-to-invoice printing; stock reservations while an order is pending.
Say which of those matters and it becomes the next fix.

**Rollback:** delete the build (previous tag) and, if you want the entry points gone, run
`drop function if exists public.ars_place_order(text, jsonb, text, text);` and the three
siblings. No table was created and no existing row was rewritten, so nothing needs restoring.
