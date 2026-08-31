/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 10] js/boar-registry.js — actual Boar Registry.

   The dashboard "Boars" card used to count distinct boar names found in the
   semen collection records — so a farm with zero living boars but two semen
   purchases showed "2 Boars". With this module, boars are first-class farm
   animals: they are registered, edited, deactivated and removed here, and the
   dashboard counts ONLY registered boars whose status is Active (app.js was
   patched for that: `f.boars` filtered by status === 'Active`). Semen records
   remain an inventory of doses and are never treated as animal registrations.

   Registry lives on the Boar Semen page (topmost panel). Data: f.boars[]
     { id, name, breed, dob, acquired, status: 'Active'|'Culled'|'Sold',
       notes, created_at, updated_at }
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsq = v => "'" + String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;') + "'";
  const boars = () => (F().boars = Array.isArray(F().boars) ? F().boars : []);
  const findBoar = id => boars().find(b => b.id === id);
  const isActive = b => String(b.status || 'Active') === 'Active';
  const newId = () => 'BOAR-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const STATUSES = ['Active', 'Culled', 'Sold', 'Reference']; /* FIX 28: Reference = outside-semen lineage source, never counted as a boar */
  const statusClass = b => isActive(b) ? 'stock-sufficient' : (b.status === 'Sold' ? 'stock-low-stock' : 'stock-out-of-stock');

  let collectionIntervalDays = 7;
  /* [REBUILD FIX 94] expand/collapse state for the full advisor list */
  let advisorExpanded = false;

  function setSemenCollectionInterval(value) {
    const parsed = Math.max(1, Math.min(30, parseInt(value, 10) || 7));
    collectionIntervalDays = parsed;
    renderPanel();
  }

  function toggleCollectionAdvisor() {
    advisorExpanded = !advisorExpanded;
    const more = document.getElementById('collAdvMore');
    const btn = document.getElementById('collAdvToggleBtn');
    if (more && btn) {
      more.style.display = advisorExpanded ? '' : 'none';
      btn.textContent = advisorExpanded ? '▲ Show top 6 only' : (btn.dataset.label || '▼ Show all');
    } else {
      renderPanel();
    }
  }
  window.toggleCollectionAdvisor = toggleCollectionAdvisor;

  function collectionAdvisorHTML() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lots = F().semen || [];
    const recommendations = boars().filter(b => isActive(b) && b.status !== 'Reference' && !b.lineage_only).map(b => {
      // Only a real collection_date/collection field counts as collection
      // history. A created_at timestamp alone is not a semen collection.
      const related = lots.filter(l =>
        ((b.id && String(l.boar_id || '').toLowerCase() === String(b.id).toLowerCase()) ||
          (b.name && String(l.boar_name || l.boar || '').toLowerCase() === String(b.name).toLowerCase())) &&
        (l.collection_date || l.collection)
      ).sort((a, z) => String(z.collection_date || z.collection).localeCompare(String(a.collection_date || a.collection)));
      const last = related[0];
      const dateValue = last?.collection_date || last?.collection || null;
      const lastDate = dateValue ? new Date(String(dateValue).slice(0, 10) + 'T00:00:00') : null;
      const daysSince = lastDate && !isNaN(lastDate.getTime()) ? Math.max(0, Math.floor((today - lastDate) / 86400000)) : null;
      if (daysSince === null) return null;
      const due = daysSince >= collectionIntervalDays;
      const soon = !due && daysSince >= Math.max(0, collectionIntervalDays - 2);
      return { b, last, lastDate, daysSince, due, soon, priority: due ? 1 : soon ? 2 : 3 };
    }).filter(Boolean).sort((a, z) => a.priority - z.priority || (z.daysSince || 0) - (a.daysSince || 0) || String(a.b.name).localeCompare(String(z.b.name)));
    /* [FIX 94] render ALL ranked boars; rows beyond the top 6 sit in a
       collapsible section the farmer can expand. */
    const rowHTML = x => {
      const status = x.daysSince === null ? 'No collection history' : x.due ? `Collect now · ${x.daysSince}d since last` : x.soon ? `Due soon · ${x.daysSince}d since last` : `Recently collected · ${x.daysSince}d`;
      const cls = x.due ? 'danger' : x.soon ? 'warn' : '';
      return `<div class="collection-advisor-row"><div><b>${esc(x.b.name)}</b><small>${esc(x.b.breed || 'Breed —')} · ${x.lastDate ? `last collected ${fmtDate(x.lastDate.toISOString().slice(0, 10))}` : 'no collection recorded'}</small></div><span class="tag ${cls}">${status}</span><button type="button" class="btn ghost small" onclick="window.openSemenNewBatch && window.openSemenNewBatch(${jsq(x.b.id)})">＋ Collect</button></div>`;
    };
    const topRows = recommendations.slice(0, 6).map(rowHTML).join('');
    const moreRows = recommendations.slice(6).map(rowHTML).join('');
    const collapsedLabel = `▼ Show all ${recommendations.length} boars`;
    return `<div class="collection-advisor"><div class="collection-advisor-head"><div><b>🧪 Next semen collection suggestions</b><small>Live active boars ranked by time since their last collection.</small></div><label>Target interval <select onchange="window.setSemenCollectionInterval(this.value)">${[5,7,10,14].map(n => `<option value="${n}" ${n === collectionIntervalDays ? 'selected' : ''}>${n} days</option>`).join('')}</select></label></div>${topRows || '<div class="empty">No active boar has a recorded semen collection history yet.</div>'}${moreRows ? `<div id="collAdvMore" style="${advisorExpanded ? '' : 'display:none'}">${moreRows}</div><button type="button" id="collAdvToggleBtn" data-label="${collapsedLabel}" class="btn ghost small" style="margin-top:10px;width:100%;font-weight:700" onclick="window.toggleCollectionAdvisor()">${advisorExpanded ? '▲ Show top 6 only' : collapsedLabel}</button>` : ''}</div>`;
  }

  function registryPanelHTML() {
    const all = boars(), act = all.filter(isActive).length,
      refCount = all.filter(b => b.status === 'Reference' || b.lineage_only).length; /* FIX 28 */
    let rows;
    if (!all.length) {
      rows = `<div class="empty">No boars registered on this farm yet.</div><p class="muted med-empty-hint">Register the actual boars living on the farm — the dashboard “Boars” count uses this registry only (semen doses are never counted as boars). Semen bought outside is recorded as a genetic source with “Lineage reference only” so its pedigree is kept without becoming a boar.</p>`;
    } else {
      rows = all.map(b => `<div class="summary-row" data-boar-row data-batch-delete-row data-batch-delete-entity="boar" data-batch-delete-key="${esc(b._ars_cloud_local_id || b.id)}">` +
        `<span><b>${(b.status === 'Reference' || b.lineage_only) ? '🧬 ' : ''}${esc(b.name)}</b> ${b.breed ? `<span class="med-chip ghost">${esc(b.breed)}</span>` : ''}<br>` + /* FIX 28: 🧬 = lineage-only source */
        `<small class="muted">${esc(b.id)}${b.dob ? ' · born ' + esc(b.dob) : ''}${b.acquired ? ' · acquired ' + esc(b.acquired) : ''}${b.notes ? ' · ' + esc(b.notes) : ''}</small></span>` +
        `<span class="med-row-side"><span class="med-row-top"><span class="med-pill ${statusClass(b)}">${esc(b.status || 'Active')}</span></span>` +
        `<span class="med-actions">` +
        `<button type="button" class="btn ghost med-mini-btn" title="Toggle active status" onclick="toggleBoarStatus(${jsq(b.id)})">${isActive(b) ? '⏸ Deactivate' : '▶ Mark active'}</button>` +
        `<button type="button" class="btn ghost med-mini-btn" title="Edit" onclick="openBoarEditor(${jsq(b.id)})">✎ Edit</button>` +
        `<button type="button" class="btn ghost med-mini-btn danger" title="Remove" onclick="deleteBoar(${jsq(b.id)})">✕</button>` +
        `</span></span></div>`).join('');
    }
    return `<div id="boarRegistryPanel" class="section panel summary med-inv"><div class="section-head"><div><h2>Registered boars</h2><p>${act} active of ${all.length} registered${refCount ? ` · ${refCount} lineage-reference only (kept for genetics, not counted)` : ''} · dashboard counts active only</p></div><button class="btn" onclick="openBoarEditor()">＋ Register boar</button></div>${collectionAdvisorHTML()}${rows}</div>`;
  }

  function renderPanel() {
    const semen = document.getElementById('semen');
    if (!semen) return;
    document.getElementById('boarRegistryPanel')?.remove();
    semen.insertAdjacentHTML('afterbegin', registryPanelHTML());
  }

  /* ── editor modal ─────────────────────────────────────────────────── */
  function openBoarEditor(id = null) {
    const b = id ? findBoar(id) : null;
    const v = k => (b ? b[k] : '') ?? '';
    document.body.insertAdjacentHTML('beforeend',
      `<div class="due-modal-bg" id="boarEdModal"><form class="reminder-modal" onsubmit="saveBoar(event)"><div class="modal-top"><h2>${b ? '✎ Edit boar' : '＋ Register boar'}</h2><button type="button" class="close-reminder" onclick="document.getElementById('boarEdModal').remove()">×</button></div>` +
      `<p class="perf-sub">${b ? `Editing <b>${esc(b.name)}</b> (${esc(b.id)})` : 'Register an actual boar living on the farm — only registered Active boars count on the dashboard.'}</p>` +
      `<input type="hidden" name="id" value="${b ? esc(b.id) : ''}">` +
      `<div class="reminder-fields">` +
        `<div class="field"><label>Boar name *</label><input name="name" required value="${esc(v('name'))}" placeholder="e.g. Thor"></div>` +
        `<div class="field"><label>Breed</label><input name="breed" value="${esc(v('breed'))}" placeholder="e.g. Duroc"></div>` +
        `<div class="field"><label>Date of birth</label><input name="dob" type="date" value="${esc(v('dob'))}"></div>` +
        `<div class="field"><label>Sire (father) name / ID</label><input name="sire" value="${esc(v('sire') || v('sireRef') || v('sire_name'))}" placeholder="e.g. Luffy"></div>` +
        `<div class="field"><label>Dam (mother) name / ID</label><input name="dam" value="${esc(v('dam') || v('damRef') || v('dam_name'))}" placeholder="e.g. Nami"></div>` +
        /* [REBUILD FIX 102] concise acquisition record for bought boars */
        `<div class="field"><label>Source farm / supplier (optional)</label><input name="source_farm" value="${esc(v('source_farm'))}" placeholder="e.g. Creekview Genetics, USA"></div>` +
        `<div class="field"><label>Purchase price ₱ (optional)</label><input name="purchase_price" type="number" min="0" step="0.01" value="${esc(v('purchase_price'))}" placeholder="e.g. 45000"></div>` +
        `<div class="field"><label>Purchase date (optional)</label><input name="purchase_date" type="date" value="${esc(v('purchase_date'))}"></div>` +
        `<small class="field-hint" style="grid-column:1/-1">Sire &amp; dam power the Wright inbreeding calculator — boars without recorded parents can only be screened as “0% detected, pedigree incomplete”.</small>` +
        `<div class="field"><label>Date acquired / entered herd</label><input name="acquired" type="date" value="${esc(v('acquired'))}"></div>` +
        `<div class="field"><label>Status</label><select name="status">${STATUSES.map(s => `<option value="${s}"${(b ? (b.status || 'Active') : 'Active') === s ? ' selected' : ''}>${s}</option>`).join('')}</select><small class="field-hint">Only “Active” boars are counted on the dashboard. Culled / Sold boars stay in the registry for history; “Reference” marks an outside-semen lineage source that is never counted. [FIX 28]</small></div>` +
        `<div class="field"><label>Notes</label><input name="notes" value="${esc(v('notes'))}" placeholder="e.g. Main breeder for Landrace sows"></div>` +
      `</div><div class="form-error" id="boarEdErr"></div>` +
      `<div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('boarEdModal').remove()">Cancel</button><button class="btn">${b ? 'Save changes' : 'Register boar'}</button></div></form></div>`);
  }

  /* [REBUILD FIX 102] book a boar's acquisition cost ONCE under
     "Breeding Stock Purchase" (capital → Investing in cash flows). */
  function bookBoarPurchase(b, d, name) {
    const price = Math.max(0, parseFloat(d.purchase_price) || 0);
    if (price <= 0) return;
    b.purchase_price = price;
    if (b.purchase_tx_id) return; /* never double-book on edits */
    const tx = {
      id: 'tx-' + Date.now().toString(36) + '-boarbuy',
      date: d.purchase_date || new Date().toISOString().slice(0, 10),
      type: 'Expense', category: 'Breeding Stock Purchase',
      description: `Purchased boar ${name} from ${String(d.source_farm || '').trim() || 'outside farm'}`,
      amount: price, paid: price, created_at: new Date().toISOString()
    };
    (F().transactions = F().transactions || []).unshift(tx);
    b.purchase_tx_id = tx.id;
  }

  function saveBoar(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const name = String(d.name || '').trim();
    const err = document.getElementById('boarEdErr');
    if (!name) { err.textContent = 'Boar name is required.'; err.classList.add('show'); return; }
    const dup = boars().find(x => x.id !== d.id && x.name.toLowerCase() === name.toLowerCase());
    if (dup) { err.textContent = `A boar named “${name}” is already registered (${dup.id}).`; err.classList.add('show'); return; }
    if (d.id) {
      const b = findBoar(d.id); if (!b) return;
      Object.assign(b, { name, breed: d.breed.trim(), dob: d.dob || '', acquired: d.acquired || '', status: d.status, sire: String(d.sire || '').trim(), dam: String(d.dam || '').trim(), source_farm: String(d.source_farm || '').trim(), purchase_date: d.purchase_date || '', notes: d.notes.trim(), updated_at: new Date().toISOString() });
      bookBoarPurchase(b, d, name);
      toast(`Updated ${name}`);
    } else {
      const nb = { id: newId(), name, breed: d.breed.trim(), dob: d.dob || '', acquired: d.acquired || '', status: d.status || 'Active', sire: String(d.sire || '').trim(), dam: String(d.dam || '').trim(), source_farm: String(d.source_farm || '').trim(), purchase_date: d.purchase_date || '', notes: d.notes.trim(), created_at: new Date().toISOString() };
      boars().push(nb);
      bookBoarPurchase(nb, d, name);
      toast(`Registered boar ${name}`);
    }
    save();
    document.getElementById('boarEdModal')?.remove();
    if (typeof renderAll === 'function') renderAll(); else renderPanel();
  }

  function toggleBoarStatus(id) {
    const b = findBoar(id); if (!b) return;
    b.status = isActive(b) ? 'Culled' : 'Active';
    if (isActive(b)) b.lineage_only = false; /* FIX 28: promoting a reference boar makes it a counted live boar */
    b.updated_at = new Date().toISOString();
    save();
    if (typeof renderAll === 'function') renderAll(); else renderPanel();
    toast(isActive(b) ? `${b.name} marked active` : `${b.name} deactivated (Culled)`);
  }

  async function deleteBoar(id) {
    const b = findBoar(id); if (!b) return;
    if (!confirm(`Remove “${b.name}” from the boar registry?\nSemen collection records are kept on the inventory.`)) return;
    const farmIdForDelete = window.__arsActiveFarmId || window.farmId;
    const cloudLocalId = b._ars_cloud_local_id || b.id;
    try {
      // Cloud-first prevents the next background pull from restoring the boar.
      if (!farmIdForDelete || !window.ARSCloud?.deleteAppRecord) throw new Error('Verified cloud deletion is unavailable.');
      await ARSCloud.deleteAppRecord(farmIdForDelete, 'boar', cloudLocalId);
    } catch (error) {
      toast(`⚠️ Boar was not removed: cloud deletion failed — ${error.message || error}`);
      return;
    }
    boars().splice(boars().indexOf(b), 1);
    save();
    if (typeof renderAll === 'function') renderAll(); else renderPanel();
    toast(`Removed ${b.name} from the cloud and this device`);
  }

  
  /* ── [REBUILD FIX] DETAILED CALENDAR AGE CALCULATOR (Months + Days) ── */
  function calcAgeDetailed(dobStr) {
    if (!dobStr) return { text: "—", summary: "—", formattedDob: "—", totalMonths: 0, days: 0 };
    try {
      const birth = new Date(dobStr + (String(dobStr).includes("T") ? "" : "T00:00:00"));
      const now = new Date();
      if (isNaN(birth.getTime())) return { text: "—", summary: "—", formattedDob: String(dobStr), totalMonths: 0, days: 0 };

      let years = now.getFullYear() - birth.getFullYear();
      let months = now.getMonth() - birth.getMonth();
      let days = now.getDate() - birth.getDate();

      if (days < 0) {
        months -= 1;
        const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        days += prevMonth.getDate();
      }
      if (months < 0) {
        years -= 1;
        months += 12;
      }

      const totalMonths = (years * 12) + months;
      let parts = [];
      if (years > 0) parts.push(years + (years > 1 ? " yrs" : " yr"));
      if (months > 0) parts.push(months + (months > 1 ? " mos" : " mo"));
      parts.push(days + (days > 1 ? " days" : " day"));

      return {
        text: parts.join(" · "),
        summary: totalMonths + " mos · " + days + " days",
        formattedDob: birth.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }),
        totalMonths,
        days
      };
    } catch (e) {
      return { text: "—", summary: "—", formattedDob: String(dobStr), totalMonths: 0, days: 0 };
    }
  }
  window.calcAgeDetailed = calcAgeDetailed;

  /* ── INTERACTIVE BOAR PROFILE MODAL ──
     Displays: DOB, age (months + days), breed, dam & maternal lineage,
     sire & paternal lineage, last collection date, semen bottles produced,
     medical treatments, vaccines, barn/pen details & quick transfer. */
  /* ── RESOLVE ANIMAL NAME & LINEAGE REFERENCE ──
     Finds the human-readable animal name from boars, sows, or ancestors tables
     so reference inbreeding tags (e.g. ANC-msj1b2u395k) display both the actual
     sire/dam name and the inbreeding reference tag. */
  function resolveAnimalLabel(ref) {
    if (!ref) return { name: "—", id: "", display: "—", hasObj: false };
    const raw = String(ref).trim();
    if (!raw || raw === "—" || raw === "-") return { name: "—", id: "", display: "—", hasObj: false };

    const farm = (typeof F === 'function' && F()) ? F() : {};
    const all = [
      ...(farm.boars || []),
      ...(farm.sows || []),
      ...(farm.ancestors || [])
    ];

    // 1. Exact ID match (e.g. ANC-msj1b2u395k or boar-101)
    let hit = all.find(x => x.id === raw || String(x.id).toLowerCase() === raw.toLowerCase());

    // 2. Exact Name match
    if (!hit) {
      hit = all.find(x => String(x.name || "").trim().toLowerCase() === raw.toLowerCase());
    }

    // 3. Semen inventory lot match
    if (!hit && farm.semen) {
      const lot = farm.semen.find(s => s.boar_id === raw || s.semen_batch_no === raw || String(s.boar_name || s.boar || "").trim().toLowerCase() === raw.toLowerCase());
      if (lot) {
        const lotName = lot.boar_name || lot.boar || raw;
        const lotId = lot.boar_id || lot.semen_batch_no || "";
        let disp = lotName;
        if (lotId && lotId !== lotName) {
          disp = `${esc(lotName)} <small class="muted" style="font-size:11px;font-weight:normal;opacity:0.85">(${esc(lotId)})</small>`;
        }
        return { name: lotName, id: lotId, breed: lot.breed || "", display: disp, hit: lot, hasObj: true };
      }
    }

    if (hit) {
      const name = hit.name || raw;
      const id = hit.id || "";
      const breed = hit.breed || "";
      let disp = esc(name);
      if (id && id !== name) {
        disp = `${esc(name)} <small class="muted" style="font-size:11px;font-weight:normal;opacity:0.85">(${esc(id)})</small>`;
      }
      return { name, id, breed, hit, display: disp, hasObj: true };
    }

    return { name: raw, id: raw, breed: "", display: esc(raw), hasObj: false };
  }
  window.resolveAnimalLabel = resolveAnimalLabel;

  /* ── FLEXIBLE BOAR RECORD RESOLUTION ── */
  function findBoarRecord(target) {
    if (!target && target !== 0) return null;
    const farm = (typeof F === 'function' && F()) ? F() : {};
    const boarsList = Array.isArray(farm.boars) ? farm.boars : [];
    const ancestorsList = Array.isArray(farm.ancestors) ? farm.ancestors : [];

    // 1. If target is already a boar object
    if (typeof target === 'object' && target !== null && (target.id || target.name)) {
      return target;
    }

    // 2. If target is a numerical index in farm.boars
    if (typeof target === 'number' && boarsList[target]) {
      return boarsList[target];
    }

    const clean = String(target).trim();
    if (!clean) return null;
    const cleanLower = clean.toLowerCase();

    // 3. Exact ID Match (Primary in active boars)
    let hit = boarsList.find(x => x && String(x.id || '').trim().toLowerCase() === cleanLower);
    if (hit) return hit;

    // 4. Exact Name Match (Primary in active boars)
    hit = boarsList.find(x => x && String(x.name || '').trim().toLowerCase() === cleanLower);
    if (hit) return hit;

    // 5. Normalized Name matching without parentheses prefix (e.g. "(KHP) Katakuri" <-> "Katakuri")
    const cleanNoCode = clean.replace(/^\s*\([A-Z0-9_-]+\)\s*/i, '').trim().toLowerCase();
    const codeMatch = clean.match(/^\s*\(([A-Z0-9_-]+)\)/i);
    const extractedCode = codeMatch ? codeMatch[1].toLowerCase() : null;

    if (cleanNoCode && cleanNoCode !== cleanLower) {
      hit = boarsList.find(x => {
        if (!x) return false;
        const bName = String(x.name || '').trim().toLowerCase();
        const bNoCode = bName.replace(/^\s*\([A-Z0-9_-]+\)\s*/i, '').trim().toLowerCase();
        return bName === cleanNoCode || bNoCode === cleanNoCode || bNoCode === cleanLower;
      });
      if (hit) return hit;
    }

    if (extractedCode) {
      hit = boarsList.find(x => x && (
        String(x.id || '').trim().toLowerCase() === extractedCode ||
        String(x.code || '').trim().toLowerCase() === extractedCode
      ));
      if (hit) return hit;
    }

    // 6. Alphanumeric normalized matching (e.g. "(B1LW) Blake" <-> "B1LW Blake" / "Blake")
    const normalize = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/gi, '');
    const cleanNorm = normalize(clean);
    if (cleanNorm) {
      hit = boarsList.find(x => {
        if (!x) return false;
        const idNorm = normalize(x.id);
        const nameNorm = normalize(x.name);
        const codeNorm = normalize(x.code);
        const comboNorm = normalize((x.code || '') + (x.name || ''));
        return idNorm === cleanNorm || nameNorm === cleanNorm || codeNorm === cleanNorm || comboNorm === cleanNorm;
      });
      if (hit) return hit;
    }

    // 7. Check if target string is an index in boarsList
    const asNum = parseInt(clean, 10);
    if (!isNaN(asNum) && asNum >= 0 && asNum < boarsList.length) {
      return boarsList[asNum];
    }

    // 8. Ancestor records exact match fallback
    hit = ancestorsList.find(x => x && (
      String(x.id || '').trim().toLowerCase() === cleanLower ||
      String(x.name || '').trim().toLowerCase() === cleanLower ||
      normalize(x.id) === cleanNorm ||
      normalize(x.name) === cleanNorm
    ));
    if (hit) return hit;

    return null;
  }
  window.findBoarRecord = findBoarRecord;

  /* ── INTERACTIVE BOAR PROFILE MODAL ──
     Displays: DOB, age (months + days), breed, dam & maternal lineage,
     sire & paternal lineage, last collection date, semen bottles produced,
     medical treatments, vaccines, barn/pen details & quick transfer. */
  function openBoarDetailModal(target) {
    if (!target && target !== 0) return;
    const b = findBoarRecord(target);
    if (!b) {
      if (window.toast) toast("Could not find boar record for " + String(target));
      return;
    }

    try {
      const farm = (typeof F === 'function' && F()) ? F() : {};
      const ageInfo = calcAgeDetailed(b.dob);

      // 1. Lineage Ancestors with Name & Tag Resolution
      const sireInfo = resolveAnimalLabel(b.sire || b.sireRef || b.sire_name);
      const damInfo = resolveAnimalLabel(b.dam || b.damRef || b.dam_name);

      const sireHit = sireInfo.hit || null;
      const damHit = damInfo.hit || null;

      const patGrandsireInfo = resolveAnimalLabel(sireHit ? (sireHit.sire || sireHit.sireRef || sireHit.sire_name) : null);
      const patGranddamInfo = resolveAnimalLabel(sireHit ? (sireHit.dam || sireHit.damRef || sireHit.dam_name) : null);
      const matGrandsireInfo = resolveAnimalLabel(damHit ? (damHit.sire || damHit.sireRef || damHit.sire_name) : null);
      const matGranddamInfo = resolveAnimalLabel(damHit ? (damHit.dam || damHit.damRef || damHit.dam_name) : null);

      // 2. Semen Production & Collections
      const semenLots = (farm.semen || []).filter(s => {
        const sId = String(s.boar_id || "").toLowerCase();
        const sName = String(s.boar_name || s.boar || "").toLowerCase();
        return (b.id && sId === String(b.id).toLowerCase()) || (b.name && sName === String(b.name).toLowerCase());
      }).sort((a, b) => String(b.collection_date || b.collection || b.created_at || "").localeCompare(String(a.collection_date || a.collection || a.created_at || "")));

      const totalBottlesProduced = semenLots.reduce((acc, s) => acc + (+s.bottles || +s.available_bottles || +s.qty || 0), 0);
      const lastLot = semenLots[0] || null;
      const lastCollectionDate = lastLot ? (lastLot.collection_date || lastLot.collection || lastLot.created_at) : null;

      // 3. Treatments & Medications
      const boarKeys = [b.id, b.name, "boar:" + b.id, "boar:" + b.name].filter(Boolean).map(s => String(s).toLowerCase());
      const treatments = [];
      (farm.medicines || []).forEach(m => {
        (m.movements || []).forEach(mov => {
          const ref = String(mov.animal_ref || "").toLowerCase();
          const lbl = String(mov.animal_label || "").toLowerCase();
          if (boarKeys.some(k => ref === k || ref.includes(k) || lbl.includes(k))) {
            treatments.push({
              date: mov.date,
              med_name: m.item_name || m.name,
              qty: mov.quantity || mov.dose_ml,
              unit: m.unit || "ml",
              reason: mov.reason || mov.notes || "Routine treatment",
              admin: mov.operator || mov.by || "Farm Staff"
            });
          }
        });
      });
      (farm.med_movements || []).forEach(mov => {
        const ref = String(mov.animal_ref || "").toLowerCase();
        const lbl = String(mov.animal_label || "").toLowerCase();
        if (boarKeys.some(k => ref === k || ref.includes(k) || lbl.includes(k))) {
          if (!treatments.some(t => t.date === mov.date && t.med_name === mov.med_name)) {
            treatments.push({
              date: mov.date,
              med_name: mov.med_name,
              qty: mov.quantity || mov.dose_ml,
              unit: mov.unit || "ml",
              reason: mov.reason || mov.notes || "Medical treatment",
              admin: mov.operator || mov.by || "Farm Staff"
            });
          }
        }
      });
      treatments.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

      // 4. Vaccines
      const vaccines = [];
      (farm.vaccination_events || []).forEach(ev => {
        if (ev.target_type === "boar" && (
          (b.id && String(ev.target_id).toLowerCase() === String(b.id).toLowerCase()) ||
          (b.name && String(ev.target_label || "").toLowerCase().includes(String(b.name).toLowerCase()))
        )) {
          vaccines.push({
            vaccine: ev.vaccine,
            date: ev.date,
            dose_ml: ev.dose_ml,
            next_due: ev.next_due,
            notes: ev.notes || ""
          });
        }
      });
      vaccines.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

      // 5. Barn & Pen Details
      let housing = { barnName: "Unassigned", penId: "—", penName: "—", occupiedSince: null, hasBarn: false };
      (farm.barns || []).forEach(barn => {
        (barn.pens || []).forEach(pen => {
          const occ = String(pen.occupant_id || "").toLowerCase();
          if (occ && ((b.id && occ === String(b.id).toLowerCase()) || (b.name && occ === String(b.name).toLowerCase()))) {
            housing = {
              barnId: barn.id,
              barnName: barn.name,
              penId: pen.id,
              penName: pen.name || pen.id,
              occupiedSince: pen.occupied_since,
              hasBarn: true
            };
          }
        });
      });

      document.getElementById("boarDetailModal")?.remove();

      document.body.insertAdjacentHTML("beforeend", `
        <div class="due-modal-bg" id="boarDetailModal" style="z-index:999999!important">
          <div class="due-modal perf-modal boar-profile-modal">
            <div class="modal-top">
              <div>
                <div class="eyebrow" style="color:var(--teal2);font-weight:700">🐗 ACTIVE STUD BOAR · BREEDING &amp; PERFORMANCE PROFILE</div>
                <h2>${esc(b.name)} <span class="med-chip ${statusClass(b)}">${esc(b.status || "Active")}</span></h2>
                <p class="perf-sub">Tag ID: <b>${esc(b.id || b.name)}</b> · Breed: <b>${esc(b.breed || "—")}</b>${b.acquired ? ` · Acquired: ${esc(fmtDate(b.acquired))}` : ""}</p>
                <!-- [FIX 115] Registered boar photo (flows into the Pedigree Report) -->
                <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
                  ${b.photo ? `<img src="${b.photo}" alt="" style="width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid var(--teal2)">` : `<span style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.07);display:inline-flex;align-items:center;justify-content:center;font-size:22px;filter:grayscale(1);opacity:.5">🐗</span>`}
                  <button type="button" class="btn ghost small" onclick="window.arsBoarPhoto('${esc(b.id || b.name)}')">📷 ${b.photo ? "Change photo" : "Add photo"}</button>
                  ${b.photo ? `<button type="button" class="btn ghost small delete-action" onclick="window.arsBoarPhotoRemove('${esc(b.id || b.name)}')" title="Remove photo" style="padding:6px 9px">🗑</button>` : ""}
                </div>
              </div>
              <button type="button" class="close-reminder" onclick="document.getElementById('boarDetailModal').remove()">×</button>
            </div>

            <!-- 4-Card Summary Metric Grid -->
            <div class="boar-metric-grid">
              <div class="boar-stat-card">
                <small>🎂 Birthday &amp; Age</small>
                <b>${ageInfo.summary}</b>
                <span>${b.dob ? `DOB: ${ageInfo.formattedDob} (${ageInfo.text})` : "DOB not recorded"}</span>
              </div>
              <div class="boar-stat-card">
                <small>🧪 Semen Production</small>
                <b>${totalBottlesProduced} bottles</b>
                <span>${semenLots.length} collection batches</span>
              </div>
              <div class="boar-stat-card">
                <small>📅 Last Collection</small>
                <b>${lastCollectionDate ? fmtDate(lastCollectionDate) : "None on record"}</b>
                <span>${lastLot ? `Batch: ${lastLot.semen_batch_no || lastLot.id}` : "Ready for collection"}</span>
              </div>
              <div class="boar-stat-card">
                <small>🏠 Housing Location</small>
                <b>${esc(housing.barnName)}</b>
                <span>Pen: <b>${esc(housing.penName)}</b>${housing.occupiedSince ? ` (since ${fmtDate(housing.occupiedSince)})` : ""}</span>
              </div>
            </div>

            <!-- 3-Generation Pedigree & Lineage Section -->
            <div class="boar-section">
              <div class="boar-sec-head">
                <h3>🧬 3-Generation Pedigree &amp; Lineage</h3>
                <button type="button" class="btn ghost small" onclick="window.openPedigreeTree && window.openPedigreeTree('${esc(b.id || b.name)}')">View Full Tree →</button>
              </div>
              <div class="boar-lineage-grid">
                <div class="lineage-card sire">
                  <div class="lineage-head"><b>♂ SIRE (Father)</b><span>${sireInfo.display}</span></div>
                  <div class="lineage-sub-grid">
                    <div><small>Paternal Grandsire</small><b>${patGrandsireInfo.display}</b></div>
                    <div><small>Paternal Granddam</small><b>${patGranddamInfo.display}</b></div>
                  </div>
                </div>
                <div class="lineage-card dam">
                  <div class="lineage-head"><b>♀ DAM (Mother)</b><span>${damInfo.display}</span></div>
                  <div class="lineage-sub-grid">
                    <div><small>Maternal Grandsire</small><b>${matGrandsireInfo.display}</b></div>
                    <div><small>Maternal Granddam</small><b>${matGranddamInfo.display}</b></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Semen Collection History -->
            <div class="boar-section">
              <div class="boar-sec-head">
                <h3>🧪 Semen Collection History (${semenLots.length})</h3>
                <button type="button" class="btn ghost small" onclick="document.getElementById('boarDetailModal').remove();window.openSemenNewBatch && window.openSemenNewBatch();">+ Collect Semen</button>
              </div>
              <div class="boar-table-scroll">
                ${semenLots.length ? `
                  <table class="table fc-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Batch No</th>
                        <th>Bottles</th>
                        <th>Available</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${semenLots.slice(0, 8).map(s => `
                        <tr>
                          <td><b>${fmtDate(s.collection_date || s.collection || s.created_at)}</b></td>
                          <td>${esc(s.semen_batch_no || s.id)}</td>
                          <td><b>${s.bottles || s.available_bottles || 0}</b></td>
                          <td>${s.available_bottles ?? s.bottles ?? 0}</td>
                          <td><span class="tag">${esc(s.status || "Active")}</span></td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>
                ` : `<div class="empty">No semen collection records for this boar yet.</div>`}
              </div>
            </div>

            <!-- Health Treatments & Medications -->
            <div class="boar-section">
              <div class="boar-sec-head">
                <h3>🩺 Veterinary Treatments &amp; Medications (${treatments.length})</h3>
                <button type="button" class="btn ghost small" onclick="document.getElementById('boarDetailModal').remove();window.openTreatmentModal && window.openTreatmentModal();">+ Add Treatment</button>
              </div>
              <div class="boar-table-scroll">
                ${treatments.length ? `
                  <table class="table fc-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Medicine</th>
                        <th>Dose</th>
                        <th>Reason</th>
                        <th>Administered By</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${treatments.slice(0, 6).map(t => `
                        <tr>
                          <td><small>${fmtDate(t.date)}</small></td>
                          <td><b>${esc(t.med_name)}</b></td>
                          <td>${t.qty ? `${t.qty} ${esc(t.unit || "ml")}` : "—"}</td>
                          <td><small>${esc(t.reason)}</small></td>
                          <td><small>${esc(t.admin)}</small></td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>
                ` : `<div class="empty">No medical treatment records for this boar yet.</div>`}
              </div>
            </div>

            <!-- Vaccines -->
            <div class="boar-section">
              <div class="boar-sec-head">
                <h3>🛡 Vaccination Records (${vaccines.length})</h3>
                <button type="button" class="btn ghost small" onclick="document.getElementById('boarDetailModal').remove();window.openSchedModal && window.openSchedModal('boar', '${esc(b.id || b.name)}', '${esc(b.name)}');">+ Schedule Vaccine</button>
              </div>
              <div class="boar-table-scroll">
                ${vaccines.length ? `
                  <table class="table fc-table">
                    <thead>
                      <tr>
                        <th>Vaccine</th>
                        <th>Date Given</th>
                        <th>Dose</th>
                        <th>Next Due Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${vaccines.slice(0, 6).map(v => `
                        <tr>
                          <td><b>${esc(v.vaccine)}</b></td>
                          <td>${fmtDate(v.date)}</td>
                          <td>${v.dose_ml ? `${v.dose_ml} ml` : "—"}</td>
                          <td>${v.next_due ? `<b>${fmtDate(v.next_due)}</b>` : "—"}</td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>
                ` : `<div class="empty">No vaccination records for this boar yet.</div>`}
              </div>
            </div>

            <!-- Action Toolbar -->
            <div class="due-actions" style="margin-top:18px;justify-content:space-between;flex-wrap:wrap;gap:8px">
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button type="button" class="btn" onclick="document.getElementById('boarDetailModal').remove();window.openBoarEditor && window.openBoarEditor('${esc(b.id || b.name)}')">✎ Edit Boar</button>
                <button type="button" class="btn ghost" onclick="document.getElementById('boarDetailModal').remove();window.openMovementWizard && window.openMovementWizard('${esc(b.id || b.name)}', 'boar')">🚚 Transfer Pen</button>
              </div>
              <button type="button" class="btn ghost" onclick="document.getElementById('boarDetailModal').remove()">Close</button>
            </div>
          </div>
        </div>
      `);
    } catch (err) {
      console.warn("Boar detail modal render error:", err);
      if (window.toast) toast("Unable to open boar profile: " + (err.message || String(err)));
    }
  }

  function openBoarDetailByIndex(index) {
    const farm = (typeof F === 'function' && F()) ? F() : {};
    const b = (farm.boars || [])[index];
    if (b) {
      openBoarDetailModal(b);
    }
  }

  window.openBoarDetailByIndex = openBoarDetailByIndex;
  window.openBoarDetailModal = openBoarDetailModal;

  Object.assign(window, { openBoarEditor, saveBoar, toggleBoarStatus, deleteBoar, setSemenCollectionInterval });

  /* expose the registry query for other modules (e.g. treatment targeting) */
  window.getActiveBoars = () => boars().filter(isActive);

  const old = window.renderAll;
  window.renderAll = function () {
    (typeof old === 'function' && old());
    renderPanel();
  };
})();