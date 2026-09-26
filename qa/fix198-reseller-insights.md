# FIX 198 — Top Resellers of the Month + per-profile performance summary

Build: `v247-reseller-insights-2026-09-26` · files: `semen-sales.js` (reseller section),
`app.css` (appended block), `config.js`, `sw.js`, `releases/arswinetech-pro-latest.zip`
Verification: `node qa/test-reseller-insights.mjs` → 79/79 · every other suite in `qa/` green.

## What was asked (two phone screenshots, 2026-09-26)

1. On the Semen Reseller Center, a **"Top Resellers of the Month"** with interactive
   animation, where the system shows **why** a reseller is the top performer.
2. In every reseller profile, a **professional quick summary** selectable by **this month /
   last month / custom dates**: bottles sold, % returned, % replaced.

## One counting engine for both screens

`resellerStatsFromTxs(txs)`, used by the leaderboard and by every profile summary, so the two
can never disagree about the same reseller and the same dates.

| figure | definition |
|---|---|
| pickup's day | LOCAL calendar day of `timestamp` (fallback `date`). Never a UTC slice (FIX 197): a pickup at 00:30 Sep 1 in Manila is September |
| scope | non-voided pickups of that reseller (by id or name, the same match the balance uses) |
| picked up | Σ `line.qty` |
| returned | Σ `line.returned_qty`, capped at the line's qty |
| replaced | Σ replacement bottles handed over (`lineReplacements`, so multi-batch rows from FIX 187 count) |
| **net bottles sold** | picked up − returned + replaced (= what is billed) |
| return rate / replacement rate | returned ÷ picked up / replaced ÷ picked up |
| returned → replaced / → credited | min(returned, replaced) / returned − replaced |
| net sales | billed − discounts |
| collected | paid, **capped per pickup at its net due**, so an over-keyed payment cannot push a rate past 100 % |
| still open | Σ per-pickup balance |

Returns and replacements count against the **pickup they came from**, because line data carries
no reliable per-return date. So "September's return rate" means: of the bottles picked up in
September, how many came back. Both screens say this on screen.

## 1) Top Resellers of the Month (hub, between the toolbar and the search)

* Month dropdown: every month with pickups, plus the current one. Opens on the current month,
  or on the latest month with data if the current one is still empty (e.g. on the 1st).
* **Rank by**: Bottles sold (net, default) · Net sales · Collected.
* Ties go to net sales, then net bottles, then the **lower** return rate, then the name. The
  engine records *which* rule separated each pair (`decidedBy`), so the reasons can say "Tied
  with #2 Jo Dacara on net bottles sold; placed first on net sales" instead of guessing.
* **Why #N** panel (open on #1; tap any podium column or row to switch without replaying the
  podium animation):
  * share of the month: "44 net bottles sold — 35.2% of all resellers' 125 in September 2026";
  * lead/gap: "Leads #2 … by 6", or "6 behind #1 …", or the tie sentence above;
  * return rate vs the group rate (Σreturned ÷ Σpicked of all active resellers);
  * swapped vs credited returns;
  * collection % of this month's billing and what is still open;
  * pickups, average bottles per pickup, dominant breed.
* The method is printed under the board, with the date range and the tie order.
* Animation (CSS only, all switched off under `prefers-reduced-motion`): podium steps rise
  3rd → 2nd → 1st, avatars pop, a floating crown, a shine across the gold step, a light sweep
  over the card, leaderboard bars fill, rows fade in staggered, and numbers count up (JS
  `requestAnimationFrame`). The HTML always carries the final value, so nothing is wrong if the
  animation never runs.

## 2) Profile performance summary (top of each expanded reseller card)

* Chips: **This month** (month-to-date) · **Last month** · **Custom** (From/To pickers; dates
  typed backwards are swapped; a missing date is refused with a toast).
* Comparison: this month vs **the same days of last month** (Sep 1–26 vs Aug 1–26, and Feb is
  clamped when today is the 31st). Last month vs the month before. Custom vs the equal-length
  window right before it. The deltas are coloured by whether the change is good (more bottles
  = good, a higher return rate = bad).
* Tiles: bottles picked up (pickups, average), **net bottles sold**, **returned %** (n of N),
  **replaced %** (bottles handed over).
* Split bar: kept / returned → replaced / returned → credited, with a legend.
* Money: net sales (after discount), collected (% of net sales), still open.
* Breed mix by net bottles, and top return reasons.
* An idle period says so and quotes the comparison period's activity.

## Rules kept

* No `data-neo` call site in JS, and no `:focus-visible` in app.css: the podium and chips take
  the app-wide neumorphic lift and focus ring like every other key.
* Every `rtop-*` / `rsum-*` class the templates emit is defined in app.css (asserted).
* Light-theme overrides included.
* No stored record is written: the insights read `semenResellerTx` only.

## Test fixes riding along

`test-reseller-orders.mjs [14]` and `test-button-contrast.mjs` pinned the service-worker cache
to the literal `v241-board-contrast`, so they had been failing since v246. Both now assert the
real invariant: `CACHE_NAME` = `arswinetech-pro-` + `ARS_APP_VERSION`, the same check
`test-neumorphic-ui.mjs` already used.
