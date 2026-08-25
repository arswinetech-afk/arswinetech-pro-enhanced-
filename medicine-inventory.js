/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FEATURE] js/medicine-inventory.js — Medicine & Treatments module.

   Replaces the stubbed "Manage inventory" screen of the original app with:
     1. Full CRUD — add / edit / save / delete farm-scoped medicines (name,
        brand, ingredient, type, form, unit, stock qty, min threshold, cost,
        expiry, supplier, notes).
     2. "🔍 Medicine / Vaccine / Vitamin Search" — name lookup against the
        built-in swine veterinary library (js/vet-library.js) with live
        internet enrichment (Wikipedia REST) + outbound Merck / DailyMed links.
     3. "🩺 Signs / Symptoms Search" — describe observed signs; get medicine
        suggestions with dosage for the selected pig type & age group, plus the
        original trusted-reference article search underneath (runVetSearch).
     4. Stock synchronization — every recorded treatment (against a sow, piglet
        batch, boar or the whole herd) automatically deducts the used quantity
        (ml / tablet / caplet / dose / sachet / g …) from that medicine's stock,
        plus restock / edit adjustments. A movement ledger keeps the full audit
        trail per medicine.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /* safe single-arg quoting for onclick="fn(${jsq(id)})" inside double-quoted
     attributes: single quotes are JS-escaped, double quotes HTML-escaped. */
  const jsq = v => "'" + String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + "'";
  const pesoFmt = n => '₱' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-PH');
  const round2 = n => Math.round(n * 100) / 100;
  const today = () => new Date().toISOString().slice(0, 10);
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const meds = () => (F().medicines = Array.isArray(F().medicines) ? F().medicines : []);
  const moves = () => (F().med_movements = Array.isArray(F().med_movements) ? F().med_movements : []);
  const findMed = id => meds().find(m => m.id === id);
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;

  const UNITS = ['ml', 'tablet', 'capsule', 'caplet', 'dose', 'sachet', 'g', 'pack', 'bottle', 'piece'];
  const TYPES = ['Antibiotic', 'Antiparasitic / Dewormer', 'Vitamin & Mineral', 'Anti-inflammatory / NSAID', 'Hormone', 'Supportive / Oral rehydration', 'Vaccine / Biologic', 'Other'];
  const FORMS = ['Injection (vial)', 'Oral solution', 'Powder/Sachet', 'Premix', 'Tablet', 'Capsule/Caplet', 'Other'];
  const KIND_ICON = { initial: '➕', restock: '📦', treatment: '💉', adjust: '⚖️', deletion: '🗑' };
  const KIND_LABEL = { initial: 'Initial stock', restock: 'Restock', treatment: 'Treatment', adjust: 'Stock adjustment', deletion: 'Removed from inventory' };

  /* ── inventory helpers ─────────────────────────────────────────────── */
  function stockStatus(m) {
    const q = +m.stock_quantity || 0;
    if (q <= 0) return 'Out of Stock';
    if (+m.minimum_stock_threshold > 0 && q <= +m.minimum_stock_threshold) return 'Low Stock';
    return 'Sufficient';
  }
  const statusClass = s => 'stock-' + s.toLowerCase().replace(/\s+/g, '-');

  function expiryInfo(m) {
    if (!m.expiry_date) return null;
    const daysLeft = Math.round((new Date(m.expiry_date + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5);
    if (daysLeft < 0) return { label: '⚠ Expired ' + m.expiry_date, cls: 'expired' };
    if (daysLeft <= 60) return { label: '⚠ Expires ' + m.expiry_date + ' (' + daysLeft + ' d)', cls: 'expiring' };
    return { label: 'Expires ' + m.expiry_date, cls: '' };
  }

  function logMove(m, kind, delta, note, extra = {}) {
    moves().unshift(Object.assign({
      id: newId('mv-'), med_id: m.id, item_name: m.item_name, kind,
      delta: round2(delta), qty_after: round2(m.stock_quantity),
      unit: m.unit, date: today(), at: new Date().toISOString(), note: note || ''
    }, extra));
  }

  /* library match for a stocked medicine (for dose hints inside forms) */
  function libMatch(name, active) {
    if (!window.VetLib) return null;
    const q = String(active || name || '').trim();
    if (q.length < 2) return null;
    return VetLib.byName(q)[0] || null;
  }

  /* ── page render ───────────────────────────────────────────────────── */
  function medPage() {
    const el = document.getElementById('medicine');
    if (!el) return;

    const invContainer = document.getElementById('medInventoryContainer');
    const recentContainer = document.getElementById('medRecentContainer');

    // If search panel is already present in DOM, update only the inventory & recent movements without wiping search results!
    if (invContainer && recentContainer) {
      invContainer.innerHTML = inventoryHTML();
      recentContainer.innerHTML = recentHTML();
      return;
    }

    el.innerHTML = searchPanelHTML() + `<div id="medInventoryContainer">${inventoryHTML()}</div>` + `<div id="medRecentContainer">${recentHTML()}</div>`;
  }

  function clearMedSearch() {
    const nameInp = document.getElementById('medNameInput');
    const symInp = document.getElementById('vetSymptoms');
    if (nameInp) nameInp.value = '';
    if (symInp) symInp.value = '';
    const out1 = document.getElementById('medResults');
    const out2 = document.getElementById('vetResults');
    if (out1) out1.innerHTML = '';
    if (out2) out2.innerHTML = '';
  }
  window.clearMedSearch = clearMedSearch;

  function searchPanelHTML() {
    return `<div class="section-head"><div><div class="eyebrow">MEDICINE & TREATMENTS</div><h2>Medicine &amp; Veterinary reference search</h2><p>Search the swine veterinary library by medicine name or by observed signs — enriched with live internet sources when you are online. Reference information is not a diagnosis or prescription.</p></div></div>` +
    `<div class="panel medicine-search">` +
      `<div class="med-tabs" role="tablist">` +
        `<button type="button" class="med-tab active" id="medTabName" onclick="medTab('name')">🔍 Medicine / Vaccine / Vitamin Search</button>` +
        `<button type="button" class="med-tab" id="medTabSym" onclick="medTab('sym')">🩺 Signs / Symptoms Search</button>` +
      `</div>` +
      `<div id="medPaneName">` +
        `<div class="field"><label>Medicine, vaccine, or vitamin name</label><input id="medNameInput" autocomplete="off" placeholder="e.g. amoxicillin, ivermectin, jectran, baytril, draxxin, farrowsure, p.g. 600" onkeydown="if(event.key==='Enter')medNameSearch()"></div>` +
        `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn" onclick="medNameSearch()">🔍 Search medicine / vaccine / vitamin</button><button type="button" class="btn ghost small" onclick="clearMedSearch()">✕ Clear</button></div>` +
      `</div>` +
      `<div id="medPaneSym" style="display:none">` +
        `<div class="field"><label>Describe the observed signs / symptoms</label><textarea id="vetSymptoms" placeholder="e.g. pale weak piglets with rough haircoat, sow with no milk after farrowing, pagtatae, ubo, galis"></textarea></div>` +
        `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn" onclick="medSymptomSearch()">🩺 Search clinical suggestions</button><button type="button" class="btn ghost small" onclick="clearMedSearch()">✕ Clear</button></div>` +
      `</div>` +
      `<div class="med-grid" style="margin-top:12px"><div class="field"><label>Animal type (dosage guidance)</label><select id="vetAnimal"><option value="piglet">Piglet</option><option value="sow">Sow</option><option value="lactating sow">Farrowed / Lactating Sow</option><option value="boar">Boar</option><option value="grower">Grower / Finisher</option></select></div><div class="field"><label>Piglet age group</label><select id="vetAge"><option value="">Not applicable</option><option>Newborn</option><option>7–21 days</option><option>Weaned</option><option>Grower</option></select></div></div>` +
      `<div class="vet-disclaimer">Veterinary suggestions are reference only. Final diagnosis and treatment decisions must be confirmed by a licensed veterinarian.</div>` +
      `<div id="medResults"></div>` +
      `<div id="vetResults"></div>` +
    `</div>`;
  }

  /* live-inventory helpers shared by both searches */
  function stockedMatchesFor(entry) {
    const keys = [entry.name, entry.active, ...(entry.aliases || [])].map(s => String(s).toLowerCase());
    return meds().filter(m => {
      const hay = `${m.item_name || ''} ${m.brand_name || ''} ${m.active_ingredient || ''}`.toLowerCase();
      return keys.some(k => k && k.length > 2 && (hay.includes(k) || k.includes(String(m.item_name || '').toLowerCase())));
    });
  }

  function liveStockBlock(entry) {
    const m = stockedMatchesFor(entry)[0];
    if (!m) return `<div class="med-live-stock">📦 <b>Not in your inventory.</b> <button type="button" class="btn ghost med-mini-btn" onclick="openMedEditor(null,${jsq(entry.key)})">＋ Add to inventory</button></div>`;
    const st = stockStatus(m);
    return `<div class="med-live-stock">📦 <b>In inventory:</b> <span class="${statusClass(st)}">${st} · ${round2(m.stock_quantity)} ${esc(m.unit)} left</span>` +
      `<button type="button" class="btn ghost med-mini-btn" onclick="openMedTreatment(${jsq(m.id)})">💉 Record treatment</button>` +
      `<button type="button" class="btn ghost med-mini-btn" onclick="openRestock(${jsq(m.id)})">＋ Restock</button></div>`;
  }

  function doseTableHTML(entry) {
    const bucket = VetLib.ageGroupKey(document.getElementById('vetAnimal')?.value, document.getElementById('vetAge')?.value);
    const rows = VetLib.DOSE_ORDER.filter(k => entry.doses && entry.doses[k]).map(k =>
      `<div class="med-dose-row${k === bucket || (bucket === 'piglet' && k === 'nursery') ? ' focus' : ''}"><span>${VetLib.ANIMAL_LABELS[k]}</span><b>${esc(entry.doses[k])}</b></div>`).join('');
    return `<div class="med-dose-box"><b>💉 Dosage — ${VetLib.ANIMAL_LABELS[bucket] || 'selected group'}:</b> <span class="med-dose-focus">${esc(VetLib.doseFor(entry, bucket))}</span><div class="med-dose-rows">${rows}</div></div>`;
  }

  function libCardHTML(entry, i) {
    const chips = `<span class="med-chip">${esc(entry.typeMed || entry.type)}</span><span class="med-chip ghost">${esc(entry.form)}</span><span class="med-chip ghost">${esc(entry.unit)}</span>`;
    return `<article class="vet-result-card med-lib-card"><div class="med-lib-head"><b>${esc(entry.name)}</b><div class="med-chips">${chips}</div><small>${esc(entry.active)}</small></div>` +
      `<div class="vet-result-body">` +
        `<div class="med-img" id="medImg${i}"></div>` +
        `<section><h4>💊 Usage</h4><p>${esc(entry.usage)}</p></section>` +
        `<section><h4>💉 Dosage by pig type &amp; age</h4>${doseTableHTML(entry)}<p class="muted med-route">📍 Route: ${esc(entry.route)} &nbsp;·&nbsp; 🥩 Withdrawal: ${esc(entry.withdrawal)}</p></section>` +
        `<section><h4>💰 Indicative price (PH farm store)</h4><p class="med-price">${esc(entry.price)}</p><small class="muted">Indicative range only — confirm current prices with your supplier.</small></section>` +
        `${liveStockBlock(entry)}` +
        `<div class="med-live" id="medLive${i}"><span class="muted">🌐 Checking live internet sources…</span></div><div class="med-live" id="medDm${i}"></div>` +
        `<section><small class="muted">Reference: ${esc(entry.source)}</small></section>` +
      `</div></article>`;
  }

  async function medNameSearch() {
    const input = document.getElementById('medNameInput'), out = document.getElementById('medResults');
    const q = (input?.value || '').trim();
    document.getElementById('vetResults').innerHTML = '';
    if (q.length < 2) { out.innerHTML = '<div class="form-error show">Enter at least two characters to search.</div>'; return; }
    out.innerHTML = '<div class="empty">Searching the swine veterinary library…</div>';
    const hits = VetLib.byName(q);
    out.innerHTML = hits.length
      ? `<div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 8px 0"><b style="color:var(--teal2)">🔍 Found ${hits.length} matching veterinary products</b><button type="button" class="btn ghost small" onclick="clearMedSearch()">✕ Clear Results</button></div><div class="vet-result-list">${hits.slice(0, 12).map((x, i) => libCardHTML(x, i)).join('')}</div>`
      : `<div class="empty">“${esc(q)}” is not in the built-in swine library.</div>`;
    /* live internet enrichment */
    hits.slice(0, 12).forEach((x, i) => { hydrateLive('medLive' + i, x.wiki || x.name.split('(')[0].trim()); hydrateDailyMed('medDm' + i, x.active || x.name.split('(')[0].trim()); });
    if (!hits.length) {
      out.insertAdjacentHTML('beforeend',
        `<div class="vet-result-list"><article class="vet-result-card med-lib-card"><div class="med-lib-head"><b>${esc(q)}</b><div class="med-chips"><span class="med-chip ghost">online lookup</span></div><small>Not found in the built-in library — live internet information below if available.</small></div>` +
        `<div class="vet-result-body"><div class="med-img" id="medImgU"></div><div class="med-live" id="medLiveU"><span class="muted">🌐 Checking live internet sources…</span></div><div class="med-live" id="medDmU"></div>` +
        `<div class="med-live-stock">📦 <b>Track it in your inventory anyway?</b> <button type="button" class="btn ghost med-mini-btn" onclick="openMedEditor(null,null,${jsq(q)})">＋ Add “${esc(q)}” to inventory</button></div>` +
        `<section><small class="muted">Always confirm label dosage with a licensed veterinarian.</small></section></div></article></div>`);
      hydrateLive('medLiveU', q); hydrateDailyMed('medDmU', q);
    }
  }

  function medSymptomSearch() {
    const symptoms = document.getElementById('vetSymptoms').value.trim(), out = document.getElementById('medResults');
    if (symptoms.length < 2) {
      out.innerHTML = '<div class="form-error show">Enter at least two characters to search.</div>';
      document.getElementById('vetResults').innerHTML = '';
      return;
    }
    const animal = document.getElementById('vetAnimal').value, age = document.getElementById('vetAge').value;
    const bucket = VetLib.ageGroupKey(animal, age);
    const sugg = VetLib.bySymptoms(symptoms, animal, age);
    const dis = (VetLib.matchDiseases ? VetLib.matchDiseases(symptoms) : []);
    let html = diseaseBlockHTML(dis, bucket);
    if (sugg.length) {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px 0"><div class="med-suggest-head" style="margin:0"><b>💊 Suggested medicines for ${VetLib.ANIMAL_LABELS[bucket]} (${sugg.length} matches)</b><small class="muted" style="display:block">Matched against observed signs · verify with licensed veterinarian</small></div><button type="button" class="btn ghost small" onclick="clearMedSearch()">✕ Clear Results</button></div>`;
      html += '<div class="vet-result-list">' + sugg.map((r, i) => {
        const entry = r.entry;
        return `<article class="vet-result-card med-lib-card"><div class="med-lib-head"><b>${esc(entry.name)}</b><div class="med-chips"><span class="med-chip">${esc(entry.typeMed || entry.type)}</span><span class="med-chip ghost">${esc(entry.unit)}</span></div><small>${esc(entry.active)} · ${esc(entry.price)}</small></div>` +
          `<div class="vet-result-body"><section><h4>💉 Suggested dosage — ${VetLib.ANIMAL_LABELS[bucket]}</h4><div class="med-dose-box"><span class="med-dose-focus">${esc(r.dose)}</span></div><p class="muted med-route">📍 ${esc(entry.route)} · 🥩 Withdrawal: ${esc(entry.withdrawal)}</p><p>${esc(entry.usage)}</p></section>${liveStockBlock(entry)}</div></article>`;
      }).join('') + '</div>';
    } else {
      html += '<div class="empty">No direct library match for these signs — see the trusted reference articles below, and consult a licensed veterinarian.</div>';
    }
    out.innerHTML = html;
    dis.forEach((d, i) => hydrateLive('medDisLive' + i, d.wiki));
    /* keep the original trusted-reference article search (runs online in production,
       offline demo library in the rebuild) below the medicine suggestions */
    if (typeof runVetSearch === 'function') runVetSearch();
  }


  /* ═══ [REBUILD FIX 66] likely-condition cards for the symptoms search ═══ */
  function diseaseBlockHTML(dis, bucket) {
    if (!dis || !dis.length) return '';
    const cards = dis.map((d, i) => {
      const meds = (d.meds || []).map(m => {
        const e = VetLib.LIB.find(x => x.key === m.k);
        return e ? `<li><b>${esc(e.name)}</b> — ${esc(VetLib.doseFor(e, bucket))} <span class="muted">· ${esc(m.why)}</span></li>` : '';
      }).join('');
      return `<article class="vet-result-card med-lib-card"><div class="med-lib-head"><b>${esc(d.name)}</b><div class="med-chips"><span class="med-chip">likely condition</span><span class="med-chip ghost">${VetLib.ANIMAL_LABELS[bucket] || 'selected group'}</span></div><small>${esc(d.blurb)}</small></div>` +
        `<div class="vet-result-body">` +
          `<div class="med-img" id="medDisImg${i}"></div>` +
          `<section><h4>👀 Typical signs</h4><p>${esc(d.signsText)}</p></section>` +
          (d.noCure
            ? `<section><h4>⚠ No cure — act immediately</h4><p class="med-nc">${esc(d.noCureText)}</p></section>`
            : `<section><h4>💊 Suggested medicine &amp; treatment — ${VetLib.ANIMAL_LABELS[bucket]}</h4><ul class="dis-meds">${meds}</ul><p class="muted">Reference guidance — confirm the diagnosis and dosage with a licensed veterinarian.</p></section>`) +
          `<div class="med-live" id="medDisLive${i}"><span class="muted">🌐 Checking live internet sources…</span></div>` +
        `</div></article>`;
    }).join('');
    return `<div class="med-suggest-head"><b>🦠 Likely conditions from your description</b><small>Library + live internet reference — not a diagnosis.</small></div><div class="vet-result-list">${cards}</div>`;
  }

  /* ═══ [REBUILD FIX 66] DailyMed (US NIH) live label lookup — CORS-open ═══ */
  /* [REBUILD FIX 67] DailyMed's JSON endpoint returns no CORS header — real
     browsers always blocked the fetch. Show instant outbound lookup links
     instead: no fetch, no console noise, works offline too (the links simply
     wait for a connection). */
  function hydrateDailyMed(elId, q) {
    const el = document.getElementById(elId);
    if (!el || !q) return;
    el.innerHTML = `<span class=\"muted\">🔎 More on the internet:</span> <span class=\"med-live-links\">` +
      `<a href=\"https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(q)}\" target=\"_blank\" rel=\"noopener\">DailyMed (US NIH) ↗</a>` +
      `<a href=\"https://www.google.com/search?q=${encodeURIComponent(q + ' drugs.com vet swine dosage')}\" target=\"_blank\" rel=\"noopener\">Google vet refs ↗</a></span>`;
  }

  /* ═══ [REBUILD FIX 66] edit + delete a recorded treatment — stock re-balances
     automatically because owners sometimes tag the wrong sow / batch / boar,
     or enter the wrong medicine or quantity. ═══ */
  function openTreatmentEdit(id) {
    const v = moves().find(x => x.id === id);
    if (!v || v.kind !== 'treatment') { toast('Treatment record not found.'); return; }
    const cur = findMed(v.med_id), gone = !cur, oldQty = Math.abs(+v.delta || 0);
    const cat = { 'Sow': 'sow', 'Piglet batch': 'batch', 'Boar': 'boar', 'Herd/Pen': 'herd' }[v.animal_type] || 'sow';
    const tc = treatTargetControl(cat);
    const catOpts = [['sow', 'Sow / Gilt'], ['batch', 'Piglet batch'], ['boar', 'Boar'], ['herd', 'Whole herd / pen / others']]
      .map(([c, l]) => `<option value="${c}"${c === cat ? ' selected' : ''}>${l}</option>`).join('');
    const medLabel = cur ? `${cur.item_name} — ${round2((+cur.stock_quantity || 0) + oldQty)} ${cur.unit} left` : (v.item_name || 'Select medicine');

    document.getElementById('treatEdModal')?.remove();
    document.body.insertAdjacentHTML('beforeend',
      `<div class="due-modal-bg" id="treatEdModal"><form class="reminder-modal perf-modal" onsubmit="saveTreatmentEdit(event,${jsq(id)})"><div class="modal-top"><h2>✎ Correct treatment</h2><button type="button" class="close-reminder" onclick="document.getElementById('treatEdModal').remove()">×</button></div>` +
      `<input type="hidden" name="total_dirty" value="1">` +
      `<p class="perf-sub">Fix a wrong sow / batch / boar assignment, medicine or quantity. Stock re-balances automatically — the original quantity is credited back before the corrected one is deducted.</p>` +
      `<div id="treatMedInfo"></div>` +
      `<div class="reminder-fields">` +
        `<div class="field full suggest-field"><label>Medicine used * <small class="field-hint">type to search inventory</small></label>` +
          `<div class="suggest-input-wrap">` +
            `<input type="text" id="treatEdMedSearch" class="suggest-input" placeholder="Type medicine name to search..." autocomplete="off" value="${esc(medLabel)}" onfocus="filterTreatMedSuggest(this.value, 'treatEdMedSearch', 'treatEdMedId', 'treatEdMedDropdown', 'treatEdMedClear')" oninput="filterTreatMedSuggest(this.value, 'treatEdMedSearch', 'treatEdMedId', 'treatEdMedDropdown', 'treatEdMedClear')">` +
            `<input type="hidden" name="med_id" id="treatEdMedId" required value="${esc(v.med_id)}">` +
            `<button type="button" class="suggest-clear-btn" id="treatEdMedClear" onclick="clearTreatMedSuggest('treatEdMedSearch', 'treatEdMedId', 'treatEdMedDropdown', 'treatEdMedClear')" style="display:block">✕</button>` +
            `<div class="suggest-dropdown" id="treatEdMedDropdown" style="display:none"></div>` +
          `</div>` +
        `</div>` +
        `<div class="field"><label>Treat what? *</label><select name="category" onchange="treatEdCategory(this.value)">${catOpts}</select></div>` +
        `<div class="field" id="treatTargetField"><label>Animal / group *</label>${tc.html}</div>` +
        `<div class="field"><label>Date *</label><input name="date" type="date" required value="${esc(v.date || today())}"></div>` +
        `<div class="field"><label>Heads treated *</label><input name="heads" type="number" min="1" step="1" required value="${esc(v.heads || 1)}" oninput="document.querySelector('#treatEdModal [name=total_dirty]').value=0;medTreatCalcEd()"></div>` +
        `<div class="field"><label>Dose per head (<span id="treatUnit1">${esc(v.unit || '')}</span>)</label><input name="dose" type="number" min="0.01" step="0.01" value="${v.dose_per_head ?? ''}" oninput="document.querySelector('#treatEdModal [name=total_dirty]').value=0;medTreatCalcEd()"></div>` +
        `<div class="field"><label>Total quantity used (<span id="treatUnit2">${esc(v.unit || '')}</span>) *</label><input name="total" type="number" min="0.01" step="0.01" required value="${round2(oldQty)}" oninput="document.querySelector('#treatEdModal [name=total_dirty]').value=1"></div>` +
        `<div class="field"><label>Administered by</label><input name="by" value="${esc(v.administered_by || '')}"></div>` +
        `<div class="field full"><label>Reason / signs / diagnosis</label><textarea name="reason">${esc(v.reason || '')}</textarea></div>` +
      `</div><div class="form-error" id="treatEdErr"></div>` +
      `<div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('treatEdModal').remove()">Cancel</button><button class="btn">Save correction</button></div></form></div>`);
    if (cur) medTreatMedChange(v.med_id);
    /* prefill the animal target: text label (category prefix stripped) + ref */
    const lbl = document.querySelector('#treatEdModal [name=animal_label]');
    if (lbl) lbl.value = String(v.animal_label || '').replace(/^[^:]+:\s*/, '');
    const refI = document.getElementById('treatTargetRef');
    if (refI) refI.value = v.animal_ref || '';
  }

  function treatEdCategory(cat) {
    const tc = treatTargetControl(cat);
    document.getElementById('treatTargetField').innerHTML = `<label>Animal / group *</label>${tc.html}`;
    const f = document.getElementById('treatEdModal');
    if (f) { f.querySelector('[name=heads]').value = tc.heads; f.querySelector('[name=total_dirty]').value = 0; medTreatCalcEd(); }
    const m = f && f.querySelector('[name=med_id]');
    if (m) medTreatMedChange(m.value);
  }

  function medTreatCalcEd() {
    const f = document.getElementById('treatEdModal'); if (!f) return;
    if (f.querySelector('[name=total_dirty]').value === '1') return; /* user overrode */
    const dose = num(f.querySelector('[name=dose]').value), heads = num(f.querySelector('[name=heads]').value) || 1;
    if (dose !== null) f.querySelector('[name=total]').value = round2(dose * heads);
  }

  function saveTreatmentEdit(e, id) {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f)), err = document.getElementById('treatEdErr');
    const errShow = t => { err.textContent = t; err.classList.add('show'); };
    const v = moves().find(x => x.id === id);
    if (!v || v.kind !== 'treatment') { closeModalById('treatEdModal'); return; }
    const newMed = findMed(d.med_id), total = num(d.total), heads = num(d.heads);
    if (!newMed || total === null || total <= 0 || !heads || heads < 1) { errShow('Enter a valid medicine, heads count and total quantity.'); return; }
    const oldMed = findMed(v.med_id), oldQty = Math.abs(+v.delta || 0),
      sameMed = !!(oldMed && oldMed.id === newMed.id),
      newStock = +newMed.stock_quantity || 0,
      avail = sameMed ? newStock + oldQty : newStock;
    if (total > avail) {
      err.innerHTML = `❌ Insufficient stock: up to <b>${round2(avail)} ${esc(newMed.unit)}</b> possible${sameMed ? ' (current stock plus what this treatment originally used)' : ''}, but the correction needs <b>${round2(total)} ${esc(newMed.unit)}</b>.`;
      err.classList.add('show'); return;
    }
    let animalLabel, animalRef = '';
    if (d.animal_ref) { animalRef = d.animal_ref; animalLabel = String(d.animal_label || '').trim() || d.animal_ref; }
    else { animalLabel = String(d.animal_label || '').trim(); animalRef = (d.category === 'herd' ? 'herd:' : d.category + ':manual'); }
    if (!animalLabel) { errShow('Choose or type the animal / group being treated.'); return; }
    const catLabel = { sow: 'Sow', batch: 'Piglet batch', boar: 'Boar', herd: 'Herd/Pen' }[d.category] || d.category,
      oldNote = `${v.item_name} ${round2(oldQty)} ${v.unit} → ${v.animal_label} · ${v.date}`;
    /* stock re-balance: credit the original back, deduct the correction */
    if (sameMed) {
      newMed.stock_quantity = round2(newStock + oldQty - total);
      if (round2(total) !== round2(oldQty)) logMove(newMed, 'adjust', round2(oldQty - total), 'Treatment corrected', { animal_label: `${catLabel}: ${animalLabel}` });
    } else {
      if (oldMed) {
        oldMed.stock_quantity = round2((+oldMed.stock_quantity || 0) + oldQty);
        oldMed.updated_at = new Date().toISOString();
        logMove(oldMed, 'adjust', round2(oldQty), `Returned — treatment corrected over to ${newMed.item_name}`, { animal_label: v.animal_label });
      }
      newMed.stock_quantity = round2(newStock - total);
    }
    newMed.updated_at = new Date().toISOString();
    Object.assign(v, {
      med_id: newMed.id, item_name: newMed.item_name, unit: newMed.unit,
      delta: -round2(total), qty_after: round2(newMed.stock_quantity),
      animal_type: catLabel, animal_ref: animalRef, animal_label: `${catLabel}: ${animalLabel}`,
      heads, dose_per_head: num(d.dose), date: d.date || today(),
      reason: String(d.reason || '').trim(), administered_by: String(d.by || '').trim(),
      edited_at: new Date().toISOString(), edit_note: `Corrected — was ${oldNote}`
    });
    save(); closeModalById('treatEdModal'); if (typeof renderAll === 'function') renderAll(); else medPage();
    toast(`✔ Treatment corrected — ${round2(total)} ${newMed.unit} of ${newMed.item_name} → ${animalLabel} (${round2(newMed.stock_quantity)} left)`);
  }

  function deleteTreatment(id) {
    const v = moves().find(x => x.id === id);
    if (!v || v.kind !== 'treatment') { toast('Treatment record not found.'); return; }
    const qty = Math.abs(+v.delta || 0), m = findMed(v.med_id);
    if (!confirm(`Delete this treatment record?\n\n${v.item_name} · ${round2(qty)} ${v.unit} → ${v.animal_label} · ${v.date}\n\nThe used quantity is returned to the medicine's stock.`)) return;
    if (m) {
      m.stock_quantity = round2((+m.stock_quantity || 0) + qty);
      m.updated_at = new Date().toISOString();
      logMove(m, 'adjust', round2(qty), 'Treatment deleted — stock returned', { animal_label: v.animal_label });
    }
    moves().splice(moves().indexOf(v), 1);
    save(); if (typeof renderAll === 'function') renderAll(); else medPage();
    toast(`Treatment deleted${m ? ` — ${round2(qty)} ${m.unit} returned to ${m.item_name}` : ''}`);
  }

  function medTab(which) {
    const isName = which === 'name';
    document.getElementById('medPaneName').style.display = isName ? '' : 'none';
    document.getElementById('medPaneSym').style.display = isName ? 'none' : '';
    document.getElementById('medTabName').classList.toggle('active', isName);
    document.getElementById('medTabSym').classList.toggle('active', !isName);
  }

  /* ── live internet enrichment (CORS-open sources only) ─────────────── */
  const liveCache = {};
  async function hydrateLive(elId, title) {
    const el = document.getElementById(elId);
    if (!el) return;
    const links = `<div class="med-live-links"><a href="https://www.merckvetmanual.com/searchresults?query=${encodeURIComponent(title)}" target="_blank" rel="noopener">Merck Vet Manual ↗</a><a href="https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(title)}" target="_blank" rel="noopener">DailyMed (US NIH) ↗</a><a href="https://www.noahcompendium.co.uk/?id=-449913&fromSearch=1&q=${encodeURIComponent(title)}" target="_blank" rel="noopener">NOAH Compendium ↗</a></div>`;
    if (!navigator.onLine) { el.innerHTML = `<span class="muted">📴 Offline — showing the built-in veterinary library.${links}</span>`; return; }
    if (liveCache[title] !== undefined) { el.innerHTML = liveCache[title] === null ? offlineNote() : liveNote(liveCache[title]); el.insertAdjacentHTML('beforeend', links); paintImgSlot(elId, liveCache[title] && liveCache[title].img); return; }
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      if (!d.extract || d.type === 'disambiguation') throw new Error('no summary');
      const info = {
        extract: d.extract.length > 420 ? d.extract.slice(0, 420) + '…' : d.extract,
        url: (d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page) || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(title)),
        img: (d.originalimage && d.originalimage.source) || (d.thumbnail && d.thumbnail.source) || null /* FIX 70 */
      };
      liveCache[title] = info;
      el.innerHTML = liveNote(info) + links;
      paintImgSlot(elId, info.img);
    } catch (e) {
      liveCache[title] = null;
      el.innerHTML = offlineNote() + links;
    }
  }
  /* [REBUILD FIX 70] visual-reference photo slot on every result card —
     fed by the Wikipedia summary image; stays hidden while empty. */
  const medImgSlotId = elId => elId.replace(/^medDisLive/, 'medDisImg').replace(/^medLive/, 'medImg');
  function paintImgSlot(elId, url) {
    const slot = document.getElementById(medImgSlotId(elId));
    if (!slot) return;
    slot.innerHTML = url
      ? `<img src="${esc(url)}" alt="Reference photo" loading="lazy"><small class="muted med-img-cap">📷 Reference image — Wikipedia / internet. Always confirm the actual product label.</small>`
      : '';
  }

  const offlineNote = () => `<span class="muted">📴 Live internet lookup unavailable right now — the dosage and price above come from the built-in swine veterinary library.</span>`;
  const liveNote = info => `<span class="med-live-ok">🌐 Live from Wikipedia (internet):</span> ${esc(info.extract)} <a href="${esc(info.url)}" target="_blank" rel="noopener">Read more ↗</a>`;

  /* ── inventory panel ────────────────────────────────────────────────── */
  function inventoryHTML() {
    const a = meds();
    const value = a.reduce((t, m) => t + (num(m.stock_quantity) || 0) * (num(m.unit_cost) || 0), 0);
    const low = a.filter(m => stockStatus(m) !== 'Sufficient').length;
    let rows = '';
    if (!a.length) {
      rows = `<div class="empty">No medicine inventory records yet.</div><p class="muted med-empty-hint">Use ＋ Add medicine to register your first medicine, vaccine or vitamin item, or find one with the search above and press “Add to inventory”.</p>`;
    } else {
      rows = a.map(m => medRowHTML(m)).join('');
    }
    return `<div class="section panel summary med-inv"><div class="section-head"><div><h2>Medicine inventory</h2><p>${a.length} farm-scoped item${a.length === 1 ? '' : 's'} · stock value ${pesoFmt(value)}${low ? ' · ' : ''}${low ? `<span class="stock-${low ? 'low-stock' : ''}">${low} stock alert${low === 1 ? '' : 's'}</span>` : ''}</p></div><button class="btn" onclick="openMedEditor()">＋ Add medicine</button></div>` +
      (a.length ? `<input class="search med-filter" placeholder="Filter by name, brand or ingredient…" oninput="filterMedRows(this.value)">` : '') +
      rows + `</div>`;
  }

  function medRowHTML(m) {
    const st = stockStatus(m), exp = expiryInfo(m);
    const hist = moves().filter(v => v.med_id === m.id).slice(0, 5);
    const valLine = (num(m.unit_cost) || 0) > 0 ? `<small class="muted"> · value ${pesoFmt((num(m.unit_cost) || 0) * (num(m.stock_quantity) || 0))}</small>` : '';
    return `<div class="summary-row med-row" data-med-row data-name="${esc((m.item_name + ' ' + (m.brand_name || '') + ' ' + (m.active_ingredient || '')).toLowerCase())}">` +
      `<div class="med-row-main"><span><b>${esc(m.item_name)}</b> ${m.brand_name ? `<span class="med-chip ghost">${esc(m.brand_name)}</span>` : ''}<br>` +
      `<small class="muted">${esc(m.active_ingredient || '')}${m.active_ingredient ? ' · ' : ''}${esc(m.med_type || 'Medicine')}${m.form ? ' · ' + esc(m.form) : ''}${m.minimum_stock_threshold ? ' · min ' + m.minimum_stock_threshold + ' ' + esc(m.unit) : ''}</small>` +
      `${exp ? `<br><small class="med-exp ${exp.cls}">${esc(exp.label)}</small>` : ''}${valLine}</span>` +
      `<details class="mv-hist"><summary>History (${moves().filter(v => v.med_id === m.id).length})</summary>${hist.length ? hist.map(v => moveRowHTML(v)).join('') : '<small class="muted">No stock movements yet.</small>'}</details></div>` +
      `<div class="med-row-side"><div class="med-row-top"><b class="med-qty">${round2(m.stock_quantity)} <small>${esc(m.unit)}</small></b><span class="med-pill ${statusClass(st)}">${st}</span></div>` +
      `<div class="med-actions"><button type="button" class="btn ghost med-mini-btn" title="Record treatment — deducts stock automatically" onclick="openMedTreatment(${jsq(m.id)})">💉 Treat</button>` +
      `<button type="button" class="btn ghost med-mini-btn" title="Add stock" onclick="openRestock(${jsq(m.id)})">＋ Restock</button>` +
      `<button type="button" class="btn ghost med-mini-btn" title="Edit" onclick="openMedEditor(${jsq(m.id)})">✎ Edit</button>` +
      `<button type="button" class="btn ghost med-mini-btn danger" title="Delete" onclick="deleteMedItem(${jsq(m.id)})">✕</button></div></div></div>`;
  }

  function moveRowHTML(v) {
    const sign = v.delta > 0 ? '+' : '';
    const cls = v.delta > 0 ? 'pos' : 'neg';
    return `<div class="mv-row"><span class="mv-kind">${KIND_ICON[v.kind] || '•'} ${KIND_LABEL[v.kind] || v.kind}</span><span class="mv-delta ${cls}">${sign}${round2(v.delta)} ${esc(v.unit)}</span><span class="muted">→ ${round2(v.qty_after)} ${esc(v.unit)}</span><small class="muted">${esc(v.date || '')}${v.animal_label ? ' · ' + esc(v.animal_label) : ''}${v.note ? ' · ' + esc(v.note) : ''}</small></div>`;
  }

  /* [REBUILD FIX 21] Recent treatments — searchable. One row renderer shared
     by the section and the live filter; the searchable text covers batch /
     sow / boar names (animal label + ref), care tags (Castration, Iron
     Treatment), vaccine / medicine type & form (from the inventory item),
     medicine name, reason, unit and date. Typing expands the list beyond the
     default "latest 6" view to every matching record. */
  function treatRowHTML(v) {
    return `<div class="summary-row"><span class="med-row-main"><b>${esc(v.item_name)}</b>${v.tag ? ` <span class="med-chip ghost" title="Care tag">${esc(v.tag)}</span>` : ''} <span class="mv-delta neg">${round2(Math.abs(v.delta))} ${esc(v.unit)} used</span><br><small class="muted">${esc(v.date)} · ${esc(v.animal_label || '—')}${v.reason ? ' · ' + esc(v.reason) : ''}${v.administered_by ? ' · by ' + esc(v.administered_by) : ''}${v.heads > 1 ? ' · ' + v.heads + ' heads' : ''}</small></span><span class="${statusClass(findMed(v.med_id) ? stockStatus(findMed(v.med_id)) : 'Out of Stock')}">${findMed(v.med_id) ? round2(findMed(v.med_id).stock_quantity) + ' ' + esc(findMed(v.med_id).unit) + ' left' : 'item removed'}</span><span class="treat-row-actions"><button type="button" class="btn ghost med-mini-btn" title="Correct this record — wrong sow / batch / boar, medicine or quantity" onclick="openTreatmentEdit(${jsq(v.id)})">✎ Edit</button><button type="button" class="btn ghost med-mini-btn danger" title="Delete this treatment — the used stock is returned" onclick="deleteTreatment(${jsq(v.id)})">✕</button></span></div>`;
  }
  function treatSearchText(v) {
    const m = findMed(v.med_id) || {};
    return [v.item_name, m.brand_name, m.med_type, m.form, m.active_ingredient,
      v.animal_label, v.animal_type, v.animal_ref, v.tag, v.reason,
      v.administered_by, v.unit, v.date].filter(Boolean).join(' ').toLowerCase();
  }
  let treatQuery = ''; /* source of truth — survives stub-then-enhanced re-renders */
  function filterTreatRows(q) {
    treatQuery = String(q || '');
    const all = moves().filter(v => v.kind === 'treatment'),
      terms = treatQuery.trim().toLowerCase().split(/\s+/).filter(Boolean),
      filtered = terms.length ? all.filter(v => { const t = treatSearchText(v); return terms.every(w => t.includes(w)); }) : all.slice(0, 6),
      box = document.getElementById('treatRows'), cnt = document.getElementById('treatCount');
    if (box) box.innerHTML = filtered.map(treatRowHTML).join('') ||
      `<div class="empty">${all.length ? `No treatment records match “${esc(String(q || '').trim())}”.` : 'No treatments recorded yet.'}</div>`;
    if (cnt) cnt.textContent = !all.length ? ''
      : terms.length ? `${filtered.length} of ${all.length} treatment records match`
      : `Showing latest ${filtered.length} of ${all.length} — type above to search all`;
  }

  function recentHTML() {
    const all = moves().filter(v => v.kind === 'treatment'),
      q = treatQuery, /* kept in module state — the stub page rewrites #medicine
                         before this enhanced render on every renderAll() */
      terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean),
      filtered = terms.length ? all.filter(v => { const t = treatSearchText(v); return terms.every(w => t.includes(w)); }) : all.slice(0, 6);
    const rows = filtered.length ? filtered.map(treatRowHTML).join('')
      : all.length ? `<div class="empty">No treatment records match “${esc(q.trim())}”.</div>`
      : '<div class="empty">No treatments recorded yet. Recorded treatments automatically deduct the used stock (ml, tablet, caplet…) from the medicine — keeping sows, piglets and boars in sync with inventory.</div>';
    const cnt = !all.length ? '' : terms.length ? `${filtered.length} of ${all.length} treatment records match`
      : `Showing latest ${filtered.length} of ${all.length} — type to search all`;
    return `<div class="section panel summary"><div class="section-head"><div><h2>Recent treatments</h2><p>Treatments are synchronized with medicine stock</p></div></div>` +
      `<div class="field treat-search-field"><input id="treatSearch" autocomplete="off" placeholder="🔍 Search: batch, sow or boar name · castration · iron · vaccine · medicine type or name" value="${esc(q)}" oninput="filterTreatRows(this.value)"></div>` +
      `<div id="treatRows">${rows}</div><small class="muted treat-count" id="treatCount">${esc(cnt)}</small></div>`;
  }

  function filterMedRows(v) {
    const q = String(v || '').toLowerCase();
    document.querySelectorAll('#medicine [data-med-row]').forEach(r => { r.style.display = r.dataset.name.includes(q) ? '' : 'none'; });
  }

  /* ── animal pick-lists for treatments ───────────────────────────────── */
  function aliveBatchHeads(b) {
    /* [FIX M1] medicine dosing follows the authoritative living count (sold
       heads are not treated as still on the farm needing treatment). */
    if (window.liveHeadsFor) return Math.max(0, window.liveHeadsFor(b));
    const mort = (F().pigletLedger || []).filter(x => x.batch_id === b.id && x.type === 'mortality' && !['undone', 'deleted'].includes(x.status)).reduce((t, x) => t + (+x.quantity || 0), 0);
    return Math.max(0, (+b.males || 0) + (+b.females || 0) - mort);
  }

  /* [REBUILD FIX 26] Animal / group is now a type-ahead search box instead of
     a dropdown: type any part of the sow name / ID, batch id / sow / sire /
     breed, or boar name and tap the matching suggestion. A hidden animal_ref
     holds the structured reference once a suggestion is picked; typing a
     custom name without picking still records a manual entry exactly like the
     old free-text fallback did. Picking a batch suggestion also auto-fills
     heads with the batch's living piglets. */
  let curTreatCat = 'sow', curTreatCands = [];

  function treatCandidates(cat) {
    if (cat === 'sow') {
      return (F().sows || []).filter(s => typeof isActiveSow === 'function' ? isActiveSow(s) : true)
        .map(s => ({ ref: `sow:${s.id}`, label: `${s.name} (${s.id})`, heads: 1,
          search: `${s.name} ${s.id} ${s.breed || ''}`.toLowerCase() }));
    }
    if (cat === 'batch') {
      return (F().piglets || []).filter(b => !b.archived && aliveBatchHeads(b) > 0) /* FIX 24: archived excluded */
        .map(b => ({ ref: `batch:${b.id}`, label: `${b.id} · ${b.dam_name || b.sow || '—'} · ${aliveBatchHeads(b)} alive`, heads: aliveBatchHeads(b),
          search: `${b.id} ${b.dam_name || b.sow || ''} ${b.sire_name || b.sire || ''} ${b.breed || ''}`.toLowerCase() }));
    }
    if (cat === 'boar') {
      /* [REBUILD FIX 10] Registered active boars only — semen records are not
         animal registrations. Free-text fallback when the registry is empty. */
      return (window.getActiveBoars ? getActiveBoars() : [])
        .map(b => ({ ref: `boar:${b.name}`, label: `${b.name}${b.breed ? ' · ' + b.breed : ''}`, heads: 1,
          search: `${b.name} ${b.breed || ''}`.toLowerCase() }));
    }
    return []; /* herd stays free-text */
  }

  function treatTargetControl(cat) {
    curTreatCat = cat; curTreatCands = [];
    const cands = treatCandidates(cat);
    const hint = { sow: 'sow / gilt', batch: 'batch', boar: 'boar', herd: 'group' }[cat];
    if (!cands.length && cat !== 'herd') {
      const emptyHints = {
        sow: 'Sow name (no active sows registered)',
        batch: 'Batch id (no live batches)',
        boar: 'Boar name — none registered; register on the Boar Semen page'
      };
      return { html: `<input name="animal_label" placeholder="${emptyHints[cat]}">`, heads: 1 };
    }
    if (cat === 'herd') return { html: '<input name="animal_label" placeholder="e.g. Whole herd · All weaners · Pen 3 growers">', heads: 1 };
    return {
      html: `<div class="treat-typeahead">` +
        `<input name="animal_label" id="treatTargetInput" autocomplete="off" placeholder="Type to search — ${hint} name or ID" ` +
        `oninput="treatTargetFilter(this.value)" onfocus="treatTargetFilter(this.value)" onblur="setTimeout(treatTargetClose,180)">` +
        `<input type="hidden" name="animal_ref" id="treatTargetRef">` +
        `<div id="treatTargetSug" class="semen-suggestions treat-sug"></div></div>`,
      heads: 1
    };
  }

  function treatTargetFilter(q) {
    const box = document.getElementById('treatTargetSug'), ref = document.getElementById('treatTargetRef');
    if (!box) return;
    if (ref) ref.value = ''; /* retyping invalidates the previous pick */
    const term = String(q || '').trim().toLowerCase();
    curTreatCands = treatCandidates(curTreatCat).filter(c => !term || c.search.includes(term));
    box.innerHTML = curTreatCands.length
      ? curTreatCands.slice(0, 12).map((c, i) => `<button type="button" onmousedown="treatTargetPick(${i})"><span><b>${esc(c.label)}</b></span><span class="treat-sug-heads">${c.heads > 1 ? c.heads + ' heads' : ''}</span></button>`).join('')
      : `<div class="suggestion-empty">No match — finish typing the ${({ sow: 'sow', batch: 'batch', boar: 'boar' })[curTreatCat] || 'group'} name and Save; it is recorded as a custom entry.</div>`;
    box.classList.add('open');
    box.style.display = 'block'
  }

  function treatTargetPick(i) {
    const c = curTreatCands[i], form = document.querySelector('#medTreatModal, #treatEdModal');
    if (!c || !form) return;
    document.getElementById('treatTargetInput').value = c.label;
    document.getElementById('treatTargetRef').value = c.ref;
    if (c.heads > 1) {
      form.querySelector('[name=heads]').value = c.heads;
      form.querySelector('[name=total_dirty]').value = 0;
      (form.id === 'treatEdModal' ? medTreatCalcEd : medTreatCalc)();
    }
    treatTargetClose()
  }

  function treatTargetClose() {
    const box = document.getElementById('treatTargetSug');
    if (box) { box.classList.remove('open'); box.style.display = 'none' }
  }

  /* ── CRUD modal ─────────────────────────────────────────────────────── */
  function openMedEditor(id = null, libKey = null, freeName = null) {
    const m = id ? findMed(id) : null;
    let p = {};
    if (libKey && window.VetLib) {
      const e = VetLib.LIB.find(x => x.key === libKey);
      if (e) p = { item_name: e.name, active_ingredient: e.active, med_type: e.typeMed || e.type, form: e.form, unit: e.unit, notes: e.usage };
    }
    /* [REBUILD FIX 69] freeName may be a full prefill object (from the AI
       card) — every key flows into the form through the v() getter below. */
    if (freeName && typeof freeName === 'object') p = Object.assign({}, freeName);
    else if (freeName) p.item_name = freeName;
    const v = k => m ? m[k] : (p[k] ?? '');
    const sel = (name, arr, cur) => `<select name="${name}">${arr.map(o => `<option value="${o}"${o === (cur || arr[0]) ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
    document.body.insertAdjacentHTML('beforeend',
      `<div class="due-modal-bg" id="medEdModal"><form class="reminder-modal perf-modal" onsubmit="saveMedEditor(event)"><div class="modal-top"><h2>${m ? '✎ Edit medicine' : '＋ Add medicine'}</h2><button type="button" class="close-reminder" onclick="document.getElementById('medEdModal').remove()">×</button></div>` +
      `<p class="perf-sub">${m ? `Editing <b>${esc(m.item_name)}</b> · current stock <b>${round2(m.stock_quantity)} ${esc(m.unit)}</b>` : 'Register a new medicine, vaccine or vitamin for this farm.'}</p>` +
      `<input type="hidden" name="id" value="${m ? esc(m.id) : ''}">` +
      `<div class="reminder-fields">` +
        `<div class="field full"><label>Name *</label><input name="item_name" required value="${esc(v('item_name'))}" placeholder="e.g. Amoxicillin LA 15%"></div>` +
        `<div class="field"><label>Brand</label><input name="brand_name" value="${esc(v('brand_name'))}" placeholder="e.g. Betamox"></div>` +
        `<div class="field"><label>Active ingredient</label><input name="active_ingredient" value="${esc(v('active_ingredient'))}" placeholder="e.g. Amoxicillin trihydrate"></div>` +
        `<div class="field"><label>Type</label>${sel('med_type', TYPES, v('med_type'))}</div>` +
        `<div class="field"><label>Form</label>${sel('form', FORMS, v('form'))}</div>` +
        `<div class="field"><label>Unit of measure *</label>${sel('unit', UNITS, v('unit'))}<small class="field-hint">Stock is tracked in this unit — ml for injectables, tablet / caplet for pills, dose for vaccines, sachet for powders.</small></div>` +
        `<div class="field"><label>Current stock *</label><input name="stock_quantity" type="number" min="0" step="0.01" required value="${esc(v('stock_quantity') !== '' ? v('stock_quantity') : 0)}"><small class="field-hint">${m ? 'Changing the stock here logs a manual stock adjustment in history.' : 'Opening stock on hand.'}</small></div>` +
        `<div class="field"><label>Minimum stock (low-stock alert)</label><input name="minimum_stock_threshold" type="number" min="0" step="0.01" value="${esc(v('minimum_stock_threshold') ?? 0)}"></div>` +
        `<div class="field"><label>Cost per unit (₱)</label><input name="unit_cost" type="number" min="0" step="0.01" value="${esc(v('unit_cost') ?? '')}" placeholder="e.g. 4.50 per ml"></div>` +
        `<div class="field"><label>Expiry date</label><input name="expiry_date" type="date" value="${esc(v('expiry_date') || '')}"></div>` +
        `<div class="field"><label>Supplier</label><input name="supplier" value="${esc(v('supplier') || '')}" placeholder="e.g. Agrivet Supply Co."></div>` +
        `<div class="field full"><label>Notes <small class="field-hint">reference dosage / usage pulled from the library is kept here for your team</small></label><textarea name="notes" placeholder="Dosage reminders, storage notes, etc.">${esc(v('notes') || (p.notes || ''))}</textarea></div>` +
      `</div>` +
      `<div class="form-error" id="medEdErr"></div>` +
      `<div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('medEdModal').remove()">Cancel</button><button class="btn">${m ? 'Save changes' : 'Save medicine'}</button></div></form></div>`);
  }

  function saveMedEditor(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const err = document.getElementById('medEdErr');
    const name = String(d.item_name || '').trim();
    const qty = num(d.stock_quantity);
    if (!name || qty === null || qty < 0) { err.textContent = 'Name and a valid (non-negative) stock quantity are required.'; err.classList.add('show'); return; }
    if (d.id) {
      const m = findMed(d.id); if (!m) return;
      const oldQty = +m.stock_quantity || 0;
      Object.assign(m, {
        item_name: name, brand_name: d.brand_name.trim(), active_ingredient: d.active_ingredient.trim(),
        med_type: d.med_type, form: d.form, unit: d.unit, stock_quantity: round2(qty),
        minimum_stock_threshold: num(d.minimum_stock_threshold) || 0, unit_cost: num(d.unit_cost),
        expiry_date: d.expiry_date || '', supplier: d.supplier.trim(), notes: d.notes.trim(), updated_at: new Date().toISOString()
      });
      if (round2(qty) !== round2(oldQty)) logMove(m, 'adjust', round2(qty - oldQty), 'Manual edit');
      save(); closeModalById('medEdModal'); if (typeof renderAll === 'function') renderAll(); else medPage();
      toast(`Medicine updated — ${round2(m.stock_quantity)} ${m.unit} in stock`);
    } else {
      const m = {
        id: newId('MED-'), item_name: name, brand_name: d.brand_name.trim(), active_ingredient: d.active_ingredient.trim(),
        med_type: d.med_type, form: d.form, unit: d.unit, stock_quantity: round2(qty),
        minimum_stock_threshold: num(d.minimum_stock_threshold) || 0, unit_cost: num(d.unit_cost),
        expiry_date: d.expiry_date || '', supplier: d.supplier.trim(), notes: d.notes.trim(),
        created_at: new Date().toISOString()
      };
      meds().push(m);
      if (round2(qty) > 0) logMove(m, 'initial', round2(qty), 'Opening stock');
      save(); closeModalById('medEdModal'); if (typeof renderAll === 'function') renderAll(); else medPage();
      toast(`Saved ${name} — ${round2(qty)} ${m.unit} in stock`);
    }
  }

  function deleteMedItem(id) {
    const m = findMed(id); if (!m) return;
    if (!confirm(`Delete “${m.item_name}” from the medicine inventory?\n\nHistory is kept for your records, but the item and its ${round2(m.stock_quantity)} ${m.unit} stock will be removed.`)) return;
    const idx = meds().indexOf(m); meds().splice(idx, 1);
    moves().unshift({ id: newId('mv-'), med_id: id, item_name: m.item_name, kind: 'deletion', delta: -round2(m.stock_quantity), qty_after: 0, unit: m.unit, date: today(), at: new Date().toISOString(), note: 'Removed from inventory' });
    save(); if (typeof renderAll === 'function') renderAll(); else medPage();
    toast(`Deleted ${m.item_name}`);
  }

  /* ── restock ────────────────────────────────────────────────────────── */
  function openRestock(id) {
    const m = findMed(id); if (!m) return;
    document.body.insertAdjacentHTML('beforeend',
      `<div class="due-modal-bg" id="medRsModal"><form class="reminder-modal" onsubmit="saveRestock(event)"><div class="modal-top"><h2>📦 Restock — ${esc(m.item_name)}</h2><button type="button" class="close-reminder" onclick="document.getElementById('medRsModal').remove()">×</button></div>` +
      `<p class="perf-sub">${esc(m.active_ingredient || m.med_type || '')} · current stock <b>${round2(m.stock_quantity)} ${esc(m.unit)}</b>${m.minimum_stock_threshold ? ` · low-stock alert at ${m.minimum_stock_threshold} ${esc(m.unit)}` : ''}</p>` +
      `<input type="hidden" name="id" value="${esc(m.id)}"><div class="reminder-fields">` +
      `<div class="field"><label>Quantity to add (${esc(m.unit)}) *</label><input name="qty" type="number" min="0.01" step="0.01" required placeholder="e.g. 100"></div>` +
      `<div class="field"><label>New cost per unit (₱)</label><input name="unit_cost" type="number" min="0" step="0.01" value="${m.unit_cost ?? ''}" placeholder="leave blank to keep"></div>` +
      `<div class="field"><label>New expiry date</label><input name="expiry_date" type="date" value="${esc(m.expiry_date || '')}"></div>` +
      `<div class="field"><label>Note</label><input name="note" placeholder="e.g. Agrivet delivery DR-1234"></div>` +
      `<div class="field full"><label class="med-check"><input type="checkbox" name="expense"> Also record purchase cost as a farm expense (₱ amount = qty × cost/unit)</label></div>` +
      `</div><div class="form-error" id="medRsErr"></div>` +
      `<div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('medRsModal').remove()">Cancel</button><button class="btn">Add stock</button></div></form></div>`);
  }

  function saveRestock(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target)), m = findMed(d.id), err = document.getElementById('medRsErr');
    const qty = num(d.qty);
    if (!m || qty === null || qty <= 0) { err.textContent = 'Enter a quantity greater than zero.'; err.classList.add('show'); return; }
    const cost = num(d.unit_cost);
    if (cost !== null) m.unit_cost = cost;
    if (d.expiry_date) m.expiry_date = d.expiry_date;
    m.stock_quantity = round2(m.stock_quantity + qty);
    if (d.expense && m.unit_cost) {
      (F().transactions = F().transactions || []).unshift({ date: today(), type: 'Expense', category: 'Medicine', description: `Restock: ${m.item_name} ×${round2(qty)} ${m.unit}`, amount: round2(qty * m.unit_cost), paid: round2(qty * m.unit_cost) });
    }
    logMove(m, 'restock', qty, d.note || 'Stock added');
    save(); closeModalById('medRsModal'); if (typeof renderAll === 'function') renderAll(); else medPage();
    toast(`Restocked ${m.item_name} — ${round2(m.stock_quantity)} ${m.unit} in stock`);
    if (stockStatus(m) === 'Sufficient') setTimeout(() => toast('Stock back above the low-stock threshold ✔'), 200);
  }

  /* ── treatment recording (stock-synced) ─────────────────────────────── */
  let cachedTreatMeds = [];

  function filterTreatMedSuggest(query, targetInputId = 'treatMedSearch', targetHiddenId = 'treatMedId', targetDropdownId = 'treatMedDropdown', targetClearId = 'treatMedClear') {
    const dropdown = document.getElementById(targetDropdownId);
    const clearBtn = document.getElementById(targetClearId);
    if (!dropdown) return;

    const allMeds = meds();
    const q = String(query || '').trim().toLowerCase();

    if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

    cachedTreatMeds = allMeds.filter(m => {
      if (!q) return true;
      const str = `${m.item_name} ${m.brand_name || ''} ${m.active_ingredient || ''} ${m.med_type || ''}`.toLowerCase();
      return str.includes(q);
    });

    if (!cachedTreatMeds.length) {
      dropdown.innerHTML = `<div class="suggest-empty">No matching medicines found in inventory.</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = cachedTreatMeds.map((m, idx) => `
      <div class="suggest-item" onmousedown="selectTreatMedByIndex(${idx}, '${targetInputId}', '${targetHiddenId}', '${targetDropdownId}', '${targetClearId}')">
        <div class="suggest-ico" style="background:rgba(13,141,145,0.15);color:var(--teal2);font-size:16px">💉</div>
        <div class="suggest-meta">
          <b>${esc(m.item_name)}</b>
          <small>${esc(m.active_ingredient || m.med_type || 'Medicine')} · <b style="color:var(--teal2)">${round2(m.stock_quantity)} ${esc(m.unit)} on hand</b></small>
        </div>
      </div>
    `).join('');

    dropdown.style.display = 'block';
  }

  function selectTreatMedByIndex(idx, targetInputId = 'treatMedSearch', targetHiddenId = 'treatMedId', targetDropdownId = 'treatMedDropdown', targetClearId = 'treatMedClear') {
    const m = cachedTreatMeds[idx];
    if (!m) return;

    const input = document.getElementById(targetInputId);
    const hidden = document.getElementById(targetHiddenId);
    const clearBtn = document.getElementById(targetClearId);
    const dropdown = document.getElementById(targetDropdownId);

    if (input) input.value = `${m.item_name} — ${round2(m.stock_quantity)} ${m.unit} left`;
    if (hidden) hidden.value = m.id;
    if (clearBtn) clearBtn.style.display = 'block';
    if (dropdown) dropdown.style.display = 'none';

    medTreatMedChange(m.id);
  }

  function clearTreatMedSuggest(targetInputId = 'treatMedSearch', targetHiddenId = 'treatMedId', targetDropdownId = 'treatMedDropdown', targetClearId = 'treatMedClear') {
    const input = document.getElementById(targetInputId);
    const hidden = document.getElementById(targetHiddenId);
    const clearBtn = document.getElementById(targetClearId);
    if (input) { input.value = ''; input.focus(); }
    if (hidden) hidden.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    filterTreatMedSuggest('', targetInputId, targetHiddenId, targetDropdownId, targetClearId);
  }

  function treatOptions(cur) {
    return meds().map(m => `<option value="${esc(m.id)}"${m.id === cur ? ' selected' : ''}>${esc(m.item_name)} — ${round2(m.stock_quantity)} ${esc(m.unit)} left</option>`).join('');
  }

  function treatMedInfo(id) {
    const m = findMed(id); if (!m) return '';
    const lib = libMatch(m.item_name, m.active_ingredient);
    let doseHint = '';
    if (lib) {
      const b = VetLib.ageGroupKey(document.querySelector('#medTreatModal [name=category], #treatEdModal [name=category]')?.value === 'batch' ? 'piglet' : document.querySelector('#medTreatModal [name=category], #treatEdModal [name=category]')?.value || 'piglet', '');
      doseHint = `<small class="field-hint">💡 Library reference — ${esc(lib.name)}: ${esc(VetLib.doseFor(lib, ['sow', 'boar', 'batch', 'herd'].includes(document.querySelector('#medTreatModal [name=category], #treatEdModal [name=category]')?.value) ? (document.querySelector('#medTreatModal [name=category], #treatEdModal [name=category]').value === 'batch' ? 'piglet' : document.querySelector('#medTreatModal [name=category], #treatEdModal [name=category]').value === 'herd' ? 'grower' : document.querySelector('#medTreatModal [name=category], #treatEdModal [name=category]').value) : b))}</small>`;
    }
    return `<p class="perf-sub" id="treatStockLine">${esc(m.active_ingredient || m.med_type || '')} · on hand <b>${round2(m.stock_quantity)} ${esc(m.unit)}</b>${m.minimum_stock_threshold ? ` · low-stock alert at ${m.minimum_stock_threshold} ${esc(m.unit)}` : ''}</p>${doseHint}`;
  }

  function openMedTreatment(id = '', defaultCat = 'sow', defaultTarget = null, defaultHeads = null) {
    if (!meds().length) { toast('No medicines in inventory — add one first.'); openMedEditor(); return; }
    const first = meds()[0];
    const selectedMed = findMed(id) || first;
    const cat = defaultCat || 'sow';
    const tc = treatTargetControl(cat);

    document.getElementById('medTreatModal')?.remove();

    document.body.insertAdjacentHTML('beforeend',
      `<div class="due-modal-bg" id="medTreatModal" style="z-index:9999999!important"><form class="reminder-modal perf-modal" onsubmit="saveMedTreatment(event)"><div class="modal-top"><h2>💉 Record treatment</h2><button type="button" class="close-reminder" onclick="document.getElementById('medTreatModal').remove()">×</button></div>` +
      `<input type="hidden" name="total_dirty" value="0">` +
      `<div id="treatMedInfo"></div>` +
      `<div class="reminder-fields">` +
        `<div class="field full suggest-field"><label>Medicine used * <small class="field-hint">type to search inventory</small></label>` +
          `<div class="suggest-input-wrap">` +
            `<input type="text" id="treatMedSearch" class="suggest-input" placeholder="Type medicine name to search..." autocomplete="off" value="${esc(selectedMed.item_name)} — ${round2(selectedMed.stock_quantity)} ${esc(selectedMed.unit)} left" onfocus="filterTreatMedSuggest(this.value, 'treatMedSearch', 'treatMedId', 'treatMedDropdown', 'treatMedClear')" oninput="filterTreatMedSuggest(this.value, 'treatMedSearch', 'treatMedId', 'treatMedDropdown', 'treatMedClear')">` +
            `<input type="hidden" name="med_id" id="treatMedId" required value="${esc(selectedMed.id)}">` +
            `<button type="button" class="suggest-clear-btn" id="treatMedClear" onclick="clearTreatMedSuggest('treatMedSearch', 'treatMedId', 'treatMedDropdown', 'treatMedClear')" style="display:block">✕</button>` +
            `<div class="suggest-dropdown" id="treatMedDropdown" style="display:none"></div>` +
          `</div>` +
        `</div>` +
        `<div class="field"><label>Treat what? *</label><select name="category" onchange="medTreatCategory(this.value)">` +
          `<option value="sow" ${cat === 'sow' ? 'selected' : ''}>Sow / Gilt</option>` +
          `<option value="batch" ${cat === 'batch' ? 'selected' : ''}>Piglet batch</option>` +
          `<option value="boar" ${cat === 'boar' ? 'selected' : ''}>Boar</option>` +
          `<option value="herd" ${cat === 'herd' ? 'selected' : ''}>Whole herd / pen / others</option>` +
        `</select></div>` +
        `<div class="field" id="treatTargetField"><label>Animal / group *</label>${tc.html}</div>` +
        `<div class="field"><label>Date *</label><input name="date" type="date" required value="${today()}"></div>` +
        `<div class="field"><label>Heads treated *</label><input name="heads" type="number" min="1" step="1" required value="${defaultHeads || tc.heads || 1}" oninput="document.querySelector('#medTreatModal [name=total_dirty]').value=0;medTreatCalc()"><small class="field-hint">Auto-filled with the batch's living piglets — adjust as needed.</small></div>` +
        `<div class="field"><label>Dose per head (<span id="treatUnit1">${esc(selectedMed.unit)}</span>) *</label><input name="dose" type="number" min="0.01" step="0.01" required placeholder="e.g. 1.0" oninput="document.querySelector('#medTreatModal [name=total_dirty]').value=0;medTreatCalc()"></div>` +
        `<div class="field"><label>Total quantity used (<span id="treatUnit2">${esc(selectedMed.unit)}</span>) *</label><input name="total" type="number" min="0.01" step="0.01" required oninput="document.querySelector('#medTreatModal [name=total_dirty]').value=1"><small class="field-hint">Auto = dose × heads — editable (e.g. spillage).</small></div>` +
        `<div class="field"><label>Administered by</label><input name="by" placeholder="e.g. Juan (caretaker)"></div>` +
        `<div class="field full"><label>Reason / signs / diagnosis</label><textarea name="reason" placeholder="e.g. sow off-feed with fever; batch scouring"></textarea></div>` +
      `</div><div class="form-error" id="medTreatErr"></div>` +
      `<div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('medTreatModal').remove()">Cancel</button><button class="btn">Save treatment &amp; deduct stock</button></div></form></div>`);

    // Pre-fill target if specified
    if (defaultTarget) {
      const inputEl = document.getElementById('treatTargetInput');
      const refEl = document.getElementById('treatTargetRef');
      if (typeof defaultTarget === 'object') {
        if (inputEl) inputEl.value = defaultTarget.label || defaultTarget.name || '';
        if (refEl) refEl.value = defaultTarget.ref || defaultTarget.id || '';
      } else if (typeof defaultTarget === 'string') {
        if (inputEl) inputEl.value = defaultTarget.startsWith('batch:') ? 'Piglet batch · ' + defaultTarget.replace('batch:', '') : defaultTarget;
        if (refEl) refEl.value = (cat === 'batch' && !defaultTarget.startsWith('batch:')) ? 'batch:' + defaultTarget : defaultTarget;
      }
    }

    medTreatMedChange(id || first.id);
  }

  function medTreatMedChange(id) {
    const m = findMed(id); if (!m) return;
    document.getElementById('treatUnit1').textContent = m.unit;
    document.getElementById('treatUnit2').textContent = m.unit;
    document.getElementById('treatMedInfo').innerHTML = treatMedInfo(id);
  }

  function medTreatCategory(cat) {
    const tc = treatTargetControl(cat);
    document.getElementById('treatTargetField').innerHTML = `<label>Animal / group *</label>${tc.html}`;
    document.querySelector('#medTreatModal [name=heads]').value = tc.heads;
    document.querySelector('#medTreatModal [name=total_dirty]').value = 0;
    medTreatCalc();
    const sel = document.querySelector('#medTreatModal [name=med_id]');
    if (sel) medTreatMedChange(sel.value);
  }

  function medTreatBatchHeads(sel) {
    const opt = sel.selectedOptions[0];
    if (opt && opt.dataset.heads) { document.querySelector('#medTreatModal [name=heads]').value = opt.dataset.heads; document.querySelector('#medTreatModal [name=total_dirty]').value = 0; medTreatCalc(); }
  }

  function medTreatCalc() {
    const f = document.getElementById('medTreatModal'); if (!f) return;
    if (f.querySelector('[name=total_dirty]').value === '1') return; /* user overrode */
    const dose = num(f.querySelector('[name=dose]').value), heads = num(f.querySelector('[name=heads]').value) || 1;
    if (dose !== null) f.querySelector('[name=total]').value = round2(dose * heads);
  }

  function saveMedTreatment(e) {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f)), err = document.getElementById('medTreatErr');
    const m = findMed(d.med_id), total = num(d.total), heads = num(d.heads);
    if (!m || total === null || total <= 0 || !heads || heads < 1) { err.textContent = 'Enter a valid medicine, heads count and total quantity.'; err.classList.add('show'); return; }
    const stock = +m.stock_quantity || 0;
    if (total > stock) {
      err.innerHTML = `❌ Insufficient stock: <b>${round2(stock)} ${esc(m.unit)}</b> on hand, but this treatment needs <b>${round2(total)} ${esc(m.unit)}</b>. Restock first or lower the quantity.`;
      err.classList.add('show'); return;
    }
    /* build the animal label */
    let animalLabel, animalRef = '';
    if (d.animal_ref) {
      animalRef = d.animal_ref;
      /* [REBUILD FIX 26] label comes from the type-ahead text field, not a <select> option */
      animalLabel = String(d.animal_label || '').trim() || d.animal_ref;
    } else {
      animalLabel = String(d.animal_label || '').trim();
      animalRef = (d.category === 'herd' ? 'herd:' : d.category + ':manual');
    }
    if (!animalLabel) { err.textContent = 'Choose or type the animal / group being treated.'; err.classList.add('show'); return; }
    const catLabel = { sow: 'Sow', batch: 'Piglet batch', boar: 'Boar', herd: 'Herd/Pen' }[d.category] || d.category;
    m.stock_quantity = round2(stock - total);
    m.updated_at = new Date().toISOString();
    const reason = String(d.reason || '').trim(), by = String(d.by || '').trim();
    const treatmentId = 'treat-med-' + Date.now();
    logMove(m, 'treatment', -round2(total), '', {
      treatment_id: treatmentId, animal_type: catLabel, animal_ref: animalRef, animal_label: `${catLabel}: ${animalLabel}`,
      heads, dose_per_head: num(d.dose), date: d.date || today(), reason, administered_by: by
    });
    // Keep the animal-level recent treatment history in sync with medicine
    // inventory movements. The same treatment remains visible in both places.
    const treatment = {
      id: treatmentId, farm_id: farmId, medicine: m.item_name, medicine_name: m.item_name,
      med_id: m.id, dosage_ml: round2(total), dose_per_head: num(d.dose), heads,
      date: d.date || today(), category: catLabel, animal_ref: animalRef,
      animal_label: `${catLabel}: ${animalLabel}`, reason, administered_by: by,
      sow_id: d.category === 'sow' ? String(animalRef || '').replace(/^sow:/, '') : null,
      sow_name: d.category === 'sow' ? animalLabel.replace(/^Sow:\s*/i, '') : null,
      created_at: new Date().toISOString()
    };
    (F().treatments = Array.isArray(F().treatments) ? F().treatments : []).unshift(treatment);
    save(); closeModalById('medTreatModal');
    if (d.category === 'batch' && d.animal_ref && d.animal_ref.startsWith('batch:')) {
      const bId = d.animal_ref.replace('batch:', '');
      if (document.getElementById('fcHealthModal') && window.openBatchDetails) {
        openBatchDetails(bId);
      }
    }
    if (typeof renderAll === 'function') renderAll(); else medPage();
    toast(`✔ ${round2(total)} ${m.unit} of ${m.item_name} → ${animalLabel} · ${round2(m.stock_quantity)} ${m.unit} left`);
    const st = stockStatus(m);
    setTimeout(() => {
      if (st === 'Out of Stock') toast(`⚠ ${m.item_name} is now OUT OF STOCK — restock soon`);
      else if (st === 'Low Stock') toast(`⚠ Low stock: ${m.item_name} down to ${round2(m.stock_quantity)} ${m.unit}`);
    }, 250);
  }

  const closeModalById = id => document.getElementById(id)?.remove();

  /* ── exports ────────────────────────────────────────────────────────── */
  Object.assign(window, {
    medTab, medNameSearch, medSymptomSearch, filterMedRows, filterTreatRows,
    openMedEditor, saveMedEditor, deleteMedItem,
    openRestock, saveRestock,
    openMedTreatment, saveMedTreatment, medTreatMedChange, medTreatCategory, medTreatBatchHeads, medTreatCalc,
    openTreatmentEdit, saveTreatmentEdit, deleteTreatment, treatEdCategory, medTreatCalcEd, hydrateDailyMed,
    treatTargetFilter, treatTargetPick, treatTargetClose, /* [REBUILD FIX 26] */
    filterTreatMedSuggest, selectTreatMedByIndex, clearTreatMedSuggest
  });

  /* render last (after the original medicine.js stub page) so the enhanced
     module owns the #medicine section. */
  const old = window.renderAll;
  window.renderAll = function () {
    (typeof old === 'function' && old());
    medPage();
  };
})();