# FIX 188 / FIX 189 — Reseller order links and the farm's order menu (v230 → v237)

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

## v237 — a search box, because this inbox is the one list that never stops growing

Their screenshot this time was the inbox itself, working correctly (v236 live, the breed × count
on every label, `2 min ago` on one line, the two hints stacked) with one request attached: *add a
search bar — name of reseller, auto-suggest while typing — to prepare for months, years, at least
there is an option to filter the resellers specific order placed for any reference required.* That
is the right instinct: the pending queue stays small, the **Handled** list is the thing that becomes
500 cards, and a farm that has to scroll to find a reference stops using the app for references.

- **one box, four things to search**: the reseller's name (both the name frozen on the order and
  their name today, so a rename never loses their history), their contact number, any word from
  their note or your decline/accept note, any breed or boar or batch number on it, and either date
  — `2026-09-12` finds the order that wanted it. Words are AND-ed, so `myrna no boar` narrows to
  one order instead of widening into every order containing any of those words.
- **auto-suggest, with the number that makes years usable**: focus lists everyone who has ever
  ordered, busiest first, each row saying `Andy Dev Test · 1 order · 🛒 1 waiting · last 2 min ago`
  and on the right `2 bottles · ₱800`. Typing narrows that list; a tie is broken by the name, never
  by insertion order. Tapping a row puts their name in the box — it is a *filter*, nothing more, and
  no order is touched (a test compares the whole `semenResellerOrders` array byte-for-byte before
  and after the search).
- **typing never rebuilds the modal**: the search row, the heading and the footer are written once
  per open; the list under them (`#orderInboxBody`) is what redraws. An input that is re-rendered on
  every keystroke loses the caret, and on Android that means the keyboard closes after one letter —
  the reason the old directory search worked and this one had to be built fresh.
- **a filter says what it hid**: `🔎 1 of 3 orders for “myrna no boar” · 2 hidden` with `✕ Clear`
  on the same row, and when nothing pending matches but something decided does, the list says *that*
  (`Nothing waiting for a decision matches “greg” — 2 matches are in Handled below`) instead of the
  misleading `nothing here`. Escape or ✕ clears; Enter takes the top suggestion.
- **a filter survives the decision it was made for**: accepting, declining or marking seen re-renders
  the inbox with `keepState`, so your typing and your expanded history are still there when the
  pick-up sheet closes. A *fresh* open from the badge is what resets everything — including the
  one-reseller filter, which used to leak into the next opening.
- **the ceiling, and the lie that went with it**: expansion has always stopped at 40 cards. Now it
  says `Showing the 40 newest of 48 — type a name or a date above to reach the rest`, and while a
  search is running the same ceiling is stated on the matches. The old code kept offering
  `Show 6 older ↓` at the ceiling, and pressing it re-rendered the same 40 cards (or collapsed them
  while labelled "show more") — unreachable until a farm had ~46 handled orders, which is precisely
  the future this request is about.
- Keyboard asks for the search key (`enterkeyhint="search"`) so the phone renders 🔍 instead of
  return, and the query is re-printed into the input with `"` neutralised, because a redraw has to
  restore what you typed and `escH` does not cover quotes.

## v236 — the clue belongs on the label, not beside it

Their reply to v235 was a screenshot with red boxes drawn in the empty space *inside* the label
row, and one sentence that settled the design: *"that is where you should place the clue if what
specific breed the reseller had placed order along with its quantity … so the farm owner can save
the time navigating to the list of orders."* Two things to notice: the position, and that breed
alone is not enough — it has to be **breed × quantity** or you still walk to the inbox to count.

v235 had put the breed in a block above the picker and left the label reading `*`; and their
deployed build was still the one before *that* — the four-column row with the clipped `Subtotal`
and the `✕` hanging in the gutter is v234's, which is why no clue appeared at all. Between the two
requests the answer was the same: put `🧬 Duroc × 3` where the eye already is, on the label.

- **the label is the clue** — `Semen Batch / Boar Line 1 · 🧬 Duroc × 3`, breed and count at
  13.5px so they survive a glance, and `*` only on a hand-added line.
- **`(asked 3 × ₱450)`** follows in amber the moment the qty or price box stops matching the
  order, and removes itself when it matches again. It is derived from the live line on every
  totals recalculation (`refreshOrderLineDrift` inside `calcPickupTotals`), so it cannot go
  stale — which is the whole reason they were walking back to the inbox to double-check.
