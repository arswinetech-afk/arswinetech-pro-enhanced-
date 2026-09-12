# FIX 188 / FIX 189 — Reseller order links and the farm's order menu (v230 → v231 → v232)

> Your question: *"Is it possible to send a link where this link will have like an ordering
> counter page, whereas the reseller can simply place their order and once they click
> 'order' it will notify a small badge in 'registered reseller' and upon clicking it, if
> there is an order it will show whose reseller had made or placed an order? Just like in
> food panda?"*
>
> Yes. That is what v230 is. **v231** is the same feature after it was tested on a phone:
> a reseller orders a **breed from a menu the farm owns** instead of a batch from the cooler,
> the ₱/bottle comes from that menu, and an arrival interrupts with a pop-up, a beep and a
> vibration. Build `v231-reseller-order-menu-2026-09-12`.
> **v232** is that same build with a fixable install: pasting the SQL onto a farm that already
> had v230 died with `42P13 cannot change return type of existing function`, because v231
> changed what the catalogue function returns. Build `v232-reseller-sql-recreate-2026-09-12`.

## v232 — why the paste failed, and why dropping is the right answer

`create or replace function` may rewrite a function's body, signature and grants, but Postgres
refuses to change its **row type**: v230's `ars_order_catalog(text)` returned
`(item_key, semen_batch_no, boar, breed, price, on_hand)` and v231's returns
`(item_key, breed, price, blurb, priced)`. Hence `42P13 … Row type defined by OUT parameters is
different. HINT: Use DROP FUNCTION ars_order_catalog(text) first.` The hint is correct, and here
it is safe: these four functions store nothing — they are only doors onto `app_records`, so no
order, link, menu row, batch or ledger entry is touched by dropping and recreating them, and the
grants at the bottom of the file are re-applied in the same paste.

So every create in `supabase/reseller_orders.sql` is now preceded by a matching
`drop function if exists …` (7 of them: the four current signatures plus the argument shapes
earlier drafts used, so a half-installed project converges too). `if exists` makes each a no-op
on a fresh project, which is why the file is still safe to paste any number of times. The harness
lints this — a create without a matching drop above it now fails a check, because this exact
failure was invisible until a human pasted it.

## v231 — what the first phone test found

Two screenshots, one evening. Both problems were real, and only one of them was an error
message.

**1. `operator does not exist: record ->> unknown`.** `ars_place_order()` looped
`for v_line in select * from jsonb_array_elements(p_lines)` with `v_line record`. A one-column
record is not a jsonb value, so `v_line->>'qty'` has no operator, and every order died on the
first line. The loop variable is `jsonb` now and the loop selects the element itself. While in
there: more than 40 lines in one order is refused — a browser posting four hundred lines is
not a farmer.

**2. A catalogue built from batches was the wrong object, and its prices were fictional.**
Listing live Semen Inventory rows with bottles left did two bad things at once. It made a
reseller's order depend on what happened to be in the cooler, which is backwards: they are
asking for semen, and **which boar to collect is the farm's decision**, made after the order,
never before it. And because a `semen_inventory` row in this app carries a collection `cost`
and no selling price — nothing in the app has ever written `price_per_dose` — every card on
the page honestly printed **₱0.00**, while the app's own pick-up form prefilled `price || 350`
behind it. The page was not mispriced; it was pricing something that has no price.

What exists instead is a **menu the farm owns**: Reseller Center → 🧬 Order menu — rows of
`{ breed, ₱/bottle, note, on the menu? }`, seeded once with Largewhite, Duroc, Duroc Pietrain
and Hamruc Pietrain, yours to rename, reorder, unlist or delete. Their page offers that list
with no stock figure and no ceiling but 999 bottles per line. An order line stores the menu
price **at the moment of ordering**, so re-pricing tomorrow does not re-price a request that
already arrived. Accepting opens Record Semen Pickup with their count and that price and the
**batch left blank**: you choose the boar in the form's own dropdown. Picking a batch no longer
overwrites the ordered price (`ordered_rate` wins over the old `price || 350` fallback), and the
only stock gate left is `saveResellerPickup`, which still refuses to hand out bottles that are
not there. A breed with nothing in the cooler is stated as a warning on the order card and on
the prefill strip — never a reason the order cannot be placed, and never a silent cut.

And an order nobody has priced says **“price to confirm”** on the order card, in the pop-up
and on the prefill strip — never `₱0.00`. A zero on a money screen reads as *free* to a tired
office, and their menu starts at ₱0 by default, so the very first real order would otherwise have
been billed at nothing with a smile. Typing the ₱/bottle in the pick-up form is what fixes it, and
the strip says so in the sentence right above Save.

