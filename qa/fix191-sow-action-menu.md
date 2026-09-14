# FIX 191 — the sow card's ⋯ (v240)

Their instruction, in their words:

> *"If you want the drilldown card collapsed to ~4 actions with the rest in a ⋯ menu, say so and
> I'll cut it." — **"Yes please"**

This is the follow-up to the v239 affordance layer. v239 made every key look like a key; it did not
reduce how many keys there are. This does.

## What the card was

Counting the buttons `sowCard()` printed for a lactating sow with a photo on file:

| where | buttons |
|---|---|
| `.drill-actions` (top right) | `actionButtons()` → WEAN · FARROWING RECORD, then **CULL**, then **🗑 delete the whole sow** |
| photo row | **📷 Change photo**, **🗑 remove photo** |
| `.sow-quick-actions` | 💉 + Vaccine · 💊 + Treat · 🚚 Move Stall · 🧬 Pedigree · 👁 Profile |
| lineage box | View Tree → |
| treatment list | + Add, and sometimes `+N More` |

**Twelve to thirteen controls per sow**, and three observations made the case for cutting rather than
styling:

1. **👁 Profile called the same `openSowProfile(index)` as VIEW GESTATION**, and **🧬 Pedigree called
   the same `openQuickPedigreeForSow(index)` as View Tree** — two buttons were pure duplication.
2. **The two destructive ones sat between the daily ones**: `CULL` and `🗑` (which permanently deletes
   the sow row) were 10 px from `+ Vaccine`. On a phone, in a barn, that is a wrong-tap waiting to
   happen — and hiding them behind one more tap is a safety change, not a cosmetic one.
3. `actionButtons()` built its buttons by string concatenation, so a state with three actions
   (PREGNANT) printed three and nothing anywhere said "the card may hold at most N".

## What the card is now

```
VIEW GESTATION   🔥 RECORD REHEAT   ⋯ More 3
💉 + Vaccine     💊 + Treat         🚚 Move Stall
```

(a gestating sow with no photo on file: the sheet holds Profile — deduped away here, because VIEW
GESTATION already opens it — Add photo, Cull and Delete, so the pill says 3; with a photo it says 4.)

Four to five visible actions (never more than six, whatever the state), the daily three, and the
destructive ones off the surface entirely.

The card and the sheet are now generated from **one array**:

```js
{ ico: '🔥', card: '🔥 HEAT', label: 'Record heat', note: 'she was seen in heat today',
  run: `openHeatRecord(${index})` }
```

`visibleSowStateActions()` prints the first `SOW_CARD_PRIMARY_STATE_ACTIONS` (2) and
`sowMoreActions()` returns the rest plus Profile, the photo pair, Cull and Delete — filtered by
`run`, so an action already on the card cannot appear twice in the menu, and an action the card cut
off cannot be lost. That single-source rule is the whole safety argument of this change, and it is
mechanically enforced: `qa/test-sow-action-menu.mjs` lifts the two pure functions out of
`drilldown.js` and **executes** them for all seven states × with/without a photo, then asserts that
every handler the old markup had is reachable, that no label drifted, that nothing destructive is
visible, and that no `run` string is on both sides.

## The sheet

The app's own overlay, reused verbatim — `.due-modal-bg` + `.due-modal` + `.close-reminder` ×, the
same structure as `#treatAction`, `#cullModal` and the reseller hub. No new overlay class, because
an invented class is an invisible overlay: the tap "does nothing" and the farm assumes the app hung.
Its rows reuse `.semen-stock-menu` + `.ss-icon` (the semen intake menu), so a row is icon + title +
one-line note, and the two dangerous rows wear the app's own `.danger-btn` red.

Why a modal and not a small anchored popover:

- `.drill-sow` cards are dense and clipped; a popover anchored inside one would be cut off or land
  under the next card;
- `@media print` un-fixes `.drill-bg`, so a popover born inside the panel inherits print behaviour,
  and a `⋯` on paper is a lie — the new CSS therefore hides `.sow-more-btn`, `.sow-photo-hint` and
  the sheet when printing;
- the app already has the overlay sweep (`showPage` removes every `.due-modal-bg`), so the sheet
  cannot outlive the screen that opened it.

Three things a ⋯ menu needs that a `<button>` does not, and their guards:

| | |
|---|---|
| stacking | `.drill-bg > .drill-panel` is `z-index:9999` and the base `.due-modal-bg` is `9998!important` — a sheet opened *from inside the drilldown* would have sat under the panel that opened it. `#sowMoreActions.due-modal-bg{z-index:999999!important}` — the `!important` is not decoration: only another `!important` beats a `!important` |
| focus and keyboard | the ⋯ carries `aria-haspopup="dialog"` / `aria-expanded`, the first row takes focus on open, `Escape` closes, and closing returns focus to the ⋯ — except when a row was chosen, where stealing focus back would leave a keyboard user behind the dialog that just opened |
| stale index | the app's card handlers all take a **position in `F().sows`**, so the sheet resolves the sow at tap time and returns without opening anything if that index no longer exists, instead of opening the *wrong sow's* Cull modal. No sow id is ever interpolated into an attribute — a name with a quote in it cannot break a row (the REBUILD FIX 56 rule) |

