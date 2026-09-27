# FIX 200 — return & replace with no cycle limit

Build: `v249-return-replace-cycles-2026-09-27` · files: `semen-sales.js`, `app.css`,
`config.js`, `sw.js`, `qa/test-reseller-return-cycles.mjs`, `releases/arswinetech-pro-latest.zip`
Verification: `node qa/test-reseller-return-cycles.mjs` → 69/69 · every other suite in `qa/` green
(868 checks in total, including `test-reseller-return.mjs` 167/167 unchanged).

## What was reported (two phone screenshots, 2026-09-27)

Pickup `#RTX-MTSL31NL`: 8 × Blake @ ₱400. The reseller returned 3 and was handed
1 × Biscuit (BDB-20260912-001) + 2 × Blake (B1L-20260912-001) instead. A week later two of
**those replacement bottles** came back unsold — and the form had nothing to offer:

* **Return qty** only ever counted the original dispatch line (`of 8 · 5 still returnable`).
  The 3 replacement bottles in the reseller's hands were invisible to it.
* The replacement rows under *REPLACED SO FAR (already billed)* carried exactly one action:
  **✕ Cancel**. Cancel means *the swap never happened* — it un-bills the row and pushes the
  bottles back into their batch. Both are lies when the bottle really was handed over and
  really did come back: the invoice would be right by accident and the batch count would be
  wrong by two.

So the flow was capped at **one** return→replace cycle per dispatch line, while the real
trade repeats: pick up → return → replace → return again → replace again.

## The model now

A replacement row is no longer a billing note. It is a **bottle in the reseller's hands**, so
it carries everything a dispatch line carries:

| field | meaning |
|---|---|
| `uid` | stable identity, so later cycles can point at it. Rows written before this build get a positional id (`#0`), persisted the first time the line is touched — they can have no children, so it can never point at the wrong parent |
| `returned_qty` / `return_reason` / `return_action` / `returned_restocked` | this row's own return, exactly like the dispatch line's |
| `replaces` | `''` = handed over for the dispatch line; otherwise the `uid` of the replacement bottle it was handed over for |
| `cycle` | 1 for a direct replacement, parent + 1 for each one after |

The chain is stored **flat** on the line (not nested), so every existing reader — receipt,
Bluetooth slip, hub card, edit sheet, cloud sync — keeps working, and the depth is unlimited:
cycle 4 is just a row whose parent is a cycle-3 row.

### Money

```
line = (qty − returned_qty) × rate  +  Σ over replacements (r.qty − r.returned_qty) × r.rate
```

A replacement that came back stops being billed **at its own price**, exactly as a returned
dispatch bottle stops being billed at the dispatch price. The bottle handed over in its place
is its own row, billed at its own batch price. With no second cycle anywhere,
`r.returned_qty` is 0 and this is byte-for-byte the FIX 187 arithmetic — which is why
`test-reseller-return.mjs` still passes 167/167 untouched.

Worked through the reported pickup:

| step | line total |
|---|---|
| dispatch 8 × ₱400 | ₱3,200 |
| return 3, swap for 1 Biscuit + 2 Blake | 5×400 + 400 + 800 = **₱3,200** |
| 2 Blake replacements come back, swapped for 2 Zorro @ ₱250 | 5×400 + 400 + 0 + 500 = **₱2,900** |
| the 2 Zorro come back, swapped for 2 Biscuit | 5×400 + 400 + 0 + 0 + 800 = **₱3,200** |
| one of those comes back, credit only | **₱2,800** |

## The form

Each row under *REPLACED SO FAR* is now its own card with the same three controls the
dispatch line has — **how many came back · why · restock or discard** — plus its own
**+ Add replacement batch** labelled with the cycle it starts. The card also states what it
was handed over for, what it has already been replaced by, and how many of it are still
returnable.

* **Restock** puts the returned replacement back into **its own** batch (B1L-20260912-001),
  never the dispatch batch.
* **Undo** works per replacement row, the twin of the dispatch-line undo: the credit comes
  off, and only the bottles that were actually restocked leave the batch again.
* **✕ Cancel is now refused** on a row that has already come back, or that a later cycle was
  handed over for, naming the reason and what to undo first. Cancel still works on a clean
  row, exactly as before.
* The live preview shows `N replacement bottle(s) back` on the line state and refuses to save
  an over-sized replacement return (refused, not clamped — the FIX 187 rule).
* Validation is still two-pass: nothing moves until the whole form is legal.

## Insights (FIX 198) — counted, not re-based

Adding later cycles to `returned` would silently change every return rate this farm has
already read. Instead:

* `returned` / `returnRate` still mean **of the bottles picked up, how many came back** —
  unchanged;
* `repReturned` is new: replacement bottles that came back;
* `handed = picked + replaced`, `backTotal = returned + repReturned`, `allReturnRate`;
* `net = picked − returned + replaced − repReturned` — the only figure that moves, and only
  when a later cycle actually exists;
* the profile summary grows one amber line (`.rsum-cycle`) and the leaderboard's *Why #N* one
  sentence, **only when `repReturned > 0`**.

## Tests (`qa/test-reseller-return-cycles.mjs`, 69 checks)

1. the reported scenario end to end, including stock per batch;
2. the cycle-2 row records what it replaces and is stamped `cycle 2`;
3. re-saving an untouched form changes nothing (idempotent at every depth);
4. cycles 3 and 4 bill correctly — no cap;
5. an over-sized replacement return is refused with the exact number, then saves once fixed;
6. Cancel is refused on a returned row and on a parent with children; still allowed on a clean row;
7. restock / discard / undo per replacement row, with the batch counts asserted;
8. the insights engine counts later cycles without re-basing `returned`;
9. legacy records bill as before, are upgraded in place, and can start a cycle 2;
10. the sheet really renders the per-replacement controls (the dead end in the screenshot is gone).
