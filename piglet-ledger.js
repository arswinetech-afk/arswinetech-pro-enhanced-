/* Batch-level allocation, mortality and reservation hub (farm-scoped local UI; mirrors Supabase ledger schema). */
(function() {
  const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  window.esc = esc;

  // Universal resilient batch resolver
  const batch = id => {
    if (!id) return null;
    if (typeof id === "object") {
      id = id.id || id.batch_id || id.name;
    }
    const raw = String(id).trim();
    let decoded = raw;
    try { decoded = decodeURIComponent(raw).trim(); } catch(_) {}

    const list = (typeof F === "function" && F() && F().piglets) ? F().piglets : [];
    const sows = (typeof F === "function" && F() && F().sows) ? F().sows : [];
    const keys = [raw, decoded, raw.toLowerCase(), decoded.toLowerCase()];

    // 1. Match by batch ID
    let found = list.find(x => {
      const xId = String(x.id || "").trim();
      return keys.includes(xId) || keys.includes(xId.toLowerCase());
    });
    if (found) return found;

    // 2. Match by dam / sow name
    found = list.find(x => {
      const dam = String(x.dam_name || x.sow || "").trim();
      return dam && (keys.includes(dam) || keys.includes(dam.toLowerCase()));
    });
    if (found) return found;

    // 3. Match by dam_id / sow_id
    found = list.find(x => {
      const damId = String(x.dam_id || x.sow_id || "").trim();
      return damId && (keys.includes(damId) || keys.includes(damId.toLowerCase()));
    });
    if (found) return found;

    // 4. Check sows table for active litter
    for (const s of sows) {
      const sName = String(s.name || s.tag || s.id || "").trim();
      if (sName && (keys.includes(sName) || keys.includes(sName.toLowerCase()))) {
        if (s.activeLitterId) {
          const act = list.find(p => String(p.id || "").trim() === String(s.activeLitterId).trim());
          if (act) return act;
        }
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          if (String(p.dam_name || p.sow || "").trim().toLowerCase() === sName.toLowerCase()) {
            return p;
          }
        }
      }
    }

    // 5. Substring / partial match
    found = list.find(x => {
      const pId = String(x.id || "").trim().toLowerCase();
      const dam = String(x.dam_name || x.sow || "").trim().toLowerCase();
      return keys.some(k => k && (pId.includes(k) || k.includes(pId) || (dam && (dam.includes(k) || k.includes(dam)))));
    });
    return found || null;
  };
  window.getPigletBatch = batch;

  function counts(b) {
    let l = (F().pigletLedger || []).filter(x => x.batch_id === b.id && !['undone', 'deleted', 'voided'].includes(String(x.status || '').toLowerCase())),

      sum = (type, gender) => l.filter(x => x.type === type && (gender === "all" || x.gender === gender)).reduce((a, x) => a + (+x.quantity || 0), 0);

    // Cross-check released reservations directly to guarantee 100% deduction
    const releasedRes = (F().reservations || []).filter(r => (r.status === 'released' || !!r.released_at) && r.status !== 'cancelled');
    const releasedFromRes = (gender, src = null) => {
      let count = 0;
      releasedRes.forEach(r => {
        if (Array.isArray(r.lines) && r.lines.length) {
          r.lines.forEach(line => {
            if (line.batch_id === b.id && (gender === 'all' || line.gender === gender) && (!src || line.source === src || (!line.source && src === 'breeder'))) {
              count += (+line.quantity || 0);
            }
          });
        } else if (r.batch_id === b.id && (gender === 'all' || r.gender === gender) && (!src || r.source === src || (!r.source && src === 'breeder'))) {
          count += (+r.quantity || 0);
        }
      });
      return count;
    };

    let m = +b.males || 0,
      f = +b.females || 0;

    // 1. Mortality Deductions (Accurate single count)
    const mortM = sum("mortality", "male");
    const mortF = sum("mortality", "female");
    const mortUnspec = l.filter(x => x.type === "mortality" && x.gender !== "male" && x.gender !== "female").reduce((a, x) => a + (+x.quantity || 0), 0);
    const mortAll = mortM + mortF + mortUnspec;

    // Source-specific mortalities
    const sourceMort = (src, gender = "all") => {
      return l.filter(x => x.type === "mortality" && x.source === src && (gender === "all" || x.gender === gender)).reduce((a, x) => a + (+x.quantity || 0), 0);
    };

    const mortBreederM = sourceMort("breeder", "male");
    const mortBreederF = sourceMort("breeder", "female");
    const mortFattenerM = sourceMort("fattener", "male");
    const mortFattenerF = sourceMort("fattener", "female");
    const mortFarmM = sourceMort("farm_use", "male");
    const mortFarmF = sourceMort("farm_use", "female");

    // Sold / Released Heads (the piglets have left the farm!)
    const soldM = Math.max(sum("sold", "male"), releasedFromRes("male"));
    const soldF = Math.max(sum("sold", "female"), releasedFromRes("female"));
    const soldUnspec = l.filter(x => x.type === "sold" && x.gender !== "male" && x.gender !== "female").reduce((a, x) => a + (+x.quantity || 0), 0);
    const soldAll = Math.max(soldM + soldF + soldUnspec, releasedFromRes("all"));

    // 2. Total Living Headcount on farm (Heads actually living on farm right now!)
    const aliveM = Math.max(0, m - mortM - soldM);
    const aliveF = Math.max(0, f - mortF - soldF);
    /* [FIX M7] genderless mortality rows (legacy/custom imports) reduce the
       living herd too; they are drained from the pools and available counts. */
    const unspecApplied = Math.min(mortUnspec, aliveM + aliveF);
    const aliveAll = Math.max(0, aliveM + aliveF - unspecApplied);

    // 3. Pool Specific Allocations Assigned
    const breederAssignedM = sum("breeder", "male");
    const breederAssignedF = sum("breeder", "female");
    const fattenerAssignedM = sum("fattener", "male");
    const fattenerAssignedF = sum("fattener", "female");
    const farmAssignedM = sum("farm_use", "male");
    const farmAssignedF = sum("farm_use", "female");

    // 4. Source-specific reservations (Active / Pending reservations only)
    const sourceReserved = (src, gender = "all") => {
      const res = l.filter(x => x.type === "reserved" && (x.source === src || (!x.source && src === "breeder")) && (gender === "all" || x.gender === gender)).reduce((a, x) => a + (+x.quantity || 0), 0);
      const can = l.filter(x => x.type === "cancel_reservation" && (x.source === src || (!x.source && src === "breeder")) && (gender === "all" || x.gender === gender)).reduce((a, x) => a + (+x.quantity || 0), 0);
      return Math.max(0, res - can);
    };

    /* [FIX H5] Sold rows are attributed ONLY by their recorded pool source.
       The old `!x.source && src === 'breeder'` fallback swallowed every
       source-less (legacy) sold row into the breeder pool, zeroing the breeder
       pool while those same heads reappeared as "available" — double-bookable.
       Source-less sales now subtract from the living herd only (soldM/soldF). */
    const sourceSold = (src, gender = "all") => {
      const sld = l.filter(x => x.type === "sold" && x.source === src && (gender === "all" || x.gender === gender)).reduce((a, x) => a + (+x.quantity || 0), 0);
      return Math.max(sld, releasedFromRes(gender, src));
    };

    const resBreederM = sourceReserved("breeder", "male");
    const resBreederF = sourceReserved("breeder", "female");
    const resFattenerM = sourceReserved("fattener", "male");
    const resFattenerF = sourceReserved("fattener", "female");
    const resFarmM = sourceReserved("farm_use", "male");
    const resFarmF = sourceReserved("farm_use", "female");

    const soldBreederM = sourceSold("breeder", "male");
    const soldBreederF = sourceSold("breeder", "female");
    const soldFattenerM = sourceSold("fattener", "male");
    const soldFattenerF = sourceSold("fattener", "female");
    const soldFarmM = sourceSold("farm_use", "male");
    const soldFarmF = sourceSold("farm_use", "female");

    // 5. Living heads in each pool:
    // First, deduct explicit mortalities and sales from assigned amounts:
    let poolFattenerM = Math.max(0, fattenerAssignedM - mortFattenerM - soldFattenerM);
    let poolFattenerF = Math.max(0, fattenerAssignedF - mortFattenerF - soldFattenerF);
    let poolBreederM = Math.max(0, breederAssignedM - mortBreederM - soldBreederM);
    let poolBreederF = Math.max(0, breederAssignedF - mortBreederF - soldBreederF);
    let poolFarmM = Math.max(0, farmAssignedM - mortFarmM - soldFarmM);
    let poolFarmF = Math.max(0, farmAssignedF - mortFarmF - soldFarmF);

    // Unattributed general mortalities:
    let unattributedMortM = Math.max(0, mortM - mortBreederM - mortFattenerM - mortFarmM);
    let unattributedMortF = Math.max(0, mortF - mortBreederF - mortFattenerF - mortFarmF);

    // If there is unattributed mortality, deduct from active pools (Fattener -> Breeder -> Farm Use)
    if (unattributedMortM > 0) {
      const dFatM = Math.min(poolFattenerM, unattributedMortM);
      poolFattenerM -= dFatM;
      unattributedMortM -= dFatM;
    }
    if (unattributedMortM > 0) {
      const dBrM = Math.min(poolBreederM, unattributedMortM);
      poolBreederM -= dBrM;
      unattributedMortM -= dBrM;
    }
    if (unattributedMortM > 0) {
      const dFmM = Math.min(poolFarmM, unattributedMortM);
      poolFarmM -= dFmM;
      unattributedMortM -= dFmM;
    }

    if (unattributedMortF > 0) {
      const dFatF = Math.min(poolFattenerF, unattributedMortF);
      poolFattenerF -= dFatF;
      unattributedMortF -= dFatF;
    }
    if (unattributedMortF > 0) {
      const dBrF = Math.min(poolBreederF, unattributedMortF);
      poolBreederF -= dBrF;
      unattributedMortF -= dBrF;
    }
    if (unattributedMortF > 0) {
      const dFmF = Math.min(poolFarmF, unattributedMortF);
      poolFarmF -= dFmF;
      unattributedMortF -= dFmF;
    }

    /* [FIX M7] genderless mortality drains the pools (fattener → breeder → farm)
       before it reduces the open/available counts. */
    let unsp = unspecApplied;
    const drainPool = (q, get, set) => {
      if (unsp <= 0) return q;
      const d = Math.min(get(q), unsp);
      unsp -= d;
      return get(q) - d;
    };
    poolFattenerM = drainPool(poolFattenerM, x => x, x => x);
    poolFattenerF = drainPool(poolFattenerF, x => x, x => x);
    poolBreederM = drainPool(poolBreederM, x => x, x => x);
    poolBreederF = drainPool(poolBreederF, x => x, x => x);
    poolFarmM = drainPool(poolFarmM, x => x, x => x);
    poolFarmF = drainPool(poolFarmF, x => x, x => x);

    // Cap pools by living heads
    poolFattenerM = Math.min(poolFattenerM, aliveM);
    poolFattenerF = Math.min(poolFattenerF, aliveF);
    poolBreederM = Math.min(poolBreederM, aliveM);
    poolBreederF = Math.min(poolBreederF, aliveF);
    poolFarmM = Math.min(poolFarmM, aliveM);
    poolFarmF = Math.min(poolFarmF, aliveF);

    // 6. Net Available (Open / Unreserved) within each specific category
    const fattenerAvailM = Math.max(0, poolFattenerM - resFattenerM);
    const fattenerAvailF = Math.max(0, poolFattenerF - resFattenerF);
    const breederAvailM = Math.max(0, poolBreederM - resBreederM);
    const breederAvailF = Math.max(0, poolBreederF - resBreederF);
    const farmAvailM = Math.max(0, poolFarmM - resFarmM);
    const farmAvailF = Math.max(0, poolFarmF - resFarmF);

    // 7. Direct unassigned reservations
    const unassignedResM = l.filter(x => x.type === "reserved" && x.source === "unassigned" && x.gender === "male").reduce((a, x) => a + (+x.quantity || 0), 0);
    const unassignedResF = l.filter(x => x.type === "reserved" && x.source === "unassigned" && x.gender === "female").reduce((a, x) => a + (+x.quantity || 0), 0);

    // 8. Available (Unassigned / Open for Assignment)
    const totalLivingAssignedM = poolBreederM + poolFattenerM + poolFarmM;
    const totalLivingAssignedF = poolBreederF + poolFattenerF + poolFarmF;

    /* [FIX M7] any genderless mortality not yet absorbed by the pools reduces
       the open counts (males first, then females). */
    let availableM = Math.max(0, aliveM - totalLivingAssignedM - unassignedResM);
    let availableF = Math.max(0, aliveF - totalLivingAssignedF - unassignedResF);
    const availDrain = Math.min(unsp, availableM);
    availableM = Math.max(0, availableM - availDrain);
    availableF = Math.max(0, availableF - (unsp - availDrain));

    const totalReservedM = sum("reserved", "male") - sum("cancel_reservation", "male");
    const totalReservedF = sum("reserved", "female") - sum("cancel_reservation", "female");

    return {
      m,
      f,
      alive: aliveAll,
      aliveM,
      aliveF,
      availableM,
      availableF,
      availableAll: availableM + availableF,
      // Breeder (Shows living available heads in category)
      breeder: poolBreederM + poolBreederF,
      breederM: poolBreederM,
      breederF: poolBreederF,
      breederAvail: breederAvailM + breederAvailF,
      breederAvailM,
      breederAvailF,
      breederAssigned: breederAssignedM + breederAssignedF,
      // Fattener (Shows living available heads in category)
      fattener: poolFattenerM + poolFattenerF,
      fattenerM: poolFattenerM,
      fattenerF: poolFattenerF,
      fattenerAvail: fattenerAvailM + fattenerAvailF,
      fattenerAvailM,
      fattenerAvailF,
      fattenerAssigned: fattenerAssignedM + fattenerAssignedF,
      // Farm Use (Shows living available heads in category)
      farm: poolFarmM + poolFarmF,
      farmM: poolFarmM,
      farmF: poolFarmF,
      farmAvail: farmAvailM + farmAvailF,
      farmAvailM,
      farmAvailF,
      farmAssigned: farmAssignedM + farmAssignedF,
      // Total Reserved
      reserved: Math.max(0, totalReservedM + totalReservedF),
      reservedM: Math.max(0, totalReservedM),
      reservedF: Math.max(0, totalReservedF),
      // Sold / Released
      sold: soldAll,
      soldM,
      soldF,
      // Mortality
      mortality: mortAll,
      mortalityM: mortM,
      mortalityF: mortF
    };
  }

  function ledger(type, b, gender, qty, notes = '') {
    let c = counts(b),
      available = gender === 'male' ? c.availableM : c.availableF;
    if (['breeder', 'fattener', 'farm_use', 'reserved', 'mortality', 'sold'].includes(type) && qty > available) {
      toast(`Not enough available ${gender} piglets.`);
      return false
    }(F().pigletLedger || (F().pigletLedger = [])).push({
      id: 'plt-' + Date.now(),
      farm_id: farmId,
      batch_id: b.id,
      type,
      gender,
      quantity: qty,
      balance_before: available,
      balance_after: available - qty,
      notes,
      created_at: new Date().toISOString()
    });
    save();
    return true
  }

  function openBatchLedger(id) {
    let b = batch(id);
    if (!b) return;
    let c = counts(b);
    /* [REBUILD] Performance snapshot strip — computed by js/batch-performance.js
       (deferred call; that module loads after this one). */
    let perf = window.batchPerformance ? window.batchPerformance(b) : null,
      perfStrip = perf && perf.hasAny ? `<div class="batch-perf-strip"><div class="perf-strip-head"><b>⚖ Performance Metrics</b><small>printed on reservation certificates</small></div><div class="perf-strip-grid">${[0,9,7,8,6,3].map(i=>`<div><small>${perf.cells[i][0]}</small><b>${perf.cells[i][1]}</b></div>`).join('')}</div></div>` : '',
      floatingReservations = (F().reservations || []).filter(r => (r.status === 'floating' || r.is_floating) && (r.batch_id === b.id || (Array.isArray(r.lines) && r.lines.some(line => line.batch_id === b.id)))),
      floatingNote = floatingReservations.length ? `<div class="batch-floating-note">⏳ <b>${floatingReservations.reduce((sum, r) => sum + (+r.quantity || 0), 0)} floating waitlist head(s)</b> for this batch are not deducted from Reserved or Total Alive. Use Reservations → <b>Allocate Slot</b> after assigning the batch to Breeder, Fattener or Farm Use.</div>` : '';
    document.body.insertAdjacentHTML('beforeend', `<div class="drill-bg" id="batchHub"><div class="drill-panel"><div class="drill-header"><div><div class="eyebrow">PIGLET BATCH MANAGEMENT${b.archived ? ` <span class="archived-pill">🗄 ARCHIVED · ${b.archivedAt || ''}</span>` : ''}</div><h2>${b.id}</h2><p>${b.dam_name||b.sow||'—'} → ${b.sire_name||b.sire||'—'} · ${b.breed||'—'}</p></div><button class="close-reminder" onclick="document.getElementById('batchHub').remove()">×</button></div><div class="batch-live-grid">${[['Total Alive',c.alive,c.aliveM,c.aliveF],['Unassigned',c.availableAll,c.availableM,c.availableF],['Breeder',c.breeder,c.breederM,c.breederF],['Fattener',c.fattener,c.fattenerM,c.fattenerF],['Farm Use',c.farm,c.farmM,c.farmF],['Reserved',c.reserved,c.reservedM,c.reservedF],['Sold / Released',c.sold,c.soldM,c.soldF],['Mortality',c.mortality,c.mortalityM,c.mortalityF]].map(x=>`<div><small>${x[0]}</small><b>${x[1]}</b><small class="mf">♂ ${x[2]} · ♀ ${x[3]}</small></div>`).join('')}</div>${floatingNote}${perfStrip}<div class="profile-actions"><button type="button" class="btn" onclick="openAllocation(decodeURIComponent('${encodeURIComponent(b.id)}'),'breeder')">Breeder</button><button type="button" class="btn" onclick="openAllocation(decodeURIComponent('${encodeURIComponent(b.id)}'),'fattener')">Fattener</button><button type="button" class="btn" onclick="openAllocation(decodeURIComponent('${encodeURIComponent(b.id)}'),'farm_use')">Farm Use</button><button type="button" class="btn danger-btn" onclick="window.openMortality(decodeURIComponent('${encodeURIComponent(b.id)}'))">Record Mortality</button><button type="button" class="btn" onclick="openReservationForBatch(decodeURIComponent('${encodeURIComponent(b.id)}'))">Create Reservation</button><button type="button" class="btn" onclick="window.openBatchPedigreeTree && window.openBatchPedigreeTree(decodeURIComponent('${encodeURIComponent(b.id)}'))">🧬 View lineage tree</button><button type="button" class="btn" onclick="openBatchPerformance(decodeURIComponent('${encodeURIComponent(b.id)}'))">⚖ Performance &amp; Ear Notches</button><button type="button" class="btn" title="Feed trials & market selling for this batch" onclick="openFattenerCenter(decodeURIComponent('${encodeURIComponent(b.id)}'))">📈 Fattener Center</button><button type="button" class="btn ghost" onclick="viewBatchReservations(decodeURIComponent('${encodeURIComponent(b.id)}'))">View Reservations</button><button type="button" class="btn ghost" onclick="document.getElementById('batchHub').remove();openPigletEditor(decodeURIComponent('${encodeURIComponent(b.id)}'))">✎ Edit details</button><button type="button" class="btn ghost ${b.archived ? '' : 'archive-btn'}" title="${b.archived ? 'Restore this batch to active counts and feed planning' : 'Archive this batch: stops counting in Total piglets, fatteners, care cards and the feed plan (records kept)'}" onclick="toggleBatchArchive(decodeURIComponent('${encodeURIComponent(b.id)}'))">${b.archived ? '↩ Restore batch' : '🗄 Archive batch'}</button></div><div class="section"><h2>Batch transactions</h2>${(F().pigletLedger||[]).filter(x=>x.batch_id===b.id && !['undone', 'deleted'].includes(x.status)).map(x=>`<div class="summary-row" id="tx_row_${x.id}"><span><b>${esc(x.type.replace('_',' ').toUpperCase())} · ${x.gender==='male'?'♂ Male':(x.gender==='female'?'♀ Female':'All')}</b><br><small class="muted">${fmtDate(String(x.created_at||'').slice(0,10))}${x.notes?' · '+esc(x.notes):''}</small></span><b style="font-size:15px;color:var(--teal2)">${x.quantity} head</b><span><button type="button" class="btn ghost small" onclick="window.editBatchTransaction('${x.id}')">Edit</button> <button type="button" class="btn ghost small" onclick="window.undoBatchTransaction('${x.id}')">Undo</button> <button type="button" class="btn ghost small delete-action" onclick="window.deleteBatchTransaction('${x.id}')">Delete</button></span></div>`).join('')||'<div class="empty">No active allocation transactions yet. Use buttons above to allocate piglets.</div>'}</div></div></div>`)
  }

  /* [REBUILD FIX 24] Archive / restore a piglet batch. Archiving keeps every
     record (viewable any time, fully restorable) but removes the batch from
     every place batches roll up: dashboard Total piglets + batch count,
     Fatteners card, Iron & castration care window, production forecast, and
     the Feeding Guide 30-day projection — so finished/sold-out batches stop
     inflating the herd totals and the feed order plan. */
  function toggleBatchArchive(id) {
    let b = batch(id);
    if (!b) return;
    if (!b.archived) {
      if (!confirm(`Archive batch ${id}?\n\nIt keeps all of its records but stops counting in Total piglets, the Fatteners card, the Iron & castration card, the production forecast and the Feeding Guide projection. You can restore it any time.`)) return;
      b.archived = true;
      b.archivedAt = new Date().toISOString().slice(0, 10);
    } else {
      b.archived = false;
      b.archivedAt = null;
    }
    let wasHub = !!document.getElementById('batchHub');
    document.getElementById('fcHealthModal')?.remove();
    document.getElementById('batchHub')?.remove();
    save();
    renderAll();
    if (window.refreshOpenDrilldown) refreshOpenDrilldown();
    if (wasHub) openBatchLedger(id);
    toast(b.archived ? `Batch ${id} archived — no longer counted in totals or feed plans.` : `Batch ${id} restored — counting again.`)
  }
  window.toggleBatchArchive = toggleBatchArchive;

  function openAllocation(id, type) {
    let b = batch(id), c = counts(b);
    /* [REBUILD FIX 13] labels show the live available ♂/♀ count so the manager
       knows exactly how many can still be selected per gender. */
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="allocationModal"><form class="due-modal" onsubmit="saveAllocation(event,'${id}','${type}')"><h2>Assign to ${type.replace('_',' ')}</h2><div class="field"><label>Male <small class="muted">· ${c.availableM} available</small></label><input name="male" type="number" min="0" max="${c.availableM}" value="0"></div><div class="field"><label>Female <small class="muted">· ${c.availableF} available</small></label><input name="female" type="number" min="0" max="${c.availableF}" value="0"></div><div class="field"><label>Notes</label><textarea name="notes"></textarea></div><div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('allocationModal').remove()">Cancel</button><button class="btn">Save</button></div></form></div>`)
  }

  async function saveAllocation(e, id, type) {
    e.preventDefault();
    let d = Object.fromEntries(new FormData(e.target)),
      b = batch(id),
      male = parseInt(d.male || '0', 10) || 0,
      female = parseInt(d.female || '0', 10) || 0,
      ok = true;
    if (!b) { toast('Batch could not be found. No change was saved.'); return; }
    if (male + female < 1) {
      toast('Enter at least 1 male or female head before saving this allocation.');
      return;
    }
    const current = counts(b);
    if (male > current.availableM || female > current.availableF) {
      toast(`Not enough unassigned heads: ${current.availableM} male and ${current.availableF} female available.`);
      return;
    }
    if (male) ok = ledger(type, b, 'male', male, d.notes) && ok;
    if (female) ok = ledger(type, b, 'female', female, d.notes) && ok;
    if (ok) {
      const sync = window.ARSCloud?.verifyFarmSave
        ? await ARSCloud.verifyFarmSave(window.__arsActiveFarmId || farmId, `batch ${id} ${type} allocation`)
        : { success: false, reason: 'Cloud verification is unavailable.' };
      document.getElementById('allocationModal')?.remove();
      document.getElementById('batchHub')?.remove();
      openBatchLedger(id);
      renderAll();
      if (sync.success) toast(`✓ ${type.replace('_', ' ')} allocation saved and cloud-verified for ${id}.`);
      else {
        toast(`✓ Allocation saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
        window.updateSyncIndicator?.('pending', 'Allocation pending', sync.reason || 'The allocation remains safely local until it is verified.');
      }
    }
  }

    function openMortality(id) {
    let b = batch(id);
    if (!b && typeof id === "string") {
      b = batch(decodeURIComponent(id));
    }
    if (!b) {
      if (window.toast) toast("Could not load batch records for mortality log.");
      return;
    }
    let c = counts(b);
    const today = new Date().toISOString().slice(0, 10);
    const defaultUnitPrice = 3500;
    const safeId = encodeURIComponent(b.id);

    // Keep batchHub open in the background; pop mortalityModal directly on top!
    document.getElementById("mortalityModal")?.remove();

    document.body.insertAdjacentHTML("beforeend", `
      <div class="due-modal-bg" id="mortalityModal" style="z-index:999999!important;position:fixed!important;inset:0!important;display:grid!important;place-items:center!important">
        <form class="due-modal mortality-modal" style="position:relative!important;z-index:1000000!important" onsubmit="window.saveMortality(event,decodeURIComponent('${safeId}'))">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:#ef4444;font-weight:700">💀 LIVESTOCK MORTALITY &amp; LOSS LOG</div>
              <h2>Record Mortality · Batch ${esc(b.id)}</h2>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('mortalityModal')?.remove()">×</button>
          </div>

          <div class="mort-headcount-bar">
            <span>Living Herd Headcount: <b>${c.alive} live</b> (♂ ${c.aliveM} · ♀ ${c.aliveF})</span>
          </div>

          <div class="reminder-fields" style="margin-top:12px">
            <div class="form-grid-2">
              <div class="field">
                <label>Male Deaths (♂) <small class="muted">· max ${c.aliveM}</small></label>
                <input name="male" id="mortMale" type="number" min="0" max="${c.aliveM}" value="0" oninput="window.calcMortalityLoss()">
              </div>
              <div class="field">
                <label>Female Deaths (♀) <small class="muted">· max ${c.aliveF}</small></label>
                <input name="female" id="mortFemale" type="number" min="0" max="${c.aliveF}" value="0" oninput="window.calcMortalityLoss()">
              </div>
            </div>

            <div class="form-grid-2">
              <div class="field">
                <label>Date of Mortality *</label>
                <input name="date" type="date" value="${today}" required>
              </div>

              <div class="field">
                <label>Cause / Clinical Reason *</label>
                <select name="cause" required>
                  <option value="Crushing / Overlay by Sow">Crushing / Overlay by Sow</option>
                  <option value="Diarrhea / Severe Scours">Diarrhea / Severe Scours</option>
                  <option value="Respiratory Disease / Pneumonia">Respiratory Disease / Pneumonia</option>
                  <option value="Low Viability / Starvation / Runt">Low Viability / Starvation / Runt</option>
                  <option value="Sow Agalactia (No Milk)">Sow Agalactia (No Milk)</option>
                  <option value="Physical Trauma / Injury">Physical Trauma / Injury</option>
                  <option value="Infection / Disease Outbreak">Infection / Disease Outbreak</option>
                  <option value="Other / Unknown">Other / Unknown</option>
                </select>
              </div>
            </div>

            <!-- Financial Value / Price Loss Section -->
            <div class="field full">
              <div class="mort-financial-box">
                <div class="field" style="margin-bottom:0">
                  <label>Intended Selling Price / Estimated Value per Head (₱) *</label>
                  <input name="unit_price" id="mortUnitPrice" type="number" min="0" step="50" value="${defaultUnitPrice}" required placeholder="e.g. 3500" oninput="window.calcMortalityLoss()">
                  <small class="field-hint">Reflects financial loss directly into Financial Management &amp; Net Operating Margin</small>
                </div>
                <div class="mort-loss-preview" id="mortLossPreview">
                  <span>💸 Computed Financial Loss: <b>₱0.00</b></span>
                </div>
              </div>
            </div>

            <div class="field full">
              <label>Deduct from Allocation Pool</label>
              <select name="source_pool">
                <option value="auto" selected>Auto-Deduct from Living Allocation (${c.fattener > 0 ? "Fattener" : (c.breeder > 0 ? "Breeder" : "Unassigned")})</option>
                ${c.fattener > 0 ? `<option value="fattener">Fattener Pool (${c.fattener} living)</option>` : ''}
                ${c.breeder > 0 ? `<option value="breeder">Breeder Pool (${c.breeder} living)</option>` : ''}
                ${c.farm > 0 ? `<option value="farm_use">Farm Use Pool (${c.farm} living)</option>` : ''}
                <option value="unassigned">Unassigned Pool</option>
              </select>
            </div>

            <div class="field full">
              <label>Observations / Veterinary Notes</label>
              <textarea name="notes" placeholder="Symptoms, pen location, necropsy findings or medication attempts..."></textarea>
            </div>
          </div>

          <div class="form-error" id="mortErr"></div>

          <div class="due-actions">
            <button type="button" class="btn ghost" onclick="document.getElementById('mortalityModal')?.remove()">Cancel</button>
            <button type="submit" class="btn danger-btn">💀 Save Mortality &amp; Log Financial Loss</button>
          </div>
        </form>
      </div>
    `);

    window.calcMortalityLoss();
  }

  function saveMortality(e, id) {
    e.preventDefault();
    const form = e.target;
    const err = document.getElementById("mortErr");
    if (err) err.classList.remove("show");

    const b = batch(id);
    if (!b) return;

    const male = parseInt(form.male.value || "0", 10) || 0;
    const female = parseInt(form.female.value || "0", 10) || 0;
    const totalDead = male + female;
    const unitPrice = parseFloat(form.unit_price.value || "0") || 0;
    const totalLoss = totalDead * unitPrice;
    const cause = form.cause.value;
    const dateVal = form.date.value || new Date().toISOString().slice(0, 10);
    const notes = form.notes.value.trim();
    const sourcePool = form.source_pool?.value || "auto";

    if (totalDead <= 0) {
      if (err) { err.textContent = "Please enter at least 1 male or female death."; err.classList.add("show"); }
      return;
    }

    const c = counts(b);
    if (male > c.aliveM || female > c.aliveF) {
      if (err) { err.textContent = `Entered deaths exceed living headcount (${c.aliveM}♂ · ${c.aliveF}♀ alive).`; err.classList.add("show"); }
      return;
    }

    const ledgerList = F().pigletLedger || (F().pigletLedger = []);
    const assignedSource = sourcePool !== "auto" ? sourcePool : (c.fattener > 0 ? "fattener" : (c.breeder > 0 ? "breeder" : (c.farm > 0 ? "farm_use" : "unassigned")));

    if (male > 0) {
      ledgerList.push({
        id: "plt-" + Date.now() + "-m",
        farm_id: farmId,
        batch_id: b.id,
        type: "mortality",
        source: assignedSource,
        gender: "male",
        quantity: male,
        cause: cause,
        unit_price: unitPrice,
        total_loss: male * unitPrice,
        notes: notes ? `${cause}: ${notes}` : cause,
        created_at: new Date().toISOString()
      });
    }

    if (female > 0) {
      ledgerList.push({
        id: "plt-" + Date.now() + "-f",
        farm_id: farmId,
        batch_id: b.id,
        type: "mortality",
        source: assignedSource,
        gender: "female",
        quantity: female,
        cause: cause,
        unit_price: unitPrice,
        total_loss: female * unitPrice,
        notes: notes ? `${cause}: ${notes}` : cause,
        created_at: new Date().toISOString()
      });
    }

    // Mirror Financial Loss to Financial Management (Expense)
    if (totalLoss > 0) {
      const txList = F().transactions || (F().transactions = []);
      txList.unshift({
        id: "tx-mort-" + Date.now(),
        date: dateVal,
        type: "Expense",
        category: "Livestock Mortality Loss",
        description: `Mortality Loss: ${totalDead} head (${male ? male + "♂ " : ""}${female ? female + "♀" : ""}) · Batch ${b.id} · ${cause}`,
        amount: totalLoss,
        paid: totalLoss,
        created_at: new Date().toISOString()
      });
    }

    save();
    document.getElementById("mortalityModal")?.remove();
    document.getElementById("batchHub")?.remove();
    openBatchLedger(b.id);
    renderAll();
    toast(`💀 Recorded ${totalDead} mortality loss (${peso(totalLoss)} logged to Financials)`);
  }

  window.calcMortalityLoss = function() {
    const male = parseInt(document.getElementById("mortMale")?.value || "0", 10) || 0;
    const female = parseInt(document.getElementById("mortFemale")?.value || "0", 10) || 0;
    const price = parseFloat(document.getElementById("mortUnitPrice")?.value || "0") || 0;
    const totalDead = male + female;
    const totalLoss = totalDead * price;

    const preview = document.getElementById("mortLossPreview");
    if (preview) {
      preview.innerHTML = `<span>💸 Computed Financial Loss: <b style="color:#ef4444;font-size:15px">₱${totalLoss.toLocaleString("en-PH", {minimumFractionDigits: 2, maximumFractionDigits: 2})}</b> <small class="muted">(${totalDead} dead × ₱${price.toLocaleString()})</small></span>`;
    }
  };

  /* [FIX M1] single source of truth for a batch's living headcount — vaccination
     prep, medicine dosing, performance ADG and the feeding guide all used their
     own "born − mortality" formula and forgot sold/released heads. */
  function liveHeadsFor(b) {
    if (!b || typeof b !== 'object') return 0;
    try {
      const c = counts(b);
      return Math.max(0, Number(c.alive) || 0);
    } catch (_) {
      return Math.max(0, (+b.males || 0) + (+b.females || 0));
    }
  }
  window.liveHeadsFor = liveHeadsFor;

  window.openMortality = openMortality;
  window.getPigletCounts = counts;
  window.saveEditBatchTransaction = saveEditBatchTransaction;
  window.saveMortality = saveMortality;


  function openReservationForBatch(id) {
    document.getElementById('batchHub')?.remove();
    if (window.openReservationForm) openReservationForm(id)
  }

  function viewBatchReservations(id) {
    document.getElementById('batchHub')?.remove();
    go('reservations');
    setTimeout(() => document.querySelectorAll('#reservations tbody tr').forEach(r => {
      if (!r.textContent.includes(id)) r.style.display = 'none'
    }), 50)
  }

  function tx(id) {
    return (F().pigletLedger || []).find(x => x.id === id)
  }

  function refreshBatch(id) {
    document.getElementById('batchHub')?.remove();
    openBatchLedger(id);
    renderAll()
  }

  // Refresh an already-open batch hub after a cloud pull from another device.
  // The background sync used to refresh only page sections, leaving the open
  // modal frozen on its old counts and ledger rows.
  function refreshOpenBatchHub() {
    const hub = document.getElementById('batchHub');
    if (!hub || document.querySelector('#allocationModal, #mortalityModal, #editBatchTxModal, #pigletEditModal')) return;
    const batchId = hub.querySelector('.drill-header h2')?.textContent?.trim();
    if (!batchId) return;
    hub.remove();
    openBatchLedger(batchId);
  }
  window.refreshOpenBatchHub = refreshOpenBatchHub;

  function editBatchTransaction(id) {
    const x = tx(id);
    if (!x) return;
    const b = batch(x.batch_id);
    if (!b) return;

    document.getElementById('editBatchTxModal')?.remove();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg" id="editBatchTxModal" style="z-index:999999!important;position:fixed!important;inset:0!important;display:grid!important;place-items:center!important">
        <form class="due-modal" style="max-width:520px!important;width:100%!important" onsubmit="window.saveEditBatchTransaction(event, '${esc(x.id)}')">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:var(--teal2);font-weight:700">EDIT BATCH TRANSACTION</div>
              <h2>Edit Allocation · Batch ${esc(b.id)}</h2>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('editBatchTxModal').remove()">×</button>
          </div>

          <div class="reminder-fields" style="margin-top:12px">
            <div class="field">
              <label>Allocation / Destination Type *</label>
              <select name="type" required>
                <option value="breeder" ${x.type === 'breeder' ? 'selected' : ''}>Breeder (Breeding Stock)</option>
                <option value="fattener" ${x.type === 'fattener' ? 'selected' : ''}>Fattener (Grow-Finish)</option>
                <option value="farm_use" ${x.type === 'farm_use' ? 'selected' : ''}>Farm Use (On-Farm Retention)</option>
                <option value="reserved" ${x.type === 'reserved' ? 'selected' : ''}>Reserved (Customer Reservation)</option>
                <option value="mortality" ${x.type === 'mortality' ? 'selected' : ''}>Mortality (Livestock Death)</option>
                <option value="sold" ${x.type === 'sold' ? 'selected' : ''}>Sold</option>
              </select>
            </div>

            <div class="form-grid-2">
              <div class="field">
                <label>Gender (Sex) *</label>
                <select name="gender" required>
                  <option value="male" ${x.gender === 'male' ? 'selected' : ''}>♂ Male</option>
                  <option value="female" ${x.gender === 'female' ? 'selected' : ''}>♀ Female</option>
                </select>
              </div>
              <div class="field">
                <label>Quantity (head) *</label>
                <input name="quantity" type="number" min="1" value="${x.quantity}" required>
              </div>
            </div>

            <div class="field full">
              <label>Notes / Reference</label>
              <input name="notes" value="${esc(x.notes || '')}" placeholder="Optional transaction note...">
            </div>
          </div>

          <div class="form-error" id="editTxErr"></div>

          <div class="due-actions" style="margin-top:16px">
            <button type="button" class="btn ghost" onclick="document.getElementById('editBatchTxModal').remove()">Cancel</button>
            <button type="submit" class="btn">Save &amp; Re-adjust Allocation</button>
          </div>
        </form>
      </div>
    `);
  }
  window.editBatchTransaction = editBatchTransaction;

  async function saveEditBatchTransaction(e, id) {
    e.preventDefault();
    const form = e.target;
    const err = document.getElementById('editTxErr');
    if (err) err.classList.remove('show');

    const x = tx(id);
    if (!x) return;
    const b = batch(x.batch_id);
    if (!b) return;

    const d = Object.fromEntries(new FormData(form));
    const newType = d.type;
    const newGender = d.gender;
    const newQty = parseInt(d.quantity || '0', 10) || 0;
    const newNotes = String(d.notes || '').trim();

    if (newQty < 1) {
      if (err) { err.textContent = 'Quantity must be at least 1 head.'; err.classList.add('show'); }
      return;
    }

    /* [FIX M6] re-classifying a transaction must respect the destination pool's
       live capacity or the batch pools can exceed the living herd and block all
       future allocations. Allow the row's own current quantity as credit. */
    const cc = counts(b);
    const aliveFor = newGender === 'male' ? cc.aliveM : cc.aliveF;
    if (newQty > aliveFor) {
      if (err) { err.textContent = `Quantity exceeds living ${newGender} headcount for this batch (${aliveFor} alive).`; err.classList.add('show'); }
      return;
    }
    if (['breeder', 'fattener', 'farm_use', 'reserved'].includes(newType)) {
      const poolKey = newType === 'reserved' ? null : newType;
      const existingCredit = x.type === newType ? (+x.quantity || 0) : 0;
      let capacity;
      if (poolKey) {
        const availG = newGender === 'male' ? cc[poolKey + 'AvailM'] : cc[poolKey + 'AvailF'];
        capacity = (availG || 0) + existingCredit;
      } else {
        // reserved draws from the widest open slot of the source pool
        capacity = Math.max(cc.breederAvail, cc.fattenerAvail, cc.farmAvail) + existingCredit;
      }
      if (newQty > capacity) {
        if (err) {
          err.textContent = `Only ${capacity} ${newGender} head(s) can move into ${newType.replace('_', ' ')} for this batch. Free a slot first (e.g. cancel a reservation).`;
          err.classList.add('show');
        }
        return;
      }
    }

    // Apply updates
    x.type = newType;
    x.gender = newGender;
    x.quantity = newQty;
    x.notes = newNotes;
    x.status = 'active';
    x.updated_at = new Date().toISOString();

    save();
    const sync = window.ARSCloud?.verifyFarmSave
      ? await ARSCloud.verifyFarmSave(window.__arsActiveFarmId || farmId, `batch ${b.id} transaction edit`)
      : { success: false, reason: 'Cloud verification is unavailable.' };
    document.getElementById('editBatchTxModal')?.remove();
    refreshBatch(b.id);
    if (sync.success) toast(`✓ Updated transaction: ${newQty} ${newGender} assigned to ${newType.replace('_', ' ')} and cloud-verified.`);
    else {
      toast(`✓ Allocation edit saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
      window.updateSyncIndicator?.('pending', 'Allocation pending', sync.reason || 'The edit remains safely local until verified.');
    }
  }
  window.saveEditBatchTransaction = saveEditBatchTransaction;

  function undoBatchTransaction(id) {
    const list = F().pigletLedger || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return;
    const x = list[idx];
    const b = batch(x.batch_id);

    if (!confirm(`Void this transaction (${x.quantity} ${x.gender} ${x.type.replace('_', ' ')})?\n\nThe original row will remain in the audit history, but it will no longer count toward the live piglet pool.`)) return;

    // If it was a mortality with mirrored loss, void the linked financial row;
    // never erase the accounting history.
    if (x.type === 'mortality') {
      (F().transactions || []).forEach(t => {
        if (String(t.description || '').includes(x.batch_id) && String(t.category || '').includes('Mortality')) {
          t.status = 'voided';
          t.voided_at = new Date().toISOString();
          t.void_reason = `Piglet ledger transaction ${x.id} was voided.`;
        }
      });
    }

    // If it was a reservation, cancel matching reservation
    if (x.type === 'reserved') {
      (F().reservations || []).forEach(r => {
        if (r.batch_id === x.batch_id && r.quantity === x.quantity) {
          r.status = 'cancelled';
        }
      });
    }

    // Preserve the original event as a tombstone. Live-count queries already
    // exclude the compatibility status "undone".
    x.status = 'undone';
    x.voided_at = new Date().toISOString();
    x.void_reason = 'User voided this piglet ledger transaction.';
    save();

    if (b) refreshBatch(b.id);
    else renderAll();

    toast(`↩ Undone transaction: ${x.quantity} ${x.gender} returned to available pool`);
  }
  window.undoBatchTransaction = undoBatchTransaction;

  function deleteBatchTransaction(id) {
    const list = F().pigletLedger || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return;
    const x = list[idx];
    const b = batch(x.batch_id);

    if (!confirm(`Mark this transaction as deleted (${x.quantity} ${x.gender} ${x.type.replace('_', ' ')})?\n\nThe original row will be retained for audit and excluded from live counts.`)) return;

    // Preserve the linked reservation as a cancelled audit row.
    if (x.type === 'reserved') {
      (F().reservations || []).forEach(r => {
        if (r.batch_id === x.batch_id && r.quantity === x.quantity) {
          r.status = 'cancelled';
          r.cancelled_at = new Date().toISOString();
          r.cancel_reason = `Piglet ledger transaction ${x.id} was marked deleted.`;
        }
      });
    }

    // Retain the linked mortality expense as a voided audit row.
    if (x.type === 'mortality') {
      (F().transactions || []).forEach(t => {
        if (String(t.description || '').includes(x.batch_id) && String(t.category || '').includes('Mortality')) {
          t.status = 'voided';
          t.voided_at = new Date().toISOString();
          t.void_reason = `Piglet ledger transaction ${x.id} was marked deleted.`;
        }
      });
    }

    // Preserve a tombstone instead of removing the cloud row.
    x.status = 'deleted';
    x.deleted_at = new Date().toISOString();
    x.delete_reason = 'User marked this piglet ledger transaction deleted.';
    save();

    if (b) refreshBatch(b.id);
    else renderAll();

    toast(`🗑 Deleted transaction: ${x.quantity} ${x.gender} returned to available pool`);
  }
  window.deleteBatchTransaction = deleteBatchTransaction;

  /* ═════════════════ [REBUILD FIX 30] Live piglet batch rows ═════════════════
     Rich batch rows used by BOTH the Piglet Batches page and the farm-scoped
     drill-down: lineage summary + live feed chip + blinking care alerts, plus
     a full editor for correcting any recorded batch detail (with ID cascade). */
  const rowAge = n => (n === null || isNaN(n)) ? '—' : n < 365 ? `${Math.floor(n / 30)}mo` : `${Math.floor(n / 365)}y ${Math.floor(n % 365 / 30)}mo`; /* FIX 30: local fmtAge (drilldown's is module-scoped) */

  /* ═════════════════ [REBUILD FIX 31] Actionable past-due care alerts ══════
     The manager loves the blinking pills — so they stay, and they now DO
     something: tapping any alert opens a quick-update sheet for that batch:
       💉 Iron       → confirm "given already" on a chosen date (or jump to the
                       full medicine-tracked Iron & castration form);
       ✂ Castration  → confirm "done" OR "males kept as breeders — no
                       castration", which clears the alert for this batch;
       🐖 Weaning    → confirm the weaning date (also returns the dam to Open
                       like the lactation drill-down flow);
       🛡 Vaccine    → record the vaccine/s given.
     Pills keep blinking until resolved. Iron / castration past the 3–25-day
     care window (piglet-care.js CARE_MIN/CARE_MAX) relabel to OVERDUE, and
     weaning past 45 days of age relabels to WEANING OVERDUE. The castration
     pill (new) appears for batches with live males aged 3+ days. */
  const ledActQ = () => (F().pigletLedger || []).filter(x => !['undone', 'deleted'].includes(x.status));
  const ledSumQ = (bid, t, g) => ledActQ().filter(x => x.batch_id === bid && x.type === t && (!g || x.gender === g)).reduce((a, x) => a + (+x.quantity || 0), 0);
  const aliveMalesQ = b => Math.max(0, (+b.males || 0) - ledSumQ(b.id, 'mortality', 'male') - ledSumQ(b.id, 'sold', 'male')); /* FIX 31: same rule as piglet-care.js aliveMales */

  const batchAlerts = b => {
    if (!b || b.archived) return []; /* archived batches never blink (FIX 24) */
    let age = b.birth ? days(b.birth) : null, out = [];
    if (age !== null && age >= 3 && !b.iron) out.push(['iron', age > 25 ? '💉 IRON OVERDUE' : '💉 NEED IRON']); /* FIX 31: past-due relabel, still blinking */
    if (age !== null && age >= 3 && aliveMalesQ(b) > 0 && !b.castration && b.castration_exempt !== 'breeder') out.push(['castr', age > 25 ? '✂ CASTRATION OVERDUE' : '✂ CASTRATE MALES']); /* FIX 31: breeder-kept males are exempt */
    if (age !== null && age >= 30 && !(b.weanedAt || b.weaning_date || b.status === 'Weaned' || b.weaning)) out.push(['wean', age >= 45 ? '🐖 WEANING OVERDUE' : '🐖 NEED TO WEAN']);
    if (!b.vaccination_status && !b.vaccines_given) out.push(['vacc', '🛡 PENDING VACCINE']);
    return out
  };

  function pigletRowHTML(x) {
    let jid = String(x.id).split("'").join("\\'"),
      alerts = batchAlerts(x).map(a => `<button type="button" class="batch-alert ${a[0]}" title="Tap to update this care status" onclick="event.stopPropagation();openCareQuick('${jid}','${a[0]}')">${a[1]}</button>`).join(''), /* FIX 31: tappable pills */
      feed = window.batchFeedChip ? window.batchFeedChip(x) : null,
      /* [REBUILD FIX 55] foster batches get their own 🍼 FOSTERED label
         plus nurse/origin lines; everything else (feed chips, vax chip, care
         alert pills, batch hub) behaves exactly like a normal batch. */
      _fost = x.foster || x.cross_fostered || (Array.isArray(x.foster_from) && x.foster_from.length > 0) || (Array.isArray(x.foster_transfers) && x.foster_transfers.length > 0),
      _origins = _fost && Array.isArray(x.foster_from) ? [...new Set(x.foster_from.map(l => l.dam).filter(Boolean))] : [],
      hay = (x.id + ' ' + (x.dam_name || x.sow || '') + ' ' + (x.sire_name || x.sire || '') + ' ' + (x.semen_batch_no || x.semen || '') + ' ' + (x.breed || '') + (_fost ? ' foster ' + (x.foster_from || []).map(l => (l.from || '') + ' ' + (l.dam || '')).join(' ') : '')).toLowerCase();
    const _vxChip = window.vaxSummaryText ? vaxSummaryText('batch', x.id, x.id) : ''; /* [REBUILD FIX 48] fetched vaccine record */
    return `<div class="drill-row batch-drill-row drill-row-link piglet-live-row ${x.archived ? 'drill-archived' : ''}" role="button" data-batch-delete-row data-batch-delete-entity="piglet_batch" data-batch-delete-key="${esc(x._ars_cloud_local_id || x.id)}" data-piglet-search="${hay}" onclick="openBatchDetails('${jid}')">` +
      `<b>${x.id}</b>${x.archived ? `<span class="archived-pill">🗄 ARCHIVED${x.archivedAt ? ' · ' + x.archivedAt : ''}</span>` : ''}${_fost ? '<span class="foster-animated-badge">🍼 FOSTERED</span>' : ''}` +
      `${feed ? (feed.complete ? '<span class="tag row-feed-done">MARKET READY</span>' : `<span class="tag row-feed-stage">on ${feed.stage}</span>`) : ''}` +
      `<span>${x.nurse_sow ? `🤱 nurse: ${x.nurse_sow} · from: ${_origins.join(', ') || '—'}` : `${x.dam_name || x.sow || '—'} → ${x.sire_name || x.sire || '—'}`}</span>` +
      `<small>${rowAge(days(x.birth))} · ${(+x.males || 0) + (+x.females || 0)} heads · ${_fost ? (x.breed || '—') + (x.birth ? ' · born ' + fmtDate(x.birth) : '') : (x.semen_batch_no || x.semen || '')}</small>` +
      `${_fost && Array.isArray(x.foster_from) && x.foster_from.length ? `<small class="row-foster-src">⇢ ${x.foster_from.map(l => `${l.males}♂+${l.females}♀ from ${l.from || l.dam}`).join(' · ')}</small>` : ''}` +
      `${feed && feed.chips ? `<small class="row-feed-chip">🍚 next 30d: ${feed.chips}</small>` : ''}` +
      `${_vxChip ? `<small class="row-vax-chip">💉 ${_vxChip}</small>` : ''}` +
      `${alerts ? `<span class="batch-alert-row">${alerts}</span>` : ''}` +
      `<em class="drill-row-caret">›</em></div>`
  }

  /* ── full batch editor: corrections to any recorded detail ── */
  function renamePigletBatchRefs(oldId, newId) {
    /* cascade the corrected ID into every store that keys by batch id
       (cloud rows re-sync on the next push under the new local id). */
    (F().pigletLedger || []).forEach(x => { if (x.batch_id === oldId) x.batch_id = newId });
    (F().reservations || []).forEach(x => { if (x.batch_id === oldId) x.batch_id = newId; if (Array.isArray(x.lines)) x.lines.forEach(L => { if (L.batch_id === oldId) L.batch_id = newId }); /* [REBUILD FIX 57] multi-batch lines */ });
    (F().med_movements || []).forEach(x => {
      if (x.animal_ref === 'batch:' + oldId) {
        x.animal_ref = 'batch:' + newId;
        x.animal_label = String(x.animal_label || '').split(oldId).join(newId)
      }
    });
    (F().medicines || []).forEach(m => (m.movements || []).forEach(x => {
      if (x.animal_ref === 'batch:' + oldId) x.animal_ref = 'batch:' + newId
    }));
    let fp = F().feedPlan;
    if (fp && fp.batches && fp.batches[oldId]) {
      fp.batches[newId] = fp.batches[oldId];
      delete fp.batches[oldId]
    }
    (F().sows || []).forEach(s => { if (s.activeLitterId === oldId) s.activeLitterId = newId });
    (F().feedTrials || []).forEach(t => {
      if (t.batchId === oldId) t.batchId = newId;
      if (t.batch_id === oldId) t.batch_id = newId;
      (t.groups || []).forEach(g => {
        if (g.batchId === oldId) g.batchId = newId;
        if (g.batch_id === oldId) g.batch_id = newId
      })
    })
  }

  function openPigletEditor(id) {
    let b = batch(id);
    if (!b) {
      toast('Batch ' + id + ' is not in the piglet records.');
      return
    }
    let jid = String(id).split("'").join("\\'"),
      /* [FIX L4] value attributes must be escaped (a breed/name with a quote or
         < could otherwise break the modal markup). */
      v = k => esc_pe(String(b[k] ?? '')),
      field = (label, inner) => `<div class="field"><label>${label}</label>${inner}</div>`;
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="pigletEditModal"><form class="reminder-modal perf-modal" onsubmit="savePigletEdits(event,'${jid}')"><div class="modal-top"><div><div class="eyebrow">CORRECT BATCH RECORD</div><h2>✎ Edit ${esc_pe(b.id)}</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('pigletEditModal').remove()">×</button></div><p class="perf-sub">All recorded details of this batch may be corrected. Renaming the Batch ID re-links its ledger, reservations, feed consumption and treatment history automatically.</p><div class="reminder-fields">` +
      field('Batch ID *', `<input name="id" required value="${v('id')}">`) +
      field('Birth date *', `<input name="birth" type="date" required value="${v('birth')}">`) +
      field('Breed', `<input name="breed" list="pigletEditBreeds" value="${v('breed')}"><datalist id="pigletEditBreeds"><option>F1</option><option>Duroc</option><option>Landrace</option><option>Large White</option><option>Pietrain</option><option>Crossbred</option></datalist>`) +
      field('Males', `<input name="males" type="number" min="0" value="${+b.males || 0}">`) +
      field('Females (Live)', `<input name="females" type="number" min="0" value="${+b.females || 0}">`) +
      field('Stillborn', `<input name="stillborn" type="number" min="0" value="${+b.stillborn || 0}">`) +
      field('Mummified', `<input name="mummified" type="number" min="0" value="${+b.mummified || 0}">`) +
      field('Dam / sow (label)', `<input name="dam_name" value="${v('dam_name') || v('sow')}">`) +
      field('Sire / boar (label)', `<input name="sire_name" value="${v('sire_name') || v('sire')}">`) +
      field('Genetic source (semen batch no.)', `<input name="semen_batch_no" value="${v('semen_batch_no') || v('semen')}">`) +
      field('Vaccination status', `<input name="vaccination_status" list="pigletEditVacc" value="${v('vaccination_status')}" placeholder="blank = pending vaccine alert on rows"><datalist id="pigletEditVacc"><option>Up to date</option><option>Scheduled</option><option>Overdue</option></datalist>`) +
      field('Vaccines given', `<input name="vaccines_given" value="${v('vaccines_given')}" placeholder="e.g. Hog Cholera 2026-07-01">`) +
      field('Health status', `<input name="health_status" list="pigletEditHealth" value="${v('health_status')}"><datalist id="pigletEditHealth"><option>Healthy</option><option>Sick</option><option>Recovering</option><option>Under observation</option></datalist>`) +
      field('Weaning weight (avg kg)', `<input name="weaning_weight" type="number" min="0" step="0.1" value="${b.weaning_weight ?? ''}">`) +
      field('Weaned date', `<input name="weanedAt" type="date" value="${v('weanedAt') || v('weaning_date')}"><small class="field-hint">Set when weaning is done (clears NEED TO WEAN); clear it to mark the batch as not yet weaned.</small>`) +
      /* [REBUILD FIX 31] iron / castration corrections (mirrors the quick-care sheets) */
      field('Iron given date', `<input name="iron_when" type="date" value="${v('ironAt') || (b.iron ? todayQ() : '')}"><small class="field-hint">Set = iron done (clears NEED IRON); leave blank = keep the alert on.</small>`) +
      field('Castration', `<select name="castr_status"><option value=""${!b.castration && b.castration_exempt !== 'breeder' ? ' selected' : ''}>Not done (alert blinks)</option><option value="done"${b.castration ? ' selected' : ''}>Done</option><option value="breeder"${!b.castration && b.castration_exempt === 'breeder' ? ' selected' : ''}>Not castrated — males kept as breeders</option></select><small class="field-hint">“Breeders” clears the castration alert without marking it done.</small>`) +
      field('Castration done date', `<input name="castr_when" type="date" value="${v('castrAt') || (b.castration ? todayQ() : '')}">`) +
      `<div class="field full"><label>Notes</label><textarea name="notes" placeholder="Litter notes, corrections log...">${v('notes')}</textarea></div>` +
      `</div><div class="form-error" id="pigletEditErr"></div><div class="actions"><button type="button" class="btn ghost" onclick="document.getElementById('pigletEditModal').remove()">Cancel</button><button class="btn">Save corrections</button></div></form></div>`)
  }

  function savePigletEdits(e, oldId) {
    e.preventDefault();
    let d = Object.fromEntries(new FormData(e.target)),
      b = batch(oldId),
      err = document.getElementById('pigletEditErr');
    if (!b) return;
    let newId = (d.id || '').trim();
    if (!newId) {
      err.textContent = 'Batch ID is required.';
      err.classList.add('show');
      return
    }
    if ((F().piglets || []).some(q => q !== b && String(q.id).toLowerCase() === newId.toLowerCase())) {
      err.textContent = `"${newId}" is already used by another batch.`;
      err.classList.add('show');
      return
    }
    b.birth = d.birth || b.birth;
    b.breed = (d.breed || '').trim();
    b.males = Math.max(0, +d.males || 0);
    b.females = Math.max(0, +d.females || 0);
    b.stillborn = Math.max(0, +d.stillborn || 0);
    b.mummified = Math.max(0, +d.mummified || 0);
    b.total_born = b.males + b.females + b.stillborn + b.mummified;
    b.sow = b.dam_name = (d.dam_name || '').trim();
    b.sire = b.sire_name = (d.sire_name || '').trim();
    b.semen = b.semen_batch_no = (d.semen_batch_no || '').trim();
    b.vaccination_status = (d.vaccination_status || '').trim();
    b.vaccines_given = (d.vaccines_given || '').trim();
    b.health_status = (d.health_status || '').trim();
    if (d.weaning_weight !== '') b.weaning_weight = +d.weaning_weight || 0;
    b.notes = d.notes || '';
    if (d.weanedAt) b.weanedAt = b.weaning_date = d.weanedAt;
    else {
      delete b.weanedAt;
      delete b.weaning_date
    }
    /* [REBUILD FIX 31] quick-care corrections */
    if (d.iron_when) { b.iron = true; b.ironAt = d.iron_when }
    else { b.iron = false; b.ironAt = '' }
    if (d.castr_status === 'done') { b.castration = true; delete b.castration_exempt; b.castrAt = d.castr_when || b.castrAt || todayQ() }
    else if (d.castr_status === 'breeder') { delete b.castration; b.castration_exempt = 'breeder' }
    else { delete b.castration; delete b.castration_exempt }
    if (newId !== oldId) renamePigletBatchRefs(oldId, newId);
    b.id = newId;
    let dam = (F().sows || []).find(s => s.id === b.dam_id || s.id === b.sow_id || (s.name && (s.name === b.dam_name || s.name === b.sow))); /* FIX 30: legacy batches link by name */
    if (dam && dam.activeLitterId === b.id) dam.lastLitter = b.males + b.females;
    save();
    document.getElementById('pigletEditModal').remove();
    renderAll();
    if (window.refreshOpenDrilldown) refreshOpenDrilldown();
    let openDetails = document.getElementById('fcHealthModal');
    if (openDetails) {
      openDetails.remove();
      openBatchDetails(newId)
    }
    toast('Batch ' + newId + ' updated')
  }

  /* ── [REBUILD FIX 31] tap-the-alert quick-care sheets ── */
  const todayQ = () => (typeof TODAY !== 'undefined' ? TODAY : new Date().toISOString().slice(0, 10));

  function refreshCareSurfaces(bid, msg) { /* FIX 31: persist + repaint every surface that shows the batch */
    save();
    document.getElementById('careQuickModal')?.remove();
    renderAll();
    if (window.refreshOpenDrilldown) refreshOpenDrilldown();
    let d = document.getElementById('fcHealthModal');
    if (d) { d.remove(); openBatchDetails(bid) }
    toast(msg)
  }

  function openCareQuick(bid, kind) {
    let b = batch(bid);
    if (!b) { toast('Batch ' + bid + ' is not in the piglet records.'); return }
    document.getElementById('careQuickModal')?.remove();
    let jid = String(bid).split("'").join("\\'"),
      age = b.birth ? days(b.birth) : null,
      head = (+b.males || 0) + (+b.females || 0),
      ctx = `<p class="perf-sub">Batch <b>${esc_pe(b.id)}</b> · ${esc_pe(b.dam_name || b.sow || '—')} → ${esc_pe(b.sire_name || b.sire || '—')} · ${age === null ? 'unknown age' : age + ' days old'} · ${head} heads</p>`,
      detBtn = tab => `<button type="button" class="btn ghost" onclick="document.getElementById('careQuickModal').remove();if(window.openPigletCare){openPigletCare('${jid}','${tab}')}else{toast('Use the dashboard Iron &amp; castration card to record with medicine details')}">💊 Record with medicine details →</button>`,
      body = '';
    if (kind === 'iron') {
      body = ctx +
        `<p class="muted care-quick-note">Iron injection is due from day 3 of age (care window: day 3–25). Confirm below if it was already given — otherwise keep the alert blinking.</p>` +
        `<form onsubmit="saveCareIron(event,'${jid}')"><div class="reminder-fields"><div class="field"><label>Date iron was given *</label><input name="when" type="date" value="${todayQ()}" required></div></div>` +
        `<div class="actions"><button type="button" class="btn ghost" onclick="document.getElementById('careQuickModal').remove()">Not yet — keep reminding me</button><button class="btn">✔ Iron given</button></div></form>` +
        `<div class="care-quick-alt">${detBtn('iron')}</div>`;
    } else if (kind === 'castr') {
      body = ctx +
        `<p class="muted care-quick-note">This batch has <b>${aliveMalesQ(b)} live male piglet(s)</b>. Castration is part of the day 3–25 care window — unless the males are being raised as breeders. Choose what applies:</p>` +
        `<form onsubmit="saveCareCastr(event,'${jid}')"><div class="reminder-fields"><div class="field"><label>Date castrated *</label><input name="when" type="date" value="${todayQ()}" required></div></div>` +
        `<div class="actions"><button type="button" class="btn ghost" onclick="document.getElementById('careQuickModal').remove()">Not yet — keep reminding me</button><button class="btn">✔ Castration done</button></div></form>` +
        `<div class="care-quick-alt"><button type="button" class="btn ghost care-breeder-btn" onclick="careCastrBreeder('${jid}')">🐗 Males kept as breeders — no castration</button>${detBtn('castration')}</div>`;
    } else if (kind === 'wean') {
      body = ctx +
        `<p class="muted care-quick-note">Piglets are due for weaning at 30 days of age. Confirming also returns the dam to OPEN status (same as the lactation drill-down).</p>` +
        `<form onsubmit="saveCareWean(event,'${jid}')"><div class="reminder-fields"><div class="field"><label>Date weaned *</label><input name="when" type="date" value="${todayQ()}" required></div></div>` +
        `<div class="form-error" id="careQuickErr"></div>` +
        `<div class="actions"><button type="button" class="btn ghost" onclick="document.getElementById('careQuickModal').remove()">Not yet — keep reminding me</button><button class="btn">✔ Mark weaned</button></div></form>`;
    } else if (kind === 'vacc') {
      body = ctx +
        `<p class="muted care-quick-note">No vaccine is on record for this batch yet. Record what was given (correctable later via ✎ Edit details).</p>` +
        `<form onsubmit="saveCareVacc(event,'${jid}')"><div class="reminder-fields"><div class="field"><label>Vaccine/s given *</label><input name="vaccs" required placeholder="e.g. Hog Cholera"></div><div class="field"><label>Date given *</label><input name="when" type="date" value="${todayQ()}" required></div></div>` +
        `<div class="actions"><button type="button" class="btn ghost" onclick="document.getElementById('careQuickModal').remove()">Not yet — keep reminding me</button><button class="btn">✔ Save vaccine record</button></div></form>`;
    } else return;
    let titles = { iron: '💉 Iron injection', castr: '✂ Castration', wean: '🐖 Weaning', vacc: '🛡 Vaccination' };
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="careQuickModal"><div class="reminder-modal perf-modal care-quick-modal"><div class="modal-top"><div><div class="eyebrow">QUICK CARE UPDATE</div><h2>${titles[kind]}</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('careQuickModal').remove()">×</button></div>${body}</div></div>`)
  }

  function saveCareIron(e, bid) {
    e.preventDefault();
    let d = Object.fromEntries(new FormData(e.target)), b = batch(bid);
    if (!b || !d.when) return;
    if (b.birth && d.when < b.birth) { toast('Date cannot be before the birth date.'); return }
    b.iron = true;
    b.ironAt = d.when;
    refreshCareSurfaces(bid, '✔ Iron recorded for ' + bid + ' · ' + d.when)
  }

  function saveCareCastr(e, bid) {
    e.preventDefault();
    let d = Object.fromEntries(new FormData(e.target)), b = batch(bid);
    if (!b || !d.when) return;
    if (b.birth && d.when < b.birth) { toast('Date cannot be before the birth date.'); return }
    b.castration = true;
    b.castrAt = d.when;
    delete b.castration_exempt; /* FIX 31: a "done" confirmation cancels any earlier breeder exemption */
    refreshCareSurfaces(bid, '✔ Castration recorded for ' + bid + ' · ' + d.when)
  }

  function careCastrBreeder(bid) {
    let b = batch(bid);
    if (!b) return;
    if (!confirm('Keep the male piglets of ' + bid + ' as breeders? They will NOT be castrated and the castration alert will stop blinking.')) return;
    delete b.castration;
    b.castration_exempt = 'breeder';
    b.castration_note = 'Males kept as breeders — no castration (confirmed from the batch alert)';
    refreshCareSurfaces(bid, '🐗 ' + bid + ' males kept as breeders — castration alert cleared')
  }

  function saveCareWean(e, bid) {
    e.preventDefault();
    let d = Object.fromEntries(new FormData(e.target)), b = batch(bid),
      err = document.getElementById('careQuickErr');
    if (!b || !d.when) return;
    if (b.birth && d.when < b.birth) {
      if (err) { err.textContent = 'Weaning date cannot be before the birth date.'; err.classList.add('show') }
      return
    }
    b.weanedAt = b.weaning_date = d.when;
    b.status = 'Weaned';
    b.weaning = true;
    /* FIX 31: mirror drilldown saveWeaning — the dam returns to Open. */
    let dam = (F().sows || []).find(s => s.id === b.dam_id || s.id === b.sow_id || (s.name && (s.name === b.dam_name || s.name === b.sow)));
    if (dam && dam.activeLitterId === b.id) {
      dam.lactationEndedAt = d.when;
      dam.weanedAt = d.when;
      dam.lifecycle = 'Weaned';
      dam.status = 'Open';
      dam.activeLitterId = null;
      dam.lastWeanedBatchId = b.id;
      if (!dam.parityIncrementedAtWeaning) { dam.parity = (+dam.parity || 0) + 1; dam.parityIncrementedAtWeaning = true }
    }
    refreshCareSurfaces(bid, '✔ ' + bid + ' weaned · ' + d.when)
  }

  function saveCareVacc(e, bid) {
    e.preventDefault();
    let d = Object.fromEntries(new FormData(e.target)), b = batch(bid);
    if (!b || !(d.vaccs || '').trim()) return;
    let entry = d.vaccs.trim() + ' ' + d.when;
    b.vaccines_given = (b.vaccines_given || '').trim() ? b.vaccines_given.trim() + '; ' + entry : entry;
    if (!b.vaccination_status) b.vaccination_status = 'Up to date';
    refreshCareSurfaces(bid, '✔ Vaccine recorded for ' + bid)
  }

  const esc_pe = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  window.batchAlerts = batchAlerts;
  window.pigletRowHTML = pigletRowHTML;
  window.openPigletEditor = openPigletEditor;
  window.savePigletEdits = savePigletEdits;
  /* [REBUILD FIX 31] */
  window.aliveMalesQ = aliveMalesQ;
  window.openCareQuick = openCareQuick;
  window.saveCareIron = saveCareIron;
  window.saveCareCastr = saveCareCastr;
  window.careCastrBreeder = careCastrBreeder;
  window.saveCareWean = saveCareWean;
  window.saveCareVacc = saveCareVacc;

  window.openReservationForBatch = openReservationForBatch;
  window.viewBatchReservations = viewBatchReservations;
  window.editBatchTransaction = editBatchTransaction;
  window.undoBatchTransaction = undoBatchTransaction;
  window.deleteBatchTransaction = deleteBatchTransaction;
  window.openBatchLedger = openBatchLedger;
  window.openAllocation = openAllocation;
  window.saveAllocation = saveAllocation;
  window.openMortality = openMortality;
  window.getPigletCounts = counts;
  window.saveEditBatchTransaction = saveEditBatchTransaction;
})();