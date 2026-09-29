# FIX 201 — a reseller pickup now deducts from the batch the farm actually chose

**Reported:** 2026-09-29, with a screenshot of the Semen Inventory drill-down.
**Symptom as described:** *"a reseller pickup no longer deducts bottles from Semen
Inventory, but a walk-in sale still does."*
**Version:** `v250-pickup-lot-accuracy-2026-09-29`
**Files:** `semen-sales.js`, `qa/test-reseller-pickup-lot.mjs` (new), `qa/test-reseller-orders.mjs`

---

## What was actually wrong

The deduction was never missing. It was landing on **the wrong batch**.

The screenshot is a farm with **147 collection records**. The AVAILABLE SEMEN strip
showed `(JDP) Jinwoo · Duroc Pietrain · collected Sep 28 · 11 bottles left`. After a
pickup was saved and billed, that card still said 11.

A pickup line created by **"✓ Accept & create pick-up"** in the reseller order inbox is
built by `window.arsResellerOrderPickupLines()` like this:

```js
lines.push({
  boar: breed || 'Semen',     // ← the BREED, in the boar slot
  breed: breed,
  semen_batch_no: '',
  semen_id: '',               // ← deliberately empty
  qty, rate, ordered_rate: rate, ordered_qty: qty, ordered_breed: breed,
  from_order: true
});
```

`semen_id` is empty on purpose. The picker pre-selects nothing, and the comment in
`renderPickupLines` says why:

> *nothing is pre-selected: which boar to collect is the farm's call, and a dropdown
> that already picked one is how a wrong lot quietly becomes an invoice*

That was the right call. The problem was that **`saveResellerPickup` then guessed
anyway.** Its resolver ended with a last-resort match:

```js
if (!s && l.boar) s = (f.semen || []).find(x =>
  (x.boar === l.boar || x.boar_name === l.boar) && +(x.available_bottles ?? x.bottles ?? 0) > 0);
```

`l.boar` on an order line is a **breed**. On a farm with 147 records, an old imported
lot filed under `boar: "Duroc Pietrain"` answers that match — so the whole deduction
went into a July batch nobody was looking at, while the September batch on screen never
moved. The pickup saved, the invoice was correct, the stock was silently wrong.

Three further consequences of the same line:

* the saved transaction line kept `semen_id: ""` and `semen_batch_no: ""`, so the
  receipt named no batch;
* **return & replace (FIX 187 / 200) resolves stock by `semen_id`** — a return on such a
  pickup could not restock the right lot either;
* if *no* lot happened to carry the breed string, the save was refused with
  `"Semen batch for "Duroc Pietrain" could not be found"` — which is why the existing
  `test-reseller-orders.mjs [9]` passed: its fixture had no decoy lot.

A walk-in POS sale was never affected: it is opened from a specific record
(`openSemenSell(i)`), so it always knows its lot. Hence "walk-in still works".

### Reproduced

```
prefill line from Accept: {"boar":"Duroc Pietrain","breed":"Duroc Pietrain",
  "semen_batch_no":"","semen_id":"","qty":5,"rate":400,"from_order":true, ...}
BEFORE  legacy(DP-20260724-003, boar="Duroc Pietrain") = 9 | JDP-20260928-001 = 11
AFTER   legacy = 4 | JDP-20260928-001 = 11        ← 5 bottles out of the wrong batch
tx saved? 1   (billed ₱2,000, line semen_id:"")
```

---

## The fix

### 1. Resolve strictly, refuse rather than guess

`saveResellerPickup` now resolves each line in this order:

| step | match | applies to |
|---|---|---|
| 1 | exact `semen_id` | every line |
| 2 | exact `semen_batch_no` | every line (survives a cloud re-key) |
| 3 | boar name with stock | **hand-written lines only**, and only when the name is not just the breed echoed back (`l.boar !== l.breed`) |

Nothing resolves → the line is **refused by number and by breed**, and nothing at all is
saved:

> ⚠️ Line 1: Choose the collection batch you are handing over for Duroc Pietrain. Nothing was saved.

### 2. Stamp the chosen lot onto the saved line

```js
l.semen_id      = s.id;
l.semen_batch_no = s.semen_batch_no || l.semen_batch_no || '';
l.boar          = s.boar_name || s.boar || l.boar;   // the real boar, not the breed
l.breed         = s.breed || l.breed || '';
```

`ordered_breed` / `ordered_qty` / `ordered_rate` are untouched, so the FIX 189 drift note
(*"asked 5 × ₱400"*) still works, and the receipt, the drill-down and return & replace
now all resolve the same batch.

### 3. Charge every line against the running remainder

FIX M8 validated each line against the **opening** stock, so two lines of 4 against a
6-bottle batch both passed and the second one clamped at zero while billing 8. A
`claimed` map now tracks what earlier lines on the same pickup already took:

> ⚠️ Line 2: Only 2 bottle(s) of LRD-20260928-001 left after the earlier line on this pickup — reduce the quantity.

### 4. Say it on the line, not in a toast

A toast that names no line is useless on a three-line pickup and it disappears while the
farm is still scrolling. Each line card now has its own error slot
(`#pickupLineErr_<n>`), the offending card is outlined amber, the form scrolls to the
first one, and picking a batch clears that line's warning immediately. A picker that has
not been used yet is outlined amber **before** the farm submits.

---

## QA

`node qa/test-reseller-pickup-lot.mjs` — **63/63**

1. an order-sourced line with no batch chosen is refused by name; nothing saved, no lot moves
2. the decoy lot filed under the breed name is never drained
3. once the batch is picked, that batch and only that batch is deducted
4. the saved line is stamped with id / batch / real boar name / breed
5. the ordered breed, qty and price survive the stamping; the money is unchanged
6. a hand-written pickup is unchanged (6b batch-number fallback, 6c boar-name fallback,
   6d the fallback is refused for an order line)
7. two lines on one batch share a single pool of bottles
8. an over-sized line is still refused with nothing saved (FIX M8 preserved)
9. a batch drained to zero is marked `exhausted`
10. the problem is painted onto the offending line card
11. an order-sourced pickup now resolves to a real lot, so it can be returned and restocked

`qa/test-reseller-orders.mjs [9]` was tightened from `/could not be found/` to the new
line-specific message: **338/338**.

Whole suite: **12 files, 932 checks, all green** — including
`test-reseller-return.mjs` 167/167 and `test-reseller-return-cycles.mjs` 69/69, the proof
that the FIX 187 / 200 money model did not shift.

---

## Cleaning up the records this already damaged

The fix stops new pickups going astray; it does not know which historical pickups went
into the wrong batch. For any reseller pickup saved from an accepted order whose line
shows no batch number on the receipt, the bottles came off some other lot. Correct those
with **Semen stock actions → Restock existing batch** (add back to the lot that was
wrongly drained) and **→ Discard semen bottles**, reason *"stock correction"*, on the lot
that should have been drained — both leave an auditable trail.
