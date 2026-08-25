/* In-app trusted veterinary reference search — citations only, never generated prescriptions. */
(function() {
  function page() {
    let meds = F().medicines || [];
    document.getElementById('medicine').innerHTML = `<div class="section-head"><div><div class="eyebrow">MEDICINE & TREATMENTS</div><h2>Veterinary reference search</h2><p>Trusted cited sources only. Reference information is not a diagnosis or prescription.</p></div></div><div class="panel medicine-search"><div class="field"><label>Signs, symptoms, disease, or medicine</label><textarea id="vetSymptoms" placeholder="e.g. diarrhea, high fever"></textarea></div><div class="med-grid"><div class="field"><label>Animal type</label><select id="vetAnimal"><option value="piglet">Piglet</option><option value="sow">Sow</option><option value="lactating sow">Farrowed / Lactating Sow</option><option value="boar">Boar</option><option value="grower">Grower / Finisher</option></select></div><div class="field"><label>Piglet age group</label><select id="vetAge"><option value="">Not applicable</option><option>Newborn</option><option>7–21 days</option><option>Weaned</option><option>Grower</option></select></div></div><button class="btn" onclick="runVetSearch()">Search trusted veterinary references</button><div class="vet-disclaimer">Veterinary suggestions are reference only. Final diagnosis and treatment decisions must be confirmed by a licensed veterinarian.</div><div id="vetResults"></div></div><div class="section panel summary"><div class="section-head"><div><h2>Medicine inventory</h2><p>${meds.length} farm-scoped items</p></div><button class="btn ghost" onclick="toast('Medicine inventory CRUD is the next treatment module screen.')">Manage inventory</button></div>${meds.length?meds.map(x=>`<div class="summary-row"><span><b>${x.item_name}</b><br><small class="muted">${x.brand_name||''} · ${x.active_ingredient||''}</small></span><b>${x.stock_quantity} ${x.unit}</b></div>`).join(''):'<div class="empty">No medicine inventory records yet.</div>'}</div>`
  }

  function cleanText(t) {
    return String(t || '').replace(/#{1,6}\s*/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  }

  function sentences(text) {
    return cleanText(text).split(/(?<=[.!?])\s+/).filter(x => x.length > 24)
  }

  function pick(sent, keys, used, max = 4) {
    let result = [];
    sent.forEach((x, i) => {
      if (result.length < max && !used.has(i) && keys.some(k => x.toLowerCase().includes(k))) {
        result.push(x);
        used.add(i)
      }
    });
    return result
  }

  function bullets(list, empty) {
    return list.length ? `<ul>${list.map(x=>`<li>${x}</li>`).join('')}</ul>` : `<p class="vet-empty">${empty}</p>`
  }

  function inventoryStatus(item) {
    let q = +item.stock_quantity || 0;
    return q <= 0 ? 'Out of Stock' : q <= +item.minimum_stock_threshold ? 'Low Stock' : 'Sufficient'
  }

  function treatmentTable(query, sourceText) {
    let catalog = (F().vetCatalog || []).filter(x => x.is_active && (`${x.item_name} ${x.active_ingredient} ${x.swine_uses||''}`).toLowerCase().includes(query.toLowerCase()) || sourceText.toLowerCase().includes((x.item_name || '').toLowerCase()));
    if (!catalog.length) return '<p class="vet-empty">No veterinarian-approved catalog medicine matches this source yet.</p>';
    return `<div class="treatment-table"><div class="tt-head"><span>Medication</span><span>Dosage ref.</span><span>Route</span><span>Withdrawal</span><span>Inventory</span></div>${catalog.map(x=>{let inv=(F().medicines||[]).find(m=>m.item_name===x.item_name||m.active_ingredient===x.active_ingredient),status=inv?inventoryStatus(inv):'Not stocked';return `<div class="tt-row"><span><b>${x.item_name}</b><small>${x.active_ingredient||''}</small></span><span>${x.dosage_reference||'Not stated'}</span><span>${x.route||'Not stated'}</span><span>${x.withdrawal_period||'Not stated'}</span><span class="stock-${status.replaceAll(' ','-').toLowerCase()}">${status}${inv?` · ${inv.stock_quantity} ${inv.unit}`:''}</span></div>`}).join('')}</div>`
  }

  function resultCard(x, i, query) {
    let sent = sentences(x.excerpt),
      used = new Set(),
      signs = pick(sent, ['symptom', 'sign', 'fever', 'diarr', 'appetite', 'letharg', 'cough', 'vomit', 'weak', 'lameness'], used),
      treat = pick(sent, ['treat', 'antibiotic', 'medicine', 'drug', 'therapy', 'streptomycin', 'supplement', 'vaccin'], used),
      prevent = pick(sent, ['prevent', 'vaccin', 'quarantine', 'hygien', 'management', 'feed', 'nutrition', 'biosecurity'], used),
      overview = sent.filter((_, i) => !used.has(i)).slice(0, 2);
    return `<article class="vet-result-card"><button class="vet-result-head" onclick="toggleVetResult(${i})"><span><em>Verified source</em><b>${x.title}</b><small>${x.source_domain}${x.published_date?' · '+x.published_date:''}</small></span><span id="vetArrow${i}">⌄</span></button><div class="vet-result-body" id="vetBody${i}"><section><h4>📄 Clinical Overview</h4>${bullets(overview,'No concise overview was extracted from this source.')}</section><section><h4>🩺 Key Symptoms & Signs</h4>${bullets(signs,'No specific signs were stated in this excerpt.')}</section><section><h4>💊 Medicine & Treatment Mentions</h4>${bullets(treat,'No medicine name was stated in this excerpt.')}</section><section><h4>🛡️ Prevention & Management</h4>${bullets(prevent,'No prevention or management instruction was stated in this excerpt.')}</section><section><h4>Reference Treatment Table</h4>${treatmentTable(query,x.excerpt)}</section><a href="${x.url}" target="_blank" rel="noopener">Open original trusted reference ↗</a><div class="vet-disclaimer">Veterinary reference information only. Diagnosis, medicine selection, dosage, route, withdrawal period, and treatment decisions must be confirmed by a licensed veterinarian.</div></div></article>`
  }
  async function runVetSearch() {
    let symptoms = document.getElementById('vetSymptoms').value.trim(),
      out = document.getElementById('vetResults');
    if (symptoms.length < 3) {
      out.innerHTML = '<div class="form-error show">Enter at least three characters to search.</div>';
      return
    }
    out.innerHTML = '<div class="empty">Searching trusted veterinary references…</div>';
    try {
      let r = await ARSCloud.vetReferenceSearch({
        symptoms,
        animalType: document.getElementById('vetAnimal').value,
        ageGroup: document.getElementById('vetAge').value
      });
      out.innerHTML = `<div class="vet-disclaimer">${r.disclaimer}</div><div class="vet-result-list">${(r.results||[]).map((x,i)=>resultCard(x,i,symptoms)).join('')}</div>` || '<div class="empty">No results from approved veterinary sources. Try different terms.</div>';
      if (!(r.results || []).length) out.innerHTML = '<div class="empty">No results from approved veterinary sources. Try different terms.</div>'
    } catch (e) {
      out.innerHTML = `<div class="form-error show">${e.message||'Veterinary reference search is unavailable.'}</div>`
    }
  }

  function toggleVetResult(i) {
    let body = document.getElementById('vetBody' + i),
      arrow = document.getElementById('vetArrow' + i),
      open = body.classList.toggle('collapsed');
    arrow.textContent = open ? '›' : '⌄'
  }
  window.runVetSearch = runVetSearch;
  window.toggleVetResult = toggleVetResult;
  const old = window.renderAll;
  window.renderAll = function() {
    (typeof old === 'function' && old());
    /* [REBUILD FIX 71] Once the enhanced medicine-inventory module has loaded,
       it owns the #medicine section. Re-running this legacy page() on every
       renderAll rebuilt the section from scratch and destroyed any open
       search results the user was reading (the background sync heartbeat
       triggered it every ~18 seconds). */
    if (!window.__arsMedInventoryLoaded) page()
  };
})();