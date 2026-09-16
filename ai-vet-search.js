/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 195] js/ai-vet-search.js — the medicine search's internet UI.

   THE FARM ASKED (v243): "when I search a medicine or vaccine name, the system
   will search all over the internet and provide a formatted result… do not
   rely on those [flaky third-party engines / keys]."

   So the internet brain now lives on the farm's OWN domain: the Cloudflare
   worker route /ars-med (see _worker.js) merges DuckDuckGo live store
   listings (real ₱ prices + packs + label dosage), openFDA facts and a
   Wikipedia photo — key-free, CORS-free, edge-cached. This module only:

     1. asks the site's own /ars-med on EVERY name search;
     2. renders the 🌐 chooser: up to 4 product cards (photo · brand · active
        ingredient · type · form · swine dosage · pack · ₱ price · sources)
        with the auto cost-per-unit (₱pack price ÷ pack qty);
     3. "✓ Use this — add to inventory" opens the Add-medicine form prefilled,
        cost per unit already computed — the manager still chooses and edits;
     4. where no worker exists (static preview / plain hosting) it degrades to
        a direct Wikipedia card, and the built-in library above remains the
        offline floor. No API keys anywhere in this file.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsq = v => "'" + String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + "'";
  /* mirrored from medicine-inventory.js (its UNITS/TYPES/FORMS live in a closure) —
     prefills must use exactly these option values or the Add-medicine selects
     fall back to their first option. */
  const UNITS = ['ml', 'tablet', 'capsule', 'caplet', 'dose', 'sachet', 'g', 'pack', 'bottle', 'piece'];
  const TYPES = ['Antibiotic', 'Antiparasitic / Dewormer', 'Vitamin & Mineral', 'Anti-inflammatory / NSAID', 'Hormone', 'Supportive / Oral rehydration', 'Vaccine / Biologic', 'Other'];
  const FORMS = ['Injection (vial)', 'Oral solution', 'Powder/Sachet', 'Premix', 'Tablet', 'Capsule/Caplet', 'Other'];
  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? u : null;
  const round2 = n => Math.round(n * 100) / 100;

  /* ── normalisation into the Add-medicine form's vocabulary ── */
  function normUnit(p) {
    const raw = String(p.packUnit || '').toLowerCase().trim();
    const map = { cc: 'ml', milliliter: 'ml', milliliters: 'ml', gram: 'g', grams: 'g', mg: 'g', tablets: 'tablet', capsules: 'capsule', caplets: 'caplet', doses: 'dose', sachets: 'sachet', vial: 'bottle', vials: 'bottle', bottles: 'bottle', packs: 'pack', pieces: 'piece' };
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
    const t = String(p.type || '');
    if (TYPES.includes(t)) return t;
    const all = `${t} ${p.name || ''} ${p.activeIngredient || ''}`.toLowerCase();
    if (/vaccin|biologic/.test(all)) return 'Vaccine / Biologic';
    if (/antibiot|antibacter|penicillin|amox|cephalo|macrolide|tetracycline|sulfa|tylosin/.test(all)) return 'Antibiotic';
    if (/deworm|parasit|mange|lice|worm|ivermect|endectocide/.test(all)) return 'Antiparasitic / Dewormer';
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

  /* ── rendering: the chooser cards ── */
  let lastRes = null; /* { q, d, via } */

  /* [FIX 196] same clean reference card as the library — the format the farm
     showed us and asked for: name (+generic), brand, used-for, general dosage,
     Piglet/Sow/Boar, frequency, est. price, two buttons. Sources collapse to a
     single muted line; the photo is a small header thumb, not a big block. */
  function productCardHTML(p, i, q) {
    const qty = packQtyOf(p), unit = normUnit(p);
    const price = parseFloat(p.pricePhp) || 0;
    const unitCost = price > 0 && qty > 0 ? round2(price / qty) : 0;
    const line = (label, cls, val) => val ? `<p class="mc-line"><b class="${cls}">${label}:</b> ${esc(val)}</p>` : '';
    const gen = lastRes && lastRes.d.genericName ? String(lastRes.d.genericName) : '';
    const title = p.name || q;
    const srcs = (Array.isArray(p.sources) ? p.sources : []).filter(s => s && safeUrl(s.url)).slice(0, 2);
    return `<article class="vet-result-card med-clean-card"><div class="mc-head"><b>${esc(title)}${gen && !title.toLowerCase().includes(gen.toLowerCase()) ? ` <span class="mc-muted">(${esc(gen)})</span>` : ''}</b><span class="mc-thumb" id="aiProdImg${i}"></span><button type="button" class="mc-x" data-neo="flat" onclick="this.closest('.vet-result-card').remove()" aria-label="Dismiss card">×</button></div>` +
      `<div class="mc-body">` +
      (p.brand ? `<p class="mc-muted">Brand: ${esc(p.brand)}</p>` : '') +
      (p.activeIngredient ? `<p class="mc-line"><b>Active ingredient:</b> ${esc(p.activeIngredient)}</p>` : '') +
      `<p class="mc-line"><b>Used for:</b> ${esc(p.usedFor || p.summary || normType(p) + ' for swine.')}</p>` +
      line('General dosage', '', p.dosage) +
      line('Piglet', 'mc-cat piglet', p.piglet) +
      line('Sow', 'mc-cat sow', p.sow) +
      line('Boar', 'mc-cat boar', p.boar) +
      line('Frequency', '', p.frequency) +
      `<p class="mc-price">Est. Price: ${esc(p.priceNote || 'Not listed — set your supplier price')}</p>` +
      (unitCost ? `<p class="mc-unit">🧮 ≈ ${unitCost.toFixed(2)} per ${esc(unit)} (₱${price} ÷ ${qty} ${esc(unit)})</p>` : '') +
      `<div class="mc-actions"><button type="button" class="btn" onclick="useAiProduct(${i})">✓ Add to Inventory</button><button type="button" class="btn ghost" onclick="aiRefresh(${jsq(q)})">⟳ Refresh</button></div>` +
      (srcs.length ? `<p class="mc-src">Sources: ${srcs.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)} ↗</a>`).join(' · ')}</p>` : '') +
      `</div></article>`;
  }

  /* photo: per-product URLs first, then the shared reference photo */
  function paintProdImgs(d, final) {
    (d.products || []).forEach((p, i) => {
      const box = document.getElementById('aiProdImg' + i);
      if (!box) return;
      const cand = (Array.isArray(p.imageUrls) ? p.imageUrls : []).filter(x => x && safeUrl(x.url)).slice(0, 2);
      if (lastRes && lastRes.d && lastRes.d.photo) cand.push({ url: lastRes.d.photo, note: 'Photo: Wikimedia Commons' });
      const tryNext = k => {
        if (!box.isConnected) return;
        if (k >= cand.length) { if (final) box.remove(); return; }
        const im = new Image();
        im.onload = () => {
          if (!box.isConnected) return;
          box.innerHTML = '';
          im.alt = 'Product reference photo';
          box.appendChild(im); /* small header thumb — FIX 196 clean card */
        };
        im.onerror = () => tryNext(k + 1);
        im.src = cand[k].url;
      };
      tryNext(0);
    });
  }

  /* direct Wikipedia card for hosts without the worker (static preview etc.) */
  async function wikiDirect(q) {
    try {
      const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=1&prop=pageimages%7Cextracts&exintro=1&explaintext=1&exsentences=2&piprop=thumbnail&pithumbsize=640&format=json&origin=*`);
      if (!r.ok) return null;
      const j = await r.json();
      const p = ((j && j.query && j.query.pages) ? Object.values(j.query.pages) : [])[0];
      if (!p) return null;
      return { title: p.title, extract: p.extract || '', thumb: (p.thumbnail && p.thumbnail.source) || null, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(p.title).replace(/ /g, '_'))}` };
    } catch (e) { return null; }
  }

  async function runInternetSearch(q, force) {
    const out = document.getElementById('medResults'); if (!out) return;
    out.querySelectorAll('#aiProductsSec, .ai-loading, .ai-err').forEach(x => x.remove());
    out.insertAdjacentHTML('beforeend', `<div class="empty ai-loading">🌐 Searching the internet for “${esc(q)}” — store prices, facts, photo…</div>`);

    let d = null, via = '';
    /* 1 — the farm's own search server (Cloudflare worker): full pipeline */
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch('/ars-med?q=' + encodeURIComponent(q) + (force ? '&r=1' : ''), { signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) { const j = await r.json(); if (j && j.found !== false && (j.products || []).length) { d = j; via = '🛰 your site’s own internet search'; } }
    } catch (e) { /* no worker on this host — fall through */ }
    /* 2 — no worker (static preview / plain hosting): Wikipedia reference card */
    if (!d) {
      const w = await wikiDirect(q);
      if (w) {
        d = {
          found: true, query: q, genericName: w.title, summary: w.extract, photo: w.thumb,
          products: [{
            name: q, brand: '', activeIngredient: '', type: '', form: '', pack: '', packQty: 0, packUnit: '',
            dosage: '', pricePhp: 0,
            priceNote: 'Live store ₱ prices come from your site’s own search server — deploy this build to your Cloudflare domain to get them here.',
            imageUrls: [], sources: [{ title: w.title, url: w.url }]
          }]
        };
        via = '📖 Wikipedia reference (deploy to Cloudflare for live store prices)';
      }
    }

    out.querySelectorAll('.ai-loading').forEach(x => x.remove());
    if (!d) {
      out.insertAdjacentHTML('beforeend', `<div class="empty ai-err">🌐 No internet connection right now — the built-in library cards above still work offline. <button type="button" class="btn ghost small" onclick="aiRefresh(${jsq(q)})">⟳ Retry</button></div>`);
      return;
    }
    const prods = (d.products || []).slice(0, 4);
    lastRes = { q, d: Object.assign({}, d, { products: prods }), via };
    out.insertAdjacentHTML('beforeend',
      `<div id="aiProductsSec"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:14px 0 8px"><b style="color:var(--teal2)">🌐 Internet results for “${esc(q)}” — ${prods.length} found · pick the one you buy</b><button type="button" class="btn ghost small" onclick="aiRefresh(${jsq(q)})">⟳ Refresh</button></div>` +
      `<p class="muted" style="margin:0 0 8px">${esc(via)}${d.genericName ? ` · generic: <b>${esc(d.genericName)}</b>` : ''}${d.summary ? ` · ${esc(d.summary)}` : ''}</p>` +
      `<div class="vet-result-list">${prods.map((p, i) => productCardHTML(p, i, q)).join('')}</div>` +
      `<small class="muted">🌐 Pulled live from internet store listings &amp; references — prices are what the web says today; confirm against the label and your supplier. Reference, not a prescription.</small></div>`);
    const my = lastRes;
    paintProdImgs(my.d, false);
    if (my.d.photo) setTimeout(() => { if (lastRes === my) paintProdImgs(my.d, true); }, 50);
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

  /* status line inside the search panel */
  function injectAiStatus() {
    const d = document.querySelector('#medicine .vet-disclaimer');
    if (!d || document.getElementById('aiStatusLine')) return;
    d.insertAdjacentHTML('afterend',
      `<div id="aiStatusLine">🌐 Internet product search: <b class="ai-on">ON</b> — every name you type is looked up live (store ₱ prices · brand · dosage · photo) by your site’s own search server — no API keys needed.</div>`);
  }

  /* ── wrap the library name search: internet search ALWAYS runs ── */
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

  Object.assign(window, { aiRefresh, useAiProduct });
})();
