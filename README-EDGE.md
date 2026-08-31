# Edge Head Cache — 10,000-user sync upgrade (FIX 123 + FIX 124)

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

If you skip these steps, the app keeps working exactly as it does today.
