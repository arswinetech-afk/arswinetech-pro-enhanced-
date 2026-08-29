/* ═══ [REBUILD FIX 55] FOSTER BATCH — piglets raised by a nurse sow ═══
   The Piglet Batches drill-down "Quick action" opens a chooser menu:
     • 🤱 Foster batch — move male+female heads OUT of one or MULTIPLE live
       batches into a surrogate ("nurse") sow.
       - If the surrogate sow already has an active piglet batch, the farmer
         can directly add the fostered piglets into her existing batch
         (which tags the batch as 🍼 Cross-Fostered with an animated badge).
       - Or create a separate new foster batch ID.
       Source batches auto-DEDUCT per sex (5M/5F → foster 1M+1F → 4M/4F
       left); the new/updated batch appears with the 🍼 FOSTERED badge.
     • 🐖 Add farrowing batch — the regular form (unchanged). */
(function () {
  const escH = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const num = v => { let n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : null; };

  const heads = b => Math.max(0, (+b.males || 0) + (+b.females || 0));
  const liveBatches = () => (F().piglets || []).filter(b => !b.archived && !b.deleted_at && heads(b) > 0);
  const batchOf = id => (F().piglets || []).find(b => b.id === id);

  function activeSowList() {
    return (F().sows || []).filter(s => String(s.status || '') !== 'Culled');
  }
  function sowHasLiveLitter(s) {
    return (F().piglets || []).some(b => !b.archived && (b.dam_id === s.id || b.sow_id === s.id || b.sow === s.name || b.dam_name === s.name));
  }

  function genFosterId(nurseName) {
    const prefix = 'FB-' + (nurseName || 'FOS').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'FB-FOS',
      day = new Date().toISOString().slice(0, 10).replaceAll('-', ''),
      seq = String((F().piglets || []).filter(x => String(x.id || '').startsWith(prefix + '-' + day)).length + 1).padStart(3, '0');
    return `${prefix}-${day}-${seq}`;
  }

  /* ── Quick action chooser (Piglet Batches drill-down) ─────────────────── */
  function openPigletQuickMenu() {
    document.getElementById('pigletQuickMenu')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="pigletQuickMenu"><div class="due-modal" style="text-align:left"><div class="modal-top"><div><div class="eyebrow">PIGLET BATCHES — QUICK ACTION</div><h2>What would you like to do?</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('pigletQuickMenu').remove()">×</button></div>
      <div class="semen-stock-menu">
        <button type="button" onclick="openFosterModal()"><span class="ss-icon">🤱</span><span><b>Foster batch</b><small>Move piglets from one or more litters to a surrogate nurse sow — heads are counted per sex, sources auto-adjust, and the fostered group becomes or merges into a fostered batch.</small></span></button>
        <button type="button" onclick="document.getElementById('pigletQuickMenu').remove(); openLinkedPigletModal()"><span class="ss-icon">🐖</span><span><b>Add farrowing batch</b><small>Record a sow's new farrowing (normal batch — unchanged flow).</small></span></button>
        <!-- [REBUILD FIX 101] buyers / backyard growers: record purchased piglets -->
        <button type="button" onclick="openPurchasedBatchModal()"><span class="ss-icon">🛒</span><span><b>Add purchased batch</b><small>Bought piglets from another farm — record supplier, heads and price per head; the cost is booked automatically into Financials under "Piglet Purchases".</small></span></button>
      </div>
    </div></div>`);
  }

  /* [FIX 101] purchased-piglet batch (no farrowing sow on this farm) */
  function openPurchasedBatchModal() {
    document.getElementById('purchasedBatchModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="purchasedBatchModal" style="z-index:10000000!important" onclick="if(event.target===this)this.remove()">
      <form class="due-modal" style="max-width:560px;width:96%;text-align:left" onsubmit="savePurchasedBatch(event)">
        <div class="modal-top"><div><div class="eyebrow" style="color:var(--teal2);letter-spacing:.12em;font-weight:800">PIGLET BATCHES — PURCHASED</div><h2>🛒 Add purchased batch</h2><small class="muted">For piglets bought from another farm — becomes a normal batch you can track, feed, vaccinate and sell.</small></div><button type="button" class="close-reminder" onclick="document.getElementById('purchasedBatchModal')?.remove()">×</button></div>
        <div class="reminder-fields">
          <div class="field"><label>Batch ID</label><input name="id" placeholder="auto if blank · e.g. P2026-BUY1"></div>
          <div class="field"><label>Supplier / source farm *</label><input name="supplier" required placeholder="e.g. Alvarez Farm, Iriga"></div>
          <div class="field"><label>Purchase date *</label><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></div>
          <div class="field"><label>Breed</label><input name="breed" placeholder="e.g. Duroc × Landrace"></div>
          <div class="field"><label>♂ Males *</label><input name="males" type="number" min="0" value="0" required></div>
          <div class="field"><label>♀ Females *</label><input name="females" type="number" min="0" value="0" required></div>
          <div class="field"><label>Price per head (₱) *</label><input name="price" type="number" min="0" step="0.01" required placeholder="e.g. 2500"></div>
          <div class="field"><label>Age at purchase (days)</label><input name="age_days" type="number" min="0" placeholder="optional — sets birth date"></div>
          <div class="field"><label>or Birth date (if known)</label><input name="birth" type="date"></div>
          <div class="field"><label>Notes</label><input name="notes" placeholder="transport, health status on arrival…"></div>
        </div>
        <small class="muted" style="display:block;margin:10px 0">Total cost (heads × price) is recorded as an <b>Expense → "Piglet Purchases"</b> and appears in the Income Statement &amp; expense mix.</small>
        <div class="due-actions" style="justify-content:flex-end"><button type="button" class="btn ghost" onclick="document.getElementById('purchasedBatchModal')?.remove()">Cancel</button><button class="btn">Save purchased batch</button></div>
      </form></div>`);
  }
  window.openPurchasedBatchModal = openPurchasedBatchModal;

  function savePurchasedBatch(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const males = Math.max(0, Math.floor(num(d.males) || 0));
    const females = Math.max(0, Math.floor(num(d.females) || 0));
    const totalHeads = males + females;
    const price = Math.max(0, num(d.price) || 0);
    if (!totalHeads) { toast('⚠ Enter the number of male and/or female piglets purchased.'); return; }
    const pid = (d.id || '').trim() || ('P' + new Date().getFullYear() + '-BUY' + String((F().piglets || []).length + 1));
    if ((F().piglets || []).some(b => b.id === pid)) { toast('⚠ That Batch ID already exists.'); return; }
    const pDate = d.date || new Date().toISOString().slice(0, 10);
    const ageDays = Math.max(0, Math.floor(num(d.age_days) || 0));
    let birth = (d.birth || '').trim();
    if (!birth && ageDays > 0) { const dt = new Date(pDate + 'T00:00:00'); dt.setDate(dt.getDate() - ageDays); birth = dt.toISOString().slice(0, 10); }
    const supplier = (d.supplier || '').trim() || 'outside farm';
    (F().piglets = F().piglets || []).push({
      id: pid, dam_name: 'Purchased · ' + supplier, sow: 'Purchased · ' + supplier, sire_name: '—',
      breed: (d.breed || '').trim(), birth: birth, males: males, females: females,
      origin: 'purchased', supplier: supplier, purchase_date: pDate, purchase_price_per_head: price,
      notes: d.notes || '', created_at: new Date().toISOString()
    });
    const total = totalHeads * price;
    if (total > 0) {
      (F().transactions = F().transactions || []).unshift({
        id: 'tx-' + Date.now().toString(36) + '-pigbuy', date: pDate, type: 'Expense',
        category: 'Piglet Purchases',
        description: `Purchased ${totalHeads} piglet${totalHeads > 1 ? 's' : ''} @ ${(typeof peso === 'function' ? peso(price) : price)}/head from ${supplier} (Batch ${pid})`,
        amount: total, paid: total, created_at: new Date().toISOString()
      });
    }
    save();
    document.getElementById('purchasedBatchModal')?.remove();
    document.getElementById('pigletQuickMenu')?.remove();
    if (typeof renderAll === 'function') renderAll();
    toast(`🛒 Batch ${pid} recorded — ${(typeof peso === 'function' ? peso(total) : total)} booked under Piglet Purchases.`);
  }
  window.savePurchasedBatch = savePurchasedBatch;

  /* ── the foster-batch desk ───────────────────────────────────────────── */
  let fb = null;
  let cachedNurseHits = [];

  function fbNurseFilter(q) {
    const dropdown = document.getElementById("fbNurseDropdown");
    const clearBtn = document.getElementById("fbNurseClear");
    if (!dropdown) return;
    const sows = activeSowList();
    const term = String(q || '').trim().toLowerCase();
    if (clearBtn) clearBtn.style.display = term ? 'block' : 'none';

    cachedNurseHits = sows.filter(s => {
      if (!term) return true;
      return (s.name + ' ' + (s.id || '') + ' ' + (s.breed || '')).toLowerCase().includes(term);
    });

    if (!cachedNurseHits.length) {
      dropdown.innerHTML = `<div class="suggest-empty" style="padding:10px 12px;color:var(--muted)">No matching sows found.</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = cachedNurseHits.map((s, idx) => {
      const activeBatch = (F().piglets || []).find(b => !b.archived && (b.dam_id === s.id || b.sow_id === s.id || b.sow === s.name || b.dam_name === s.name));
      const isNursing = !!activeBatch || sowHasLiveLitter(s) || (typeof status === 'function' && status(s) === 'Lactating');
      return `
        <div class="suggest-item" onmousedown="window.fbNursePick(${idx})" ontouchstart="window.fbNursePick(${idx})" style="cursor:pointer">
          <div class="suggest-ico sow" style="background:#ec4899;color:#fff">♀</div>
          <div class="suggest-meta">
            <b>${escH(s.name)} ${activeBatch ? `<span class="badge ok" style="font-size:10.5px">🍼 Nursing: ${escH(activeBatch.id)}</span>` : (isNursing ? '<span class="badge ok" style="font-size:10.5px">Currently Nursing</span>' : '')}</b>
            <small>${escH(s.breed || 'Sow')} · Parity ${s.parity || 1}${s.id ? ` · (${escH(s.id)})` : ''}</small>
          </div>
        </div>
      `;
    }).join("");

    dropdown.style.display = "block";
  }

  function fbNursePick(idx) {
    const s = cachedNurseHits[idx];
    if (!s) return;
    const input = document.getElementById("fbNurseInput");
    const hidden = document.getElementById("fbNurseVal");
    const clearBtn = document.getElementById("fbNurseClear");
    const dropdown = document.getElementById("fbNurseDropdown");

    if (input) input.value = s.name + (s.breed ? ` · ${s.breed}` : '');
    if (hidden) hidden.value = s.name;
    if (clearBtn) clearBtn.style.display = 'block';
    if (dropdown) dropdown.style.display = 'none';

    fbNurseChange(s.name);
  }

  function fbNurseClear() {
    const input = document.getElementById("fbNurseInput");
    const hidden = document.getElementById("fbNurseVal");
    const clearBtn = document.getElementById("fbNurseClear");
    if (input) { input.value = ''; try { input.focus(); } catch (e) {} }
    if (hidden) hidden.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    fbNurseChange('');
    fbNurseFilter('');
  }

  function openFosterModal() {
    document.getElementById('pigletQuickMenu')?.remove();
    document.getElementById('fosterModal')?.remove();
    fb = { lines: [], hits: [], breedTouched: false, idTouched: false, nurse: null, existingBatch: null, mode: 'new' };

    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="fosterModal"><form class="due-modal" style="text-align:left" onsubmit="saveFosterBatch(event)"><div class="modal-top"><div><div class="eyebrow">🤱 FOSTER BATCH</div><h2>Transfer piglets to a nurse sow</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('fosterModal').remove()">×</button></div>
      <p class="field-hint" style="margin:0 0 10px">A <b>fostered batch</b> is piglets moved from their biological dam to be raised &amp; nursed by a surrogate sow. Heads move per sex — each source batch auto-adjusts (e.g. 5♂/5♀ → foster 1♂+1♀ → 4♂/4♀ left) and the fostered piglets gain a 🍼 <b>FOSTERED</b> badge.</p>
      <div class="reminder-fields">
        <div class="field full suggest-field" style="position:relative"><label>Nurse (surrogate) sow * <small class="field-hint">type to search sows</small></label>
          <div class="suggest-input-wrap">
            <input type="text" id="fbNurseInput" class="suggest-input" placeholder="Type sow name to search..." autocomplete="off" onfocus="window.fbNurseFilter(this.value)" oninput="window.fbNurseFilter(this.value)" onblur="setTimeout(()=>{const d=document.getElementById('fbNurseDropdown');if(d)d.style.display='none';},220)">
            <input type="hidden" name="nurse" id="fbNurseVal" required>
            <button type="button" class="suggest-clear-btn" id="fbNurseClear" onclick="window.fbNurseClear()" style="display:none">✕</button>
            <div class="suggest-dropdown" id="fbNurseDropdown" style="display:none"></div>
          </div>
        </div>
      </div>

      <!-- Dynamic Surrogate Batch Choice (Direct Merge vs Standalone) -->
      <div id="fbNurseBatchChoice" style="display:none"></div>

      <div class="field" style="margin-top:10px"><label>＋ Source batch(es) to take piglets from *</label>
        <div class="treat-typeahead"><input id="fbSrcInput" autocomplete="off" placeholder="Search live batches — id, dam, breed…" oninput="window.fbSrcFilter(this.value)" onfocus="window.fbSrcFilter(this.value)" onblur="setTimeout(window.fbSrcClose,180)"><div id="fbSrcSug" class="semen-suggestions treat-sug"></div></div>
        <small class="field-hint">add as many source batches as needed — each moves its own male/female heads</small>
        <div id="fbSrcList" class="adj-lines"></div>
      </div>
      <div class="reminder-fields" style="margin-top:10px">
        <div class="field"><label>Breed (foster batch) *</label><input name="breed" id="fbBreedInp" list="fbBreeds" placeholder="auto from sources" oninput="window.fbBreedTouch()"><datalist id="fbBreeds"><option>F1</option><option>Duroc</option><option>Landrace</option><option>Large White</option><option>Pietrain</option><option>Crossbred</option></datalist></div>
        <div class="field" id="fbIdFieldWrap"><label>Foster batch ID *</label><input name="bid" id="fbIdInp" value="${genFosterId('FOS')}" oninput="window.fbIdTouch()"></div>
        <div class="field full"><label>Note</label><input name="note" placeholder="Reason — weak litter, orphan piglets, small teats…"></div>
      </div>
      <div class="adj-recon" id="fbRecon"></div>
      <p class="field-hint">Saved with an automatic date &amp; time stamp. 💉 vaccination starts fresh for this batch (record its shots like any normal batch); 💊 iron / ✂ castration alerts are carried over as done only when EVERY source batch is already done.</p>
      <div class="form-error" id="fbErr"></div>
      <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('fosterModal').remove()">Cancel</button><button class="btn">🤱 Save foster transfer</button></div>
    </form></div>`);
    fbCalc();
  }

  /* nurse change → refresh the auto batch id or present direct merge option */
  function fbNurseChange(name) {
    const nurse = (F().sows || []).find(s => s.name === name);
    const existingBatch = nurse ? (F().piglets || []).find(b => !b.archived && (b.dam_id === nurse.id || b.sow_id === nurse.id || b.sow === nurse.name || b.dam_name === nurse.name)) : null;
    const choiceBox = document.getElementById('fbNurseBatchChoice');
    const idField = document.getElementById('fbIdFieldWrap');

    if (fb) {
      fb.nurse = nurse;
      fb.existingBatch = existingBatch;
      fb.mode = existingBatch ? 'merge' : 'new';
    }

    if (choiceBox) {
      if (existingBatch) {
        choiceBox.innerHTML = `
          <div class="foster-choice-card" style="background:rgba(236,72,153,0.12);border:1.5px solid rgba(236,72,153,0.5);border-radius:12px;padding:12px 14px;margin:12px 0;animation:fadeIn 0.2s ease-out">
            <div style="display:flex;align-items:center;gap:8px;font-weight:800;color:#f472b6;font-size:13.5px;margin-bottom:6px">
              <span style="font-size:18px">🍼</span>
              <span>${escH(nurse.name)} has an existing nursing batch: <b>${escH(existingBatch.id)}</b> (${(+existingBatch.males || 0)}♂ / ${(+existingBatch.females || 0)}♀)</span>
            </div>
            <p style="margin:0 0 10px;font-size:12px;color:var(--muted)">Choose how to register the fostered piglets:</p>
            <div style="display:flex;flex-direction:column;gap:8px">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;font-weight:750;color:var(--ink)">
                <input type="radio" name="foster_mode" value="merge" checked onchange="window.fbModeChange('merge')">
                <span>➕ <b>Add into ${escH(existingBatch.id)}</b> (Adds directly to heads + tags as <span class="foster-animated-badge">🍼 FOSTERED</span>)</span>
              </label>
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;color:var(--ink)">
                <input type="radio" name="foster_mode" value="new" onchange="window.fbModeChange('new')">
                <span>👶 <b>Create as separate new batch ID</b> (New standalone foster batch)</span>
              </label>
            </div>
          </div>
        `;
        choiceBox.style.display = 'block';
        if (idField) idField.style.display = 'none';
      } else {
        choiceBox.innerHTML = '';
        choiceBox.style.display = 'none';
        if (idField) idField.style.display = 'block';
      }
    }

    if (fb && !fb.idTouched && (!existingBatch || fb.mode === 'new')) {
      let i = document.getElementById('fbIdInp');
      if (i) i.value = genFosterId(name);
    }
    fbCalc();
  }

  function fbModeChange(mode) {
    if (fb) fb.mode = mode;
    const idField = document.getElementById('fbIdFieldWrap');
    if (idField) idField.style.display = mode === 'merge' ? 'none' : 'block';
    fbCalc();
  }

  function fbBreedTouch() { if (fb) fb.breedTouched = true; }
  function fbIdTouch() { if (fb) fb.idTouched = true; }

  /* ── source-batch picker (auto-suggest like the customer / semen searches) ── */
  function fbCandidates() {
    return liveBatches().filter(b => !fb.lines.some(l => l.bid === b.id));
  }
  function fbSrcFilter(q) {
    let box = document.getElementById('fbSrcSug');
    if (!box) return;
    const term = String(q || '').trim().toLowerCase(),
      hits = fbCandidates().filter(b => !term || (b.id + ' ' + (b.dam_name || b.sow || '') + ' ' + (b.sire_name || b.sire || '') + ' ' + (b.breed || '')).toLowerCase().includes(term));
    fb.hits = hits;
    box.innerHTML = hits.length
      ? hits.map((b, i) => `<button type="button" onmousedown="window.fbSrcPick(${i})" ontouchstart="window.fbSrcPick(${i})"><span><b>${escH(b.id)}</b><br><small>${escH(b.breed || '—')} · born ${fmtDate(b.birth)}</small></span><span class="treat-sug-heads">${escH(b.dam_name || b.sow || '—')} → ${escH(b.sire_name || b.sire || '—')} · <b>${+b.males || 0}♂ ${+b.females || 0}♀</b></span></button>`).join('')
      : `<div class="suggestion-empty">${term ? 'No matching live batch.' : 'No live batch with heads left to foster from.'}</div>`;
    box.classList.add('open');
    box.style.display = 'block';
  }
  function fbSrcPick(i) {
    const b = fb.hits[i];
    if (!b) return;
    fb.lines.push({ bid: b.id, m: 0, f: 0 });
    document.getElementById('fbSrcInput').value = '';
    fbSrcClose();
    fbRenderLines();
    fbCalc();
  }
  function fbSrcClose() { let b = document.getElementById('fbSrcSug'); if (b) { b.classList.remove('open'); b.style.display = 'none'; } }
  function fbQty(bid, sex, v) {
    const l = fb.lines.find(x => x.bid === bid);
    if (l) l[sex] = Math.max(0, Math.floor(num(v) || 0));
    fbCalc();
  }
  function fbRemove(bid) { fb.lines = fb.lines.filter(x => x.bid !== bid); fbRenderLines(); fbCalc(); }

  function fbRenderLines() {
    const box = document.getElementById('fbSrcList');
    if (!box) return;
    box.innerHTML = fb.lines.map(l => {
      const b = batchOf(l.bid);
      if (!b) return '';
      return `<div class="adj-card adj-origin"><div class="adj-card-title">⇢ take from this batch <button type="button" class="adj-x" onclick="window.fbRemove('${String(b.id).split("'").join("\\'")}')" title="Remove">×</button></div>
        <b>${escH(b.id)}</b> · ${escH(b.dam_name || b.sow || '—')} → ${escH(b.sire_name || b.sire || '—')}<br>
        <span>${escH(b.breed || '—')} · born ${fmtDate(b.birth)} · on hand <b>${+b.males || 0}♂ / ${+b.females || 0}♀</b></span>
        <div class="adj-qty-row"><label>♂ males to foster</label><input type="number" step="1" value="${l.m}" oninput="window.fbQty('${String(b.id).split("'").join("\\'")}', 'm', this.value)"><label>♀ females</label><input type="number" step="1" value="${l.f}" oninput="window.fbQty('${String(b.id).split("'").join("\\'")}', 'f', this.value)"><span>→ left: <b id="fb-left-${l.bid.replace(/[^a-z0-9_-]/gi, '_')}">${(+b.males || 0) - l.m}♂ / ${(+b.females || 0) - l.f}♀</b></span></div>
      </div>`;
    }).join('');
  }

  /* auto breed: single source breed → that; differing breeds → joined list */
  function fbAutoBreed(moves) {
    const set = [...new Set(moves.map(l => (batchOf(l.bid) || {}).breed).filter(Boolean))];
    return !set.length ? '' : set.length === 1 ? set[0] : set.join(' / ');
  }

  function fbCalc() {
    const recon = document.getElementById('fbRecon');
    if (!recon) return;
    const moves = (fb ? fb.lines : []).filter(l => (l.m || l.f) > 0),
      m = moves.reduce((a, l) => a + l.m, 0), f = moves.reduce((a, l) => a + l.f, 0),
      auto = fbAutoBreed(moves.length ? moves : (fb ? fb.lines : [])),
      nurse = document.querySelector('#fosterModal [name="nurse"]')?.value || '';
    /* keep the breed helper in sync until the user edits it by hand */
    if (fb && !fb.breedTouched) { let bi = document.getElementById('fbBreedInp'); if (bi) bi.value = auto; }
    if (fb) {
      fb.lines.forEach(l => {
        const b = batchOf(l.bid),
          el = document.getElementById('fb-left-' + l.bid.replace(/[^a-z0-9_-]/gi, '_'));
        if (b && el) el.textContent = `${(+b.males || 0) - l.m}♂ / ${(+b.females || 0) - l.f}♀`;
      });
    }
    if (!moves.length) {
      recon.innerHTML = 'Pick source batch(es) above and set how many ♂ / ♀ heads move — the live count check appears here.';
      return;
    }
    const births = moves.map(l => (batchOf(l.bid) || {}).birth).filter(Boolean).sort(),
      earliest = births[0] || '',
      per = moves.map(l => {
        const b = batchOf(l.bid) || {};
        return `⇢ ${escH(l.bid)} (${escH(b.dam_name || b.sow || '—')}): −${l.m}♂ −${l.f}♀ → ${(+b.males || 0) - l.m}♂/${(+b.females || 0) - l.f}♀ left`;
      }).join('<br>');
    recon.innerHTML = `Fostering <b>${m}♂ + ${f}♀ = ${m + f} head(s)</b> from <b>${moves.length}</b> batch(es)${nurse ? ` → 🤱 <b>${escH(nurse)}</b>` : ''}<br>${per}<br><small>breed: <b>${escH(auto || '—')}</b>${earliest ? ` · earliest birth: <b>${fmtDate(earliest)}</b> (batch age follows it)` : ''}</small>`;
  }

  /* ── save ────────────────────────────────────────────────────────────── */
  function saveFosterBatch(e) {
    e.preventDefault();
    const err = document.getElementById('fbErr'),
      show = m => { err.textContent = m; err.classList.add('show'); };
    err.classList.remove('show');
    const d = Object.fromEntries(new FormData(e.target));
    try {
      const nurseName = String(d.nurse || '').trim(),
        nurse = (F().sows || []).find(s => s.name === nurseName);
      if (!nurse) throw new Error('Pick the nurse (surrogate) sow.');
      const moves = (fb ? fb.lines : []).filter(l => (l.m || l.f) > 0);
      if (!moves.length) throw new Error('Add at least one source batch and set how many male/female heads move.');
      moves.forEach(l => {
        const b = batchOf(l.bid);
        if (!b) throw new Error('A selected source batch no longer exists.');
        if (l.m < 0 || l.f < 0) throw new Error('Fostered heads cannot be negative.');
        if (l.m > (+b.males || 0) || l.f > (+b.females || 0))
          throw new Error(`${b.id} has only ${+b.males || 0}♂ / ${+b.females || 0}♀ — you set ${l.m}♂ / ${l.f}♀.`);
      });

      const mode = d.foster_mode || (fb ? fb.mode : 'new');
      const existingBatch = fb ? fb.existingBatch : null;
      const at = new Date().toISOString(),
        note = String(d.note || '').trim();

      const targetBatchId = (mode === 'merge' && existingBatch) ? existingBatch.id : String(d.bid || '').trim();
      if (!targetBatchId) throw new Error('The foster batch needs an ID.');

      /* transfer: sources deduct first, so the confirmation toast can quote real counts */
      const lines = moves.map(l => {
        const b = batchOf(l.bid);
        b.males = Math.max(0, (+b.males || 0) - l.m);
        b.females = Math.max(0, (+b.females || 0) - l.f);
        (b.foster_out = b.foster_out || []).push({ to: targetBatchId, males: l.m, females: l.f, at, note });
        (F().pigletLedger = F().pigletLedger || []).push({
          id: 'tx-fo-' + Date.now() + Math.random().toString(36).slice(2, 5),
          batch_id: b.id,
          type: 'foster_out',
          gender: 'all',
          quantity: l.m + l.f,
          notes: `Fostered out to ${targetBatchId} (${nurse.name})${note ? ' · ' + note : ''}`,
          status: 'active',
          created_at: at
        });
        return { from: b.id, dam: b.dam_name || b.sow || '—', sire: b.sire_name || b.sire || '', breed: b.breed || '', birth: b.birth || '', males: l.m, females: l.f, at };
      });

      const m = lines.reduce((a, l) => a + l.males, 0), f = lines.reduce((a, l) => a + l.females, 0);

      if (mode === 'merge' && existingBatch) {
        // Direct merge into surrogate sow's existing batch
        existingBatch.males = (+existingBatch.males || 0) + m;
        existingBatch.females = (+existingBatch.females || 0) + f;
        existingBatch.foster = true;
        existingBatch.cross_fostered = true;
        existingBatch.foster_from = [...(existingBatch.foster_from || []), ...lines];
        (existingBatch.foster_transfers = existingBatch.foster_transfers || []).push({
          at,
          males: m,
          females: f,
          sources: lines,
          note
        });
        (F().pigletLedger = F().pigletLedger || []).push({
          id: 'tx-fi-' + Date.now() + Math.random().toString(36).slice(2, 5),
          batch_id: existingBatch.id,
          type: 'foster_in',
          gender: 'all',
          quantity: m + f,
          notes: `Fostered in ${m}♂+${f}♀ from ${moves.map(l => l.bid).join(', ')}${note ? ' · ' + note : ''}`,
          status: 'active',
          created_at: at
        });
        save();
        document.getElementById('fosterModal')?.remove();
        fb = null;
        renderAll();
        if (window.refreshOpenDrilldown) refreshOpenDrilldown();
        const moved = lines.map(l => `${l.males}♂+${l.females}♀ ← ${l.from}`).join(', ');
        toast(`🍼 Added ${m + f} fostered piglet(s) directly into ${existingBatch.id} (${nurse.name})!`);
        if (window.openBatchDetails) openBatchDetails(existingBatch.id);
        return;
      }

      // Mode: new standalone foster batch
      if (batchOf(targetBatchId)) throw new Error(`Batch ID "${targetBatchId}" already exists — choose another.`);
      const breedSet = [...new Set(moves.map(l => (batchOf(l.bid) || {}).breed).filter(Boolean))];
      const births = lines.map(l => l.birth).filter(Boolean).sort();
      const srcDone = k => moves.every(l => { const b = batchOf(l.bid); return b && (k === 'castration' ? (b.castration || b.castration_exempt === 'breeder') : b.iron); });
      const allBreeder = moves.every(l => { const b = batchOf(l.bid); return b && !b.castration && b.castration_exempt === 'breeder'; });

      const newBatch = {
        id: targetBatchId, farm_id: farmId,
        birth: births[0] || at.slice(0, 10),
        breed: String(d.breed || '').trim() || fbAutoBreed(moves) || (breedSet[0] || ''),
        males: m, females: f,
        dam_id: nurse.id, sow_id: nurse.id, dam_name: nurse.name, sow: nurse.name,
        sire_name: '', sire: '',
        foster: true, nurse_sow: nurse.name, foster_from: lines,
        /* care flags: inherited ONLY when every source batch is done */
        iron: srcDone('iron') ? true : false,
        castration: (!allBreeder && srcDone('castration')) ? true : false,
        castration_exempt: allBreeder ? 'breeder' : undefined,
        health_status: 'Healthy',
        notes: note ? `Foster batch. ${note}` : 'Foster batch.',
        created_at: at
      };
      (F().piglets = F().piglets || []).push(newBatch);
      save();
      document.getElementById('fosterModal')?.remove();
      fb = null;
      renderAll();
      if (window.refreshOpenDrilldown) refreshOpenDrilldown();
      const moved = lines.map(l => `${l.males}♂+${l.females}♀ ← ${l.from}`).join(', ');
      toast(`🤱 Foster batch ${targetBatchId} saved — ${m + f} head(s) to ${nurse.name} (${moved})`);
      if (window.openBatchDetails) openBatchDetails(targetBatchId);
    } catch (ex) {
      show(ex.message || 'Could not save the foster batch.');
    }
  }

  /* ── return fostered piglets to an original dam/source batch ─────────── */
  function fosterReturnAvailability(line) {
    return {
      males: Math.max(0, (+line.males || 0) - (+line.returned_males || 0)),
      females: Math.max(0, (+line.females || 0) - (+line.returned_females || 0))
    };
  }

  function fbReturnSourceChange(value) {
    const idx = Math.max(0, parseInt(value, 10) || 0);
    const batchId = document.getElementById('fbReturnBatchId');
    const mInput = document.getElementById('fbReturnMales');
    const fInput = document.getElementById('fbReturnFemales');
    const info = document.getElementById('fbReturnAvailability');
    const modal = document.getElementById('fosterReturnModal');
    const targetId = modal?.dataset.targetBatch;
    const target = batchOf(targetId);
    const line = target?.foster_from?.[idx];
    if (!line) return;
    const source = batchOf(line.from);
    const available = fosterReturnAvailability(line);
    if (batchId) batchId.textContent = line.from || 'source batch not found';
    if (info) info.innerHTML = `Available to return: <b>${available.males}♂ + ${available.females}♀</b>${source ? ` · original mom: <b>${escH(source.dam_name || source.sow || line.dam || '—')}</b>` : ' · source batch is not currently present'}${source?.archived ? ' · <span class="tag warn">archived source</span>' : ''}`;
    if (mInput) { mInput.max = available.males; mInput.value = Math.min(+mInput.value || 0, available.males); }
    if (fInput) { fInput.max = available.females; fInput.value = Math.min(+fInput.value || 0, available.females); }
  }

  function openFosterReturnModal(batchId) {
    const target = batchOf(batchId);
    const lines = Array.isArray(target?.foster_from) ? target.foster_from : [];
    if (!target || !lines.length) {
      toast('This batch has no recorded original foster source to return to.');
      return;
    }
    document.getElementById('fosterReturnModal')?.remove();
    const options = lines.map((line, idx) => {
      const source = batchOf(line.from);
      const available = fosterReturnAvailability(line);
      return `<option value="${idx}" ${available.males + available.females > 0 ? '' : 'disabled'}>${escH(line.dam || source?.dam_name || source?.sow || 'Original mom')} · ${escH(line.from || 'source batch')} — ${available.males}♂/${available.females}♀ available</option>`;
    }).join('');
    const first = lines.findIndex(line => { const a = fosterReturnAvailability(line); return a.males + a.females > 0; });
    if (first < 0) {
      toast('All fostered heads in this batch have already been returned.');
      return;
    }
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="fosterReturnModal" data-target-batch="${escH(target.id)}"><form class="due-modal" style="text-align:left;max-width:620px" onsubmit="saveFosterReturn(event,'${escH(target.id)}')"><div class="modal-top"><div><div class="eyebrow">↩ FOSTER RETURN</div><h2>Return piglets to original mom</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('fosterReturnModal')?.remove()">×</button></div><p class="field-hint">Current foster/nurse sow: <b>${escH(target.nurse_sow || target.sow || '—')}</b>. Select the original mom/source batch and return the exact male/female head counts.</p><div class="field"><label>Original mom / source batch *</label><select name="source_index" id="fbReturnSource" onchange="fbReturnSourceChange(this.value)">${options}</select><small id="fbReturnAvailability" class="field-hint"></small><small class="field-hint">Source batch: <b id="fbReturnBatchId">—</b></small></div><div class="reminder-fields"><div class="field"><label>Male piglets to return</label><input id="fbReturnMales" name="return_males" type="number" min="0" step="1" value="0"></div><div class="field"><label>Female piglets to return</label><input id="fbReturnFemales" name="return_females" type="number" min="0" step="1" value="0"></div></div><div class="form-error" id="fbReturnErr"></div><div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('fosterReturnModal')?.remove()">Cancel</button><button class="btn">↩ Return selected piglets</button></div></form></div>`);
    const select = document.getElementById('fbReturnSource');
    if (select) select.value = String(first);
    fbReturnSourceChange(first);
  }

  function saveFosterReturn(e, targetId) {
    e.preventDefault();
    const err = document.getElementById('fbReturnErr');
    err.classList.remove('show');
    try {
      const target = batchOf(targetId);
      const data = Object.fromEntries(new FormData(e.target));
      const sourceIndex = Math.max(0, parseInt(data.source_index, 10) || 0);
      const line = target?.foster_from?.[sourceIndex];
      const source = line ? batchOf(line.from) : null;
      if (!target || !line || !source) throw new Error('The original source batch is not available. No records were changed.');
      const available = fosterReturnAvailability(line);
      const males = Math.max(0, Math.floor(num(data.return_males) || 0));
      const females = Math.max(0, Math.floor(num(data.return_females) || 0));
      if (males + females < 1) throw new Error('Enter at least one male or female piglet to return.');
      if (males > available.males || females > available.females) throw new Error(`Only ${available.males}♂ and ${available.females}♀ remain available from this original source.`);
      if (males > (+target.males || 0) || females > (+target.females || 0)) throw new Error('The foster batch does not have enough live male/female heads.');

      const at = new Date().toISOString();
      target.males = Math.max(0, (+target.males || 0) - males);
      target.females = Math.max(0, (+target.females || 0) - females);
      source.males = (+source.males || 0) + males;
      source.females = (+source.females || 0) + females;
      line.returned_males = (+line.returned_males || 0) + males;
      line.returned_females = (+line.returned_females || 0) + females;
      target.foster_returns = target.foster_returns || [];
      target.foster_returns.push({ id: 'fr-' + Date.now(), at, source_batch_id: source.id, original_mom: line.dam || source.dam_name || source.sow || '', foster_mom: target.nurse_sow || target.sow || '', males, females, status: 'returned' });
      source.foster_return_ins = source.foster_return_ins || [];
      source.foster_return_ins.push({ at, from_batch_id: target.id, foster_mom: target.nurse_sow || target.sow || '', males, females });
      const out = (source.foster_out || []).find(x => String(x.to) === String(target.id) && (+x.males || 0) >= males && (+x.females || 0) >= females && (+x.returned_males || 0) < (+x.males || 0));
      if (out) { out.returned_males = (+out.returned_males || 0) + males; out.returned_females = (+out.returned_females || 0) + females; }
      (F().pigletLedger = F().pigletLedger || []).push({ id: 'tx-fr-out-' + Date.now(), batch_id: target.id, type: 'foster_return_out', gender: 'all', quantity: males + females, males, females, notes: `Returned to original mom ${source.dam_name || source.sow || line.dam || '—'} from ${source.id}`, status: 'active', created_at: at });
      F().pigletLedger.push({ id: 'tx-fr-in-' + Date.now(), batch_id: source.id, type: 'foster_return_in', gender: 'all', quantity: males + females, males, females, notes: `Received back from foster batch ${target.id} (${target.nurse_sow || target.sow || 'nurse sow'})`, status: 'active', created_at: at });
      save();
      document.getElementById('fosterReturnModal')?.remove();
      renderAll();
      if (window.refreshOpenDrilldown) refreshOpenDrilldown();
      toast(`↩ Returned ${males}♂ + ${females}♀ to ${source.dam_name || source.sow || line.dam || source.id}.`);
      if (window.openBatchDetails) openBatchDetails(target.id);
    } catch (ex) {
      err.textContent = ex.message || 'Could not return the fostered piglets.';
      err.classList.add('show');
    }
  }

  /* ── exports ─────────────────────────────────────────────────────────── */
  window.openPigletQuickMenu = openPigletQuickMenu;
  window.openFosterModal = openFosterModal;
  window.fbNurseFilter = fbNurseFilter;
  window.fbNursePick = fbNursePick;
  window.fbNurseClear = fbNurseClear;
  window.fbNurseChange = fbNurseChange;
  window.fbModeChange = fbModeChange;
  window.fbBreedTouch = fbBreedTouch;
  window.fbIdTouch = fbIdTouch;
  window.fbSrcFilter = fbSrcFilter;
  window.fbSrcPick = fbSrcPick;
  window.fbSrcClose = fbSrcClose;
  window.fbQty = fbQty;
  window.fbRemove = fbRemove;
  window.fbCalc = fbCalc;
  window.saveFosterBatch = saveFosterBatch;
  window.openFosterReturnModal = openFosterReturnModal;
  window.fbReturnSourceChange = fbReturnSourceChange;
  window.saveFosterReturn = saveFosterReturn;
})();
