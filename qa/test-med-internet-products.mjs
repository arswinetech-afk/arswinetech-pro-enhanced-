#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   [FIX 194] internet product chooser for the medicine search — QA

   The old flow showed ONE non-selectable AI card, and only after the built-in
   library missed; the prompt self-limited to "real swine medicines", there was
   no product photo chooser, no pack-size, and no way to land the right cost
   per unit in the Add-medicine form. The user asked for: type any medicine or
   vaccine name → the internet returns products (photo, brand, dosage, active
   ingredient, type, price per bottle) → the manager picks one → the Add-
   medicine form opens prefilled, cost per unit auto-computed. No approval-
   list gating. This harness verifies the shipped engine statically:

     1. the search wrap ALWAYS runs the internet lookup (library hit or miss);
     2. the prompt asks for up to 4 products with pack/price/photo fields and
        explicitly forbids an approved-only list;
     3. cards render photo box, brand, active ingredient, dosage, pack+price
        and the auto cost-per-unit division;
     4. "Use this" prefills the Add-medicine form with exactly its field names
        and a computed unit_cost;
     5. engines degrade: Gemini grounded → Gemini plain → keyless Pollinations;
        photos degrade: AI URLs → Wikimedia thumbnail.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const AI = read('ai-vet-search.js');
const MI = read('medicine-inventory.js');

let checks = 0, failures = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};

/* 1 — the wrap no longer gates on a library miss */
const wrap = AI.slice(AI.indexOf('wrap the library name search'));
ok('internet search runs on EVERY name search', /runInternetSearch\(q, false\)/.test(wrap));
ok('no more medLiveU gate (library-hit only flow is gone)', !wrap.includes('medLiveU'));

/* 2 — the prompt is a product-research brief without approval gating */
ok('prompt returns a products array', /"products":\[\{/.test(AI));
ok('prompt asks pack + numeric qty + unit', /packQty":0,"packUnit"/.test(AI));
ok('prompt asks price per pack + photo URLs + sources', /pricePhp":0,"priceNote"/.test(AI) && /imageUrls/.test(AI) && /sources/.test(AI));
ok('prompt forbids approval-list gating', /Do NOT restrict to any approved or vet-only list/.test(AI));
ok('prompt prefers PH trade names', /Philippine trade names first/.test(AI));

/* 3 — the chooser card shows everything the user listed */
ok('card has a photo box', /aiProdImg/.test(AI));
ok('card shows brand chip', /Brand: \$\{esc\(p\.brand\)\}/.test(AI));
ok('card shows active ingredient', /Active ingredient/.test(AI));
ok('card shows swine dosage', /Swine dosage/.test(AI));
ok('card shows pack & price', /Pack &amp; price/.test(AI));
ok('card shows the auto cost/unit division', /Auto cost per unit/.test(AI) && /round2\(price \/ qty\)/.test(AI));
ok('each card has its own choose button', /useAiProduct\(\$\{i\}\)/.test(AI));

/* 4 — the chooser prefills the Add-medicine form (exact field names from the form) */
const formFields = ['item_name', 'brand_name', 'active_ingredient', 'med_type', 'form', 'unit', 'unit_cost', 'notes', 'supplier'];
const prefill = AI.slice(AI.indexOf('function useAiProduct'), AI.indexOf('function aiRefresh'));
ok('prefill covers every Add-medicine field', formFields.every(f => new RegExp(f + ':').test(prefill)),
  formFields.filter(f => !new RegExp(f + ':').test(prefill)).join(','));
ok('prefill computes unit_cost from pack price ÷ qty', /unit_cost: unitCost/.test(prefill) && /price > 0 && qty > 0 \? round2\(price \/ qty\)/.test(AI));
/* and the form's select vocabularies are mirrored exactly, so prefills land on real options */
const grab = (src, n) => (src.match(new RegExp(`const ${n} = \\[(.*?)\\]`)) || [])[1];
['UNITS', 'TYPES', 'FORMS'].forEach(n =>
  ok(`${n} mirror matches medicine-inventory.js`, (grab(AI, n) || '').replace(/\s/g, '') === (grab(MI, n) || '').replace(/\s/g, '')));

/* 5 — engine + photo degradation chains */
ok('Gemini grounded (google_search tool) attempted first', /body\.tools = \[\{ google_search: \{\} \}\]/.test(AI));
ok('falls back to plain Gemini on grounding 400', /grounded\) \{ lastErr = 'grounding unsupported/.test(AI));
ok('keyless Pollinations fallback exists', /text\.pollinations\.ai\//.test(AI));
ok('Gemini failure falls through to keyless engine', /grounded engine failed — the keyless one still may work/.test(AI));
ok('photo fallback: Wikimedia thumbnail of the generic', /en\.wikipedia\.org\/w\/api\.php/.test(AI) && /piprop=thumbnail/.test(AI));
ok('wiki fetch is capped (no stuck placeholder)', /setTimeout\(\(\) => res\(null\), 6000\)/.test(AI));
ok('stale search cannot paint its wiki photo over a newer one', /if \(lastRes !== my\) return/.test(AI));

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
