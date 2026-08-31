/* ═══════════════════════════════════════════════════════════════════════════
   ARSwineTech Pro — EDGE HEAD CACHE (Cloudflare Pages _worker.js, FIX 124)

   Serves the tiny "did my farm change?" sync head from Cloudflare KV at
   /ars-head so thousands of polling devices never touch Supabase egress.

   SETUP (one-time, ~2 minutes, Cloudflare dashboard):
     1. Workers & Pages → KV → Create namespace (e.g. "ars-head-cache").
     2. Pages → your project → Settings → Functions → KV namespace bindings
        → Add binding: variable name  ARS_HEADS  → select that namespace.
     3. Upload this _worker.js together with the rest of the build folder
        (it is already inside the release zip).
     4. Done. The app auto-detects /ars-head; if any of the above is missing
        the app silently falls back to the direct Supabase probe — nothing
        breaks, ever. Supabase remains the source of truth for real data.

   Routes:
     GET  /ars-head?farm=<id>  → cached head JSON, or 404 {missing:true}
     POST /ars-head            → {farm,count,maxUpdated} stored, TTL 60s
     anything else             → static site (env.ASSETS)
   ═══════════════════════════════════════════════════════════════════════════ */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ars-head') return env.ASSETS.fetch(request);

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type'
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' }
    });

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!env.ARS_HEADS) return json({ error: 'KV namespace not bound' }, 503);

    if (request.method === 'GET') {
      const farm = url.searchParams.get('farm') || '';
      if (!farm) return json({ error: 'farm required' }, 400);
      const raw = await env.ARS_HEADS.get(farm);
      if (!raw) return json({ missing: true }, 404);
      return new Response(raw, { headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }

    if (request.method === 'POST') {
      const j = await request.json().catch(() => null);
      if (!j || typeof j.farm !== 'string' || !j.farm || typeof j.count !== 'number') {
        return json({ error: 'bad body' }, 400);
      }
      await env.ARS_HEADS.put(
        j.farm,
        JSON.stringify({ farm: j.farm, count: j.count, maxUpdated: j.maxUpdated || null }),
        { expirationTtl: 60 }
      );
      return json({ ok: true });
    }

    return json({ error: 'method not allowed' }, 405);
  }
};