- **the block under the picker now says only what is actionable** — `BDD (5 left) is the only lot
  of it [Use it]`, `3 lots of it in stock, ticked ✓ at the top of the list`, `no Hamruc Pietrain
  in stock right now — any lot here works, or accept now and collect later`, `✓ Duroc (BD) is
  that breed`, `⚠ you put B1 Large White on this line instead`. A line that repeats its own breed
  twice is a line that gets skimmed.
- **the strip up top lists the order in one line** — `Largewhite × 2 · Duroc × 4 · Duroc
  Pietrain × 3 · Hamruc Pietrain × 3` — the shape of the request before the first dropdown. Fixing
  it also killed the stray `. .` their screenshot caught: two optional clauses each left their own
  period behind when neither applied.
- Their inbox card's `✓ ACCEPTED 7 / MIN AGO` was the same class of thing — relative time wrapped
  because `.adj-card-title > span` uppercases and letter-spaces — so `7 min ago` is `nowrap`
  normal-case now, and `wants it 2026-09-13` and `you choose which boar` sit on their own lines
  instead of running into one sentence.

## v235 — the pick-up line now says which breed it is for

Accepting an order opened Record Semen Pickup with four lines carrying the right counts and the
right money (₱1,200 + ₱800 + ₱1,250 + ₱600 = ₱3,850 on their test order) — and four identical
`— Choose Available Semen —` dropdowns. Nothing on the line said which breed it belonged to, so
matching the order to the cooler was a memory exercise, and the farm was writing it into the
caretaker note by hand (`Return: 2B1LW 2BD 3CDP`) to keep the lines straight.

Each prefilled line now carries its own clue:

- **above the picker**: `🛒 They asked for Duroc Pietrain · 5 bottles at ₱250`, and one of four
  honest states — *the only lot of it in stock is BDD (5 left)* with a **Use it** button that
  goes through the same handler as the dropdown; *3 lots of it in stock, ticked ✓ at the top of
  the list*; *no Duroc Pietrain in stock right now — put any lot here, or accept now and collect
  later*; or, once a lot is chosen, `✓ Duroc (BD) is that breed` / `⚠ you put B1 Large White on
  this line instead (fine if that was the swap you meant)`.
- **in the picker**: lots of the requested breed sort to the top and carry a `✓`. Nothing is
  pre-selected — that stays your decision, and a dropdown that already picked a boar is how a
  wrong lot quietly becomes an invoice.
- **in the label**: `Semen Batch / Boar Line 3 — for Duroc Pietrain`, so the tab order itself
  says what each row is for. (v236 moved the block from *above* the picker to *under* it and put
  the breed **plus the ordered quantity** into the label proper — see above.)

Breed matching lives in one helper (`lotsForBreed`) and it is **asymmetric on purpose** (tightened
in v236): requested breed vs a lot's **boar name** may contain it, because that is how pens name
pigs — "B1 Large White" is Largewhite, and a farm that spells its menu `Largewhite` and its boars
`Large White` still gets its ✓. Requested breed vs a lot's **breed field** must be the same word
(case and punctuation aside), because a farm that breeds `Duroc` does not thereby have `Duroc
Pietrain` and ticking that lot would be a claim no boar record made. The two mistakes are not
equal: a missed match costs you a hint, a wrong match hands the reseller a different pig. The
inbox warning, the clue and the tick marks all read from that one helper, so they cannot disagree. `ordered_breed` rides along on the
line and into the saved ledger line, which means the reseller's own history shows
`Batch: BDD · 2 bottle(s) × ₱250 · 🛒 asked Duroc Pietrain` **only when you gave a different
breed than the one requested** — a deliberate swap stays auditable, a matching fill stays quiet.

While in there: the line's money row was a four-column grid
(`minmax(85px) / minmax(105px) / minmax(95px) / auto`) inside a phone-width modal, which is what
was clipping `Subtotal` and hanging the `✕` half off the right edge in the same screenshot. Qty
and Price now share a two-column row and the subtotal sits under them, with the remove button
labelled `✕ Remove line 3` instead of a bare ✕ in the gutter — same ids, same arithmetic, nothing
to squeeze.

## v234 — five years of orders, and what a reseller's page is allowed to remember

