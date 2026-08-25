/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 67] js/ai-vet-search.js — AI live online lookup for the
   🔍 Medicine / Vaccine / Vitamin search (same behaviour as the original app).

   The built-in library now recognizes commercial brand names (Farrowsure,
   P.G. 600, Lutalyse, Dectomax, Baytril…) offline. For names it still
   misses, this module asks a Google AI Studio (Gemini) endpoint — a FREE key
   the farm owner generates once at aistudio.google.com/apikey — and renders
   the original-style card: Used for · General dosage · Piglet/Sow/Boar ·
   Frequency · Est. price ₱ · source links, with ✓ Add to Inventory and
   ⟳ Refresh.

   The key is saved on this device (localStorage) AND in the farm settings
   record so it syncs to the rest of the farm's devices/users — anyone with
   farm access can see it (same trade-off the original app made with a
   client-side key). Without a key everything still works; searches just stay
   library + Wikipedia + DailyMed.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const LS = 'ars-ai-key';
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsq = v => "'" + String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + "'";
  const aiKey = () => localStorage.getItem(LS) ||
    (typeof F === 'function' && F().settings && F().settings.aiKey) || '';
  /* [REBUILD FIX 68] never rely on one hardcoded model name — Google retires
     and renames them (live 404s). Discover what THIS key may actually call
     through the ListModels endpoint (CORS-open), prefer the newest
     flash-class names, and keep a static list as the last resort. Cached for
     the page session; reset whenever the key changes. */
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
    } catch (e) { /* offline or blocked — the static fallbacks below still apply */ }
    STATIC_MODELS.forEach(n => { if (!found.includes(n)) found.push(n); });
    modelList = found.slice(0, 6);
    return modelList;
  }
  const aiCache = {};

  function saveAiKey(k) {
    k = String(k || '').trim();
    if (k) localStorage.setItem(LS, k); else localStorage.removeItem(LS);
    modelList = null; Object.keys(aiCache).forEach(x => delete aiCache[x]); /* FIX 68: re-discover models for the new key */
    if (typeof F === 'function') {
      F().settings = F().settings || {};
      F().settings.aiKey = k;
      if (typeof save === 'function') save(); /* rides the normal farm sync */
    }
    document.getElementById('aiKeyModal')?.remove();
    if (typeof renderAll === 'function') renderAll();
    if (typeof toast === 'function') toast(k ? '✨ AI online lookup enabled — searching the internet for any brand now' : 'AI online lookup turned OFF (library + Wikipedia + DailyMed still work)');
  }

  /* ── setup modal ── */
  function openAiSetup() {
    document.getElementById('aiKeyModal')?.remove();
    const cur = aiKey();
    document.body.insertAdjacentHTML('beforeend',
      `<div class="due-modal-bg" id="aiKeyModal"><div class="reminder-modal perf-modal ai-setup-modal"><div class="modal-top"><h2>✨ AI online lookup</h2><button type="button" class="close-reminder" onclick="document.getElementById('aiKeyModal').remove()">×</button></div>` +
      `<p class="perf-sub">Gives the medicine search the same superpower as the original app: type <b>any commercial brand</b> — Farrowsure, Naxcel, Draxxin, a feed-store trade name — and a live AI lookup fetches its usage, dosage per pig class, frequency and indicative price from internet veterinary sources, in seconds.</p>` +
      `<div class="reminder-fields">` +
      `<div class="field full"><label>Google AI Studio API key ${cur ? '(saved)' : '(free)'}</label><input id="aiKeyInput" type="password" autocomplete="off" placeholder="AIza…" value="${esc(cur)}"><small class="field-hint">Get a free key in 1 minute: aistudio.google.com/apikey → “Create API key”. Saved on this device and in your farm settings (syncs to this farm's other devices/users — anyone with access to this farm can see it). The app never sends farm data with it — only the product name you search.</small></div>` +
      `</div><div class="due-actions" style="margin-top:16px">` +
      (cur ? `<button type="button" class="btn ghost" onclick="saveAiKey('')">Remove key</button>` : '') +
      `<button type="button" class="btn ghost" onclick="document.getElementById('aiKeyModal').remove()">Close</button>` +
      `<button class="btn" onclick="saveAiKey(document.getElementById('aiKeyInput').value)">Save &amp; enable AI lookup</button></div></div></div>`);
  }

  /* tiny status line inside the search panel (teaser when OFF) */
  function injectAiStatus() {
    const d = document.querySelector('#medicine .vet-disclaimer');
    if (!d || document.getElementById('aiStatusLine')) return;
    d.insertAdjacentHTML('afterend',
      `<div id="aiStatusLine">✨ AI online lookup: ${aiKey()
        ? `<b class="ai-on">ON</b> — unknown brands get a live AI card automatically · <a role="button" tabindex="0" onclick="openAiSetup()" onkeydown="if(event.key==='Enter')openAiSetup()">manage</a>`
        : `<b>OFF</b> — <button type="button" class="ai-nudge-btn" onclick="openAiSetup()">🔑 Enable free AI lookup</button> so brand names like <i>Farrowsure</i> or <i>P.G. 600</i> are fetched from the internet`}</div>`);
  }

  /* ── the live lookup ── */
  const PROMPT = q => `You are a swine veterinary reference assisting a Philippine hog farm manager. Identify the medicine / vaccine / vitamin product or active ingredient "${q}". Reply with ONLY a compact JSON object (no markdown, no backticks) with exactly these keys:
{"found":true,"name":"","brand":"","activeIngredient":"","usedFor":"","generalDosage":"","piglet":"","sow":"","boar":"","frequency":"","pricePhp":"","sources":[{"title":"","url":""}],"imageUrls":[{"url":"","note":""}]}
Rules: usedFor = 1-2 short sentences (include the manufacturer in parentheses, e.g. (Zoetis)). generalDosage = the standard dose + route. piglet / sow / boar = the dosing & usage instruction for that class; write "Not indicated for piglets…" style text where the product is not for that class. frequency = dosing schedule / booster interval. pricePhp = a typical PHILIPPINE farm-store price estimate in pesos (e.g. "₱140 per dose") — estimate only. sources = 2-4 real veterinary reference pages (manufacturer product page, drugs.com/vet, Merck Vet Manual, reputable vet services) with full https URLs. imageUrls = up to 3 DIRECT https image URLs showing the actual product / pack (prefer the manufacturer official image first, then a reputable retailer product photo, then a Wikimedia Commons photo of the active ingredient); include ONLY image URLs you are confident really resolve - otherwise return an empty list. note credits the source, e.g. "Photo: Zoetis official product page". If "${q}" is not a real swine medicine/vaccine/vitamin or you are not confident, reply {"found":false}.`;

  async function askGemini(q, force) {
    const ck = q.toLowerCase();
    if (!force && aiCache[ck]) return aiCache[ck];
    let lastErr = 'no reply';
    for (const model of await modelCandidates()) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 14000);
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(aiKey())}`, {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT(q) + (force ? '\nRegenerate a fresh answer (vary sources if possible).' : '') }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } })
        });
        clearTimeout(t);
        if (r.status === 403) throw { fatal: true, message: 'API key rejected (check the key in ✨ setup)' };
        if (r.status === 400) throw { fatal: true, message: 'API key not valid (re-paste it from aistudio.google.com/apikey)' };
        if (r.status === 429) { lastErr = 'busy — free quota momentarily full'; continue; }
        if (!r.ok) { lastErr = 'http ' + r.status; continue; }
        const j = await r.json();
        let txt = ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('');
        txt = txt.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
        const start = txt.indexOf('{'); if (start > 0) txt = txt.slice(start);
        const d = JSON.parse(txt);
        if (!d || d.found === false) return { found: false };
        aiCache[ck] = d; return d;
      } catch (e) {
        if (e && e.fatal) throw new Error(e.message);
        lastErr = (e && e.name === 'AbortError') ? 'timed out' : 'network';
      }
    }
    throw new Error(lastErr);
  }

  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? u : null;

  function aiCardHTML(d, q) {
    const chips = `<span class="med-chip ai-chip-live">✨ live AI lookup</span>` +
      (d.brand ? `<span class="med-chip">Brand: ${esc(d.brand)}</span>` : '') +
      (d.activeIngredient ? `<span class="med-chip ghost">${esc(d.activeIngredient)}</span>` : '');
    const srcs = (Array.isArray(d.sources) ? d.sources : []).filter(s => s && safeUrl(s.url)).slice(0, 4);
    return `<article class="vet-result-card med-lib-card ai-card"><div class="med-lib-head"><b>${esc(d.name || q)}</b><div class="med-chips">${chips}</div><small>Fetched live from internet veterinary sources — confirm against the product label.</small></div>` +
      `<div class="vet-result-body">` +
      ((d.imageUrls || []).filter(x => x && safeUrl(x.url)).length ? `<div class="med-img ai-img" id="aiImgBox"><span class="muted">🖼 Loading reference image…</span></div>` : '') +
      `<section><h4>📋 Used for</h4><p>${esc(d.usedFor || '—')}</p></section>` +
      `<section><h4>💉 General dosage</h4><p>${esc(d.generalDosage || '—')}</p></section>` +
      `<section class="ai-doses"><h4>🐷 Dosage by class</h4>` +
      `<p><b class="ai-cat piglet">Piglet:</b> ${esc(d.piglet || '—')}</p>` +
      `<p><b class="ai-cat sow">Sow:</b> ${esc(d.sow || '—')}</p>` +
      `<p><b class="ai-cat boar">Boar:</b> ${esc(d.boar || '—')}</p></section>` +
      (d.frequency ? `<section><h4>🔁 Frequency</h4><p>${esc(d.frequency)}</p></section>` : '') +
      (d.pricePhp ? `<p class="med-price ai-price">Est. Price: ${esc(d.pricePhp)}</p><small class="muted">AI estimate — always confirm the current price with your supplier.</small>` : '') +
      (srcs.length ? `<div class="med-live-links ai-src">${srcs.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)} ↗</a>`).join('')}</div>` : '') +
      `<div class="ai-actions"><button type="button" class="btn" onclick="aiAddToInv(${jsq(q)})">✓ Add to Inventory</button><button type="button" class="btn ghost" onclick="aiRefresh(${jsq(q)})">⟳ Refresh</button></div>` +
      `<small class="muted ai-note">✨ Generated live by AI — double-check dosage and use with a licensed veterinarian before treating.</small>` +
      `</div></article>`;
  }

  /* [REBUILD FIX 70] visual reference image on the AI card: tries up to 3 URLs
     the AI returned (best first); silently removes the box when none loads. */
  function paintAiImgs(d) {
    const box = document.getElementById('aiImgBox');
    if (!box) return;
    const cand = (Array.isArray(d.imageUrls) ? d.imageUrls : []).filter(x => x && safeUrl(x.url)).slice(0, 3);
    if (!cand.length) { box.remove(); return; }
    const tryNext = i => {
      if (!box.isConnected) return;
      if (i >= cand.length) { box.remove(); return; }
      const im = new Image();
      im.onload = () => {
        if (!box.isConnected) return;
        box.innerHTML = '';
        im.alt = 'Reference image';
        box.appendChild(im);
        box.insertAdjacentHTML('beforeend',
          '<small class="muted med-img-cap">📷 Reference image fetched from the internet — always confirm the actual product pack / label.</small>' +
          (cand[i].note ? '<small class="muted med-img-cap">📍 ' + esc(cand[i].note) + '</small>' : ''));
      };
      im.onerror = () => tryNext(i + 1);
      im.src = cand[i].url;
    };
    tryNext(0);
  }

  async function runAiLookup(q, force) {
    const out = document.getElementById('medResults'); if (!out) return;
    out.querySelectorAll('.ai-loading, .ai-err').forEach(x => x.remove());
    out.insertAdjacentHTML('beforeend', `<div class="empty ai-loading">✨ Asking the AI about “${esc(q)}” — fetching live internet sources…</div>`);
    try {
      const d = await askGemini(q, force);
      out.querySelectorAll('.ai-loading').forEach(x => x.remove());
      if (d && d.found !== false) {
        out.innerHTML = aiCardHTML(d, q);
        paintAiImgs(d);
      } else {
        out.insertAdjacentHTML('beforeend', `<div class="empty ai-err">✨ The AI does not recognize “${esc(q)}” as a swine medicine / vaccine / vitamin — the built-in references above still apply.</div>`);
      }
    } catch (e) {
      out.querySelectorAll('.ai-loading').forEach(x => x.remove());
      out.insertAdjacentHTML('beforeend', `<div class="form-error show ai-err">✨ AI lookup failed (${esc(e.message || 'network')}). Check the key under ✨ AI online lookup, or use the built-in references above.</div>`);
    }
  }

  function aiRefresh(q) { runAiLookup(q, true); }
  /* ═══ [REBUILD FIX 69] prefill the whole Add-medicine form from the card ═══ */
  function aiGuess(d) {
    const t = [d.generalDosage, d.pricePhp, d.sow, d.piglet, d.boar, d.frequency, d.usedFor, d.name, d.activeIngredient, d.brand].join(' ').toLowerCase();
    const unit = /caplet/.test(t) ? 'caplet' : /bolus|\btablet/.test(t) ? 'tablet' : /capsule/.test(t) ? 'capsule'
      : /sachet/.test(t) ? 'sachet' : /(^|[\d\s])g\b|\bgram/.test(t) ? 'g'
      : /\bml\b|\bcc\b|milliliter|injection|\binject|\bim\b|\biv\b|\bsc\b/.test(t) ? 'ml'
      : /vial|bottle/.test(t) ? 'bottle' : /dose/.test(t) ? 'dose' : 'piece';
    const form = ['caplet', 'capsule'].includes(unit) ? 'Capsule/Caplet'
      : unit === 'tablet' ? 'Tablet' : unit === 'sachet' || unit === 'g' ? 'Powder/Sachet'
      : /oral|drench|drink|water|solution|suspension|syrup/.test(t) ? 'Oral solution'
      : unit === 'ml' || unit === 'bottle' || unit === 'dose' ? 'Injection (vial)' : 'Other';
    const type = /vaccin/.test(t) ? 'Vaccine / Biologic'
      : /antibiotic|antibacter|penicillin|cephalosporin|macrolide|tetracycline|sulfa|amox|tylosin/.test(t) ? 'Antibiotic'
      : /deworm|anthelmintic|parasite|mange|lice|worm/.test(t) ? 'Antiparasitic / Dewormer'
      : /vitamin|mineral|\biron\b/.test(t) ? 'Vitamin & Mineral'
      : /hormone|prostaglandin|estrus|oestrus|heat sync|oxytocin|gonadotroph/.test(t) ? 'Hormone'
      : /anti-inflammatory|nsaid|\bpain\b|\bfever\b|analges/.test(t) ? 'Anti-inflammatory / NSAID'
      : /herbal|supplement|tonic|rehydrat|electrolyte|support/.test(t) ? 'Supportive / Oral rehydration' : 'Other';
    const cost = (String(d.pricePhp || '').match(/(\d+(?:\.\d+)?)/) || [])[1];
    return { unit, form, type, cost };
  }

  function aiAddToInv(q) {
    const d = aiCache[String(q || '').toLowerCase()];
    if (!d || typeof openMedEditor !== 'function') {
      if (typeof openMedEditor === 'function') openMedEditor(null, null, (d && d.name) || q);
      return;
    }
    const g = aiGuess(d);
    const notes = [
      d.usedFor ? 'Used for: ' + d.usedFor : '',
      d.generalDosage ? 'Dosage: ' + d.generalDosage : '',
      d.piglet ? 'Piglet: ' + d.piglet : '',
      d.sow ? 'Sow: ' + d.sow : '',
      d.boar ? 'Boar: ' + d.boar : '',
      d.frequency ? 'Frequency: ' + d.frequency : '',
      '— ✨ AI-fetched ' + new Date().toISOString().slice(0, 10) + '; confirm against the product label / veterinarian.'
    ].filter(Boolean).join('\n');
    openMedEditor(null, null, {
      item_name: d.name || q, brand_name: d.brand || '', active_ingredient: d.activeIngredient || '',
      med_type: g.type, form: g.form, unit: g.unit, unit_cost: g.cost ? +g.cost : '', notes
    });
  }

  /* ── wrap the library name search: on a miss, fall through to the AI ── */
  const origSearch = window.medNameSearch;
  window.medNameSearch = async function () {
    await origSearch.apply(this, arguments);
    const out = document.getElementById('medResults');
    if (!out || !document.getElementById('medLiveU')) return; /* library hit — no AI needed */
    const q = ((document.getElementById('medNameInput') || {}).value || '').trim();
    if (q.length < 2) return;
    if (!aiKey()) {
      out.insertAdjacentHTML('beforeend', `<div class="ai-nudge">✨ Not in the built-in library. <b>Want it fetched live from the internet like the old app?</b> <button type="button" class="ai-nudge-btn" onclick="openAiSetup()">🔑 Enable free AI lookup</button> — set it up once with a free Google AI Studio key.</div>`);
      return;
    }
    runAiLookup(q, false);
  };

  /* refresh the status line after every render */
  const oldRender = window.renderAll;
  if (typeof oldRender === 'function') {
    window.renderAll = function () { (typeof oldRender === 'function' && oldRender()); injectAiStatus(); };
  }

  Object.assign(window, { openAiSetup, saveAiKey, aiRefresh, aiAddToInv });
})();