**3. An arrival now interrupts.** Per order, once: a pop-up on whatever screen the office is on
(who, bottles, exact money, their note, the date they want it) with a beep and a vibration and
**Open orders / Later**; a `🛒 N order new` chip on that reseller's own card, which opens the
inbox filtered to them; and `🛒 Orders (N)` permanently in the toolbar, so the queue stays
reachable after "seen". The watch is a 20-second read of the *local* bucket — no new polling and
no new endpoint; the existing sync head probe is what carries the row. First run on a device
marks the existing queue silently, so a backlog never shouts, and the pop-up stays quiet while
the inbox is already open.

**Re-paste `supabase/reseller_orders.sql` once, then open 🧬 Order menu and press ✓ Save menu.**
The SQL is idempotent and rewrites no existing row — but the `record ->>` failure lives in the
database, so uploading the zip alone cannot fix it. (From v232 the paste also drops and recreates
its own four functions, since v231 changed a return type; see the section above.) Saving the menu once is what puts your four
breeds into the cloud for the page to read; until then their page says the farm has not put any
breeds on the menu yet, which is true.

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
2. **The farm's own SQL does the money.** `ars_place_order()` looks the breed up in that
   farm's menu, takes the ₱/bottle written there — never the number in the request — and
   stamps the row with `rate`, `amount`, `total`, `bottles`. A key that is no longer on the
   menu is dropped into a `removed` list with a reason, which their page prints instead of
   pretending it sent something. It consults no stock column at all, by design.
3. **Accepting cannot over-promise.** The prefill carries their count and the price the order
   recorded; `saveResellerPickup` then re-validates the bottles before it deducts, exactly as
   it does for a hand-written pick-up. So an order for 40 of a breed that has 5 either gets 5
   and the office adds a second line later, or the save says *"Only 5 bottle(s) on hand …
   Nothing was saved."* — and the order keeps its `accepted` decision either way.
4. **Inbox money is exact, not rounded.** The app's `peso()` rounds to whole pesos (right for
   a receipt footer, wrong for a queue), so the inbox uses its own formatter: a ₱350.50 line
   shows `₱350.50`, a whole amount stays `₱1,200`.

## Files touched (v230, with v231 on top)

