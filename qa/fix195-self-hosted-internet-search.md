# FIX 195 — the medicine search's internet engine moves onto the farm's own domain

**Reported (2026-09-16):** "Look at the error, can we not rely from those? I simply
needed, when I search a medicine or vaccine name, the system will search all over the
internet and provide a formatted result." — v242's browser-side chain (Gemini key →
keyless LLM relay → Wikipedia) errored out whenever the weak link failed; the keyless
relay in particular is rate-limited/unstable and returned non-JSON.

## What was wrong

The internet brain lived in the browser and depended on third parties:
a user-supplied Gemini key, or Pollinations' free relay when no key — both outside the
farm's control, both CORS/token-constrained from a browser, one of them flaky enough to
turn a search into an error card.

## The rebuild

`_worker.js` now serves **`GET /ars-med?q=…`** on the farm's own Cloudflare domain and
merges, server-side (no CORS, no tokens, no keys), three key-free public sources:

1. **DuckDuckGo lite** — live web results: real PH store listings with real ₱ prices,
   packs (10ml/100ml) and label dosage text ("Swine: 1ml per 33kg body weight",
   "Withdrawal… 28 days") mined from snippets; verified live during development —
   "Iverjec" returned Iverjec ₱179 (Lazada) and Ivermectin 100ml ₱980 (agrilife.ph);
2. **openFDA drugsfda** — authoritative facts: active ingredient + strength,
   pharmacologic class → Type, dosage form → Form, route, manufacturer;
3. **Wikipedia** — the generic's summary + a real reference photo.

Every source is optional (`Promise.allSettled`, per-source timeouts); the answer is
**edge-cached 1 h** so a source hiccup still serves the last good answer. The browser
(`ai-vet-search.js`, now key-free — Gemini/Pollinations/key modal deleted) only asks
its own `/ars-med` and renders the same chooser: photo · brand · active ingredient ·
type · form · swine dosage · pack · ₱ price · sources, with the auto cost-per-unit and
"✓ Use this — add to inventory" prefilling the Add-medicine form. Hosts without the
worker (static preview) degrade to a direct Wikipedia card; the built-in library —
now with brand aliases (`iverjec`, `ivermec`, `genvet ivermec` on the ivermectin
entry) — stays the offline floor.

## Verified by

`qa/test-med-internet-products.mjs` — 40 checks, three layers: (A) parser unit tests
on a captured DuckDuckGo-lite fixture with real listings; (B) static checks that the
client carries no keys and the worker keeps `/ars-head` + the static fallback; (C) an
end-to-end run of the REAL shipped `default.fetch('/ars-med')` handler with the three
sources stubbed in live-API shapes. Run: `node qa/test-med-internet-products.mjs`.
(The live external calls themselves can't be made from this sandbox — no outbound
network — but they were verified through the fetch tooling during development, and
they run on Cloudflare's edge in production.)