Two side effects worth knowing about:

- a sow with no photo now reads `📷 No photo yet · ⋯ More to change it` instead of two buttons, so
  the row explains itself instead of inviting a tap;
- `VIEW GESTATION` / `PREGNANCY STATUS` / `FARROWING RECORD` / `⚠ ALERT` changed from a bare
  `openSowProfile(i)` to `window.openSowProfile && window.openSowProfile(i)` — the same guard the
  quick-action row already used, because `openSowProfile` lives in another file and a failed load
  used to make these four buttons throw.

## Fixed while testing: the suite was only green before midnight

`qa/test-reseller-orders.mjs` stamped its "today" fixtures as `Date.now() + 1h`. Run after 23:00
local, those orders landed on the day **after** the board's `orderDayOffset(0)`, and 11 collection-
board checks failed against a correct app (this is exactly what happened while writing this
release). The fixtures are now anchored to **local noon** (`stamp(off)`), which is the same local
day in every timezone a farm's phone can be in.

Noted, not changed: the board scopes days with `new Date().getFullYear()/getMonth()/getDate()` —
the **device's** day — while the inbox grouping uses `localDay(…, tz offset)` — the **farm's** day.
For a farm in Manila holding phones set to Manila they are the same day, so this is not a bug today;
if a farm ever syncs from a phone in another timezone, the board's "Today" should switch to the
farm's day like the rest of the app. One-line change, separate release, since it moves a *number*,
not a pixel.

## v239's one visual defect, found and fenced here

`neumorphic.css` lifts "anything with an `onclick`". A modal backdrop **is** an element with an
`onclick` (tap-outside-to-close), so the whole viewport got the soft edge — a 1 px teal frame around
every open modal, plus a press flash when tapping outside. All four `[onclick]` rules now exclude
`[class*="modal-bg"]`, `.drill-bg`, `.onboard-screen` and `.reset-screen`. `qa/test-neumorphic-ui.mjs`
grew a check for that exclusion (it is the kind of thing no one notices until a screenshot).

## Files

| file | change |
|---|---|
| `drilldown.js` | `actionButtons()` → `sowStateActions()` / `visibleSowStateActions()` / `sowMoreActions()` / `sowMoreSheetHTML()` / `openSowMoreActions()` / `closeSowMoreActions()`; the card's three button rows rewritten; two exports added |
| `app.css` | one `[FIX 191]` block appended: the ⋯ button, the count pill, the sheet width/row sizes, the z-index override, the print rule. No existing rule edited |
| `neumorphic.css` | overlay backdrops excluded from lift / press / hover, + the header note |
| `qa/test-sow-action-menu.mjs` | **new**, 32 checks, including the executed per-state split |
| `qa/test-neumorphic-ui.mjs` | 41 checks (the backdrop exclusion, and the `cardPress` probe tightened so it cannot match the wrong rule) |
| `qa/test-reseller-orders.mjs` | fixtures anchored to local noon; build-string assertion → v240 |
| `sw.js` / `config.js` | `v240-sow-action-menu-2026-09-14` |

No new file ships, so no new `<link>` and no new cache entry to miss when a folder is uploaded by
hand; `./js/drilldown.js` was already in `APP_SHELL`. No SQL.

## Checks

`test-sow-action-menu.mjs` **32/32** · `test-neumorphic-ui.mjs` **41/41** ·
`test-reseller-orders.mjs` **337/337** · `test-reseller-return.mjs` **167/167** ·
`test-sync-preflight.mjs` **27/27** — **604 total**, plus `node --check` on every JS file.

## After uploading, on the phone

1. A sow card should read as: state, state, ⋯, then Vaccine / Treat / Move Stall — nothing red.
2. `⋯ More 4` opens a dark sheet with the sow's name; each row says what it does in one line.
3. Cull and Delete are in there, red, and still ask their usual questions — the confirmations were
   not rewritten, only relocated.
4. Tap outside, or press Escape, or tap ×, and it closes and hands focus back to the ⋯.
5. Print a card: no ⋯, no `📷 …` hint.
6. A state that had three buttons (PREGNANT) is the only one where a *state* action is inside the
   sheet (🔥 Record reheat) — if that ever feels wrong, `SOW_CARD_PRIMARY_STATE_ACTIONS = 3` is one
   number in one line and nothing else has to change.