| File | Change |
|---|---|
| `order.html` *(new, root)* | The reseller's ordering page. Own `<style>` on purpose: a future `app.css` change can never break a link you already handed out. v231: the heading asks *"Which breeds do you need?"*, the bottles-left pill is gone. |
| `order-page.js` → `js/order-page.js` *(new)* | Token parsing, cart maths, the quantity-only `rpc` calls, their own status list. v231: the cart is capped at 999/line with a stated reason and a retired breed is dropped with one; no stock figure exists anywhere in the file. |
| `supabase/reseller_orders.sql` *(new)* | The install you paste once: 3 partial indexes + 4 `security definer` functions. No new table. v231: the catalogue reads the farm's menu, `ars_place_order` takes the menu price and touches no stock, and its loop variable is `jsonb` (the `record ->>` fix). |
| `semen-sales.js` | Badge in the Registered Resellers KPI box · `🛒 Order link` per reseller · the order inbox · link create/pause/supersede + QR/copy/share · `acceptResellerOrder` → prefilled pick-up (one-shot `pendingPickupPrefill`) · decline with a reason · `👁 Seen`. **v231:** `🧬 Order menu` editor in the toolbar (+ `🛒 Orders (N)`), `ensureResellerOrderMenu` seeded once and never re-seeded behind an empty list, the `🛒 N order new` chip on each reseller's card, the pop-up + beep + vibration with `ars-order-notified:<farmId>`, breed-shaped prefill with the batch left blank, `ordered_rate` so a batch pick cannot re-price an accepted order, and the link sheet's menu warning. |
| `client.js` | `entityMap` += `semenResellerOrders: 'semen_reseller_order'`, `semenResellerOrderLinks: 'semen_reseller_order_link'`, `semenOrderBreeds: 'semen_order_breed'` — so orders, links and the menu sync, back up and restore like every other record (the menu must sync: the public page reads it from the cloud). |
| `app.js` | `sanitizeFarm` initialises the three buckets, as it does for all the others. |
| `sw.js` | `/order.html` and `/js/order-page.js` bypass the app cache (a reseller must never get yesterday's page, and offline must not hand them your login screen). |
| `_headers`, `config.js` | `order.html` served `no-cache` + `X-Robots-Tag: noindex`; version `v232-reseller-sql-recreate-2026-09-12`. |
| `qa/build-deploy-layout.sh`, `qa/test-reseller-orders.mjs` | the page is copied into the deploy layout; 197 checks. |

No `_worker.js` change is needed: it only special-cases `/ars-head` and otherwise falls
through to `env.ASSETS.fetch(request)`, so `/order.html` is served as a static asset.

## One-time install (Supabase → SQL editor → Paste)

Paste **`supabase/reseller_orders.sql`** once (again, for v231 — it replaces the catalogue
function, rewrites `ars_place_order` and adds the menu's index; v232 made that paste work on a
farm that already had v230 installed). It is idempotent — every statement is
`create or replace` / `create index if not exists` / `drop function if exists`, so pasting it
twice is safe, and it installs nothing else. It creates **no table and deletes no row**: orders and links are
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

A `save()` in a render is a bug, by the way: v231 briefly seeded the menu when the hub
*opened*, which put an extra write into a "nothing was saved" invariant in
`qa/test-reseller-return.mjs` and was caught by it on the spot. Seeding is in memory; the
write happens when the farm presses ✓ Save menu or creates a link.

## Using it

**You (the farm):**
1. Semen Reseller Center → **🧬 Order menu** once: your four breeds are already there — put a
   ₱/bottle on each (leave it blank and they see "Price confirmed by the farm"), add or delete
   lines, then **✓ Save menu**. This list, not the cooler, is what they can order.
2. Open a reseller (tap their name) → **🛒 Order link**.
2. First time: **🛒 Create their order link**. It copies itself — paste into Messenger/SMS.
   Or let them scan the QR on the same sheet.
3. An order arrives, loudly: a pop-up wherever you are (beep + vibration), `🛒 N new orders` on
   **Registered Resellers**, and `🛒 N order new` on that reseller's own card → tap any of them →
   **✓ Accept & create pick-up** → choose which boar to collect on each line, edit a qty or `✕`
   a line if you must → **Save**. That save is the moment bottles and balance move.
4. Can't fill it today: **✕ Decline** and type why — they see your note on their page. Accepting
   a breed you have none of is also allowed; collect it later.
5. Busy: **👁 Seen** (the flash stops, the request stays waiting — seeing is not deciding).
6. **🔗 Links** shows every link in the farm and how many orders each brought.

**Your reseller:** open the link → the farm's breeds and menu prices appear → tap `＋` → their
total shows at the bottom → (optional) note + wanted date → **Place order**. Their page then
lists their own recent orders as `Waiting for the farm` / `Accepted — ready to pick up` /
`Declined`, and it tells them honestly if a count was cut to what you have.

## Checks that ran

`node qa/test-reseller-orders.mjs` → **197/197** (page arithmetic with no stock in it and the
999 cap; the payload that leaves the phone; the fake-browser end-to-end incl. an unpriced breed
admitted as "Price confirmed by the farm"; link lifecycle incl. supersede and pause; the menu —
seeded once, emptied stays emptied, duplicates refused, a draft line pruned on cancel, and a
hub open that provably writes nothing; badge + per-reseller chip; accept honouring the menu price
and leaving the batch blank; accept → prefilled form → choose a boar → save → **₱1,350 billed
and 10 → 7 bottles**; the two refusals (no boar chosen, more than on hand); the pop-up incl.
silent first run and never twice; every sheet's markup linted against `app.css`; the sync
contract; the shipped files and the SQL's shape, incl. a lint that no jsonb loop variable is
declared `record`). `qa/test-reseller-return.mjs` still **167/167** and
`qa/test-sync-preflight.mjs` still **27/27**, so the return/replace money and the sync
preflight are untouched.

`ARS_DUMP_SHEETS=1 node qa/test-reseller-orders.mjs` writes `/tmp/order-*.html` if you want
to read a sheet's markup without a phone.

## Deliberately not in this build

A phone-number OTP or account for resellers; payment on delivery; auto-notify by SMS/Telegram
when an order lands (the pop-up is in-app only); letting a reseller see their consignment
balance; per-reseller quantity caps or price tiers; order-to-invoice printing; stock
reservations while an order is pending. A named-boar *preference* also stays out: their order is
by breed, the boar is yours, and turning it into structure would mean holding a bottle — that is
a reservation feature, not a tweak to this one.
Say which of those matters and it becomes the next fix.

**Rollback:** delete the build (previous tag) and, if you want the entry points gone, run
`drop function if exists public.ars_place_order(text, jsonb, text, text);` and the three
siblings. No table was created and no existing row was rewritten, so nothing needs restoring.
