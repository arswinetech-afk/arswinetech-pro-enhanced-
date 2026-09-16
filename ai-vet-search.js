/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 194] js/ai-vet-search.js — the medicine search's internet engine.

   THE USER ASKED (v242): "Do not place a specific limitation like vet-approved
   meds. Once I type a specific name of medicine or vaccine, it should search
   over the internet and pull the details and information as a result — photo
   (if available), brand, dosage, active ingredient, type, price per bottle —
   and I will be the one to choose which one, so I can place the cost per unit
   correctly (or auto-compute it), following the Add-medicine form."

   So this module no longer renders ONE "not in library" AI card. Every name
   search now appends a 🌐 INTERNET PRODUCT RESULTS section with up to four
   commercial product cards (PH brands first). Each card shows a product photo
   (AI-sourced direct URLs, falling back to a Wikimedia Commons thumbnail of
   the active ingredient), brand/manufacturer, active ingredient, type, form,
   swine dosage, pack size and ₱ price per pack — plus an AUTO cost per unit
   (₱price ÷ pack qty, e.g. ₱450 ÷ 100 ml = ₱4.50/ml). "✓ Use this — add to
   inventory" opens the same Add-medicine form the farm already knows, with
   every field prefilled and the cost per unit already computed; the manager
   still chooses which product and can edit anything.

   No approval-list gating: the prompt returns any real product marketed for
   pigs (or whose active ingredient is used in pigs). Engines, in order:
     1. Google AI Studio (Gemini) with Google-Search grounding, when the farm
        saved a free key (best: live sources + real pack photos);
     2. the free keyless Pollinations text API, so internet product search
        works out of the box on a brand-new device.
   The key manager (✨/🌐 manage) is unchanged in behaviour; the wording now
   says the key is an optional upgrade, not a requirement.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const LS = 'ars-ai-key';
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsq = v => "'" + String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + "'";
  const aiKey = () => localStorage.getItem(LS) ||
    (typeof F === 'function' && F().settings && F().settings.aiKey) || '';
  /* mirrored from medicine-inventory.js (its UNITS/TYPES/FORMS live in a closure) —
     prefills must use exactly these option values or the Add-medicine selects fall
     back to their first option. */
  const UNITS = ['ml', 'tablet', 'capsule', 'caplet', 'dose', 'sachet', 'g', 'pack', 'bottle', 'piece'];
  const TYPES = ['Antibiotic', 'Antiparasitic / Dewormer', 'Vitamin & Mineral', 'Anti-inflammatory / NSAID', 'Hormone', 'Supportive / Oral rehydration', 'Vaccine / Biologic', 'Other'];
  const FORMS = ['Injection (vial)', 'Oral solution', 'Powder/Sachet', 'Premix', 'Tablet', 'Capsule/Caplet', 'Other'];

  /* [REBUILD FIX 68] model discovery — Google retires model names; ask the key what
     it may call and keep a static last resort. */
  const STATIC_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-latest'];
  let modelList = null;
  function modelRank(n) {
    const v = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]) || 0;
    return v * 10 + (/flash-lite|lite/.test(n) ? 3 : /flash/.test(n) ? 2 : /pro/.test(n) ? 1 : 0);
  }
  async function modelCandidates() {
    if (modelList) return modelList;
    const found = [];
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(aiKey())}`);
      if (r.ok) {
        const j = await r.json();
        ((j && j.models) || [])
          .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map(m => String(m.name || '').replace(/^models\//, ''))
          .filter(n => /^gemini-/i.test(n))
          .sort((a, b) => modelRank(b) - modelRank(a))
          .forEach(n => { if (!found.includes(n)) found.push(n); });
      }
    } catch (e) { /* offline or blocked — static fallbacks below still apply */ }
    STATIC_MODELS.forEach(n => { if (!found.includes(n)) found.push(n); });
    modelList = found.slice(0, 6);
    return modelList;
  }
  const aiCache = {};

  function saveAiKey(k) {
    k = String(k || '').trim();
    if (k) localStorage.setItem(LS, k); else localStorage.removeItem(LS);
    modelList = null; Object.keys(aiCache).forEach(x => delete aiCache[x]);
    if (typeof F === 'function') {
      F().settings = F().settings || {};
      F().settings.aiKey = k;
      if (typeof save === 'function') save();
    }
    document.getElementById('aiKeyModal')?.remove();
    if (typeof renderAll === 'function') renderAll();
    toast(k ? '🌐 Gemini key saved — internet product search now uses grounded live sources' : '🌐 Key removed — product search continues on the free keyless engine');
  }

  /* ── setup modal ── */
  function openAiSetup() {
    document.getElementById('aiKeyModal')?.remove();
    const cur = aiKey();
    document.body.insertAdjacentHTML('beforeend',
      `<div class="due-modal-bg" id="aiKeyModal"><div class="reminder-modal perf-modal ai-setup-modal"><div class="modal-top"><h2>🌐 Internet product search</h2><button type="button" class="close-reminder" onclick="document.getElementById('aiKeyModal').remove()">×</button></div>` +
      `<p class="perf-sub">Every medicine / vaccine / vitamin name search already pulls live product cards from the internet — photo, brand, active ingredient, dosage, pack and ₱ price — on the free keyless engine. Adding a <b>free Google AI Studio key</b> upgrades it to grounded live sources (manufacturer pages, Merck Vet Manual, PH vet retailers) and real pack photos.</p>` +
      `<div class="reminder-fields">` +
      `<div class="field full"><label>Google AI Studio API key ${cur ? '(saved)' : '(optional)'}</label><input id="aiKeyInput" type="password" autocomplete="off" placeholder="AIza…" value="${esc(cur)}"><small class="field-hint">Free in 1 minute: aistudio.google.com/apikey → “Create API key”. Saved on this device and in your farm settings. The app never sends farm data with it — only the product name you search.</small></div>` +
      `</div><div class="due-actions" style="margin-top:16px">` +
      (cur ? `<button type="button" class="btn ghost" onclick="saveAiKey('')">Remove key</button>` : '') +
      `<button type="button" class="btn ghost" onclick="document.getElementById('aiKeyModal').remove()">Close</button>` +
      `<button class="btn" onclick="saveAiKey(document.getElementById('aiKeyInput').value)">Save &amp; enable grounded lookup</button></div></div></div>`);
  }

  /* status line inside the search panel */
  function injectAiStatus() {
    const d = document.querySelector('#medicine .vet-disclaimer');
    if (!d || document.getElementById('aiStatusLine')) return;
    d.insertAdjacentHTML('afterend',
      `<div id="aiStatusLine">🌐 Internet product search: <b class="ai-on">ON</b> — any brand you type is looked up live (photo · brand · dosage · pack price → auto cost/unit) · engine: ${aiKey() ? '<b class="ai-on">Gemini grounded</b>' : 'free keyless'} · <a role="button" tabindex="0" onclick="openAiSetup()" onkeydown="if(event.key==='Enter')openAiSetup()">manage</a></div>`);
  }

  /* ── the product-research prompt: NO approval-list restriction ── */
  const PROMPT = q => `You are a veterinary product research assistant for a Philippine hog farm. The manager typed: "${q}". Research it the way internet veterinary sources describe it (manufacturer pages, Merck Veterinary Manual, drugs.com, Philippine agri-vet retailer listings) and reply with ONLY a compact JSON object (no markdown, no backticks):
{"found":true,"query":"${q}","genericName":"","summary":"","products":[{"name":"","brand":"","activeIngredient":"","type":"","form":"","pack":"","packQty":0,"packUnit":"","dosage":"","pricePhp":0,"priceNote":"","imageUrls":[{"url":"","note":""}],"sources":[{"title":"","url":""}]}]}
Rules:
- products: up to 4 DIFFERENT commercial products/brands matching "${q}" — Philippine trade names first when known (e.g. Iverjec, Bioran, Colamox), then international ones. If "${q}" is a generic ingredient (e.g. ivermectin, amoxicillin), list the common PH commercial brands of it. Do NOT restrict to any approved or vet-only list: any real product marketed for pigs, or whose active ingredient is used in pigs, qualifies.
- name = commercial product name; brand = brand/manufacturer (e.g. "Universal Harvester", "Zoetis"); activeIngredient = e.g. "Ivermectin 1% w/v".
- type: one of [Antibiotic, Antiparasitic / Dewormer, Vitamin & Mineral, Anti-inflammatory / NSAID, Hormone, Supportive / Oral rehydration, Vaccine / Biologic, Other].
- form: one of [Injection (vial), Oral solution, Powder/Sachet, Premix, Tablet, Capsule/Caplet, Other].
- pack = the most common sold pack, e.g. "100 ml bottle"; packQty = the numeric amount in that pack (100); packUnit = its unit (ml, g, dose, tablet, sachet…).
- dosage = one-line standard swine dosage + route (e.g. "1 ml per 50 kg BW, SC, repeat in 14 days").
- pricePhp = numeric Philippine farm-store price PER PACK, best estimate (0 if truly unknown); priceNote = human wording, e.g. "₱450 per 100 ml bottle (PH farm-store estimate)".
- imageUrls: up to 2 DIRECT https image URLs of the actual product pack that you are confident really resolve (manufacturer official first); otherwise [].
- sources: 1-3 real reference pages with full https URLs.
- genericName = the generic/active name for "${q}" (for photo fallback); summary = one sentence what it is.
- If "${q}" is not a real medicine/vaccine/vitamin product at all, reply {"found":false}.`;

  const parseJson = txt => {
    txt = String(txt || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const a = txt.indexOf('{'); if (a > 0) txt = txt.slice(a);
    const b = txt.lastIndexOf('}'); if (b > -1) txt = txt.slice(0, b + 1);
    return JSON.parse(txt);
  };

  async function askGemini(q, force) {
    const ck = 'g:' + q.toLowerCase();
    if (!force && aiCache[ck]) return aiCache[ck];
    let lastErr = 'no reply';
    for (const model of await modelCandidates()) {
      for (const grounded of [true, false]) {
        try {
          const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 16000);
          const body = {
            contents: [{ parts: [{ text: PROMPT(q) + (force ? '\nRegenerate a fresh answer (vary products/sources if possible).' : '') }] }],
            generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
          };
          if (grounded) body.tools = [{ google_search: {} }];
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(aiKey())}`, {
            method: 'POST', signal: ctl.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          clearTimeout(t);
          if (r.status === 403) throw { fatal: true, message: 'API key rejected (check the key in 🌐 manage)' };
          if (r.status === 400 && grounded) { lastErr = 'grounding unsupported — retrying plain'; continue; }
          if (r.status === 400) throw { fatal: true, message: 'API key not valid (re-paste it from aistudio.google.com/apikey)' };
          if (r.status === 429) { lastErr = 'busy — free quota momentarily full'; break; }
          if (!r.ok) { lastErr = 'http ' + r.status; continue; }
          const j = await r.json();
          const txt = ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('');
          const d = parseJson(txt);
          if (!d || d.found === false) return { found: false };
          aiCache[ck] = d; return d;
        } catch (e) {
          if (e && e.fatal) throw new Error(e.message);
          lastErr = (e && e.name === 'AbortError') ? 'timed out' : 'network';
        }
      }
    }
    throw new Error(lastErr);
  }

  /* keyless free engine so internet search works on a device with no key at all */
  async function askPollinations(q, force) {
    const ck = 'p:' + q.toLowerCase();
    if (!force && aiCache[ck]) return aiCache[ck];
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch('https://text.pollinations.ai/', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai', messages: [{ role: 'user', content: PROMPT(q) }] })
    });
    clearTimeout(t);
    if (!r.ok) throw new Error('keyless engine http ' + r.status);
    const d = parseJson(await r.text());
    if (!d || d.found === false) return { found: false };
    aiCache[ck] = d; return d;
  }

  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? u : null;

  /* real-photo fallback: Wikimedia Commons thumbnail of the generic ingredient
     (6 s cap — a hanging fetch must not hold the "looking for a photo…" box open) */
  function wikiThumb(q) {
    return Promise.race([
      (async () => {
        const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=640&format=json&origin=*`);
        if (!r.ok) return null;
        const j = await r.json();
        const p = ((j && j.query && j.query.pages) ? Object.values(j.query.pages) : [])[0];
        return (p && p.thumbnail && p.thumbnail.source) ? { url: p.thumbnail.source, note: 'Photo: Wikimedia Commons' } : null;
      })(),
      new Promise(res => setTimeout(() => res(null), 6000))
    ]).catch(() => null);
  }

  /* ── normalisation into the Add-medicine form's vocabulary ── */
  function normUnit(p) {
    const raw = String(p.packUnit || '').toLowerCase().trim();
    const map = { cc: 'ml', milliliter: 'ml', milliliters: 'ml', gram: 'g', grams: 'g', tablets: 'tablet', capsules: 'capsule', caplets: 'caplet', doses: 'dose', sachets: 'sachet', vial: 'bottle', vials: 'bottle', bottles: 'bottle', packs: 'pack', pieces: 'piece' };
    if (UNITS.includes(raw)) return raw;
    if (map[raw]) return map[raw];
    const all = `${p.form || ''} ${p.activeIngredient || ''} ${p.pack || ''}`.toLowerCase();
    if (/inject|vial|\bml\b|\bcc\b/.test(all)) return 'ml';
    if (/sachet|powder|premix/.test(all)) return 'g';
    if (/tablet|bolus/.test(all)) return 'tablet';
    if (/capsule|caplet/.test(all)) return 'caplet';
    if (/vaccin|dose/.test(all)) return 'dose';
    return 'piece';
  }
  function packQtyOf(p) {
    const n = parseFloat(p.packQty);
    if (isFinite(n) && n > 0) return n;
    const m = String(p.pack || '').match(/(\d+(?:\.\d+)?)\s*(ml|cc|g|grams?|milliliters?|tablets?|capsules?|caplets?|doses?|sachets?)/i);
    return m ? parseFloat(m[1]) : 0;
  }
  function normType(p) {
    const t = String(p.type || '').toLowerCase();
    const hit = TYPES.find(x => t && (x.toLowerCase() === t || t.includes(x.split(' / ')[0].toLowerCase().split(' ')[0]) || x.toLowerCase().split(' / ').some(w => t.includes(w.split(' ')[0]))));
    if (hit) return hit;
    const all = `${t} ${p.name || ''} ${p.activeIngredient || ''}`.toLowerCase();
    if (/vaccin|biologic/.test(all)) return 'Vaccine / Biologic';
    if (/antibiot|antibacter|penicillin|amox|cephalo|macrolide|tetracycline|sulfa|tylosin/.test(all)) return 'Antibiotic';
    if (/deworm|parasit|mange|lice|worm|ivermect/.test(all)) return 'Antiparasitic / Dewormer';
    if (/vitamin|mineral|\biron\b/.test(all)) return 'Vitamin & Mineral';
    if (/hormone|prostagland|estrus|oxytocin/.test(all)) return 'Hormone';
    if (/inflam|nsaid|\bpain\b|fever/.test(all)) return 'Anti-inflammatory / NSAID';
    if (/rehydrat|electrolyte|support|tonic/.test(all)) return 'Supportive / Oral rehydration';
    return 'Other';
  }
  function normForm(p) {
    const f = String(p.form || '');
    if (FORMS.includes(f)) return f;
    const all = `${f} ${p.pack || ''} ${p.dosage || ''}`.toLowerCase();
    if (/inject|vial/.test(all)) return 'Injection (vial)';
    if (/oral|drench|solution|suspension|syrup|water/.test(all)) return 'Oral solution';
    if (/sachet|powder/.test(all)) return 'Powder/Sachet';
    if (/premix/.test(all)) return 'Premix';
    if (/tablet|bolus/.test(all)) return 'Tablet';
    if (/capsule|caplet/.test(all)) return 'Capsule/Caplet';
    return 'Other';
  }
  const round2 = n => Math.round(n * 100) / 100;

  /* ── rendering ── */
  let lastRes = null; /* { q, d, wiki } */

  function productCardHTML(p, i, q) {
    const qty = packQtyOf(p), unit = normUnit(p);
    const price = parseFloat(p.pricePhp) || 0;
    const unitCost = price > 0 && qty > 0 ? round2(price / qty) : 0;
    const chips =
      (p.brand ? `<span class="med-chip">Brand: ${esc(p.brand)}</span>` : '') +
      `<span class="med-chip ghost">${esc(normType(p))}</span>` +
      `<span class="med-chip ghost">${esc(normForm(p))}</span>` +
      (p.activeIngredient ? `<span class="med-chip ghost">${esc(p.activeIngredient)}</span>` : '');
    const srcs = (Array.isArray(p.sources) ? p.sources : []).filter(s => s && safeUrl(s.url)).slice(0, 3);
    return `<article class="vet-result-card med-lib-card ai-card ai-prod"><div class="med-lib-head"><b>${esc(p.name || q)}</b><div class="med-chips">${chips}</div>` +
      `<small>${esc(p.summary || '')}</small></div><div class="vet-result-body">` +
      `<div class="med-img ai-img" id="aiProdImg${i}"><span class="muted">🖼 Looking for a product photo…</span></div>` +
      (p.activeIngredient ? `<section><h4>🧪 Active ingredient</h4><p>${esc(p.activeIngredient)}</p></section>` : '') +
      (p.dosage ? `<section><h4>💉 Swine dosage</h4><p>${esc(p.dosage)}</p></section>` : '') +
      `<section><h4>📦 Pack &amp; price</h4><p class="med-price ai-price">${esc(p.priceNote || (price ? `₱${price} per ${esc(p.pack || 'pack')}` : 'Price not available — set your supplier price below.'))}</p>` +
      (unitCost ? `<p class="ai-unit-cost">🧮 Auto cost per unit: <b>₱${unitCost.toFixed(2)} per ${esc(unit)}</b> <small class="muted">(₱${price} ÷ ${qty} ${esc(unit)})</small></p>` : '') +
      `</section>` +
      (srcs.length ? `<div class="med-live-links ai-src">${srcs.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)} ↗</a>`).join('')}</div>` : '') +
      `<div class="ai-actions"><button type="button" class="btn" onclick="useAiProduct(${i})">✓ Use this — add to inventory</button></div>` +
      `</div></article>`;
  }

  /* final=false: AI URLs only, keep the placeholder when none loads (the Wikimedia
     fallback may still arrive); final=true: nothing loaded → remove the box. */
  function paintProdImgs(d, final) {
    (d.products || []).forEach((p, i) => {
      const box = document.getElementById('aiProdImg' + i);
      if (!box) return;
      const cand = (Array.isArray(p.imageUrls) ? p.imageUrls : []).filter(x => x && safeUrl(x.url)).slice(0, 2);
      if (lastRes && lastRes.wiki) cand.push(lastRes.wiki);
      const tryNext = k => {
        if (!box.isConnected) return;
        if (k >= cand.length) { if (final) box.remove(); return; }
        const im = new Image();
        im.onload = () => {
          if (!box.isConnected) return;
          box.innerHTML = '';
          im.alt = 'Product reference photo';
          box.appendChild(im);
          box.insertAdjacentHTML('beforeend',
            '<small class="muted med-img-cap">📷 Reference photo from the internet — confirm the actual pack / label.</small>' +
            (cand[k].note ? '<small class="muted med-img-cap">📍 ' + esc(cand[k].note) + '</small>' : ''));
        };
        im.onerror = () => tryNext(k + 1);
        im.src = cand[k].url;
      };
      tryNext(0);
    });
  }

  async function runInternetSearch(q, force) {
    const out = document.getElementById('medResults'); if (!out) return;
    out.querySelectorAll('#aiProductsSec, .ai-loading, .ai-err').forEach(x => x.remove());
    out.insertAdjacentHTML('beforeend', `<div class="empty ai-loading">🌐 Searching the internet for “${esc(q)}” products — photo, brand, dosage, price…</div>`);
    let d = null, err = null;
    try {
      d = aiKey() ? await askGemini(q, force) : await askPollinations(q, force);
      if (d && d.found !== false && !(d.products || []).length) {
        /* a legacy-shaped single answer: wrap it so the chooser still shows */
        d.products = [Object.assign({}, d, { name: d.name || q, pack: d.pack || '', packQty: d.packQty || 0 })];
      }
    } catch (e) {
      if (aiKey()) { /* grounded engine failed — the keyless one still may work */
        try { d = await askPollinations(q, force); } catch (e2) { err = e2; }
      } else err = e;
    }
    out.querySelectorAll('.ai-loading').forEach(x => x.remove());
    if (err) {
      out.insertAdjacentHTML('beforeend', `<div class="form-error show ai-err">🌐 Internet product search failed (${esc(err.message || 'network')}). <button type="button" class="btn ghost small" onclick="aiRefresh(${jsq(q)})">⟳ Retry</button> · <a role="button" tabindex="0" onclick="openAiSetup()">manage engines</a></div>`);
      return;
    }
    if (!d || d.found === false || !(d.products || []).length) {
      out.insertAdjacentHTML('beforeend', `<div class="empty ai-err">🌐 The internet search found no real product matching “${esc(q)}”. Check the spelling, or try the generic name (e.g. “ivermectin”).</div>`);
      return;
    }
    const prods = d.products.slice(0, 4);
    lastRes = { q, d: Object.assign({}, d, { products: prods }), wiki: null };
    const sec = `<div id="aiProductsSec"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:14px 0 8px"><b style="color:var(--teal2)">🌐 Internet product results for “${esc(q)}” — ${prods.length} found · pick the one you buy</b><button type="button" class="btn ghost small" onclick="aiRefresh(${jsq(q)})">⟳ Refresh</button></div>` +
      (d.genericName || d.summary ? `<p class="muted" style="margin:0 0 8px">${esc(d.summary || '')}${d.genericName ? ` · generic: <b>${esc(d.genericName)}</b>` : ''}</p>` : '') +
      `<div class="vet-result-list">${prods.map((p, i) => productCardHTML(p, i, q)).join('')}</div>` +
      `<small class="muted">🌐 Pulled live from internet sources — prices are estimates; confirm against the product label and your supplier. Reference, not a prescription.</small></div>`;
    out.insertAdjacentHTML('beforeend', sec);
    /* photos: AI URLs first, Wikimedia thumbnail of the generic as the real-photo fallback */
    const my = lastRes;
    paintProdImgs(my.d, false);
    wikiThumb(d.genericName || q).then(w => {
      if (lastRes !== my) return; /* the user already searched something newer */
      my.wiki = w;
      paintProdImgs(my.d, true);
    });
  }

  /* ── the chooser: prefill the Add-medicine form, cost per unit auto-computed ── */
  function useAiProduct(i) {
    const p = lastRes && (lastRes.d.products || [])[i];
    if (!p || typeof openMedEditor !== 'function') return;
    const qty = packQtyOf(p), unit = normUnit(p);
    const price = parseFloat(p.pricePhp) || 0;
    const unitCost = price > 0 && qty > 0 ? round2(price / qty) : '';
    const srcs = (Array.isArray(p.sources) ? p.sources : []).filter(s => s && safeUrl(s.url)).slice(0, 2);
    const notes = [
      p.dosage ? 'Dosage: ' + p.dosage : '',
      p.priceNote ? 'Price ref: ' + p.priceNote : '',
      unitCost ? `Auto cost/unit: ₱${price} ÷ ${qty} ${unit} = ₱${Number(unitCost).toFixed(2)} per ${unit}` : '',
      srcs.length ? 'Sources: ' + srcs.map(s => s.url).join(' ') : '',
      '— 🌐 internet-fetched ' + new Date().toISOString().slice(0, 10) + '; confirm against the product label / veterinarian.'
    ].filter(Boolean).join('\n');
    openMedEditor(null, null, {
      item_name: p.name || lastRes.q, brand_name: p.brand || '', active_ingredient: p.activeIngredient || '',
      med_type: normType(p), form: normForm(p), unit, unit_cost: unitCost, supplier: p.brand || '', notes: notes
    });
    toast(unitCost
      ? `🧮 Cost per unit auto-computed: ₱${price} ÷ ${qty} ${unit} = ₱${Number(unitCost).toFixed(2)}/${unit} — adjust if your supplier price differs`
      : `📋 ${p.name || lastRes.q} prefilled — set your supplier's cost per unit`);
  }

  function aiRefresh(q) { runInternetSearch(q, true); }
  /* legacy hook (old single-card buttons) — now routes into the chooser */
  function aiAddToInv(q) {
    if (lastRes && lastRes.q === q && (lastRes.d.products || []).length) return useAiProduct(0);
    if (typeof openMedEditor === 'function') openMedEditor(null, null, q);
  }

  /* ── wrap the library name search: internet product search ALWAYS runs ── */
  const origSearch = window.medNameSearch;
  window.medNameSearch = async function () {
    await origSearch.apply(this, arguments);
    const q = ((document.getElementById('medNameInput') || {}).value || '').trim();
    if (q.length < 2) return;
    runInternetSearch(q, false);
  };

  /* refresh the status line after every render */
  const oldRender = window.renderAll;
  if (typeof oldRender === 'function') {
    window.renderAll = function () { (typeof oldRender === 'function' && oldRender()); injectAiStatus(); };
  }

  Object.assign(window, { openAiSetup, saveAiKey, aiRefresh, aiAddToInv, useAiProduct });
})();
