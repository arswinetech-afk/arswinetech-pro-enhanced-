# FIX 203 — "Print / PDF" now produces a real Statement of Account, with a month picker

**Reported:** 2026-10-03, two screenshots — the statement for Jo Dacara (balance ₱4,650)
open, and Android's Save-as-PDF showing **six completely blank pages**.
**Version:** `v252-reseller-soa-2026-10-03`
**Files:** `semen-sales.js`, `app.css`, `qa/test-reseller-soa.mjs` (new)

---

## Why it printed nothing

The button was the bare browser print:

```html
<button onclick="window.print()">🖨 Print / PDF</button>
```

`#resellerStatementModal` is a `.drill-bg`, which is `position:fixed; inset:0` — and **no
`@media print` rule in the app ever claimed it**. Every other printable screen has one:

| screen | print isolation |
|---|---|
| `#reservationDetail` | ✅ `app.css:133` |
| `#pedigreeReport` | ✅ `app.css:147` |
| `#fcReport` | ✅ `app.css:479` |
| `#vaxReport` | ✅ `app.css:813` |
| `#feedReport` | ✅ `app.css:843` |
| **`#resellerStatementModal`** | ❌ **none** |

So the browser did the only thing it could: it laid out **the hidden app shell behind the
overlay**, paginated that into six sheets, and clipped the fixed overlay away. Six blank
pages.

And even with isolation bolted on, what would have printed is a **300 px, 58 mm thermal
receipt** in `'Courier New'` — a cash-register slip, stretched across Letter paper. Not a
document you hand a reseller who owes you ₱4,650.

---

## What it is now

A proper **Statement of Account** on A4, printed through the app's proven new-window path
(the same one `printFeedReport()` uses) so the app shell can never reach the paper again.

### The document

* farm letterhead, farm logo and app logo, `ARSWINETECH PRO · SEMEN RESELLER ACCOUNT`
* **Billed to** — reseller name, address, contact
* **Statement details** — statement number (`SOA-xxxxxx-YYYYMM`), period covered, date
  issued, currency
* **📦 Bottles dispatched** — date, reference, boar · batch · qty per line, gross,
  discount, net; totalled
* **💵 Payments received** — dated on the day the money actually arrived, not the
  dispatch date
* **🧾 Account summary** — the running ledger
* footer counters, signature block with a **Received / Conforme** line for the reseller

### The period picker

A toolbar `<select>` above the document offers:

* **All time — full account history**
* **every month that has activity**, newest first (September 2026, August 2026, …) — a
  month with nothing in it is never offered
* **Custom date range…**, which reveals From / To date inputs

### The money reconciles

```
Previous balance brought forward          ← everything strictly before the period
+ bottles dispatched this period (gross)
− discounts / readjustments
= Net charges this period
− payments received
= BALANCE DUE
```

Two guarantees, both pinned by QA:

1. **All time** opens at zero, so the balance due is *by construction* the same
   `max(0, net − collected)` that the hub and the thermal slip already show — ₱4,650 on
   the reported account.
2. **The months chain.** August closes at ₱10,000 → September opens at ₱10,000 and closes
   at ₱9,150 → October opens at ₱9,150 and closes at ₱4,650. The months sum to the
   all-time figures exactly.

Three details worth stating:

* **Discounts are counted once.** The money lives in each transaction's
  `discount_amount`; the dated `semenResellerAdjustments` log is reproduced underneath as
  an audit reference, explicitly labelled *"not charged twice"*.
* **Voided tickets are weightless** — not listed, not counted (FIX 180 held).
* **Overpayment carries forward as a credit** instead of clamping to zero: the opening
  line becomes *"Advance / credit brought forward"* and the total reads *"CREDIT IN
  FAVOUR OF RESELLER"*.

### Printing

`printResellerSOA()` writes **only the `<article class="certificate">`** into a fresh
window with its own `@page{size:A4;margin:12mm}` stylesheet. The app shell, the toolbar
and the Bluetooth panel are not in that document at all. A blocked pop-up is explained
rather than failing silently.

`Ctrl+P` / the system share sheet is covered too — `body.soa-report-open` now gets the
same print-isolation block the other five reports have, which is the actual blank-page
cause closed at its root.

### Left alone

The 58 mm thermal statement and the BLE `📶 Print via Bluetooth` path are untouched —
they are the right tool for a receipt printer, and this was never about them.

---

## QA

`node qa/test-reseller-soa.mjs` — **86/86**, against a fixture rebuilt from the
screenshot (billed ₱86,300 · discounts ₱1,000 · net ₱85,300 · collected ₱80,650 ·
balance ₱4,650).

1. the bare `window.print()` is gone from the statement footer
2. the document exists, with both parties, the period and a statement number
3. the picker offers All time, every active month (newest first) and a custom range
4. All time reconciles **cell for cell with `resellerAccountTotals`**
5. a month shows only that month and opens with the balance brought forward
6. the months chain, and sum to the all-time figures
7. the discount is charged once; the dated log is a reference
8. voided tickets are invisible and weightless
9. an overpaid account carries a credit forward
10. printing writes only the certificate into a new window with its own A4 CSS, and the
    app shell is asserted **absent** from it
11. the `@media print` isolation block exists — the blank-page cause, pinned

Whole suite: **14 files, 1,080 checks, all green.**

---

# FIX 203b — the document was opening behind the statement

**Reported:** 2026-10-03, immediately after FIX 203 shipped — *"When I try to click now
after the update, nothing happens. It seems the button is not responding."*
**Version:** `v253-soa-stacking-2026-10-03`
**File:** `app.css` (one line)

The handler was never broken. Driven through the real code, the click resolves
`window.openResellerSOA`, runs end to end without throwing, and renders the complete
5,956-byte document onto the page.

It just could not be seen.

| element | z-index | where from |
|---|---|---|
| `#resellerStatementModal` | **9 999 999** | inline, in `semen-sales.js:5628` |
| `#resellerSOA` | **9 997** | inherited from `.drill-bg` in `app.css` |

The Statement of Account is opened *from* the statement modal, and the statement modal
stays on screen behind it. At `9997` against `9999999`, the brand-new A4 document was
painted underneath an opaque overlay. From the phone, a perfectly rendered invisible page
and a dead button are the same thing.

```css
#resellerSOA{…;z-index:100000000!important}
```

`100 000 000` is above every overlay the app uses (the highest is `99 999 999`) and still
below `.toast` at `999 999 999`, which has to stay readable over everything. Closing the
document still reveals the statement underneath, so "× Close" goes back where you came
from.

## QA

Section `[12]` added to `qa/test-reseller-soa.mjs` — **95/95**. It does not merely assert
a number: it scans **every** `z-index:…!important` in `app.css` and `semen-sales.js`,
and requires the document to outrank all of them except the toast. A future overlay that
tries to sit on top of it fails this test.

It also drives the real button: resolves the `onclick` out of the rendered statement
footer, asserts the function is exported, calls it, asserts it does not throw and that a
document lands on the page.

Whole suite: **14 files, 1,089 checks, all green.**
