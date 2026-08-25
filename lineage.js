/* Automatic semen → breeding record → piglet lineage. Every lookup uses active farm F(). */
(function() {
  const uid = p => p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let criticalTonePlayed = false;
  let curPigletDams = []; /* [REBUILD FIX 27] filtered dam suggestions for the type-ahead */

  function normSemen(s) {
    s.id = s.id || uid('semen');
    s.boar_id = s.boar_id || s.boarId || s.boar || ('boar-' + String(s.boar || 'unknown').toLowerCase().replace(/\W+/g, '-'));
    s.boar_name = s.boar_name || s.boar || 'Unknown boar';
    s.semen_batch_no = s.semen_batch_no || s.batch_no || `${String(s.boar_name).slice(0,3).toUpperCase()}-${s.collection||s.collection_date||'LOT'}`;
    s.collection_date = s.collection_date || s.collection;
    s.available_bottles = +(s.available_bottles ?? s.bottles ?? 0);
    return s
  }

  function semenLots() {
    return (F().semen || []).map(normSemen).filter(x => !x.deleted_at)
  }

  function records(sowId) {
    return (F().breedingRecords || []).filter(x => x.sow_id === sowId && !x.deleted_at).sort((a, b) => String(b.insemination_date).localeCompare(String(a.insemination_date)))
  }

  function latestSuccessful(sowId) {
    return records(sowId).find(x => x.status === 'successful' || x.status === 'inseminated')
  }

  function prohibited(result, boar, sow) {
    /* [REBUILD FIX 29] Blocking is driven by an explicit flag from the
       compatibility engine (parent-offspring, full siblings, grandparent
       cross). The old label substring match ('parent' / 'full sibling') could
       leave Record insemination disabled on a SAFE preview whenever the
       relationship text happened to contain those words — the flag cannot. */
    if (result && result.blocked === true) return true;
    let rel = (result?.relationship || '').toLowerCase();
    return boar?.id === sow?.id || rel.includes('parent') || rel.includes('full sibling')
  }

  function criticalTone() {
    if (criticalTonePlayed) return;
    criticalTonePlayed = true;
    try {
      let C = window.AudioContext || window.webkitAudioContext,
        ctx = new C(),
        o = ctx.createOscillator(),
        g = ctx.createGain();
      o.frequency.value = 300;
      o.type = 'square';
      g.gain.value = .16;
      o.connect(g).connect(ctx.destination);
      o.start();
      o.frequency.setValueAtTime(520, ctx.currentTime + .12);
      o.stop(ctx.currentTime + .28)
    } catch (e) {}
  }

  function generatedBatch(boar, date) {
    let prefix = (boar || 'SEM').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'SEM',
      day = (date || new Date().toISOString().slice(0, 10)).replaceAll('-', ''),
      seq = String(semenLots().filter(x => String(x.semen_batch_no || '').startsWith(prefix + '-' + day)).length + 1).padStart(3, '0');
    return `${prefix}-${day}-${seq}`
  }

  function openBreedSow(index) {
    criticalTonePlayed = false;
    let sow = F().sows[index],
      lots = semenLots();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="breedModal"><form class="reminder-modal" data-sow-index="${index}" onsubmit="recordLinkedInsemination(event,${index})"><div class="modal-top"><div><div class="eyebrow">GENETICALLY LINKED INSEMINATION</div><h2>${sow.name}</h2><p>${sow.id} · genetic source is locked after offspring are generated.</p></div><button type="button" class="close-reminder" onclick="document.getElementById('breedModal').remove()">×</button></div><div class="reminder-fields"><div class="field"><label>Insemination date</label><small class="field-hint">Breeding day counts as Day 0 — Day 1 of gestation starts the next day · due date = insemination + 114 days. [REBUILD FIX 61]</small><input name="insemination_date" type="date" value="${(window.localToday ? window.localToday() : new Date().toISOString().slice(0,10))}" required></div><div class="field"><label>Technician</label><input name="technician" placeholder="Name of technician"></div><div class="field full semen-combobox"><label>Select semen batch</label><input id="semenBatchSearch" type="text" autocomplete="off" placeholder="Search or select semen batch..." onfocus="filterSemenSuggestions(this.value)" oninput="filterSemenSuggestions(this.value)"><input type="hidden" name="semen_id" id="semenBatchId"><div class="semen-suggestions" id="semenSuggestions">${lots.map(x=>`<button type="button" data-search="${(x.boar_name+' '+x.semen_batch_no).toLowerCase()}" onclick="selectSemenBatch('${x.id}')"><b>${x.boar_name}</b><span>${x.semen_batch_no}${x.available_bottles>0?` · ${x.available_bottles} bottles`:''}${lotRoleTag(x)}</span></button>`).join('')}</div><button type="button" class="manual-source-toggle" onclick="toggleManualSemenSource(${index})">+ Register New Semen Source</button></div></div><div class="manual-semen-source" id="manualSemenSource" style="display:none"><div class="eyebrow">NEW GENETIC SOURCE</div><div class="reminder-fields"><div class="field full"><label>Source type *</label><select name="manual_source_role"><option value="reference" selected>Lineage reference only — outside semen / AI (not counted as a boar)</option><option value="active">Active boar + lineage reference — live boar on this farm</option></select><small class="field-hint">Outside-bought semen stays on record for genetic lineage and inbreeding checks without inflating the boar count.</small></div><div class="field"><label>Boar name *</label><input name="manual_boar_name" oninput="previewManualSemen(${index})"></div><div class="field"><label>Boar ID</label><input name="manual_boar_id" oninput="previewManualSemen(${index})"></div><div class="field"><label>Breed</label><input name="manual_breed" oninput="previewManualSemen(${index})"></div><div class="field"><label>Source farm</label><input name="manual_source_farm" oninput="previewManualSemen(${index})"></div><div class="field"><label>Collection date</label><input name="manual_collection_date" type="date" value="${(window.localToday ? window.localToday() : new Date().toISOString().slice(0,10))}" oninput="previewManualSemen(${index})"></div><div class="field"><label>Batch number</label><input name="manual_batch_no" placeholder="Auto-generated if blank" oninput="previewManualSemen(${index})"></div><div class="field"><label>Boar sire record / ID</label><input name="manual_sire_ref" list="manualSireSuggestions" oninput="previewManualSemen(${index})"></div><div class="field"><label>Boar dam record / ID</label><input name="manual_dam_ref" list="manualDamSuggestions" oninput="previewManualSemen(${index})"></div><div class="field full"><label>Notes</label><textarea name="manual_notes" placeholder="Source, collection notes, genetic remarks"></textarea></div></div><datalist id="manualSireSuggestions">${(F().boars||[]).map(x=>`<option value="${x.id}">${x.name} · ${x.breed||''}</option>`).join('')}</datalist><datalist id="manualDamSuggestions">${(F().sows||[]).map(x=>`<option value="${x.id}">${x.name} · ${x.breed||''}</option>`).join('')}</datalist></div><div class="lineage-preview" id="semenLineagePreview">Select a semen batch or register a new source to run the pedigree compatibility check.</div><div class="form-error" id="manualSemenError"></div><div class="actions"><button type="button" class="btn ghost" onclick="document.getElementById('breedModal').remove()">Cancel</button><button class="btn" id="recordInseminationBtn">Record insemination</button></div></form></div>`)
  }

  /* [REBUILD FIX 28] marker shown on semen suggestions whose genetic source
     is lineage-only (outside semen / AI, not a live boar on the farm). */
  function lotRoleTag(lot) {
    let b = (F().boars || []).find(q => q.id === lot.boar_id || q.name === lot.boar_name);
    return (lot.boar_role === 'reference' || (b && (b.lineage_only || b.status === 'Reference'))) ? ' · lineage only' : ''
  }

  function filterSemenSuggestions(query) {
    let box = document.getElementById('semenSuggestions');
    if (!box) return;
    let q = (query || '').toLowerCase();
    box.classList.add('open');
    box.querySelectorAll('button[data-search]').forEach(b => b.style.display = !q || b.dataset.search.includes(q) ? 'flex' : 'none')
  }

  function selectSemenBatch(id) {
    let lot = semenLots().find(x => x.id === id),
      input = document.getElementById('semenBatchSearch'),
      hidden = document.getElementById('semenBatchId');
    if (!lot) return;
    hidden.value = id;
    input.value = `${lot.boar_name} · ${lot.semen_batch_no}${lot.available_bottles>0?` · ${lot.available_bottles} bottles`:''}`;
    document.getElementById('semenSuggestions').classList.remove('open');
    previewSemenLineage(id)
  }

  function toggleManualSemenSource(index) {
    let box = document.getElementById('manualSemenSource'),
      input = document.getElementById('semenBatchSearch'),
      hidden = document.getElementById('semenBatchId'),
      manual = box.style.display === 'none';
    box.style.display = manual ? 'block' : 'none';
    input.disabled = manual;
    if (manual) {
      hidden.value = '';
      input.value = '';
      document.getElementById('semenSuggestions').classList.remove('open');
      document.getElementById('semenLineagePreview').innerHTML = 'Enter a Boar Name to check the new genetic source.';
      /* [REBUILD FIX 29] switching to a new source must clear any stale block
         left by a previously selected prohibited semen batch */
      let btn = document.getElementById('recordInseminationBtn');
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('blocked-breed')
      }
    } else refreshSemenCompatibility(index)
  }

  function refreshSemenCompatibility(index) {
    let form = document.querySelector('#breedModal form'),
      box = document.getElementById('manualSemenSource');
    if (!form) return;
    let sowIndex = index ?? +form.dataset.sowIndex;
    if (box && getComputedStyle(box).display !== 'none') return previewManualSemen(sowIndex);
    let selected = form.querySelector('[name="semen_id"]')?.value;
    if (selected) previewSemenLineage(selected);
    else {
      /* [REBUILD FIX 29] nothing selected — clear any stale block so Record
         insemination is never stuck disabled */
      let btn = document.getElementById('recordInseminationBtn');
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('blocked-breed')
      }
    }
  }

  function sourcePreview(lot, boar, sow, result) {
    let box = document.getElementById('semenLineagePreview');
    if (!lot || !box) return;
    let f = +result.f || 0,
      level = f === 0 ? 'safe' : f < 6.25 ? 'caution' : f < 12.5 ? 'high' : 'critical',
      blocked = prohibited(result, boar, sow),
      btn = document.getElementById('recordInseminationBtn');
    if (btn) {
      btn.disabled = blocked;
      btn.classList.toggle('blocked-breed', blocked)
    }
    if (level === 'critical') criticalTone();
    let banner = f > 0 ? `<div class="inbreed-banner ${level}"><div class="inbreed-title">${level==='critical'?'⚠ CRITICAL RISK - INBREEDING DETECTED':level==='high'?'⚠ HIGH RISK - INBREEDING DETECTED':'⚠ CAUTION - INBREEDING DETECTED'} · F ${f.toFixed(2)}%</div><div><b>Relationship Detected:</b> ${result.relationship||'Common ancestor relationship'}</div><div><b>Mating Type:</b> ${result.message}</div>${level==='critical'?'<div class="inbreed-impact">This mating may significantly increase genetic defects and reduced performance.</div>':''}${blocked?'<div class="inbreed-block">BREEDING BLOCKED — prohibited genetic relationship.</div>':''}</div>` : `<div class="inbreed-banner safe"><div class="inbreed-title">✓ SAFE · F 0.00%</div><div>${result.message}</div></div>`;
    box.className = 'lineage-preview ' + level;
    box.innerHTML = `<div class="semen-source"><b>${lot.boar_name}</b><br><small>Genetic source: ${lot.semen_batch_no||'New batch'} · collected ${lot.collection_date||'—'}${lot.source_farm?' · '+lot.source_farm:''}</small></div>${banner}`
  }

  function previewSemenLineage(id) {
    let lot = semenLots().find(x => x.id === id);
    if (!lot) return;
    let sow = F().sows.find(x => document.querySelector('#breedModal h2')?.textContent === x.name),
      boar = (F().boars || []).find(x => x.id === lot.boar_id || x.name === lot.boar_name),
      result = window.calculateCompatibility && boar && sow ? window.calculateCompatibility(boar.id, sow.id) : {
        r: 'SAFE',
        relationship: 'No linked boar profile',
        f: 0,
        message: 'Boar profile is not yet linked; add the boar pedigree for deep compatibility screening.'
      };
    sourcePreview(lot, boar, sow, result)
  }

  function previewManualSemen(index) {
    let form = document.querySelector('#breedModal form'),
      d = Object.fromEntries(new FormData(form)),
      name = d.manual_boar_name?.trim();
    if (!name) return;
    let sow = F().sows[index],
      existing = (F().boars || []).find(b => b.id === d.manual_boar_id || b.name?.toLowerCase() === name.toLowerCase()),
      boar = existing || {
        id: d.manual_boar_id || 'manual-' + name.toLowerCase().replace(/\W+/g, '-'),
        name,
        sireRef: d.manual_sire_ref,
        damRef: d.manual_dam_ref
      };
    let result;
    if (existing && window.calculateCompatibility) result = window.calculateCompatibility(existing.id, sow.id);
    else if (boar.id === sow.sireRef || boar.id === sow.damRef) result = {
      r: 'CRITICAL RISK',
      relationship: 'Parent → Offspring',
      f: 25,
      message: 'Manual Boar ID matches the sow’s recorded parent.'
    };
    else result = {
      r: 'SAFE',
      relationship: 'No known relationship',
      f: 0,
      message: 'New source has no complete recorded lineage yet. Add sire and dam IDs for deeper compatibility screening.'
    };
    sourcePreview({
      boar_name: name,
      semen_batch_no: d.manual_batch_no || generatedBatch(name, d.manual_collection_date),
      collection_date: d.manual_collection_date,
      source_farm: d.manual_source_farm
    }, boar, sow, result)
  }

  function resolveAnimalRef(value) {
    if (!value) return '';
    let a = [...(F().boars || []), ...(F().sows || [])].find(x => x.id === value || String(x.name || '').toLowerCase() === String(value).toLowerCase());
    return a?.id || value
  }

  function recordLinkedInsemination(e, index) {
    e.preventDefault();
    let form = e.currentTarget,
      data = Object.fromEntries(new FormData(form)),
      sow = F().sows[index],
      manualBox = document.getElementById('manualSemenSource'),
      manual = manualBox && getComputedStyle(manualBox).display !== 'none',
      err = document.getElementById('manualSemenError');
    if (err) err.classList.remove('show');
    try {
      let lot = semenLots().find(x => x.id === data.semen_id);
      if (manual) {
        let name = (data.manual_boar_name || '').trim();
        if (!name) {
          throw new Error('Boar Name is required for a new semen source.')
        }
        let boarId = (data.manual_boar_id || '').trim() || uid('boar'),
          boar = (F().boars || []).find(b => b.id === boarId || b.name?.toLowerCase() === name.toLowerCase());
        /* [REBUILD FIX 28] The keeper declares whether this genetic source is a
           live on-farm boar ('active') or an outside-semen lineage reference
           ('reference'). References keep the full genetic record for lineage /
           inbreeding checks but never count as boars anywhere. */
        let sourceRole = data.manual_source_role === 'active' ? 'active' : 'reference';
        if (!boar) {
          boar = {
            id: boarId,
            name,
            breed: data.manual_breed || '',
            sireRef: resolveAnimalRef(data.manual_sire_ref),
            damRef: resolveAnimalRef(data.manual_dam_ref),
            source_farm: data.manual_source_farm || '',
            status: sourceRole === 'active' ? 'Active' : 'Reference',
            lineage_only: sourceRole === 'reference',
            source_role: sourceRole
          };
          (F().boars || (F().boars = [])).push(boar)
        }
        lot = {
          id: uid('semen'),
          farm_id: farmId,
          boar_id: boar.id,
          boar_name: boar.name,
          boar: boar.name,
          breed: boar.breed || data.manual_breed || '',
          semen_batch_no: (data.manual_batch_no || '').trim() || generatedBatch(name, data.manual_collection_date),
          collection_date: data.manual_collection_date || new Date().toISOString().slice(0, 10),
          collection: data.manual_collection_date || new Date().toISOString().slice(0, 10),
          expiration_date: null,
          available_bottles: 0,
          bottles: 0,
          source_farm: data.manual_source_farm || '',
          notes: data.manual_notes || '',
          manual_source: true,
          boar_role: (boar.lineage_only || boar.status === 'Reference') ? 'reference' : 'active' /* FIX 28 */
        };
        (F().semen || (F().semen = [])).push(lot)
      }
      if (!lot) throw new Error('Select an existing semen batch or register a new semen source.');
      let boar = (F().boars || []).find(x => x.id === lot.boar_id || x.name === lot.boar_name),
        check = window.calculateCompatibility && boar ? window.calculateCompatibility(boar.id, sow.id) : {
          r: 'SAFE',
          f: 0,
          relationship: 'No known relationship'
        };
      if (prohibited(check, boar, sow)) throw new Error('Breeding blocked due to prohibited genetic relationship.');
      let rec = {
        id: uid('breed'),
        farm_id: farmId,
        sow_id: sow.id,
        sow_name: sow.name,
        semen_id: lot.id,
        semen_batch_no: lot.semen_batch_no,
        boar_id: lot.boar_id,
        boar_name: lot.boar_name,
        collection_date: lot.collection_date,
        insemination_date: data.insemination_date,
        technician: data.technician || '',
        status: 'inseminated',
        compatibility: check,
        created_date: new Date().toISOString()
      };
      (F().breedingRecords || (F().breedingRecords = [])).push(rec);
      lot.available_bottles = Math.max(0, (+lot.available_bottles || 0) - 1);
      lot.bottles = lot.available_bottles;
      sow.insemination = data.insemination_date;
      sow.current_breeding_record_id = rec.id;
      sow.status = 'Gestating';
      sow.lifecycle = 'Gestating'; /* A successful new insemination begins a new cycle and clears prior heat/reheat state. */
      sow.reheatDate = null;
      sow.reheatNotes = '';
      sow.lastHeatDate = null;
      sow.lastHeatNotes = '';
      if (sow.farrowingDate || sow.lactationStart) sow.lastFarrowingDate = sow.farrowingDate || sow.lactationStart;
      sow.lactationEndedAt = null;
      sow.weanedAt = null;
      sow.farrowingDate = null;
      sow.lactationStart = null;
      sow.lastSemenBoarName = lot.boar_name;
      sow.lastSemenBoarId = lot.boar_id; /* Never overwrite biological sire/dam with a breeding semen source. */
      save();
      document.getElementById('breedModal').remove();
      renderAll();
      if (window.refreshOpenDrilldown) refreshOpenDrilldown();
      toast(`Insemination linked to ${lot.semen_batch_no}`)
    } catch (ex) {
      if (err) {
        err.textContent = ex.message || 'Unable to record insemination.';
        err.classList.add('show')
      } else toast(ex.message || 'Unable to record insemination.')
    }
  }

  function pigletPage() {
    /* [REBUILD FIX 30] the live row renderer lives in piglet-ledger.js, which
       loads AFTER this file — the boot render during initial script parsing
       would otherwise throw. Defer one tick; all parser-blocking scripts have
       run by then. */
    if (!window.pigletRowHTML) {
      setTimeout(pigletPage, 50);
      return
    }
    let list = F().piglets || [];
    document.getElementById('piglets').innerHTML = `<div class="notice"><b>Live batch watchboard</b><span>Tap a row for full batch details. Rows blink when a batch needs iron (3+ days), weaning (30+ days) or its first vaccine — and show the batch's live feed plan when the Feeding Guide is set up.</span></div><div class="toolbar"><input class="search" placeholder="Search piglet batches" oninput="filterPigletRows(this.value)"><button class="btn" onclick="openLinkedPigletModal()">+ Add farrowing batch</button></div><div class="panel batch-cards" id="pigletRowList">${list.map((x,i)=>pigletRowHTML(x).replace('<em class="drill-row-caret">›</em>', `<button type="button" class="btn ghost row-mini-del" title="Delete this batch record" onclick="event.stopPropagation();deleteLinkedPiglet(${i})">🗑</button><em class="drill-row-caret">›</em>`)).join('')||'<div class="empty">No farrowing batches in this farm yet.</div>'}</div>`
  }

  function filterPigletRows(q) {
    q = q.toLowerCase();
    document.querySelectorAll('[data-piglet-search]').forEach(x => x.style.display = x.dataset.pigletSearch.includes(q) ? '' : 'none')
  }

  function openPigletModalImpl(index = null, presetSowId = null) { /* [REBUILD FIX 39] presetSowId pre-fills the dam (used by the 🐷 FARROW buttons on pregnant sow cards) */
    let p = index === null ? {} : F().piglets[index],
      sows = F().sows || [];
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="pigletModal"><form class="reminder-modal" onsubmit="saveLinkedPiglet(event,${index})"><div class="modal-top"><div><div class="eyebrow">FARROWING & OFFSPRING LINEAGE</div><h2>${index===null?'Add piglet batch':'Piglet batch lineage'}</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('pigletModal').remove()">×</button></div><div class="reminder-fields"><div class="field"><label>Batch ID *</label><input name="id" required value="${p.id||'P'+new Date().getFullYear()+'-'}" ${index!==null?'readonly':''}></div><div class="field"><label>Dam / sow *</label>${damField(index,p)}</div><div class="field"><label>Breed</label><input name="breed" id="batchBreed" list="batchBreedOptions" value="${p.breed||''}" placeholder="Auto-filled from dam and sire; editable" ${index!==null?'readonly':''}><datalist id="batchBreedOptions"><option>F1</option><option>Duroc</option><option>Landrace</option><option>Large White</option><option>Pietrain</option><option>Crossbred</option></datalist></div><div class="field"><label>Birth date *</label><input name="birth" type="date" value="${p.birth||(window.localToday ? window.localToday() : new Date().toISOString().slice(0,10))}" required ${index!==null?'readonly':''}></div><div class="field"><label>Born Alive (♂ Males)</label><input name="males" id="inpMales" type="number" min="0" value="${p.males||0}" oninput="window.updateFarrowTotals()" ${index!==null?'readonly':''}></div><div class="field"><label>Born Alive (♀ Females)</label><input name="females" id="inpFemales" type="number" min="0" value="${p.females||0}" oninput="window.updateFarrowTotals()" ${index!==null?'readonly':''}></div><div class="field"><label>Stillborn (Full-term dead)</label><input name="stillborn" id="inpStillborn" type="number" min="0" value="${p.stillborn||0}" placeholder="0" title="Full-term dead piglets at farrowing" oninput="window.updateFarrowTotals()" ${index!==null?'readonly':''}></div><div class="field"><label>Mummified (Dead in utero)</label><input name="mummified" id="inpMummified" type="number" min="0" value="${p.mummified||0}" placeholder="0" title="Shriveled/dehydrated fetuses" oninput="window.updateFarrowTotals()" ${index!==null?'readonly':''}></div></div><div class="farrow-live-totals" id="farrowTotalsBox"><span>🐷 Live Born: <b id="totLive">${(+p.males||0)+(+p.females||0)}</b></span> · <span>💀 Stillborn: <b id="totStill">${p.stillborn||0}</b></span> · <span>🏺 Mummies: <b id="totMum">${p.mummified||0}</b></span> · <span>📊 Total Farrowed: <b id="totAll">${(+p.males||0)+(+p.females||0)+(+p.stillborn||0)+(+p.mummified||0)}</b></span></div><div class="lineage-preview" id="inheritedLineage">${p.breeding_record_id?`<b>Dam: ${p.dam_name}</b><br><b>Sire: ${p.sire_name}</b><br><small>Genetic Source: ${p.semen_batch_no}</small>`:'Search and pick a dam to inherit her latest linked insemination.'}</div>${index===null?'<div class="actions"><button class="btn">Create genetic-linked batch</button></div>':'<p class="muted">View-only here — record corrections via the ✎ Edit details editor (see Batch details); every field is correctable there and re-links automatically. [FIX 30]</p>'}</form></div>`)
    /* [REBUILD FIX 39] Preset handled after the insert via applyPresetSow(presetSowId) —
       kept here as a no-op guard comment for context. */
    applyPresetSow(presetSowId)
  }

  /* ═══ [REBUILD FIX 56] the FARROW buttons must never die silently ═══
     Two layers of bulletproofing:
       1. farrowSowFromCard(index) — the sow-card buttons now pass the NUMERIC
          sow index (like every other button on the card) instead of injecting
          the id into an inline onclick string; an id containing a quote
          (e.g. RM'S-style farm data) used to make those two buttons silently
          dead on tap. The id is resolved from F().sows at tap time.
       2. openLinkedPigletModal is wrapped: any unexpected record shape that
          used to throw mid-render now surfaces a clear toast instead of
          leaving the user confused with "no respond". */
  function openLinkedPigletModal(index = null, presetSowId = null) {
    try {
      openPigletModalImpl(index, presetSowId);
      if (!document.getElementById('pigletModal')) throw new Error('the form failed to render');
    } catch (e) {
      console.error('[FIX56] farrow form failed:', e);
      toast('⚠ Could not open the farrowing form — tap again, or reopen the list. (' + ((e && e.message) || 'unknown error') + ')');
    }
  }

  function farrowSowFromCard(index) {
    try {
      const s = (F().sows || [])[index];
      if (!s) throw new Error('sow record not found (index ' + index + ')');
      openLinkedPigletModal(null, s.id);
    } catch (e) {
      console.error('[FIX56] farrow button failed:', e);
      toast('⚠ Could not open the farrowing form — ' + ((e && e.message) || 'unknown error'));
    }
  }

  /* [REBUILD FIX 39] shared by both callers: pre-select + lineage + breed for a known dam. */
  function applyPresetSow(presetSowId) {
    if (!presetSowId) return;
    let ps = (F().sows || []).find(x => x.id === presetSowId),
      inp = document.getElementById('pigletDamInput'),
      ref = document.getElementById('pigletDamRef');
    if (ps && inp && ref) {
      inp.value = ps.name + ' · ' + ps.id;
      ref.value = ps.id;
      showInheritedLineage(ps.id);
      prefillBatchBreed(ps.id);
    }
  }

  function prefillBatchBreed(sowId) {
    let sow = F().sows.find(x => x.id === sowId),
      r = latestSuccessful(sowId),
      boar = (F().boars || []).find(x => x.id === r?.boar_id || x.name === r?.boar_name),
      input = document.getElementById('batchBreed');
    if (!sow || !input || input.value) return;
    let dam = sow.breed || '',
      sire = boar?.breed || '';
    input.value = dam && sire ? (dam.toLowerCase() === sire.toLowerCase() ? dam : `${dam} × ${sire}`) : dam || sire || ''
  }

  /* [REBUILD FIX 27] Dam/sow picker: search-as-you-type instead of a native
     dropdown (same combobox pattern as the treatment target FIX 26). */
  function damField(index, p) {
    if (index !== null) {
      let label = (p.dam_name || p.sow || '') + (p.dam_id || p.sow_id ? ' · ' + (p.dam_id || p.sow_id) : '');
      return '<input value="' + esc(label) + '" disabled>'
    }
    return '<div class="treat-typeahead sow-typeahead">'
      + '<input name="sow_label" id="pigletDamInput" autocomplete="off" placeholder="Type to search — sow name or ID" '
      + 'oninput="pigletDamFilter(this.value)" onfocus="pigletDamFilter(this.value)" onblur="setTimeout(pigletDamClose,180)">'
      + '<input type="hidden" name="sow_id" id="pigletDamRef">'
      + '<div id="pigletDamSug" class="semen-suggestions treat-sug"></div></div>'
  }

  function pigletDamCandidates() {
    return (F().sows || []).map(s => ({ id: s.id, label: `${s.name} · ${s.id}`,
      search: `${s.name} ${s.id} ${s.breed || ''}`.toLowerCase() }))
  }

  function pigletDamFilter(q) {
    let box = document.getElementById('pigletDamSug'),
      ref = document.getElementById('pigletDamRef');
    if (!box) return;
    if (ref) ref.value = ''; /* retyping invalidates the previous pick */
    let term = String(q || '').trim().toLowerCase();
    curPigletDams = pigletDamCandidates().filter(c => !term || c.search.includes(term));
    box.innerHTML = curPigletDams.length ?
      curPigletDams.slice(0, 15).map((c, i) => `<button type="button" onmousedown="pigletDamPick(${i})"><span><b>${esc(c.label)}</b></span></button>`).join('') :
      '<div class="suggestion-empty">No sow matches — she must be saved on the Sow List first.</div>';
    box.classList.add('open');
    box.style.display = 'block'
  }

  function pigletDamPick(i) {
    let c = curPigletDams[i],
      input = document.getElementById('pigletDamInput'),
      ref = document.getElementById('pigletDamRef');
    if (!c || !input || !ref) return;
    input.value = c.label;
    ref.value = c.id;
    pigletDamClose();
    /* FIX 27: keep the original onchange side-effects. prefillBatchBreed is
       called from module scope here — the old inline onchange could not
       reach it, so breed auto-fill silently never ran before. */
    showInheritedLineage(c.id);
    prefillBatchBreed(c.id)
  }

  function pigletDamClose() {
    let box = document.getElementById('pigletDamSug');
    if (box) {
      box.classList.remove('open');
      box.style.display = 'none'
    }
  }

  function showInheritedLineage(sowId) {
    let sow = F().sows.find(x => x.id === sowId),
      r = latestSuccessful(sowId),
      box = document.getElementById('inheritedLineage');
    if (!box) return; /* [REBUILD FIX 56] never die on a missing preview box */
    box.innerHTML = r ? `<b>Dam: ${sow.name}</b><br><b>Sire: ${r.boar_name}</b><br><small>Genetic Source: ${r.semen_batch_no} · breeding record ${r.id}</small>` : '<span class="risk">No successful insemination record found for this sow. Record insemination first.</span>'
  }

  function saveLinkedPiglet(e, index) {
    e.preventDefault();
    let x = Object.fromEntries(new FormData(e.target)),
      sow = F().sows.find(q => q.id === x.sow_id);
    /* [REBUILD FIX 27] The dam type-ahead stores the pick in hidden sow_id; if
       the keeper typed a full sow name or ID without tapping a suggestion,
       resolve that too before saving. */
    if (!sow && x.sow_label) {
      let t = String(x.sow_label).trim().toLowerCase();
      sow = F().sows.find(q => t && (String(q.name).toLowerCase() === t || String(q.id).toLowerCase() === t || (q.name + ' · ' + q.id).toLowerCase() === t))
    }
    let r = latestSuccessful(sow ? sow.id : x.sow_id);
    if (!sow || !r) {
      toast('A linked insemination record is required before farrowing.');
      return
    }
    let p = {
      id: x.id,
      farm_id: farmId,
      breed: x.breed || sow.breed || '',
      dam_id: sow.id,
      dam_name: sow.name,
      sow: sow.name,
      sow_id: sow.id,
      sire_id: r.boar_id,
      sire_name: r.boar_name,
      sire: r.boar_name,
      semen_batch_no: r.semen_batch_no,
      semen: r.semen_batch_no,
      breeding_record_id: r.id,
      birth: x.birth,
      males: +x.males || 0,
      females: +x.females || 0,
      genetic_source_locked: true
    };
    F().piglets.push(p);
    r.status = 'successful';
    r.farrowing_date = x.birth;
    sow.farrowingDate = x.birth;
    sow.lactationStart = x.birth;
    sow.status = 'Lactating';
    sow.lifecycle = 'Lactating';
    sow.activeLitterId = p.id;
    sow.lastLitter = (+x.males || 0) + (+x.females || 0);
    save();
    document.getElementById('pigletModal').remove();
    renderAll();
    toast('Piglet lineage inherited from linked semen record')
  }

  function deleteLinkedPiglet(i) {
    let p = F().piglets[i];
    if (!p) return;
    if (!confirm(`Delete piglet batch "${p.id}"? This cannot be undone.`)) return;

    const bId = String(p.id || '').trim();

    // 1. Add to tombstone set so sync never resurrects it
    F().deleted_ids = F().deleted_ids || [];
    if (bId && !F().deleted_ids.includes(bId)) {
      F().deleted_ids.push(bId);
    }

    // 2. Remove from all local DB buckets
    if (window.DB) {
      Object.keys(DB).forEach(fKey => {
        if (DB[fKey] && Array.isArray(DB[fKey].piglets)) {
          DB[fKey].piglets = DB[fKey].piglets.filter(x => String(x.id || '').trim() !== bId);
        }
      });
    }

    save();

    // 3. Delete from Supabase cloud
    if (window.ARSCloud && typeof ARSCloud.deleteAppRecord === 'function' && farmId && bId) {
      ARSCloud.deleteAppRecord(farmId, 'piglet_batch', bId).catch(() => {});
    }

    renderAll();
    if (window.refreshOpenDrilldown) window.refreshOpenDrilldown();
    toast(`✓ Piglet batch "${bId}" deleted.`);
  }

  const escFirst = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function profileWithHistory(indexOrId) {
    let farmSows = F().sows || [];
    let index = -1;
    if (typeof indexOrId === 'number') {
      index = indexOrId;
    } else if (typeof indexOrId === 'string') {
      const clean = indexOrId.trim().toLowerCase();
      index = farmSows.findIndex(s =>
        (s.id && String(s.id).trim().toLowerCase() === clean) ||
        (s.name && String(s.name).trim().toLowerCase() === clean) ||
        (s.rfid && String(s.rfid).trim().toLowerCase() === clean)
      );
    } else if (typeof indexOrId === 'object' && indexOrId !== null) {
      index = farmSows.indexOf(indexOrId);
      if (index === -1) {
        index = farmSows.findIndex(s => (s.id && s.id === indexOrId.id) || (s.name && s.name === indexOrId.name));
      }
    }
    if (index === -1 || !farmSows[index]) {
      toast('Sow record not found.');
      return;
    }
    let sow = farmSows[index];
    let hist = records(sow.id || sow.name);

    // 1. Most Recent Farrowing Record & Pregnancy State Check
    const sowNameClean = String(sow.name || '').trim().toLowerCase();
    const sowIdClean = String(sow.id || '').trim().toLowerCase();
    const linkedBatches = (F().piglets || []).filter(b => {
      const bDamId = String(b.dam_id || b.sow_id || '').trim().toLowerCase();
      const bSow = String(b.sow || b.dam_name || '').trim().toLowerCase();
      return (sowIdClean && (bDamId === sowIdClean || bSow === sowIdClean)) ||
             (sowNameClean && (bSow === sowNameClean || bDamId === sowNameClean));
    }).sort((a, b) => String(b.birth || b.farrowingDate || '').localeCompare(String(a.birth || a.farrowingDate || '')));

    const recentBatch = linkedBatches[0] || null;
    const latestFarrowDate = recentBatch ? (recentBatch.birth || recentBatch.farrowingDate) : sow.farrowingDate;

    // Check if sow has farrowed on or after the recorded insemination date
    const hasFarrowedSinceAI = !!(latestFarrowDate && sow.insemination && latestFarrowDate >= sow.insemination);

    // Current Status
    const curStatus = (typeof status === 'function' ? status(sow) : (sow.status || 'Active'));

    // Is actively gestating right now (not yet farrowed, status is pregnant/gestating/overdue)?
    const isActivelyPregnant = !!(sow.insemination && !hasFarrowedSinceAI && !sow.lactationStart && !['Open', 'Weaned', 'Culled', 'OPEN', 'CULLED'].includes(curStatus));

    // Insemination & Gestation Calculations
    const aiDay = (isActivelyPregnant && sow.insemination) ? Math.max(0, Math.round((new Date((window.localToday ? window.localToday() : new Date().toISOString().slice(0,10)) + 'T00:00:00') - new Date(sow.insemination + 'T00:00:00')) / 864e5)) : null;
    const aiDue = (sow.insemination) ? (() => { let dd = new Date(sow.insemination + 'T00:00:00'); dd.setDate(dd.getDate() + 114); return dd.toISOString().slice(0, 10); })() : null;
    const daysRemaining = aiDay !== null ? (114 - aiDay) : null;
    const isOverdue = isActivelyPregnant && daysRemaining !== null && daysRemaining < 0;
    const gestationProgressPct = aiDay ? Math.min(100, Math.round((aiDay / 114) * 100)) : 0;

    // Resolve Semen / Service Boar Used
    const breedRecs = (F().breedingRecords || []).filter(r => 
      (sow.id && r.sow_id === sow.id) || (sow.name && (r.sow_name === sow.name || r.sow === sow.name)) ||
      (sow.insemination && (r.insemination_date === sow.insemination || r.date === sow.insemination))
    ).sort((a, b) => String(b.insemination_date || b.date || '').localeCompare(String(a.insemination_date || a.date || '')));
    const latestBreed = breedRecs[0] || null;

    let semenUsed = '';
    if (isActivelyPregnant) {
      semenUsed = sow.semen || sow.semen_batch_no || sow.service_boar || sow.lastSemenBoarName || (latestBreed ? (latestBreed.boar_name || latestBreed.boar || latestBreed.semen_batch_no) : '') || sow.boar || sow.sire || '';
    } else if (hasFarrowedSinceAI && recentBatch) {
      semenUsed = recentBatch.sire_name || recentBatch.sire || recentBatch.semen_batch_no || recentBatch.semen || (latestBreed ? (latestBreed.boar_name || latestBreed.boar) : '') || '';
    } else {
      semenUsed = sow.semen || sow.semen_batch_no || (latestBreed ? (latestBreed.boar_name || latestBreed.boar) : '') || sow.service_boar || '';
    }

    if (!semenUsed || semenUsed === '—' || semenUsed === 'Unknown') {
      semenUsed = sow.lastSemenBoarName || (recentBatch ? (recentBatch.sire_name || recentBatch.sire) : '') || 'AI Service Boar';
    }

    // 2. Housing Location
    const barnName = (F().barns || []).find(b => b.id === sow.barn_id)?.name || sow.barn_id || "Unassigned Barn";
    const penName = sow.pen_id || "Unassigned Stall";

    // 3. Breed & Age
    const sowBreed = sow.breed || "Commercial Crossbred";
    const sowDobText = sow.dob ? fmtDate(sow.dob) : "—";
    const sowAge = sow.dob ? (window.boarAgeText ? window.boarAgeText(sow.dob) : "") : "";

    // 5. Lineage (Sire & Dam)
    const sireName = sow.sire || sow.sireRef || sow.sire_name || "Unknown";
    const damName = sow.dam || sow.damRef || sow.dam_name || "Unknown";

    document.getElementById('sowProfileModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg" id="sowProfileModal">
        <div class="due-modal sow-profile sow-dossier-modal">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:var(--teal2);font-weight:700">♀ SOW DOSSIER &amp; HERD PROFILE</div>
              <h2 style="margin:2px 0 4px 0">${escFirst(sow.name)} <span class="parity-pill" style="font-size:12px;vertical-align:middle">P${sow.parity || 0}</span></h2>
              <p style="margin:0" class="muted">
                ID: <b>${escFirst(sow.id || sow.name)}</b>
                ${sow.rfid ? ` · <span class="tag-code" style="font-size:11px">📡 ${escFirst(sow.rfid)}</span>` : ''}
              </p>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('sowProfileModal').remove()">×</button>
          </div>

          <!-- Housing Location Bar -->
          <div class="rfid-location-pill" style="margin:12px 0 14px 0;background:rgba(25,74,77,0.25);border:1px solid var(--line);padding:10px 14px;border-radius:10px;display:flex;justify-content:space-between;align-items:center">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:18px">🏢</span>
              <div>
                <small class="muted" style="display:block;font-size:11px">Current Housing Location</small>
                <b>${escFirst(barnName)} — ${escFirst(penName)}</b>
              </div>
            </div>
            <button type="button" class="btn small ghost" onclick="document.getElementById('sowProfileModal').remove();window.openMovementWizard && window.openMovementWizard('${escFirst(sow.id || sow.name)}', 'sow')">🚚 Move Stall →</button>
          </div>

          <!-- 4-Card Vitals Grid -->
          <div class="sow-vitals-4grid">
            <div class="sow-vital-box">
              <small>Breed</small>
              <b>${escFirst(sowBreed)}</b>
            </div>
            <div class="sow-vital-box">
              <small>Date of Birth</small>
              <b>${sowDobText}</b>
              ${sowAge ? `<small class="muted" style="font-size:10.5px;margin-top:2px">${escFirst(sowAge)} old</small>` : ''}
            </div>
            <div class="sow-vital-box">
              <small>Parity</small>
              <b>Parity ${sow.parity || 0}</b>
            </div>
            <div class="sow-vital-box">
              <small>Lifecycle Status</small>
              <b style="color:var(--teal2)">${escFirst(curStatus)}</b>
            </div>
          </div>

          <!-- Gestation & Breeding Tracker Card -->
          <div class="sow-section-card">
            <h4>
              <span>💉 Insemination &amp; Gestation Tracker</span>
              <span class="status-pill ${curStatus.toLowerCase()}">${escFirst(curStatus)}</span>
            </h4>
            ${isActivelyPregnant ? `
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
                <div>
                  <small class="muted" style="display:block">Insemination Date:</small>
                  <b>${fmtDate(sow.insemination)}</b>
                </div>
                <div>
                  <small class="muted" style="display:block">Expected Farrowing Due Date:</small>
                  <b style="color:${isOverdue ? '#ef4444' : 'var(--teal2)'}">${fmtDate(aiDue)}</b>
                </div>
                <div style="grid-column:1/-1;border-top:1px dashed var(--line);padding-top:6px;margin-top:2px">
                  <small class="muted" style="display:block">Semen / Service Boar Used:</small>
                  <b style="color:var(--teal2);display:flex;align-items:center;gap:6px">
                    <span>🧬</span>
                    <span>${escFirst(semenUsed)}</span>
                  </b>
                </div>
              </div>
              <div class="sow-progress-bar-wrap" style="margin-top:10px">
                <div class="sow-progress-bar-fill ${isOverdue ? 'overdue' : ''}" style="width:${gestationProgressPct}%"></div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
                <span class="muted">Gestation Progress: <b>Day ${aiDay} of 114</b> (${gestationProgressPct}%)</span>
                <b style="color:${isOverdue ? '#ef4444' : 'var(--teal2)'}">${isOverdue ? (aiDay - 114) + ' Days Overdue!' : (114 - aiDay) + ' Days to Farrowing'}</b>
              </div>
            ` : `
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
                <div>
                  <small class="muted" style="display:block">Current Lifecycle Stage:</small>
                  <b style="color:var(--teal2)">${escFirst(curStatus)} · Ready for Breeding</b>
                </div>
                <div>
                  <small class="muted" style="display:block">${recentBatch ? 'Last Farrowing Date:' : 'Status Detail:'}</small>
                  <b>${recentBatch ? fmtDate(recentBatch.birth || recentBatch.farrowingDate) : 'No Active Pregnancy'}</b>
                </div>
                ${semenUsed ? `
                  <div style="grid-column:1/-1;border-top:1px dashed var(--line);padding-top:6px;margin-top:2px">
                    <small class="muted" style="display:block">Last Semen / Service Boar Used:</small>
                    <b style="color:var(--teal2);display:flex;align-items:center;gap:6px">
                      <span>🧬</span>
                      <span>${escFirst(semenUsed)}${recentBatch ? ` (Batch ${escFirst(recentBatch.id)})` : ''}</span>
                    </b>
                  </div>
                ` : ''}
              </div>
              <p class="muted" style="margin:8px 0 0 0;font-size:12px">Sow is currently open / ready for next breeding cycle. No active gestation in progress.</p>
            `}
          </div>

          <!-- Most Recent Farrowing Record Card -->
          <div class="sow-section-card">
            <h4>
              <span>🐷 Most Recent Farrowing Record</span>
              ${recentBatch ? `<span class="badge ok">Batch ${escFirst(recentBatch.id)}</span>` : '<span class="badge">No Farrowing</span>'}
            </h4>
            ${recentBatch ? `
              <div class="sow-farrow-details">
                <div>
                  <small class="muted" style="display:block">Farrowing Date:</small>
                  <b>${fmtDate(recentBatch.birth || recentBatch.farrowingDate)}</b>
                </div>
                <div>
                  <small class="muted" style="display:block">Total Litter Born:</small>
                  <b style="color:var(--teal2)">${(Number(recentBatch.males || 0) + Number(recentBatch.females || 0))} Heads</b>
                  <small class="muted">(${recentBatch.males || 0} ♂ · ${recentBatch.females || 0} ♀)</small>
                </div>
                <div>
                  <small class="muted" style="display:block">Sire / Boar Line:</small>
                  <b>${escFirst(recentBatch.sire_name || recentBatch.sire || '—')}</b>
                </div>
                <div>
                  <button type="button" class="btn ghost small" style="margin-top:2px" onclick="document.getElementById('sowProfileModal').remove();window.openBatchPerformance && window.openBatchPerformance('${escFirst(recentBatch.id)}')">👁️ View Batch Performance →</button>
                </div>
              </div>
            ` : `
              <p class="muted" style="margin:4px 0">No historical farrowing batch logged on record for this sow.</p>
            `}
          </div>

          <!-- 3-Generation Pedigree & Lineage Box -->
          <div class="sow-section-card">
            <h4>
              <span>🧬 Genetic Lineage (Sire &amp; Dam)</span>
              <button type="button" class="btn ghost small" onclick="document.getElementById('sowProfileModal').remove();window.openQuickPedigreeForSow && window.openQuickPedigreeForSow(${index})">View 3-Gen Tree →</button>
            </h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px">
              <div>
                <small class="muted" style="display:block">♂ SIRE (Father):</small>
                <b>${escFirst(sireName)}</b>
              </div>
              <div>
                <small class="muted" style="display:block">♀ DAM (Mother):</small>
                <b>${escFirst(damName)}</b>
              </div>
            </div>
          </div>

          <!-- Breeding History Log -->
          <div class="pedigree-mini" style="margin:14px 0">
            <b style="color:var(--teal2)">📜 Insemination &amp; Breeding History</b>
            ${hist.length ? hist.map(r => `
              <button type="button" class="breeding-history-item" onclick="document.getElementById('sowProfileModal').remove();openBreedingBatchDetails('${escFirst(r.id)}')">
                <span>
                  <b>${fmtDate(r.insemination_date)}</b>
                  <br>${escFirst(r.boar_name || 'Boar')} · Batch ${escFirst(r.semen_batch_no || '—')}
                  <br><small class="muted">${escFirst(r.status || 'Recorded')}</small>
                </span>
                <i>›</i>
              </button>
            `).join('') : '<p class="muted" style="margin:6px 0 0 0">No linked historical insemination records yet.</p>'}
          </div>

          <!-- Interactive Actions Toolbar -->
          <div class="profile-actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn ghost" onclick="document.getElementById('sowProfileModal').remove();${isActivelyPregnant ? 'openReheatRecord' : 'openHeatRecord'}(${index})">${isActivelyPregnant ? '🔥 Record Reheat' : '☼ Record Heat'}</button>
            <button type="button" class="btn" onclick="document.getElementById('sowProfileModal').remove();openBreedSow(${index})">⌁ Breed / Inseminate</button>
            ${isActivelyPregnant ? `<button type="button" class="btn ghost" onclick="document.getElementById('sowProfileModal').remove();openLinkedPigletModal(null,'${escFirst(sow.id || sow.name)}')">🐷 Record Farrowing</button>` : ''}
            <button type="button" class="btn ghost" onclick="document.getElementById('sowProfileModal').remove();window.openQuickVaxForSow && window.openQuickVaxForSow(${index})">💉 + Vaccine</button>
            <button type="button" class="btn ghost" onclick="document.getElementById('sowProfileModal').remove();editRecord('sows',${index})">✎ Edit Sow</button>
          </div>
        </div>
      </div>
    `);
  }

  function detailDate(date, add) {
    if (!date) return 'N/A';
    let d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + add);
    return fmtDate(d.toISOString().slice(0, 10))
  }

  function openBreedingBatchDetails(id) {
    let r = (F().breedingRecords || []).find(x => x.id === id);
    if (!r) {
      toast('Breeding record not found.');
      return
    }
    let batch = (F().piglets || []).find(x => x.breeding_record_id === id),
      total = batch ? (+batch.males || 0) + (+batch.females || 0) : null,
      jid = String(id).split("'").join("\\'");
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="breedingDetailModal"><div class="reminder-modal breeding-detail"><div class="modal-top"><div><div class="eyebrow">BREEDING BATCH DETAILS</div><h2>${r.semen_batch_no||r.id}</h2></div><button class="close-reminder" onclick="document.getElementById('breedingDetailModal').remove()">×</button></div><div class="batch-summary"><div><small>Sow</small><b>${r.sow_name||'N/A'}</b></div><div><small>Status</small><b class="tag">${r.status||'N/A'}</b></div><div><small>Record ID</small><b>${r.id}</b></div></div><div class="batch-detail-grid"><section><h3>General Breeding Info</h3><p><b>Insemination Date</b><span>${fmtDate(r.insemination_date)}</span></p><p><b>Boar / Semen Source</b><span>${r.boar_name||'N/A'}</span></p><p><b>Batch Tracking ID</b><span>${r.semen_batch_no||'N/A'}</span></p><p><b>Technician</b><span>${r.technician||'N/A'}</span></p></section><section><h3>Cycle & Expected Dates</h3><p><b>Expected Heat Return</b><span>${detailDate(r.insemination_date,21)}</span></p><p><b>Expected Farrowing</b><span>${detailDate(r.insemination_date,114)}</span></p><p><b>Pregnancy / Cycle Notes</b><span>${r.failure_reason||r.pregnancy_notes||'N/A'}</span></p></section><section><h3>Performance & Record Metrics</h3><p><b>Total Litter</b><span>${total??'N/A'}</span></p><p><b>Live Pigs Born</b><span>${total??'N/A'}</span></p><p><b>Birth / Litter Notes</b><span>${batch?.notes||batch?.litter_notes||'N/A'}</span></p><p><b>Remarks</b><span>${r.notes||'N/A'}</span></p></section></div><div class="actions"><button class="btn ghost delete-action" onclick="deleteBreedingRecord('${jid}')">🗑 Delete record</button><button class="btn ghost" onclick="window.print()">Print / Export PDF</button><button class="btn" onclick="document.getElementById('breedingDetailModal').remove()">Close</button></div></div></div>`)
  }

  /* ═════════ [REBUILD FIX 33] Delete a breeding record ═════════
     Soft-delete (deleted_at) — it vanishes from the Breeding History list,
     sow cards and the gestating tools, but farrowed piglet batches keep their
     breeding_record_id so genetic lineage and certificates stay intact.
     Deleting the sow's CURRENT inseminated cycle stops that pregnancy
     tracking and returns her to Open (same reset the reheat/failed flow
     performs, plus the explicit status reset the weaning flow uses). */
  function deleteBreedingRecord(id) {
    let r = (F().breedingRecords || []).find(x => x.id === id);
    if (!r) { toast('Breeding record not found.'); return }
    let sow = (F().sows || []).find(s => s.id === r.sow_id),
      offspring = (F().piglets || []).filter(x => x.breeding_record_id === id && !x.archived),
      isCurrent = !!(sow && sow.current_breeding_record_id === id && r.status === 'inseminated'),
      msg = `Delete breeding record ${r.semen_batch_no || r.id} (${r.sow_name || 'sow'} · ${fmtDate(r.insemination_date)})? It disappears from the breeding history and cannot be undone.`;
    if (isCurrent) msg += `\n\nThis is ${sow.name}'s CURRENT pregnancy tracking — deleting stops it and returns her to Open status.`;
    if (offspring.length) msg += `\n\nThe farrowed batch ${offspring.map(x => x.id).join(', ')} is NOT deleted.`;
    if (!confirm(msg)) return;
    r.deleted_at = new Date().toISOString();
    if (sow && sow.current_breeding_record_id === id) {
      sow.current_breeding_record_id = null;
      if (isCurrent) { /* FIX 33: mirror reheat "failed" reset + explicit Open like the weaning flow */
        sow.insemination = null;
        sow.status = 'Open';
        sow.lifecycle = 'Open'
      }
    }
    save();
    document.getElementById('breedingDetailModal')?.remove();
    let prof = document.getElementById('sowProfileModal');
    if (prof && sow) { prof.remove(); profileWithHistory(F().sows.indexOf(sow)) } /* FIX 33: refresh the history list behind */
    renderAll();
    if (window.refreshOpenDrilldown) refreshOpenDrilldown();
    toast('Breeding record deleted')
  }
  window.deleteBreedingRecord = deleteBreedingRecord; /* FIX 33 */
  const oldCrud = window.crudPage;
  window.crudPage = function(k) {
    if (k === 'piglets') return pigletPage();
    return oldCrud(k)
  };
  const oldRender = window.renderAll;
  window.renderAll = function() {
    (typeof oldRender === 'function' && oldRender());
    pigletPage()
  };
  window.openBreedingBatchDetails = openBreedingBatchDetails;
  window.openBreedSow = openBreedSow;
  window.filterSemenSuggestions = filterSemenSuggestions;
  window.selectSemenBatch = selectSemenBatch;
  window.refreshSemenCompatibility = refreshSemenCompatibility;
  window.toggleManualSemenSource = toggleManualSemenSource;
  window.previewManualSemen = previewManualSemen;
  window.previewSemenLineage = previewSemenLineage;
  window.recordLinkedInsemination = recordLinkedInsemination;
  window.openLinkedPigletModal = openLinkedPigletModal;
  window.farrowSowFromCard = farrowSowFromCard; /* [REBUILD FIX 56] */
  window.showInheritedLineage = showInheritedLineage;
  window.pigletDamFilter = pigletDamFilter;
  window.pigletDamPick = pigletDamPick;
  window.pigletDamClose = pigletDamClose;
  window.damField = damField;
  window.saveLinkedPiglet = saveLinkedPiglet;
  window.deleteLinkedPiglet = deleteLinkedPiglet;
  window.filterPigletRows = filterPigletRows;
  window.openSowProfile = profileWithHistory;

})();
window.updateFarrowTotals = function() {
  const m = parseInt(document.getElementById('inpMales')?.value || '0', 10) || 0;
  const f = parseInt(document.getElementById('inpFemales')?.value || '0', 10) || 0;
  const s = parseInt(document.getElementById('inpStillborn')?.value || '0', 10) || 0;
  const mu = parseInt(document.getElementById('inpMummified')?.value || '0', 10) || 0;
  const live = m + f;
  const all = live + s + mu;

  const elLive = document.getElementById('totLive');
  const elStill = document.getElementById('totStill');
  const elMum = document.getElementById('totMum');
  const elAll = document.getElementById('totAll');

  if (elLive) elLive.textContent = live;
  if (elStill) elStill.textContent = s;
  if (elMum) elMum.textContent = mu;
  if (elAll) elAll.textContent = all;
};
