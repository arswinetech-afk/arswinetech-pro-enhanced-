/* ═══════════════════════════════════════════════════════════════════════════
   ARSwineTech Pro — Cloudflare Pages _worker.js (FIX 124 + FIX 195)

   FIX 124: serves the tiny "did my farm change?" sync head from Cloudflare KV
   at /ars-head so thousands of polling devices never touch Supabase egress.

   FIX 195: /ars-med?q=… — the medicine search's OWN internet engine.
   The farm asked for a medicine/vaccine search that "searches all over the
   internet" without relying on third-party API keys or flaky free LLM
   relays. So the search now lives on the farm's own domain, server-side
   (no CORS, no tokens), merging three key-free public sources:

     1. DuckDuckGo lite  — live web results: real PH store listings with real
        ₱ prices, packs (10ml/100ml) and label dosage text in the snippets
        (Lazada / Shopee / vet-store pages);
     2. openFDA drugsfda — authoritative facts: active ingredient + strength,
        pharmacologic class (→ type), dosage form (→ form), route, maker;
     3. Wikipedia        — the generic's summary + a real reference photo.

   Responses are edge-cached for 1 h, so a source hiccup still serves the
   last good answer. Every source is optional: the merge degrades gracefully
   and always returns the product-card JSON the app renders (photo · brand ·
   active ingredient · type · dosage · pack · ₱ price · sources).

   SETUP (one-time, ~2 minutes, Cloudflare dashboard):
     1. Workers & Pages → KV → Create namespace (e.g. "ars-head-cache").
     2. Pages → your project → Settings → Functions → KV namespace bindings
        → Add binding: variable name  ARS_HEADS  → select that namespace.
     3. Upload this _worker.js together with the rest of the build folder.
     4. Done. /ars-med needs no binding at all; /ars-head falls back silently
        to the direct Supabase probe if the binding is missing.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── FIX 195: the self-hosted internet medicine search ─────────────────────── */

