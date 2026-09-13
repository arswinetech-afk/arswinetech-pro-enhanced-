# FIX 190 — the neumorphic affordance layer (v239)

Their request, in full:

> *"If you will analyze, there is a lot of clickable buttons and some are not clickable. Can you
> redesign those clickable buttons into neumorphic UI so that it will not be confusing specially in
> mobile version? Will it not break anything since we are only dealing with the design?"*

Screenshots: the **Total Sows** drilldown card (VIEW GESTATION · RECORD REHEAT · CULL · 🗑 ·
Change photo · ＋Vaccine · ＋Treat · Move Stall · Pedigree · Profile, next to GESTATING / P0 /
"Unassigned Stall · —" chips), the **dashboard** (health-index card, ✓/⚠ check rows, 4-up KPI
tiles, "View breakdown →"), and the **Semen Inventory** drilldown (two AVAILABLE SEMEN tiles,
then a list of rows with chevrons, then "Show 107 older collection batches…").

## What the app was actually doing wrong

Three findings from `app.css` (6,085 lines, 291 KB), all of them the cause rather than the symptom:

1. **`.btn.ghost` has `box-shadow:none` and a flat fill** — and `.btn.ghost` is the most common
   button in the app. `.tag`, `.status-pill`, `.parity-pill` and `.count-pill` are the same shape
   language: small radius, tinted fill, no shadow. On the same panel, a control and a label are
   therefore pixel-indistinguishable, which is exactly what they reported.
2. **There is no `.btn:active` anywhere.** The seven `:active` rules in the stylesheet are all on
   *list rows* (`.drill-row-link`, `.care-batch-row`, `.health-chip`, `.boar-drill-row`,
   `.semen-stock-menu button`, `.suggest-item`, `.score-ring`) — the inversion of what a phone
   needs: the things that read like text flash when pressed, the buttons do nothing. On a phone the
   press *is* the affordance; there is no cursor to fall back on.
3. **`:focus-visible` count: 0.** No keyboard, barcode gun or switch device can see where it is.

The chevron in the semen list and the "Show 107 older collection batches…" dashed box are the other
half of the same problem: those rows are clickable *surfaces*, not buttons, so nothing in the
stylesheet said "press me" about them either.

## The rule the layer follows

**The element decides, not the class.** `button`, `.btn`, `[role=button]` and any element carrying
`onclick` (the app wires taps as inline `onclick` in 485 places, including `<div>`/`<span>` tiles)
get the raised soft-UI treatment: a black drop on the bottom-right, a teal-white highlight on the
top-left, an inset hairline edge, and — on press — the whole key goes *into* the panel.

Everything that is not such an element but was wearing button clothes (`.tag`, `.status-pill`,
`.parity-pill`, `.count-pill`, `.due-time`, `.field-hint`, the dashboard's read-only
`.checklist .check-item`) gets `--neo-inset` instead: the same hairline, pushed inward, plus
`cursor:default`. Raised = press me. Inset = stamped into the panel.

That vocabulary is the neumorphic one, and it is why the change is safe: it never touches the
*colours* that carry meaning (amber gestating, red overdue, green save), only elevation.

## Why "only design" still needs fencing, and how each risk is fenced

A CSS-only change cannot move a number, but it can break the interface in six ways. Each has a
guard, and each guard is asserted by `qa/test-neumorphic-ui.mjs` (40 checks):

