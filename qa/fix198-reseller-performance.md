# FIX 198 — Top Resellers of the Month + a performance summary in every reseller profile

**Requested (2026-09-26):**

1. On the resellers page, add a *"Top Resellers of the Month"* with interactive
   animation. The system must correctly calculate **why** a specific reseller is
   the top performer.
2. In every reseller profile, add a quick summary where the farm can select
   **last month / this month / a custom set of dates** and see **how many bottles
   were sold** and **what percent were returned and replaced**. Make it professional.

Both ship in `semen-sales.js` (Semen Reseller Center) + `app.css`. No new file is
linked from `index.html`, so a phone picks them up with the normal shell refresh —
`config.js` and `sw.js` move to `v247-reseller-performance-2026-09-26` together.

---

## 1. One engine, two screens

A leaderboard that counts different bottles from the profile underneath it is
worse than no leaderboard, so both screens are rendered from a single function set:

| Function | Answers |
| --- | --- |
| `resellerRangeFor(state)` | "This month" / "Last month" / custom → one concrete `from`–`to` window |
| `resellerAdjustmentEvents(tx)` | when each return / replacement actually happened |
| `resellerPeriodStats(f, reseller, range)` | every number both screens print |
| `resellerLeaderboard(f, range)` | the ranking, with each reseller's score broken into its parts |
| `resellerTopReasons(board)` | the plain-language proof for the #1 spot |

They are also exposed for QA and future screens:
`window.arsResellerPeriodStats`, `window.arsResellerLeaderboard`,
`window.arsResellerTopReasons`, `window.arsResellerRangeFor`.

## 2. The accounting rules (this is the actual feature)

1. **Local dates, never UTC.** `resDayKey()` derives `YYYY-MM-DD` from local date
   parts. FIX 197 showed what `toISOString()` does on a UTC+8 phone: October 1
   00:00 local files itself under September.
2. **A pickup counts in the period it was dispatched in.**
3. **A return or replacement counts in the period it was *recorded* in**, not the
   period of the pickup it corrects. Bottles that came back in October are
   October's returns even if they were picked up in September. The per-save audit
   trail written by FIX 187 (`tx.return_audit[].at`) carries those dates. A save
   that only *undid* a mis-keyed return counts **negative** for that day, because
   that is exactly what it did to the month's return count
   (`returns − undone`, `replacements − cancelled`).
4. **The audit is reconciled, never trusted blindly.** `tx.return_audit` is capped
   at the last 20 saves and records written by older builds have none at all. The
   events are summed and compared against what the invoice lines actually hold
   (`returned_qty`, `lineReplacements(l)`); any unexplained remainder is emitted as
   one event dated at `return_adjusted_at` / `adjusted_at`. Totals therefore always
   add up to the invoice, on legacy rows too.
5. **Voided pickups are excluded** everywhere (they are not sales).
6. **Cash counts on the date received** — modal payments and money paid at
   dispatch, via the dated history from FIX 95. A November payment against an
   October invoice is November's collection.
7. **A percentage needs a denominator.** If a window holds returns but no bottles
   dispatched (e.g. a one-day custom range on the day a return was keyed), the tile
   shows `2 btl` and *"returned against pickups dated outside this window"* instead
   of a meaningless `0.0%`.

Derived figures: `net bottles sold = dispatched − returned + replaced`,
`returned % = returned ÷ dispatched`, `replaced % = replaced ÷ dispatched`,
`replacement coverage = replaced ÷ returned`,
`collection rate = collected ÷ net billed` (net billed = billed − discounts).

## 3. Why *that* reseller is on top

100 points, five weighted metrics. Volume, value and cash are scored **relative to
the month's best performer**; the two rate metrics are absolute, so a small
reseller who sells everything he takes and settles on time still competes for 25
points and a big sloppy one cannot hide behind volume.

| Weight | Metric | Basis |
| ---: | --- | --- |
| 30 | Bottles delivered | net bottles (dispatched − returned + replacements) ÷ month's best |
| 25 | Net sales value | billed − discounts ÷ month's best |
| 20 | Cash collected | payments received in the period ÷ month's best |
| 15 | Collection rate | collected ÷ net billed |
| 10 | Low-return quality | 1 − return rate |

Ties break on net bottles, then cash, then name. Every point is shown: the
winner's five component bars sit under the "Why … is on top" panel, and any row
expands to the same breakdown plus its raw counts. The explanation only says
*"most"* or *"highest"* when the reseller genuinely leads that metric, quotes the
gap to the runner-up and the field average, and names the metric that decided the
margin.

## 4. Interaction & animation

* Podium tiles pop in, staggered; the gold medal bobs and the crown shimmers.
* Score bars fill from 0 with an eased 0.9–1 s transition; scores count up
  (ease-out cubic).
* **The final figures are in the markup already** — the count-up only replays
  them, and a 1.4 s watchdog paints the final value if `requestAnimationFrame`
  never fires (hidden tab, throttled webview). Nothing is ever left showing `0`.
* This month / Last month chips re-render the board in place and replay the
  animation; any row expands its score breakdown; a podium tile scrolls to that
  reseller's card, opens it and flashes it.
* Expanding a profile replays that summary's bars.
* Every animation is a transform/opacity/width transition and all of them are
  switched off under `prefers-reduced-motion`.

## 5. The profile summary

Rendered at the top of every reseller card body (`.rps-card`):

* **Period chips** — This month · Last month · Custom range (two date inputs +
  Apply; a back-to-front range is swapped, not dropped). The choice is remembered
  per reseller across hub re-renders.
* **Four tiles** — Bottles sold (net), Returned %, Replaced %, Collected, each
  with a ▲/▼ delta against the *comparable previous window* (previous month, or
  the same number of days immediately before a custom range).
* **Stacked bar + legend** — kept / returned / replaced, and a fulfilment rate.
* **Daily sparkline** of bottles dispatched (returned days flagged amber).
* **Money line** — gross billed, discounts, net billed, unpaid in period, average
  per pickup, all-time open balance.
* **Mix dispatched** and **return reasons** pills.
* A footer stating the basis, the window and what it is being compared against —
  so the number can be defended in front of the reseller.

## 6. Tests

`node qa/test-reseller-performance.mjs` — 80 checks, boots the real module in a VM:
score model totals 100 and each score equals the sum of the points displayed;
local month boundaries; a September pickup returned in October counted in October;
trimmed-audit and no-audit legacy rows reconciled; voided pickup invisible;
cash dated on receipt; custom/one-day/reversed ranges; empty month crowns nobody;
the hub really mounts the board and one summary per reseller; the no-denominator
case; and the CSS (light theme, phone layout, reduced motion) shipped with it.

Regression suites re-run green: `test-reseller-return` (167), `test-reseller-orders`
(337), `test-neumorphic-ui` (41), `test-button-contrast` (26), `test-sow-action-menu`,
`test-bottom-nav-icons`, `test-med-internet-products`, `test-month-timezone`,
`test-sync-preflight`.

Two assertions in `test-button-contrast` and `test-reseller-orders` had pinned the
literal `v241-board-contrast` release string and had been failing since v246
shipped; they now assert the invariant they were written to defend — `sw.js` names
its cache after `config.js`'s build string and both move together.

`qa/preview-reseller-performance.html` is a throw-away harness: it boots the real
`semen-sales.js` against the real `app.css` with a mock farm, so both screens can be
eyeballed without signing in. It is deliberately **not** in `build-deploy-layout.sh`.
