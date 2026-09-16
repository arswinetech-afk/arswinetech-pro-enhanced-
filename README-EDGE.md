# Edge worker — head cache (FIX 123/124) + self-hosted medicine search (FIX 195)

Your app already works offline-first and only downloads the farm when a
lightweight "head" probe says something changed. These two fixes make that
pattern scale to thousands of concurrent users:

* **FIX 123 – Adaptive heartbeat with jitter.** Each device now polls at its
  own randomized rhythm (30s + 0–10s jitter while open, ~2min while hidden)
  instead of every device hammering the backend in lockstep every 30s.
* **FIX 124 – Edge head cache.** The "did my farm change?" probe is served
  from Cloudflare's edge (KV) at `/ars-head` — **zero Supabase egress** for
  unchanged polls. Real pulls/pushes still go straight to Supabase
  (source of truth), and the cache is refreshed automatically after every
  successful push/pull (60s TTL as a safety bound).

## Safety (why nothing can break)
* The edge layer is **auto-detected**: if `/ars-head` is missing or wrong,
  the app disables it for the session and behaves exactly like before.
* KV is a **read-only cache**; writes happen only *after* a successful
  Supabase write, fire-and-forget.
* No config changes needed in the app itself.

## Enable it (one-time, ~2 minutes)
1. Cloudflare dashboard → **Workers & Pages → KV** → Create namespace
   (name it anything, e.g. `ars-head-cache`).
2. **Pages → your project → Settings → Functions → KV namespace bindings** →
   Add binding with variable name **`ARS_HEADS`** → pick the namespace.
3. Upload the build folder as usual — `_worker.js` is already inside the zip.
4. Done. New app versions start using the edge automatically.

If you skip these steps, the app keeps working exactly like it does today.

## FIX 195 — `/ars-med?q=…`: the medicine search's own internet engine

The medicine / vaccine search no longer depends on third-party API keys or
free LLM relays. `GET /ars-med?q=iverjec` runs **on your own domain**, in this
worker, merging three key-free public sources server-side (no CORS, no
tokens): DuckDuckGo lite (live PH store listings — real ₱ prices, packs and
label dosage text), openFDA drugsfda (active ingredient, class, dosage form,
route, maker) and Wikipedia (summary + reference photo). The response is the
exact product-card JSON the app's chooser renders, and it is **edge-cached
for 1 h**, so a source hiccup still serves the last good answer.

* Needs **no KV binding and no setup** — it ships with `_worker.js`.
* On hosts without the worker (static preview, plain hosting) the app
  degrades to a direct Wikipedia card; the built-in library stays the
  offline floor. QA: `node qa/test-med-internet-products.mjs`.
