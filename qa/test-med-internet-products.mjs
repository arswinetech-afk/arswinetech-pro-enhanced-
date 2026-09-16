#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   [FIX 195] self-hosted internet medicine search — QA

   v242 chained third-party engines in the BROWSER (Gemini key → keyless LLM
   relay → Wikipedia); when the weak link failed the farm got an error card
   instead of results. v243 moves the internet brain onto the farm's OWN
   Cloudflare domain: GET /ars-med merges, server-side and key-free,
   DuckDuckGo lite (live PH store listings with real ₱ prices / packs / label
   dosage), openFDA drugsfda (authoritative facts) and Wikipedia (summary +
   photo), edge-cached 1 h. The browser only renders.

   This harness verifies it two ways:
     A. PARSER UNIT TESTS — imports the worker's pure functions and runs them
        on a captured DuckDuckGo-lite fixture (real listings: Iverjec ₱179 on
        Lazada, Ivermectin 100ml ₱980 on agrilife.ph) plus openFDA/Wikipedia
        fixtures shaped like the live APIs;
     B. STATIC CHECKS — the client asks its own /ars-med and carries no API
        keys; the worker keeps /ars-head and the static fallback; the chooser
        still prefills the Add-medicine form with the auto cost-per-unit.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const AI = read('ai-vet-search.js');
const WORKER = read('_worker.js');
const MI = read('medicine-inventory.js');

/* the worker is ESM for Cloudflare but the repo has no package.json (Node would
   read .js as CJS) — import it through a data URL so the REAL shipped code runs */
const mod = await import('data:text/javascript;base64,' + Buffer.from(WORKER).toString('base64'));
const { parseDdg, extractOffer, fdaFacts, buildProducts } = mod;

let checks = 0, failures = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};

/* ── A. parser unit tests on captured-shape fixtures ─────────────────────── */
const DDG_FIXTURE = `<table>
<tr><td>1.</td><td><a rel="nofollow" class="result-link" href="https://www.lazada.com.ph/products/iverjec-ivermectin-endectocide-dewormer-for-animals-10ml100ml-i4469998768.html">Iverjec Ivermectin Endectocide - Dewormer for Animals (10ml/100ml)</a></td></tr>
<tr><td></td><td class="result-snippet"><b>Iverjec</b> <b>Ivermectin</b> Endectocide - Dewormer for Animals (10ml/100ml) App 4.9(12) ₱179.00</td></tr>
<tr><td>2.</td><td><a rel="nofollow" class="result-link" href="https://agrilife.ph/product/ivermectin-100ml/">Ivermectin 100ml - Agrilife Philippines</a></td></tr>
<tr><td></td><td class="result-snippet"><b>Ivermectin</b> 100ml ₱980.00 Add to cart SKU: IVERMECTINML100</td></tr>
<tr><td>3.</td><td><a rel="nofollow" class="result-link" href="https://shopee.ph/Iverjec-Ivermectin-Endectocide-Dewormer-(10ml)-i.1047011131.22162420595">Iverjec Ivermectin Endectocide - Dewormer (10ml) - Shopee Philippines</a></td></tr>
<tr><td></td><td class="result-snippet">Buy Iverjec Ivermectin (10ml). Dosage and Administration: Swine: 1ml per 33kg body weight. Withdrawal Period: Withdraw medication 28 days.</td></tr>
</table>`;

const results = parseDdg(DDG_FIXTURE);
ok('parseDdg pairs links with snippets', results.length === 3 && results.every(r => r.title && r.url && r.snippet !== undefined), `${results.length} results`);

const o1 = extractOffer(results[0]);
ok('offer 1: ₱179 mined from the listing', o1.pricePhp === 179, String(o1.pricePhp));
ok('offer 1: pack mined (ml)', o1.packQty > 0 && o1.packUnit === 'ml', `${o1.packQty} ${o1.packUnit}`);
ok('offer 1: store = Lazada', o1.store === 'Lazada', o1.store);
ok('offer 1: title cleaned of marketplace suffix', !/Lazada/i.test(o1.name), o1.name);

const o3 = extractOffer(results[2]);
ok('offer 3: swine dosage mined from snippet', /swine/i.test(o3.dosage) && /33\s*kg/i.test(o3.dosage), o3.dosage);
ok('offer 3: withdrawal mined', /28 days/i.test(o3.withdrawal), o3.withdrawal);
ok('offer 3: store = Shopee', o3.store === 'Shopee', o3.store);

const FDA_FIXTURE = { results: [{ sponsor_name: 'X', openfda: { generic_name: ['IVERMECTIN'], substance_name: ['IVERMECTIN'], manufacturer_name: ['Edenbridge Pharmaceuticals LLC.'], pharm_class_epc: ['Antiparasitic [EPC]', 'Pediculicide [EPC]'] }, products: [{ brand_name: 'IVERMECTIN', active_ingredients: [{ name: 'IVERMECTIN', strength: '3MG' }], dosage_form: 'TABLET', route: 'ORAL' }] }] };
const facts = fdaFacts(FDA_FIXTURE);
ok('fdaFacts: class → Antiparasitic / Dewormer', facts.type === 'Antiparasitic / Dewormer', facts.type);
ok('fdaFacts: dosage form → TableT vocab', facts.form === 'Tablet', facts.form);
ok('fdaFacts: active + strength', /IVERMECTIN/.test(facts.activeIngredient) && /3MG/.test(facts.activeIngredient), facts.activeIngredient);

