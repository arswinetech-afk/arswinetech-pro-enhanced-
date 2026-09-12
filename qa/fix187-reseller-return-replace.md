# FIX 187 — reseller Return & Replace: many replacement batches, and no lost pesos

Build: `v227-reseller-return-2026-09-12`, hotfixed by `v228-return-modal-shell-2026-09-12`,
then `v229-undo-returned-qty-2026-09-12` (undo for a mis-keyed return) ·
files touched: `semen-sales.js` (reseller section), `sw.js`, `config.js`
Verification: `node qa/test-reseller-return.mjs` → 167/167 (v228 markup guard + the v229 undo cases)

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

## Test coverage (`qa/test-reseller-return.mjs`, 167 checks)

Boots the real `semen-sales.js` in a VM and drives the actual `window.rr*` /
`saveResellerReturnReplace` / `saveEditResellerTx` handlers: multi-batch replacement,
idempotent re-save, over-return refusal + partial returns accumulating, discard vs
restock, cancel/undo of a saved row, discount- and payment-aware balance, stock
validation, legacy-record reading and repair, hand-correction offset, voided read-only,
and a reproduction of the old arithmetic (₱2,250 → ₱1,850 when a batch was *added*) that
proves the regression.

---

# v228 hotfix — ↩ Return / Replace and ✎ Edit opened nothing (markup, not maths)

**Reported from the live site after v227 was uploaded:** tapping **↩ Return / Replace** or
**✎ Edit** on a transaction row did nothing at all. Every other button on the row still
worked (Receipt, Payment, Delete, Void).

**Cause.** The two new forms were built as
`document.createElement('div')` + `className = 'modal-overlay show'`, with an inner
`.modal`, `.modal-hd`, `.modal-bd`, `.modal-ft`. **No stylesheet in this app defines any of
those** — `app.css` is the only CSS (`css/app.css` in the deploy) and never mentions
`modal-overlay`; `index.html` has no `<style>` block either. So the sheet was appended as a
plain static block at the end of `<body>`, *underneath* the reseller hub, which is itself a
`.due-modal-bg` layer pinned at `z-index:9999999`. The element existed, the handler ran, the
arithmetic was correct — there was simply nothing above the hub to see, which reads on a phone
as a dead button. The hub's own sheets (Payment, Pickup, Profile) do use the right shell, which
is why they kept working.

**Fix (`v228`).** Both sheets are now built exactly like `openResellerPickupModal()`:

```
<div class="due-modal-bg" style="z-index:9999999!important">   ← fixed, dimmed, centred, on top
  <div class="due-modal reseller-hub-wrap" style="text-align:left">   ← 880px panel, scrolls
    <div class="modal-top"> .eyebrow + h2 + <button class="close-reminder">
    …form…
    <div class="due-actions">   ← full-width stacked buttons below 700px, per app.css
```

Also carried by the same pass, all cosmetic-only but needed for the dark sheet:

* line boxes use `.adj-card`; the running totals panel uses
  `.reseller-settlement-preview` (the green in-modal preview box the hub already uses); and
  the loose inputs/selects were wrapped in
  `.field` so `app.css` gives them the dark, full-width, high-contrast treatment
  (`.field input,.field select` is the only rule that styles form controls in these sheets);
* light-sheet colours that are invisible on the dark panel were mapped onto the palette the
  app uses inside modals: `#166534 → #b7e9c7`, `#b45309 → #f0b64b`, `#dc2626 → var(--danger)`,
  save button `var(--ok)`;
* the return/replacement rows are inside a `.reminder-fields` grid, which app.css collapses to
  one column under 700px — the qty/price boxes are thumb-sized on a phone;
* `closeResellerModal(id)` is used by every close path (it was already defined for that reason;
  `app.js closeModal()` ignores its argument and would hide the shared app modal).

**No computation changed.** `lineReplacements`, `resellerLineAmount`,
`applyResellerLineAmounts`, the refuse-the-whole-save validation, `return_audit`, the
hand-correction offset and ✎ Edit's rebuild/derived-vs-stored logic are byte-identical
behaviour — sections [0]–[12] of the harness still pass unchanged, which is the point of
running it on a markup patch.