const stripHtml = s => String(s || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/* DuckDuckGo "lite" is deliberately plain HTML: numbered rows, one
   <a class="result-link"> and one <td class="result-snippet"> per result. */
export function parseDdg(html) {
  const links = [...String(html).matchAll(/<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ url: m[1], title: stripHtml(m[2]) }));
  const snaps = [...String(html).matchAll(/<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(m => stripHtml(m[1]));
  return links.map((l, i) => ({ title: l.title, url: l.url, snippet: snaps[i] || '' }))
    .filter(r => r.title && /^https?:\/\//i.test(r.url));
}

const cleanTitle = t => stripHtml(t)
  .replace(/\s*[-–|·]\s*(Lazada|Shopee|TikTok Shop|TikTok|BigGo|eCommerce|Price & Voucher[^\-|]*)[^-|]*$/i, '')
  .replace(/\([\d,]+\s*reviews?\)/i, '').trim();

const STORES = [
  [/lazada\.com\.ph/i, 'Lazada'], [/shopee\.ph/i, 'Shopee'], [/tiktok\.com/i, 'TikTok Shop'],
  [/agrilife\.ph/i, 'Agrilife'], [/unahco\.com/i, 'UNAHCO'], [/biggo\.com/i, 'BigGo']
];
const storeOf = u => {
  try {
    const h = new URL(u).hostname;
    const hit = STORES.find(x => x[0].test(h));
    return hit ? hit[1] : h.replace(/^www\./, '');
  } catch (e) { return ''; }
};

/* one web listing → one purchasable offer (price/pack/dosage mined from text) */
export function extractOffer(r) {
  const text = `${r.title} ${r.snippet}`;
  const price = (text.match(/₱\s?([\d,]+(?:\.\d+)?)/) || [])[1];
  const ml = text.match(/(\d+(?:\.\d+)?)\s*(?:ml|cc)\b/i);
  const gm = !ml && text.match(/(\d+(?:\.\d+)?)\s*(g|mg|mcg)\b/i);
  const tab = !ml && !gm && text.match(/(\d+)\s*(tablets?|capsules?|caplets?|sachets?|doses?)/i);
  const packQty = ml ? parseFloat(ml[1]) : gm ? parseFloat(gm[1]) : tab ? parseFloat(tab[1]) : 0;
  const packUnit = ml ? 'ml' : gm ? (gm[1].toLowerCase() === 'g' ? 'g' : 'mg') : tab ? tab[2].toLowerCase().replace(/s$/, '') : '';
  const dosage = (r.snippet.match(/swine[^.]{0,140}\.[^.]{0,60}(weight|day|days)?\.?/i) || [])[0] ||
    (r.snippet.match(/(\d+(?:\.\d+)?\s*ml\s+per\s[^.]{0,60})/i) || [])[0] || '';
  const withdrawal = (r.snippet.match(/withdrawal[^.]{0,80}\.?/i) || [])[0] || '';
  return {
    name: cleanTitle(r.title),
    pricePhp: price ? parseFloat(price.replace(/,/g, '')) : 0,
    packQty, packUnit,
    pack: packQty ? `${packQty} ${packUnit === 'mg' ? 'mg' : packUnit}` : '',
    dosage: dosage ? dosage.trim() : '',
    withdrawal: withdrawal ? withdrawal.trim() : '',
    store: storeOf(r.url),
    source: { title: cleanTitle(r.title), url: r.url }
  };
}

const guessType = t => {
  t = String(t).toLowerCase();
  if (/vaccin|biologic/.test(t)) return 'Vaccine / Biologic';
  if (/deworm|endectocide|parasit|mange|lice|worm|ivermect|doramect/.test(t)) return 'Antiparasitic / Dewormer';
  if (/antibiot|antibacter|amox|penicillin|cephalo|tylosin|oxytetracycline|enrofloxacin|colistin|fosfomycin/.test(t)) return 'Antibiotic';
  if (/vitamin|mineral|\biron\b|dextran/.test(t)) return 'Vitamin & Mineral';
  if (/prostagland|estrus|oxytocin|hormone|gonadotroph/.test(t)) return 'Hormone';
  if (/inflam|nsaid|meloxicam|fever/.test(t)) return 'Anti-inflammatory / NSAID';
  if (/electrolyte|rehydrat|tonic|support/.test(t)) return 'Supportive / Oral rehydration';
  return 'Other';
};
const guessForm = (t, unit) => {
  t = String(t).toLowerCase();
  if (/tablet|bolus/.test(t)) return 'Tablet';
  if (/capsule|caplet/.test(t)) return 'Capsule/Caplet';
  if (/sachet|powder|premix/.test(t)) return 'Powder/Sachet';
  if (/oral|drench|solution|suspension|syrup|drink|water/.test(t)) return 'Oral solution';
  if (unit === 'ml' || /inject|vial/.test(t)) return 'Injection (vial)';
  return 'Other';
};

/* openFDA (US FDA database) → authoritative facts for the active ingredient */
export function fdaFacts(j) {
  const r = ((j && j.results) || [])[0];
  if (!r) return null;
  const o = r.openfda || {};
  const p = (r.products || [])[0] || {};
  const ai = ((p.active_ingredients || [])[0] || {});
  const cls = (o.pharm_class_epc || []).join(' ');
  const type = /Antiparasitic|Anthelmintic|Pediculicide|Scabicide/.test(cls) ? 'Antiparasitic / Dewormer'
    : /Antibacter|Antibiotic/.test(cls) ? 'Antibiotic'
    : /Vaccine/.test(cls) ? 'Vaccine / Biologic'
    : /Anti-Inflammatory/.test(cls) ? 'Anti-inflammatory / NSAID'
    : /Vitamin|Mineral/.test(cls) ? 'Vitamin & Mineral'
    : /Hormone|Prostaglandin/.test(cls) ? 'Hormone' : '';
  const df = String(p.dosage_form || '').toUpperCase();
  const form = /TABLET/.test(df) ? 'Tablet' : /CAPSULE/.test(df) ? 'Capsule/Caplet'
    : /INJECT|SOLUTION.*INJ/.test(df) ? 'Injection (vial)'
    : /SOLUTION|SUSPENSION|SYRUP/.test(df) ? 'Oral solution'
    : /POWDER|GRANULE/.test(df) ? 'Powder/Sachet' : '';
  return {
    generic: (o.generic_name || o.substance_name || [])[0] || '',
    activeIngredient: ai.name ? `${ai.name}${ai.strength ? ' ' + ai.strength : ''}` : (o.substance_name || [])[0] || '',
    type, form,
    route: (p.route || (o.route || [])[0] || '').toLowerCase(),
    manufacturer: (o.manufacturer_name || [])[0] || r.sponsor_name || ''
  };
}

/* merge everything into the chooser's product JSON */
export function buildProducts(q, wiki, fda, rawOffers) {
  const offers = (rawOffers || []).map(extractOffer).filter(o => o.name);
  const seen = new Set();
  const priced = offers.filter(o => o.pricePhp > 0);
  const unpriced = offers.filter(o => !o.pricePhp);
  const ordered = [...priced, ...unpriced].filter(o => {
    const k = (o.name + '|' + o.pack).toLowerCase();
    if (seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, 4);

  const products = ordered.map(o => ({
    name: o.name,
    brand: o.store,
    activeIngredient: fda?.activeIngredient || '',
    type: fda?.type || guessType(`${q} ${o.name} ${o.dosage}`),
    form: fda?.form || guessForm(`${q} ${o.name}`, o.packUnit),
    pack: o.pack, packQty: o.packQty, packUnit: o.packUnit,
    dosage: o.dosage || '',
    pricePhp: o.pricePhp,
    priceNote: o.pricePhp ? `₱${o.pricePhp} per ${o.pack || 'pack'} — ${o.store}, live web price` : `Price not listed by ${o.store || 'the store'} — set your supplier price`,
    imageUrls: [],
    sources: [o.source]
  }));

  if (!products.length) {
    /* no store listing matched — still answer with the facts we have */
    products.push({
      name: q, brand: fda?.manufacturer || '',
      activeIngredient: fda?.activeIngredient || '',
      type: fda?.type || guessType(q), form: fda?.form || '',
      pack: '', packQty: 0, packUnit: '', dosage: '',
      pricePhp: 0, priceNote: 'No live store price found — set your supplier price',
      imageUrls: [],
      sources: wiki?.url ? [{ title: wiki.title, url: wiki.url }] : []
    });
  }
  return {
    found: true,
    query: q,
    genericName: fda?.generic || wiki?.title || '',
    summary: wiki?.extract || '',
    photo: wiki?.thumb || null,
    products
  };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function srcDdg(q) {
  const r = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q + ' price philippines')}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (ARSwineTech farm app)' }
  });
  if (!r.ok) throw new Error('ddg ' + r.status);
  return parseDdg(await r.text());
}
async function srcFda(q) {
  const r = await fetch(`https://api.fda.gov/drug/drugsfda.json?search=${encodeURIComponent(q)}&limit=3`);
  if (!r.ok) throw new Error('fda ' + r.status);
  return fdaFacts(await r.json());
}
async function srcWiki(q) {
  const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=1&prop=pageimages%7Cextracts&exintro=1&explaintext=1&exsentences=2&piprop=thumbnail&pithumbsize=640&format=json`);
  if (!r.ok) throw new Error('wiki ' + r.status);
  const j = await r.json();
  const p = ((j && j.query && j.query.pages) ? Object.values(j.query.pages) : [])[0];
  if (!p) return null;
  return { title: p.title, extract: p.extract || '', thumb: p.thumbnail?.source || null, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(p.title).replace(/ /g, '_'))}` };
}

export async function medSearch(q) {
  const [ddg, fda, wiki] = await Promise.allSettled([
    withTimeout(srcDdg(q), 6000), withTimeout(srcFda(q), 5000), withTimeout(srcWiki(q), 5000)
  ]);
  return buildProducts(
    q,
    wiki.status === 'fulfilled' ? wiki.value : null,
    fda.status === 'fulfilled' ? fda.value : null,
    ddg.status === 'fulfilled' ? ddg.value : []
  );
}

/* ── the worker: /ars-head (FIX 124) + /ars-med (FIX 195) + static ─────────── */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ars-med') {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'content-type': 'application/json'
      };
      if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
      if (q.length < 2) return new Response(JSON.stringify({ error: 'q required' }), { status: 400, headers: { ...cors, 'cache-control': 'no-store' } });
      try {
        const out = await withTimeout(medSearch(q), 9000);
        return new Response(JSON.stringify(out), { headers: { ...cors, 'cache-control': 'public, max-age=3600' } });
      } catch (e) {
        return new Response(JSON.stringify({ found: false, error: String(e && e.message || e) }), { status: 200, headers: { ...cors, 'cache-control': 'no-store' } });
      }
    }

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
      return new Response(raw, { headers: cors, 'content-type': 'application/json', 'cache-control': 'no-store' });
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
