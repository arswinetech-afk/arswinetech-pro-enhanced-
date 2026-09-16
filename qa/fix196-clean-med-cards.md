# FIX 196 — clean reference cards: the label format, not a bombardment

**Reported (phone screenshots, 2026-09-16):** the farm showed us the format they
want — one clean card per product (name + generic, Brand line, Used for, General
dosage, Piglet/Sow/Boar lines, Frequency, Est. Price, two buttons) — next to their
current screen where a name search stacks full library dossiers: chip walls, 7-row
dosage grids, Wikipedia/DailyMed/NOAH link walls and chemical-structure images.
"Bombarded by search results with supporting details I don't need."

## What changed

* **One shared clean card** (`med-clean-card`) now renders BOTH the built-in
  library hits (name search) and the internet products from `/ars-med`:
  name (+generic in parentheses), small 46px header photo thumb, Brand line,
  Used for, General dosage, Piglet/Sow/Boar coloured lines, Frequency,
  route/withdrawal muted line, Est. Price, the auto cost-per-unit division,
  `✓ Add to Inventory` + `⟳ Refresh`, sources collapsed to ONE muted line, and an
  `×` that dismisses just that card.
* **Bombardment removed from the name search:** library hits capped at 3 (was
  12); the Wikipedia/DailyMed live-link hydration and the big image blocks are
  gone from it (the Signs/Symptoms view keeps its own enrichment).
* **Worker mines the clean-card fields** from store snippets: Piglet/Sow/Boar
  lines and Frequency ("repeat after…", "every N days", "single dose") join the
  dosage/price/pack it already mined.

## Verified by

`qa/test-med-internet-products.mjs` → 56 checks, now including: per-class +
frequency mining from the captured fixture, every clean-card element on the
internet card, and the library-side changes (cleanLibCard present, libCardHTML
gone, hits sliced to 3, no link-wall hydration). `qa/test-bottom-nav-icons.mjs`
still 12/12. Run both with `node qa/<file>`.