**Guard added (`[13]`, 19 new checks).** A vm harness cannot see a missing CSS rule, which is
how this shipped at all. `qa/test-reseller-return.mjs` now captures every element the builders
append to `<body>` and asserts: the layer class is `due-modal-bg`, the inline `z-index:9999999`
is present, the panel is `due-modal reseller-hub-wrap`, the header/footer use `modal-top` /
`due-actions`, none of the invented names appear — and every `class="…"` token emitted by
either sheet exists in `app.css` (a fixed allow-list covers the unstyled JS hooks
`.rr-*`/`.modal-bd`). **Rule for this file: never invent a class name for an overlay; copy one
of the hub's existing sheets.**

---

# v229 — ↩ Undo the returned quantity

**Requested from the phone (screenshot, red arrow at `returned 10 → 10`).** Once a return is
saved the number is spent: the line reads `0 still returnable` and there is no way back short
of cancelling a replacement row. Humans mis-key this, so the form now has an explicit undo on
every line that has a recorded return.

## What appears

Under the line header, on any line with recorded returns:

```
↩︎ Undo the returned qty
Recorded as returned: 10. Returned the wrong number? Put some or all of them back.
                                     How many [ 10 ]   [ ↩︎ Undo all 10 | ✕ Keep the return ]
```

* **`↩︎ Undo all N`** — one tap arms the whole recorded return; the button then reads
  **`✕ Keep the return`**, so a mis-tap is disarmed before anything can happen.
* **`How many`** — type a smaller number to undo only part of it (10 recorded but only 2 were
  truly returned → undo 8; or undo all 10 and re-enter 2 — both land in the same place).
* The preview under the card follows immediately — `returned 10 → 2`, `line: ₱1500.00 →
  ₱2000.00`, invoice and balance included — and `still returnable` widens, which is what makes
  “undo, then type the right number” one save instead of two.
* Nothing is written until **Save**, and Save still applies the whole form or refuses it.

A wrong quantity that was **typed but never saved** gets a lighter control on the same row —
`✕ Clear this entry` — because reversing stock for an unsaved draft would be wrong.

## What a save reverses

| the recorded return had been | the undo does |
|---|---|
| `Discard — not restocked` | removes the credit (the line re-derives to `(qty − returned) × rate + replacements`) and **leaves batch stock alone** — those bottles never went back |
| `Restock — add back into <batch>` | removes the credit **and** takes those bottles back out of that batch |

The stock side is exact per bottle rather than per last-picked-action: each line now carries
`returned_restocked` (how many of its recorded returns physically went back into stock), so a
line restocked once and discarded once gives back only what is really in the batch. Legacy
records without the field fall back to their stored `return_action`, which is what the old
build's behaviour implies.

Two refusals, in the same “nothing half-applied” style as the rest of FIX 187:

* asking to undo more than is recorded → clamped by the box, refused if it reaches the save;
* an undo whose batch cannot give the bottles back (they were sold on since) →
  `B1 Large White would end up 3 bottle(s) below zero — the undo takes back more than its 1 on
  hand. Undo fewer bottles, or correct that batch in Semen Inventory first.` and nothing is saved.

Written on save: `return_audit[].undone` per event plus `returned_before` / `returned` /
`undone` per line; `returned_count` re-derived on the header, so the receipt and the Bluetooth
slip stop printing the reversed bottles; a sentence in `replacement_notes` /
`adjustment_notes` naming the count and the pesos; `sync_status → 'pending'`; and a toast that
ends `· 3 returned bottle(s) undone`. Arming costs nothing to undo — it lives only in the form
draft, so closing the sheet without saving changes the record not at all.

## Coverage

`qa/test-reseller-return.mjs` section **[14]**, 24 new checks (167 total, all passing): a full
undo restores line, invoice and balance while keeping replacement money that was genuinely
handed over; a partial undo of 8 of 10; a discard-undo leaving the batch alone versus a
restock-undo pulling 4 bottles back out; the below-zero refusal writing nothing and firing no
`save()`; the clamp; undo-then-retype ending at 1 returned; `✕ Clear this entry` on an unsaved
draft saving nothing; and re-opening after an undo cannot push `returned_qty` negative or write
a second time.
