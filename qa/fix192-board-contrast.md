# FIX 192 — the collection board on a phone (v241)

Their report, with the screenshot attached:

> *"Look at the black texts. Its not visible since its blending with dark background."*

The screenshot was the order-link inbox: every breed row read as a dark rectangle with a barely
visible teal name and an invisible number, while `only 5 in stock · short 14` in amber was perfectly
clear. The scope switch underneath it was four full-width bars stacked on top of the board, so the
numbers they wanted were below the fold *and* unreadable.

## This was our bug, and it was not the palette

The board row v238 shipped with was:

```html
<button type="button" onclick="…" style="width:100%;text-align:left;background:var(--bg);
        border:1px solid var(--line);…">            ← a surface, and no colour
  <b>Duroc Pietrain</b> <b>19 bottles</b>           ← so the browser's own colour
  <small class="field-hint">19 to collect · 6 orders …</small>
</button>
```

**A `<button>` does not inherit text colour the way a `<div>` does.** The browser paints a control
with its own default — `buttontext`, black — and `app.css` resets `cursor`, `border` and `font` on
`button` but never `color`. So the row's words were black on `var(--bg)` = `#071114`, which measures
**1.1:1** (readable body text wants 4.5:1). Three things conspired, and all three are worth naming so
the same mistake is not made again:

1. `.field-hint` **has no global rule at all** — only `.perf-modal .field-hint` styles it — so the
   second line had nothing to fall back on;
2. the amber survived because that span states `color:` on itself ✓ — the one part of the row that
   declared its own colour was the one part that could be read;
3. every other control in the app is safe because it carries a class that sets a colour (`.btn` →
   `#fff`, `.count-pill` → `#7ce8da`, `.res-notch-chip` → `#e7f4f2`, `.field input` → `#e7f6f5`).
   The board row was the only control on that screen with **no class and no colour**.

## What changed

| where | before | after |
|---|---|---|
| the row | dark background, no colour → **1.1:1** | `color:var(--ink)` → **17.65:1** |
| the breed name | `var(--teal2)` #07988f → 5.36:1 | `var(--teal)` #13b9ad → **7.8:1** |
| the row's hint line | inherited the control's black | `var(--muted)` → **7.8:1**, still visibly a hint |
| the amber | hardcoded `#f0b64b` (10.46:1 on dark, **1.71:1** on the light theme) | `var(--warn)` (10.46:1 dark, 2.58:1 light) |
| the scope chips | reused `.due-actions`, which is `flex-direction:column` + `.btn{width:100%}` under 700px → four stacked bars | their own `.order-board-chips`: a 2×2 grid on a phone, one row on a tablet, **40px** targets kept |

The stylesheet also got a net under the markup, so the next screen that forgets is still readable:

```css
.adj-card>button:not([class]){color:var(--ink)}
.adj-card>button:not([class]) .field-hint{color:var(--muted)}
```

`:not([class])` is load-bearing: an unscoped `.adj-card button` rule would out-specify `.btn` and
repaint every real button in every adjustment card in the app.

## Then the same question was asked of the whole app

`qa/test-button-contrast.mjs` computes both palettes out of `app.css` (the light `:root`, the dark
`:root`, and `.light-theme{}` — merged the way the browser cascades them, because `.light-theme`
overrides only a *subset* and reading one block alone would have told a lie about `--warn`), measures
the WCAG ratio of every colour the board can produce, and then **audits all 1,043
`<button>`/`<select>`/`<textarea>` templates in the shipped JS**: any control whose own class (or
inline style) paints a dark surface — luminance under 0.16, including the `var(--bg)`, `var(--card)`,
`var(--card2)`, `var(--white)` tokens, which are dark in the shipped theme — must state a colour.
**Zero offenders remain**, and the audit is tested against a fixture pair so it cannot quietly become
vacuous.

Two honest notes out of the same measurement:

- **The light theme's own tokens are thin for small text** — `--muted` 4.08:1, `--teal` 3.76:1,
  `--warn` 2.58:1 on `#f5f8f8`. That is a palette property of every screen, not of the board, and
  changing it means re-checking contrast across the whole app; so it is deliberately **not** touched
  here. If this farm ever works in the light theme (a bright barn is a reason to), one release can
  deepen those three tokens inside `.light-theme{}` and nowhere else — say so and it's next.
- `.count-pill`, `.status-pill`, `.parity-pill`, `.tag`, `.due-time`, `.adj-x`, `.suggestion-empty`
  and the typeahead rows were each checked: every one already sets its own colour ✓ nothing else on
  that modal was invisible.

## Files

| file | change |
|---|---|
| `semen-sales.js` | inside `orderBoardHTML` only: row colour, name accent, hint colour, 3× amber → token, chips off `.due-actions` |
| `app.css` | one appended `[FIX 192]` block (two nets + `.order-board-chips`); no existing rule edited |
| `qa/test-button-contrast.mjs` | **new**, 26 checks — measured contrast, the app-wide control audit, the chips' layout |
| `qa/test-reseller-orders.mjs` | build-string assertion → v241 (the 337 board checks themselves were untouched: this release changes how the numbers look, never what they are) |
| `sw.js` / `config.js` | `v241-board-contrast-2026-09-14` |

No SQL, no new file, no new `<link>` — `css/app.css` and `js/semen-sales.js` are already in the shell
cache list, so an ordinary folder upload is enough.

## Checks

**630** total: `test-button-contrast` 26 · `test-neumorphic-ui` 41 · `test-reseller-orders` 337 ·
`test-reseller-return` 167 · `test-sow-action-menu` 32 · `test-sync-preflight` 27.

## What to look for after uploading

1. The breed rows: `Duroc Pietrain` in bright teal, `19 bottles` in body white, the second line a
   legible grey, and the amber shortfall meaning exactly what it meant before.
2. `Today · Yesterday + today` on one line and `7 days · Everything` under it, each a thumb-sized
   chip — so the rows themselves are above the fold.
3. Tap a breed row: it still writes the search box and filters the list (v238 behaviour, untouched).
4. Every other screen should be unchanged — the net rule reaches only classless buttons inside
   `.adj-card`, and `.due-actions` still behaves as it always did for Save/Cancel pairs.