const WIKI_FIXTURE = { title: 'Ivermectin', extract: 'Ivermectin is an anti-parasitic medication.', thumb: 'https://upload.wikimedia.org/x.jpg', url: 'https://en.wikipedia.org/wiki/Ivermectin' };
const merged = buildProducts('Iverjec', WIKI_FIXTURE, facts, results);
ok('merge: offers become chooser products (≤4)', merged.products.length >= 2 && merged.products.length <= 4, String(merged.products.length));
ok('merge: priced offers first', merged.products[0].pricePhp === 179, String(merged.products[0].pricePhp));
ok('merge: priceNote carries live-web provenance', /live web price/.test(merged.products[0].priceNote), merged.products[0].priceNote);
ok('merge: FDA facts land on every product', merged.products.every(p => p.type === 'Antiparasitic / Dewormer' && /IVERMECTIN/.test(p.activeIngredient)));
ok('merge: generic + photo surface for the client', merged.genericName === 'IVERMECTIN' && merged.photo === WIKI_FIXTURE.thumb);
ok('merge: sources kept (the farm can tap through)', merged.products[0].sources[0].url.includes('lazada.com.ph'));
const noOffers = buildProducts('Farrowsure', WIKI_FIXTURE, null, []);
ok('merge: no store listing still answers (facts/floor card)', noOffers.found === true && noOffers.products.length === 1 && noOffers.products[0].sources.length > 0);

/* ── B. static checks: client carries no keys, worker owns the internet ──── */
ok('client asks its own /ars-med', AI.includes("fetch('/ars-med?q='"));
ok('client: internet search runs on EVERY name search', /runInternetSearch\(q, false\)/.test(AI.slice(AI.indexOf('wrap the library name search'))));
ok('client has NO Gemini endpoint', !AI.includes('generativelanguage.googleapis.com'));
ok('client has NO keyless LLM relay', !AI.includes('pollinations'));
ok('client stores NO api key', !AI.includes('ars-ai-key') && !AI.includes('openAiSetup'));
ok('client degrades to Wikipedia when no worker', AI.includes('wikiDirect'));
ok('card shows the auto cost/unit division', /Auto cost per unit/.test(AI) && /round2\(price \/ qty\)/.test(AI));
const prefill = AI.slice(AI.indexOf('function useAiProduct'), AI.indexOf('function aiRefresh'));
ok('prefill covers every Add-medicine field', ['item_name', 'brand_name', 'active_ingredient', 'med_type', 'form', 'unit', 'unit_cost', 'supplier', 'notes:'].every(f => prefill.includes(f)));
const grab = (src, n) => (src.match(new RegExp(`const ${n} = \\[(.*?)\\]`)) || [])[1];
['UNITS', 'TYPES', 'FORMS'].forEach(n =>
  ok(`${n} mirror matches medicine-inventory.js`, (grab(AI, n) || '').replace(/\s/g, '') === (grab(MI, n) || '').replace(/\s/g, '')));

ok('worker routes /ars-med', WORKER.includes("url.pathname === '/ars-med'"));
ok('worker edge-caches answers 1 h', WORKER.includes('public, max-age=3600'));
ok('worker: DDG lite + openFDA + Wikipedia sources', WORKER.includes('lite.duckduckgo.com') && WORKER.includes('api.fda.gov/drug/drugsfda.json') && WORKER.includes('en.wikipedia.org'));
ok('worker keeps /ars-head (FIX 124)', WORKER.includes("url.pathname !== '/ars-head'") && WORKER.includes('env.ARS_HEADS'));
ok('worker keeps static fallback', WORKER.includes('env.ASSETS.fetch(request)'));
ok('worker sources are individually optional (allSettled)', WORKER.includes('Promise.allSettled'));

/* ── C. end-to-end: the REAL worker fetch handler, network stubbed ─────────
   Runs the shipped default.fetch('/ars-med') code path with canned responses
   shaped like the three live sources, so the route logic itself is verified. */
const realFetch = globalThis.fetch;
globalThis.fetch = async u => {
  const s = String(u);
  if (s.includes('lite.duckduckgo.com')) return new Response(DDG_FIXTURE, { status: 200 });
  if (s.includes('drugsfda')) return new Response(JSON.stringify(FDA_FIXTURE), { status: 200 });
  if (s.includes('wikipedia.org')) return new Response(JSON.stringify({ query: { pages: { 1: { title: 'Ivermectin', extract: 'Ivermectin is an anti-parasitic medication.', thumbnail: { source: 'https://upload.wikimedia.org/x.jpg' } } } } }), { status: 200 });
  throw new Error('unexpected fetch: ' + s);
};
try {
  const res = await mod.default.fetch(new Request('https://farm.pages.dev/ars-med?q=Iverjec'), { ASSETS: { fetch: async () => new Response('static', { status: 200 }) } });
  const j = await res.json();
  ok('e2e /ars-med: 200 + edge cache header', res.status === 200 && /max-age=3600/.test(res.headers.get('cache-control') || ''));
  ok('e2e /ars-med: chooser JSON with the ₱179 Lazada offer first', j.found === true && j.products[0].pricePhp === 179 && /Lazada/.test(j.products[0].brand), JSON.stringify(j.products[0]).slice(0, 120));
  ok('e2e /ars-med: auto-cost inputs present (price+packQty)', j.products[0].packQty > 0 && j.products[0].packUnit === 'ml');
  ok('e2e /ars-med: photo + generic surfaced', j.photo === 'https://upload.wikimedia.org/x.jpg' && j.genericName === 'IVERMECTIN');
  const head = await mod.default.fetch(new Request('https://farm.pages.dev/ars-head?farm=f1'), { ASSETS: { fetch: async () => new Response('static', { status: 200 }) } });
  ok('e2e /ars-head without KV binding still 503-JSON (FIX 124 behaviour kept)', head.status === 503);
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