Their question was the right one to ask before it becomes a problem: *the recent-orders list is
useful today, but what happens after years of orders — does it just keep eating memory?*

Two different things grow, and only one of them needs a feature:

- **The reseller's page cannot grow.** `ars_order_status()` ends in `limit 10` and a link can only
  ever read orders placed through it, so a five-year-old farm and a one-day-old farm cost the same
  phone call: at most ten rows, whatever the history. The page now also *refuses to render* more
  than **three** until they tap `Show N more ↓` — which is what they asked for, and it doubles as
  the reason the fixed basket bar has nothing to hide behind. When there is something behind the
  ten, the SQL returns `older` and the list says `7 older orders behind this list — your page only
  ever loads the last 10, the farm keeps them all`, instead of silently truncating.
- **The farm's records do grow, and that is fine, on purpose.** An order row is 854 bytes of JSON
  for an 8-bottle, 3-line order — about 0.8 MB per thousand orders before Postgres's row overhead.
  Five years at three orders a week is roughly 780 rows, under a megabyte, in a database whose
  free tier starts at 500 MB and whose expensive residents are photos and weight history. Nothing
  about the reseller page reads that table unbounded, so there is no cliff to fall off.
  **No auto-delete was added, and I would resist adding one:** these rows are the customer-facing
  paper trail for a request that moved money — pruning it on a timer is how a farm loses an
  argument three years later. If you ever want a control, the honest shape is "clear handled
  requests older than 12 months" as an explicit button in 🔗 Links, with the pick-up ledger left
  alone, because that is the record that actually bills.
- **The farm's own inbox had the same wall in it.** `Handled recently` used to draw eight cards
  with no way to see the rest and no mention that the rest existed. It is six cards with a
  `9 total` count in the header and `Show 3 older ↓` below; expanding keeps the reseller you
  tapped in from, and the header stops saying "recently" when nothing is hidden.

`What they ordered` is now printed in small text on every row (`2× Largewhite · 3× Duroc ·
3× Duroc Pietrain`). It is deliberately **frozen at placement** inside `ars_place_order` — a
denormalized `summary` on the order, not a join to your menu — because renaming "Duroc Pietrain"
next month must not rewrite what a reseller is looking at from March. Rows that predate this
build simply omit the line; nothing about them is invented.

One stale promise went with it: the inbox still told you *"prices are re-read from today's batch
price"* — true in v230, false since v231, and exactly the kind of sentence that makes a farm
stop reading the screen. It now says each line carries the ₱/bottle that was on 🧬 Order menu
when the order was sent.

## v233 — the last row of the reseller's page was unreachable behind the basket bar

Their screenshot was the page scrolled to its limit: **"My recent orders" showed one line of a
row and nothing more** — the pick-up date, the farm's answer and the status chip were under the
fixed bar, and the page would not scroll any further. The cause was a promise the CSS could not
keep: `body{padding-bottom:104px}` next to a bar whose real height is 11px + the totals row +
the button + a hint that wraps to two lines + `env(safe-area-inset-bottom)` ≈ 150-165px on a
phone. Any hint longer than one line ate the padding, and the more useful the hint, the more
content it buried.

Guessing is not the fix — the page measures. `syncBarSpace()` reads the bar's own height and
publishes it as `--ars-bar-h`; the CSS reserves `calc(var(--ars-bar-h,160px) + env(safe-area-inset-bottom) + 22px)`
and sets `scroll-padding-bottom` so an anchor jump also lands clear. It runs after every paint
(the hint changes height exactly when the basket changes), on `resize`/`orientationchange`, and
through a `ResizeObserver` when the browser has one. The `160px` default is the point: with the
script failing entirely, a reseller still reaches the bottom of their own history.

Two honest numbers on the same screen were fixed while in there, both from that screenshot:

- **`09/12/2026` in "Pick-up date wanted" at 00:01 on 09/13.** The page took "today" from
  `new Date().toISOString().slice(0,10)` — a UTC string — so for eight hours of every Philippine
  day the field defaulted to, and refused to accept, *yesterday*. A helper now formats the
  viewer's own calendar day, the same way an order's date is printed under "My recent orders"
  (a row placed at 00:30 in Dasmariñas no longer reads as the previous evening). The field is
  also labelled *(optional)* and left blank instead of pre-filling a date they never chose —
  "wants it tomorrow" and "any day" are different requests to the farm.