| risk | fence |
|---|---|
| repainting a semantic colour, so a save button stops looking like a save | **not one `background:` or `color:` declaration in the file** — the app paints buttons inline from the JS templates and a layer that fought those would win on some and lose on others |
| re-flowing a tight layout (the pick-up Qty/Price grid was fixed in v236 for exactly this) | no `padding`, `margin`, `font-size`, `width`, `height`, `border-radius` or `display` either; the only geometry is `min-height: 40px` on real action rows inside `@media (max-width:760px)`, and none on inputs |
| breaking receipts and printouts | the entire layer is inside `@media screen`, and `.certificate` / `#feedReport` are reset on top of it |
| a transform on a clickable *card* creating a containing block, which makes an absolutely-positioned child (a corner chevron, a photo badge) jump | cards press with `box-shadow` only — `transform` is reserved for `button`/`.btn`/`[role=button]`; a test asserts the card rule contains no transform |
| lifting 11 rows inside a typeahead popover (turning one list into eleven keys) | `.semen-suggestions button`, `.tt-row button`, `.suggestion-empty`, `.nav button` and `.close-reminder` are exempted at the bottom of the file |
| a rule that silently does nothing (stale selector, typo'd token, missing semicolon, unbalanced brace) | the test checks every `var(--neo-…)` is defined, every class the file mentions exists in the app or `app.css`, brace balance, per-declaration parse, no `:has()`/`:is()` (older webviews), and no `!important` — none was needed, because the file loads last and matches app.css's own specificity |
| a half-uploaded folder breaking the *next* update | `sw.js` install was `cache.addAll(APP_SHELL)`, which rejects as a whole when one entry 404s — the old worker then stays alive and the site looks "unchanged" forever. It is now per-entry (`Promise.allSettled` + `cache.add`), so one missing extra cannot veto a release |

`data-neo="flat"` opts an element out and `data-neo="lift"` exists as the counterpart, for a
one-off screen, without touching the file. No `data-neo` attribute is set anywhere in the JS yet —
it is documented slack, not a dependency.

## Accessibility, said plainly

Neumorphism's known weakness is exactly the thing they want to fix and the thing that can go wrong:
a soft edge on a soft background is subtle, and subtlety fails in daylight. So the layer keeps a
**1px inset edge on every raised key** (a purist's neumorphic card drops it; a barn does not),
adds a real `:focus-visible` ring, respects `prefers-reduced-motion` (the transform goes, the
shadow stays) and `prefers-contrast: more` (the edge thickens to `rgba(190,245,240,.6)` and the
inset to `rgba(0,0,0,.75)`). Tap targets go to 40px on phones and the modal × to 44px — it is 30px
in `app.css` today, which is the hardest thing in the interface to hit and the one button you must
not miss when a sheet is covering your work. `-webkit-tap-highlight-color: transparent` removes the
grey Android flash that was previously the *only* press feedback, and `touch-action: manipulation`
removes the double-tap-zoom delay on controls.

## What is deliberately not in this build

- **`order.html`, the reseller's page, keeps its own design.** It is public, served no-cache, and
  already has its own visual language; a farm-side layer must not reach into a customer-facing
  page as a side effect. Say the word and it gets its own version.
- **No button was removed, merged or renamed.** Their sentence started with "there are a lot of
  clickable buttons" — the count is a separate decision (e.g. the drilldown card shows CULL *and*
  a 🗑 next to it *and* a 🗑 under the photo; Move Stall sits in the same row as ＋Treat). Making
  14 controls unmistakable is a stylesheet; deciding that 14 is too many is a product call, and it
  is theirs.
- **The `.semen-stock-menu` and other bespoke tiles keep their own `:active` transforms** — the
  layer adds to them rather than replacing them, so no screen loses a working affordance.

## Files

| file | what changed |
|---|---|
| `neumorphic.css` | **new**, the whole layer — tokens, the raised key, the inset label, mobile targets, the two media hedges, the exemptions |
| `index.html` | one `<link>` after `app.css`, cache-busted `?v=190-neumorphic-affordance`, marked `[FIX 190]` |
| `sw.js` | `CACHE_NAME` → `v239-neumorphic-affordance-2026-09-13`; `./css/neumorphic.css` pre-warmed; install now per-entry |
| `config.js` | `ARS_APP_VERSION` → `v239-neumorphic-affordance-2026-09-13` |
| `qa/build-deploy-layout.sh` | copies `neumorphic.css` by name and aborts the build if it is missing |
| `qa/test-neumorphic-ui.mjs` | **new**, 40 checks over the claims above |
| `qa/test-reseller-orders.mjs` | its build-string assertion moved to v239 |

No SQL. No JS logic file touched. `app.css` unchanged, deliberately: the layer is additive so the
whole release reverts by deleting one line from `index.html`.

## Checks

`node qa/test-neumorphic-ui.mjs` → **40/40** · `test-reseller-orders.mjs` → **337/337** ·
`test-reseller-return.mjs` → **167/167** · `test-sync-preflight.mjs` → **27/27**.
`node --check` clean on `sw.js`, `config.js`, `index.html` scripts and every module.

## How to look at it after uploading

1. **A sow card** (the screenshot): VIEW GESTATION / RECORD REHEAT / CULL / ＋Vaccine / ＋Treat /
   Move Stall / Pedigree / Profile should all read as keys with a lip, and hold one down — it
   sinks. GESTATING, P0 and "Unassigned Stall · —" should read as stamps sitting in the panel.
2. **The dashboard**: a ✓/⚠ row that opens something is raised; a row that only reports is inset.
   They differ now even though both are dark rounded rectangles.
3. **Semen Inventory**: the two AVAILABLE tiles and each list row lift; "Show 107 older collection
   batches…" lifts; the "Collected Sep 10, 2026" and "3 days passed" texts do not.
4. **Any modal**: the × in the corner is now a thumb-sized target on a phone.

If a single screen reads wrong after this, that is the layer meeting a screen it did not account
for — send the screenshot and it gets an exemption (or `data-neo="flat"`), not a rollback.
