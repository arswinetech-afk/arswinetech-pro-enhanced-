# FIX 187 — reseller Return & Replace: many replacement batches, and no lost pesos

Build: `v227-reseller-return-2026-09-12` · file touched: `semen-sales.js` (reseller section), `sw.js`, `config.js`
Verification: `node qa/test-reseller-return.mjs` → 107/107

## What was reported

Jo Dacara returned 3 × B1 Large White @₱400 and wanted to replace them with **2 × B1LW
+ 1 × Duroc (BD)**, all @₱400 — a net-zero change. Two things went wrong:

1. the form offered **one** replacement semen per returned line, so "2 of this batch and
   1 of that batch" could not be expressed;
2. the balance then read **₱850 instead of ₱2,650** — ₱1,800 of billed product vanished.

## Root causes (all in the old `saveResellerReturnReplace`)

| # | Cause | Effect |
|---|-------|--------|
| 1 | One `rep_semen_N / rep_qty_N / rep_rate_N` triple per dispatch line | multi-batch replacement impossible |
| 2 | Every line was rebuilt as `(qty − returned_qty) × rate + repQty × repRate`, using **only this session's** `repQty` | replacement money billed by an earlier save was deleted (a second save that only *added* a batch made the invoice go **down**) |
| 3 | `returned_qty` accumulated while `l.replaced_qty = repQty` **overwrote** | replacements were replaced, not added |
| 4 | `tx.total_amount = newTotal` | the pickup record itself was rewritten short — the ledger was damaged, not just the display |
| 5 | `tx.balance = newTotal − tx.paid_amount` | the discount/readjustment already on the record was ignored |
| 6 | `tx.status = 'returned_replaced'` forced | the row stopped reporting open/partial/paid and dropped out of the hub's "awaiting payment" count |
| 7 | `tx.returned_count` / `tx.replaced_count` never written | the printed receipt and the Bluetooth slip said nothing about the adjustment |
| 8 | ✎ Edit could only re-type total/paid/notes | an already-broken pickup could not be corrected with any audit trail, and the next adjustment overwrote whatever was typed |

## The model now

A dispatch line owns an **array** of replacement rows:

```js
line = {
  qty, rate, amount,            // as dispatched
  returned_qty, return_reason, return_action,
  replacements: [ { semen_id, boar, breed, batch_no, qty, rate, reason, at } ],
  replaced_qty, replacement_rate, replacement_boar, …   // legacy mirrors, kept in sync
}
```

* `resellerLineAmount(l)` = kept bottles × dispatch rate + Σ(replacement qty × that
  batch's own rate). Nothing else computes line money.
* `applyResellerLineAmounts(tx)` recomputes the lines, then the invoice, then
  `recalculateResellerTx(tx)` — balance = total − discount − paid, status from the money.
  It is **idempotent**: re-running it changes nothing.
* `syncResellerLineMirrors(l)` writes the legacy fields back (`replaced_qty`,
  `replacement_rate` as the blended rate, `replacement_boar` = `"Duroc (BD) +1 more"`),
  so the hub KPIs, the transaction row, the receipt and the BLE slip work unchanged.
* `total_manual` — when the office corrects an amount by hand, the invoice moves by the
  **delta** of its lines on later adjustments instead of being replaced by their sum, and
  the kept offset is stated in the toast (`+₱800.00 over the lines`).
* Older records (single replacement in `replaced_qty`/`replacement_rate`) are read as a
  one-entry array, so they bill exactly as before; they are upgraded in place the next
  time the line is touched. An explicit empty array means "cancelled", and never falls
  back to the legacy field.

## Behaviour changes in the form

* "+ Add replacement batch" — any number of rows per line, each `batch × qty × price`,
  price prefilled from the batch (that is the price indicator) and editable for a
  negotiated rate.
* "REPLACED SO FAR (already billed)" lists rows saved earlier; each can be **cancelled**
  (reverses the charge *and* puts the bottles back into that batch) with an Undo until the
  save is committed.
* Live preview per line and in the footer: `returned 3 → 0`, `line: ₱400 → ₱1,200`,
  `Invoice ₱850 → ₱2,650`, `Balance ₱850 → ₱2,650`, computed by the same primitives the
  save uses.
* Nothing is clamped any more. A return larger than what is still unreturned, or a
  replacement beyond the batch's on-hand count (cross-line contention included), **refuses
  the whole save** and states why — a half-applied adjustment used to be silent.
* `sync_status` is pushed back to `pending` when a verified row is edited, so the cloud
  copy is re-verified instead of keeping the old numbers.

## New: ✎ Edit pickup record can repair an adjusted invoice

The edit form now shows the line breakdown (stored amount next to the recomputed one, and
each replacement row), and offers:

* **Rebuild the lines** — recompute every line from its dispatch quantity, returns and
  replacement rows (fixes a breakdown that drifted);
* a corrected **Total amount** — refused unless a reason is written when it does not match
  the lines; the reason, the before/after figures and the derived total are stored on the
  record (`manual_correction`, `edit_history`), which is what makes the fix survive the
  next adjustment;
* a hand override of `paid` — blocked if it would fall below payments already allocated to
  the pickup;
* a visible note of any standing hand correction and how to drop it (save the exact line
  total with a reason).

## Repairing Jo Dacara's ₱850 record

The ₱800 the old build swallowed was **overwritten**, not stored anywhere, so it cannot be
re-derived automatically. Two supported paths (use one, not both):

1. **Recommended** — ✎ Edit → type `2650` → reason `2 × B1LW @₱400 replacement dropped by
   the old return form` → save. Balance reads ₱2,650 at once, the reason is on the record,
   and future adjustments keep the figure as an offset.
2. Or ↩ Return / Replace → **+ Add replacement batch** → B1LW × 2 @400 → save: the invoice
   becomes ₱2,650 *and* 2 bottles are deducted from that batch again — correct only if the
   physical count really still shows them as dispatched. Check the batch count afterwards.

`arsResellerReturnMath.derive(tx)` in the browser console reports
`{ derived, stored, drift, balance, manual }` for any pickup without changing it.

## Test coverage (`qa/test-reseller-return.mjs`, 107 checks)

Boots the real `semen-sales.js` in a VM and drives the actual `window.rr*` /
`saveResellerReturnReplace` / `saveEditResellerTx` handlers: multi-batch replacement,
idempotent re-save, over-return refusal + partial returns accumulating, discard vs
restock, cancel/undo of a saved row, discount- and payment-aware balance, stock
validation, legacy-record reading and repair, hand-correction offset, voided read-only,
and a reproduction of the old arithmetic (₱2,250 → ₱1,850 when a batch was *added*) that
proves the regression.