- **`4 bottles · ₱0.00`** on an order placed before the menu was priced. On a money screen ₱0.00
  reads as *free*, so the reseller's page now says what the app has said since v231: **price to
  confirm**, in the same amber the farm's inbox uses.

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
| `order.html` *(new, root)* | The reseller's ordering page. Own `<style>` on purpose: a future `app.css` change can never break a link you already handed out. v231: the heading asks *"Which breeds do you need?"*, the bottles-left pill is gone. v233: the room for the fixed bar is a measured CSS variable with a 160px fallback, and the pick-up date is optional. |
| `order-page.js` → `js/order-page.js` *(new)* | Token parsing, cart maths, the quantity-only `rpc` calls, their own status list. v231: the cart is capped at 999/line with a stated reason and a retired breed is dropped with one; no stock figure exists anywhere in the file. v233: `localDay()` for every date it shows or accepts, `syncBarSpace()` measuring the basket bar, and "price to confirm" instead of ₱0.00. |
| `supabase/reseller_orders.sql` *(new)* | The install you paste once: 3 partial indexes + 4 `security definer` functions. No new table. v231: the catalogue reads the farm's menu, `ars_place_order` takes the menu price and touches no stock, and its loop variable is `jsonb` (the `record ->>` fix). v234: `ars_order_status` gains `summary` + `older` beside its `limit 10`, and placement freezes the line list. **Re-paste needed.** |
| `semen-sales.js` | Badge in the Registered Resellers KPI box · `🛒 Order link` per reseller · the order inbox · link create/pause/supersede + QR/copy/share · `acceptResellerOrder` → prefilled pick-up (one-shot `pendingPickupPrefill`) · decline with a reason · `👁 Seen`. **v231:** `🧬 Order menu` editor in the toolbar (+ `🛒 Orders (N)`), `ensureResellerOrderMenu` seeded once and never re-seeded behind an empty list, the `🛒 N order new` chip on each reseller's card, the pop-up + beep + vibration with `ars-order-notified:<farmId>`, breed-shaped prefill with the batch left blank, `ordered_rate` so a batch pick cannot re-price an accepted order, and the link sheet's menu warning. |
| `client.js` | `entityMap` += `semenResellerOrders: 'semen_reseller_order'`, `semenResellerOrderLinks: 'semen_reseller_order_link'`, `semenOrderBreeds: 'semen_order_breed'` — so orders, links and the menu sync, back up and restore like every other record (the menu must sync: the public page reads it from the cloud). |
| `app.js` | `sanitizeFarm` initialises the three buckets, as it does for all the others. |
| `sw.js` | `/order.html` and `/js/order-page.js` bypass the app cache (a reseller must never get yesterday's page, and offline must not hand them your login screen). |
| `_headers`, `config.js` | `order.html` served `no-cache` + `X-Robots-Tag: noindex`; version `v237-inbox-search-2026-09-13`. |
| `qa/build-deploy-layout.sh`, `qa/test-reseller-orders.mjs` | the page is copied into the deploy layout; 308 checks. |

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

`node qa/test-reseller-orders.mjs` → **308/308** (page arithmetic with no stock in it and the
999 cap; the payload that leaves the phone; the fake-browser end-to-end incl. an unpriced breed
admitted as "Price confirmed by the farm"; link lifecycle incl. supersede and pause; the menu —
seeded once, emptied stays emptied, duplicates refused, a draft line pruned on cancel, and a
hub open that provably writes nothing; badge + per-reseller chip; accept honouring the menu price
and leaving the batch blank; accept → prefilled form (each line labelled with the breed it is for, the only
matching lot offered with one tap, a deliberate swap warned about, `ordered_breed` kept on the
saved line so a swap reads as `🛒 asked …` in the reseller's history only when it differs) →
choose a boar → save → **₱1,350 billed
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

**Still on offer, not built:** `Use it` could also fill the caretaker note with
`Return: 2B1LW 2BD 3CDP` — the shorthand they were already writing by hand to keep the lines
straight. It stays out of this build because the note's format is theirs, not a field the app
owns, and auto-writing into a free-text box people read as their own is a decision to make once,
not a default. Say the word and it is one line.

**Rollback:** delete the build (previous tag) and, if you want the entry points gone, run
`drop function if exists public.ars_place_order(text, jsonb, text, text);` and the three
siblings. No table was created and no existing row was rewritten, so nothing needs restoring.
