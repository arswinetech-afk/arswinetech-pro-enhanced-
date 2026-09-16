# FIX 193 — the bottom bar is a pig-farm tab strip, not a tray of boxed glyphs

**Reported (phone screenshots, 2026-09-16):** "The bottom nav for mobile has visible
squares. The home button icon 'grid' looks like a beginner design, piglets icon looks
like a dot, sales looks like a square divided into 4, sows has a female symbol. Please
consider that this app we are building is for pigs."

## What was wrong

Two separate defects stacked:

1. **The squares.** `neumorphic.css` (FIX 190) lifts *every* `<button>` with
   `--neo-lift-sm` + `--neo-edge` (a 1px inset ring) so controls read as keys. Correct
   for form buttons — wrong for a tab strip: each of the eight tabs rendered inside a
   visible square, and the press state re-painted the square on tap.
2. **The glyphs.** `index.html` used text characters as icons: `▦` Home, `♀` Sows,
   `●` Piglets, `💉` Health, `🏢` Barns, `📡` Scan, `⊞` Sales, `◉` Alerts. They render
   at whatever the font/emoji-set decides, and on a swine app a female symbol and a
   dot are not a sow and a piglet.

## The fix

* **Icons** — eight hand-drawn 24×24 line SVGs, `stroke="currentColor"`, one visual
  family: house-with-door (Home), **sow face** (head, ears, snout ellipse with two
  nostrils, eyes), **side-view piglet** (body, ear, snout, legs, tail curl, eye),
  medical cross (Health), gambrel barn with loft window (Barns), scan frame with laser
  line (Scan), price tag (Sales), bell (Alerts). They inherit the tab colour, so the
  active pill tints them for free.
* **Bar** — `app.css`: flat gradient bar with a hairline top border, tabs are
  borderless; the active tab gets a soft teal pill behind its icon
  (`.bottom-nav button.active .bi`), the modern tab-strip affordance.
* **Squares** — `neumorphic.css` section 5 now opts `.bottom-nav button` out of the
  lift *and* the `:active` press (a tap dims the tab instead of re-boxing it).

## Verified by

`qa/test-bottom-nav-icons.mjs` — 12 static checks: eight tabs in order with labels
kept, 8 currentColor SVGs, none of the old glyphs (unicode-escaped in the test so the
bytes can't drift), sow/piglet icon anatomy, pill rule present, neo lift+press
exclusion present. Run: `node qa/test-bottom-nav-icons.mjs`.
