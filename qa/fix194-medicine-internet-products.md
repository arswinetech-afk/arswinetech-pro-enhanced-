# FIX 194 — medicine search: internet product chooser with auto cost-per-unit

**Reported (phone screenshots, 2026-09-16):** "Re-engineer the search algorithm for
medicine. It has a very limited searching capability when it comes to widely available
medicine over the internet for pigs. Do not place a specific limitation like vet
approved meds. Once I type a specific name of medicine or vaccine, it should search
over the internet and pull the details — photo (if available), brand, dosage, active
ingredient, type, price per bottle — and I will be the one to choose which one, so I
can place the cost per unit correctly (or auto-compute it), following the format when
adding a new medicine."

## What was wrong

The old `ai-vet-search.js` ran only *after* the built-in library missed (it watched
for the `#medLiveU` marker), rendered **one** non-selectable AI card, its prompt
self-limited to "a real swine medicine" (`{"found":false}` otherwise), and its
"Add to Inventory" guessed a unit from prose — there was no pack size, no per-bottle
price to divide, and no chooser.

## The rebuild

* **Always-on internet search.** The `medNameSearch` wrap now appends a
  `🌐 Internet product results` section on *every* name search (library hit or miss),
  after the library cards.
* **No gating.** The prompt explicitly says: any real product marketed for pigs, or
  whose active ingredient is used in pigs; PH trade names first; generic queries
  return their commercial brands (ivermectin → Iverjec, Bioran…).
* **The chooser.** Up to 4 product cards, each with: product photo (AI-sourced direct
  URLs → Wikimedia Commons thumbnail of the generic as the real-photo fallback, 6 s
  cap), brand chip, active ingredient, type, form, swine dosage, pack ("100 ml
  bottle"), ₱ price per pack, source links — and the money line:
  `🧮 Auto cost per unit: ₱4.50 per ml (₱450 ÷ 100 ml)`.
* **"✓ Use this — add to inventory"** opens the existing Add-medicine modal prefilled
  (Name, Brand, Active ingredient, Type, Form, Unit, Supplier, Notes) with
  `unit_cost` already computed; the manager still picks the product and can edit
  everything. A toast restates the division.
* **Engines, degraded gracefully.** Gemini with Google-Search grounding (farm key) →
  plain Gemini → keyless Pollinations, so a brand-new device with no key still gets
  internet product search out of the box. The manage modal now calls the key an
  *optional upgrade*.
* Select vocabulary (`UNITS/TYPES/FORMS`) is mirrored exactly from
  `medicine-inventory.js` so prefills land on real options.

## Verified by

`qa/test-med-internet-products.mjs` — 24 static checks across the wrap (always-on, no
`medLiveU` gate), the prompt (products schema, no-approval-gating wording), the card
(photo/brand/ingredient/dosage/pack/price/auto-cost/choose-button), the prefill (every
Add-medicine field name, `unit_cost = round2(price/qty)`, mirrored select vocabularies
deep-compared against `medicine-inventory.js`), and both degradation chains. Run:
`node qa/test-med-internet-products.mjs`. Live end-to-end (Gemini/Pollinations/
Wikimedia responses) needs a browser with network — not runnable in this sandbox.
