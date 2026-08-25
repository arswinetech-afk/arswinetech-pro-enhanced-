/* ═══════════════════════════════════════════════════════════════════════════
   ARSwineTech Pro — Customer Reservations Management Hub (js/reservations.js)
   Features: Release-readiness sorting (90d maturity), Floating / Waitlist Priority,
   Multi-batch bundling, Ear notch tagging, Certificate generation & Living herd sync.
   ═══════════════════════════════════════════════════════════════════════════ */
(function() {
  const allocationAvailable = (b, source, g) => {
    let l = F().pigletLedger || [],
      assigned = l.filter(t => t.batch_id === b.id && t.gender === g && t.type === source && !['undone', 'deleted', 'voided'].includes(String(t.status || '').toLowerCase())).reduce((a, t) => a + (+t.quantity || 0), 0),
      reserved = l.filter(t => t.batch_id === b.id && t.gender === g && t.type === 'reserved' && t.source === source && !['undone', 'deleted', 'voided'].includes(String(t.status || '').toLowerCase())).reduce((a, t) => a + (+t.quantity || 0), 0),
      cancelled = l.filter(t => t.batch_id === b.id && t.gender === g && t.type === 'cancel_reservation' && t.source === source && !['undone', 'deleted', 'voided'].includes(String(t.status || '').toLowerCase())).reduce((a, t) => a + (+t.quantity || 0), 0);
    return Math.max(0, assigned - reserved + cancelled);
  };
  const batch = id => (F().piglets || []).find(x => x.id === id);

  /* Multi-batch reservations: "+N more" under the table's primary batch */
  const resLineExtra = r => {
    if (!Array.isArray(r.lines) || r.lines.length < 2) return '';
    let extra = new Set(r.lines.map(L => L.batch_id)).size - 1;
    return extra > 0 ? `<br><small>+${extra} more batch${extra > 1 ? 'es' : ''}</small>` : '';
  };
  const escAttr = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* [FIX H3] The old picker computed "alive − assigned" from born mortality
     counts and IGNORED sold/released heads, so it showed pigs that had already
     left the farm as bookable. It also showed the global unassigned count while
     reservations actually draw from an assigned pool, so displayed and validated
     numbers disagreed. We now use the authoritative count engine (sold-aware)
     and report the best pool a customer can reserve from for each gender. */
  const available = b => {
    if (window.getPigletCounts && typeof window.getPigletCounts === 'function') {
      try {
        const c = window.getPigletCounts(b);
        if (c && typeof c === 'object') {
          const best = (g) => Math.max(
            g === 'male' ? (c.breederAvailM || 0) : (c.breederAvailF || 0),
            g === 'male' ? (c.fattenerAvailM || 0) : (c.fattenerAvailF || 0),
            g === 'male' ? (c.farmAvailM || 0) : (c.farmAvailF || 0)
          );
          const headerM = Math.max(best('male'), c.availableM || 0);
          const headerF = Math.max(best('female'), c.availableF || 0);
          return { m: headerM, f: headerF, byCounts: c };
        }
      } catch (_) { /* fall through to conservative fallback */ }
    }
    /* Legacy fallback (no ledger engine): worst case treat sold as still present
       so the manager can never over-book. */
    let l = (F().pigletLedger || []).filter(x => x.batch_id === b.id && !['undone', 'deleted', 'voided'].includes(String(x.status || '').toLowerCase())),
      m = +b.males || 0,
      f = +b.females || 0,
      sum = (type, gender) => l.filter(x => x.type === type && (gender === "all" || x.gender === gender)).reduce((a, x) => a + (+x.quantity || 0), 0);
    const calcAvail = g => {
      const alive = (g === "male" ? m : f) - sum("mortality", g) - sum("sold", g);
      const assigned = sum("breeder", g) + sum("fattener", g) + sum("farm_use", g);
      const unassignedRes = l.filter(x => x.type === "reserved" && x.source === "unassigned" && x.gender === g).reduce((a, x) => a + (+x.quantity || 0), 0);
      return Math.max(0, alive - assigned - unassignedRes);
    };
    return {
      m: calcAvail("male"),
      f: calcAvail("female")
    };
  };

  let currentReservationSearch = '';
  let isReservationListExpanded = false;

  window.toggleReservationListCollapse = function() {
    isReservationListExpanded = !isReservationListExpanded;
    const box = document.getElementById('resOlderRows');
    const btn = document.getElementById('btnToggleReservationList');
    if (!box || !btn) return;
    if (isReservationListExpanded) {
      box.style.display = 'table-row-group';
      btn.innerHTML = '▲ Collapse older / completed reservations';
    } else {
      box.style.display = 'none';
      const count = box.querySelectorAll('tr.reservation-row').length;
      btn.innerHTML = `▼ Show ${count} older / other reservation records…`;
    }
  };

  function floatingMiniDetails(r) {
    const lines = Array.isArray(r.lines) && r.lines.length ? r.lines : [{ batch_id: r.batch_id, source: r.source || 'breeder', gender: r.gender || 'female', quantity: r.quantity || 1 }];
    let requested = 0, available = 0;
    const detail = [];
    lines.forEach(line => {
      const b = batch(line.batch_id);
      const gender = line.gender === 'mixed' ? 'female' : (line.gender || 'female');
      const open = b ? allocationAvailable(b, line.source || 'breeder', gender) : 0;
      requested += +line.quantity || 0;
      available += open;
      detail.push(`${line.batch_id || 'batch'} · ${line.source || 'allocation'} · ${open} available`);
    });
    const title = detail.join(' | ');
    if (available > 0) {
      const readyText = available >= requested ? `🔔 Ready: ${requested} head${requested === 1 ? '' : 's'}` : `🔔 Slot open: ${available}/${requested} head${requested === 1 ? '' : 's'}`;
      return `<span class="floating-slot-notice open" title="${esc(title)}">${readyText} · tap Allocate Slot</span>`;
    }
    return `<span class="floating-slot-notice pending" title="${esc(title)}">⏳ Floating waitlist: ${requested} head${requested === 1 ? '' : 's'} · not yet allocated</span>`;
  }

  const reservationRowHTML = (r, origIndex) => {
    let b = batch(r.batch_id);
    if (!b && Array.isArray(r.lines) && r.lines.length) {
      b = batch(r.lines[0].batch_id);
    }
    const ageDays = b && b.birth ? Math.max(0, days(b.birth)) : null;
    const daysTo90 = ageDays !== null ? Math.max(0, 90 - ageDays) : null;
    const isReady = ageDays !== null && ageDays >= 90;
    const isFloating = r.status === 'floating' || r.is_floating;

    let ageBadge = '';
    if (r.status !== 'released' && r.status !== 'cancelled' && ageDays !== null && !isFloating) {
      if (isReady) {
        ageBadge = `<br><span class="tag ok" style="font-size:10px">🏆 90d Ready (${ageDays}d old)</span>`;
      } else {
        ageBadge = `<br><small class="muted" style="font-size:10.5px">In ${daysTo90}d (${ageDays}/90d)</small>`;
      }
    }

    const statusTag = isFloating
      ? `<span class="tag warn" style="background:#f59e0b;color:#000;font-weight:800">⏳ FLOATING (WAITLIST)</span>`
      : `<span class="tag ${r.status === 'released' ? 'dark' : (r.status === 'partially_paid' ? 'warn' : '')}">${esc(r.status.replace('_', ' '))}</span>`;

    return `
      <tr class="reservation-row ${isFloating ? 'floating-row' : ''}" style="cursor:pointer" onclick="window.openReservationDetails(${origIndex})" title="Tap to view / print reservation certificate">
        <td><b>${esc(r.no)}</b><br><small class="muted">${fmtDate(String(r.date || '').slice(0, 10))}</small></td>
        <td><b>${esc(r.customer)}</b><br><small class="muted">${esc(r.contact || '—')}</small></td>
        <td><b>${esc(r.batch_id)}</b>${resLineExtra(r)}${ageBadge}${isFloating ? floatingMiniDetails(r) : ''}</td>
        <td><b>${r.quantity}</b> <small class="muted">${r.gender}</small></td>
        <td><b style="color:${r.balance > 0 ? 'var(--warn)' : 'var(--ok)'}">${peso(r.balance)}</b>${r.paid > 0 ? `<br><small style="color:var(--ok)">Paid: ${peso(r.paid)}</small>` : ''}</td>
        <td>${statusTag}</td>
        <td style="white-space:nowrap" onclick="event.stopPropagation()">
          <button type="button" class="btn ghost small" style="color:var(--teal2);font-weight:700" onclick="window.openReservationDetails(${origIndex})">📜 View Cert</button>
          ${isFloating ? `
            <button type="button" class="btn small" style="background:#0ea5e9;color:#fff;font-weight:750" onclick="allocateFloatingSlot(${origIndex})">⚡ Allocate Slot</button>
            <button type="button" class="btn ghost small" onclick="editReservation(${origIndex})">Edit</button>
            <button type="button" class="btn ghost small" style="color:#f59e0b" onclick="reservationAction(${origIndex},'cancelled')" title="Cancel waitlist reservation">Cancel</button>
          ` : (!['released', 'cancelled'].includes(r.status) ? `
            <button type="button" class="btn ghost small" style="color:var(--ok);font-weight:700" onclick="reservationAction(${origIndex},'released')">Release</button>
            <button type="button" class="btn ghost small" onclick="editReservation(${origIndex})">Edit</button>
            <button type="button" class="btn ghost small" style="color:#f59e0b" onclick="reservationAction(${origIndex},'cancelled')" title="Cancel reservation and return heads to available pool">Cancel</button>
          ` : `
            <button type="button" class="btn ghost small" onclick="editReservation(${origIndex})" title="Edit customer, release record or payment">${r.balance > 0 ? '💰 Pay / Edit' : 'Edit'}</button>
            ${r.status === 'cancelled' ? `<button type="button" class="btn ghost small" style="color:var(--ok);font-weight:700" onclick="reactivateReservation(${origIndex})" title="Restore this accidentally cancelled reservation">↩ Reactivate</button>` : ''}
          `)}
          <button type="button" class="btn ghost small delete-action" onclick="deleteReservation(${origIndex})" title="Permanently remove reservation record">Delete</button>
        </td>
      </tr>
    `;
  };

  function filterReservationTable(query) {
    currentReservationSearch = String(query || '');
    const table = document.getElementById('table-reservations');
    const countEl = document.getElementById('reservationRecordCount');
    const olderBox = document.getElementById('resOlderRows');
    const toggleBtn = document.getElementById('btnToggleReservationList');
    if (!table) return;

    const q = currentReservationSearch.trim().toLowerCase();
    
    if (q && olderBox) {
      olderBox.style.display = 'table-row-group';
      if (toggleBtn) toggleBtn.style.display = 'none';
    } else if (!q && olderBox) {
      olderBox.style.display = isReservationListExpanded ? 'table-row-group' : 'none';
      if (toggleBtn) {
        toggleBtn.style.display = 'flex';
        const count = olderBox.querySelectorAll('tr.reservation-row').length;
        toggleBtn.innerHTML = isReservationListExpanded ? '▲ Collapse older / completed reservations' : `▼ Show ${count} older / other reservation records…`;
      }
    }

    const rows = table.querySelectorAll('tr.reservation-row');
    let visibleCount = 0;

    rows.forEach(r => {
      const text = r.textContent.toLowerCase();
      const match = !q || text.includes(q);
      r.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });

    const emptyRow = table.querySelector ? table.querySelector('.search-empty-row') : null;
    if (visibleCount === 0 && rows.length > 0) {
      if (!emptyRow && table.querySelector) {
        const tb = table.querySelector('tbody') || table;
        tb.insertAdjacentHTML('beforeend', `<tr class="search-empty-row"><td colspan="7" class="empty">No reservations match “${esc(currentReservationSearch.trim())}”.</td></tr>`);
      }
    } else if (emptyRow) {
      emptyRow.remove();
    }

    if (countEl) {
      const total = rows.length;
      countEl.textContent = q ? `${visibleCount} of ${total} Matching` : `${total} Reservations`;
    }
  }
  window.filterReservationTable = filterReservationTable;

  function page() {
    let rs = F().reservations || [];
    isReservationListExpanded = false;

    const indexed = rs.map((r, origIndex) => {
      let b = batch(r.batch_id);
      if (!b && Array.isArray(r.lines) && r.lines.length) {
        b = batch(r.lines[0].batch_id);
      }
      const ageDays = b && b.birth ? Math.max(0, days(b.birth)) : 0;
      const daysTo90 = Math.max(0, 90 - ageDays);
      let priority = 0;

      if (r.status === 'floating' || r.is_floating) {
        priority = 500; // Floating waitlist shown right below ready-to-release
      } else if (r.status === 'released') {
        priority = 9000;
      } else if (r.status === 'cancelled') {
        priority = 9999;
      } else {
        priority = daysTo90; // Lowest days remaining to 90d (oldest piglets) comes first
      }

      return { r, origIndex, priority, ageDays, daysTo90 };
    }).sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return String(b.r.date || '').localeCompare(String(a.r.date || ''));
    });

    const recent = indexed.slice(0, 5);
    const older = indexed.slice(5);

    document.getElementById('reservations').innerHTML = `
      <div class="section-head">
        <div>
          <div class="eyebrow">PIGLET RESERVATIONS &amp; PRIORITY WAITLIST</div>
          <h2>Reservations</h2>
          <p>${rs.length} reservation records on file · sorted by release urgency &amp; priority waitlist</p>
        </div>
        <button class="btn" onclick="openReservationForm()">+ New Reservation</button>
      </div>
      <div class="toolbar" style="margin-bottom:14px">
        <div class="toolbar-left" style="flex:1">
          <input type="search" id="reservationSearchInput" class="search" style="width:100%;max-width:420px" placeholder="🔍 Search customer name, contact #, or batch details..." value="${esc(currentReservationSearch)}" oninput="window.filterReservationTable(this.value)">
        </div>
        <div class="tag" id="reservationRecordCount">${rs.length} Reservations</div>
      </div>
      <div class="panel table-wrap">
        <table class="table" id="table-reservations">
          <thead>
            <tr>
              <th>Reservation</th>
              <th>Customer</th>
              <th>Batch</th>
              <th>Qty</th>
              <th>Balance</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody class="res-recent-rows">
            ${recent.map(item => reservationRowHTML(item.r, item.origIndex)).join('') || '<tr><td colspan="7" class="empty">No reservations yet. Tap “+ New Reservation” to create one.</td></tr>'}
          </tbody>
          ${older.length ? `
            <tbody id="resOlderRows" style="display:none">
              ${older.map(item => reservationRowHTML(item.r, item.origIndex)).join('')}
            </tbody>
          ` : ''}
        </table>
        ${older.length ? `
          <button type="button" class="btn ghost" id="btnToggleReservationList" onclick="window.toggleReservationListCollapse()" style="width:100%;margin:12px 0 6px 0;padding:12px 14px;font-weight:750;background:rgba(13,141,145,0.09);color:var(--teal2);border:1.5px dashed var(--teal);border-radius:10px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer">
            ▼ Show ${older.length} older / other reservation records…
          </button>
        ` : ''}
      </div>
    `;
    if (currentReservationSearch) {
      filterReservationTable(currentReservationSearch);
    }
  }

  function openReservationForm(selectedBatchId = null) {
    let batches = (F().piglets || []).filter(b => !b.archived);
    window._resLines = [];
    window._resNotchSel = {};
    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg" id="reservationModal">
        <form class="reminder-modal" onsubmit="saveReservation(event)">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:var(--teal2);font-weight:700">PIGLET RESERVATION &amp; PREPAYMENT</div>
              <h2>New Reservation</h2>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('reservationModal').remove()">×</button>
          </div>
          <div class="reminder-fields">
            <div class="field"><label>Customer Name *</label><input name="customer" required placeholder="e.g. Jinky Sinfuego Badiola"></div>
            <div class="field"><label>Contact Number</label><input name="contact" placeholder="e.g. 09947026724"></div>
            <div class="field full">
              <div class="res-lines-box">
                <div>
                  <div class="res-lines-head">🐖 Piglets in this reservation</div>
                  <p class="res-lines-sub">Buying from several batches or breeds? Add each one below — all lines go into <b>one</b> reservation.</p>
                </div>
                <div class="field full reservation-combobox">
                  <label>Piglet Batch *</label>
                  <input id="reservationBatchSearch" autocomplete="off" placeholder="Search batch, sow, sire, breed..." onfocus="filterReservationBatches(this.value)" oninput="filterReservationBatches(this.value)">
                  <input type="hidden" name="batch_id" id="reservationBatchId" value="${selectedBatchId||''}">
                  <div id="reservationSuggestions" class="semen-suggestions">
                    ${batches.map(b=>{let a=available(b);return `<button type="button" data-search="${(b.id+' '+(b.dam_name||b.sow||'')+' '+(b.sire_name||b.sire||'')+' '+(b.breed||'')).toLowerCase()}" onclick="selectReservationBatch('${b.id}')"><span><b>${b.id}</b><br><small>Sow: ${b.dam_name||b.sow||'—'} · Breed: ${b.breed||'—'}</small></span><span>M:${a.m} F:${a.f}</span></button>`}).join('')}
                  </div>
                  <div id="reservationBatchSummary"></div>
                </div>

                <!-- Floating / Waitlist Priority Alert Banner -->
                <div id="floatingPromptBox" style="display:none;background:rgba(245,158,11,0.12);border:1.5px solid #f59e0b;border-radius:12px;padding:12px;margin:10px 0">
                  <div style="display:flex;align-items:flex-start;gap:8px">
                    <span style="font-size:18px">⏳</span>
                    <div>
                      <b style="color:#f59e0b;font-size:13px">Floating / Priority Waitlist Mode Active</b>
                      <p style="margin:4px 0 0 0;font-size:12px" class="muted">
                        Slots in this category are currently full. This customer will be queued as <b>Priority Waitlist</b> with their prepayment credited immediately. When a slot opens or another reservation is cancelled, you can allocate the slot with 1 click!
                      </p>
                    </div>
                  </div>
                </div>

                <div class="res-line-inputs">
                  <div class="field"><label>Reserve From *</label><select name="source" onchange="updateReservationAvailability()"><option value="breeder">Breeder</option><option value="fattener">Fattener</option><option value="farm_use">Farm Use</option></select></div>
                  <div class="field"><label>Gender</label><select name="gender" onchange="updateReservationAvailability()"><option value="male">Male</option><option value="female">Female</option></select></div>
                  <div class="field"><label>Quantity</label><input name="quantity" type="number" min="1" value="1" oninput="window.updateResPriceFeedback && window.updateResPriceFeedback()"></div>
                  <div class="field"><label>Price per Piglet (₱)</label><input name="price" id="resPriceInput" type="number" min="0" placeholder="e.g. 4500" oninput="window.updateResPriceFeedback && window.updateResPriceFeedback()"></div>
                </div>

                <!-- [REBUILD FIX 76] live batch cost analysis + profit protection -->
                <div id="batchCostPanel"></div>
                <div id="priceFeedbackBox"></div>

                <!-- Floating Checkbox Toggle -->
                <label class="res-check" style="margin-top:8px;display:flex;align-items:center;gap:8px;font-size:12.5px;color:#f59e0b;cursor:pointer">
                  <input type="checkbox" name="is_floating" id="floatingResChk" onchange="window.toggleFloatingMode && window.toggleFloatingMode(this.checked)">
                  <span>⏳ Accept as <b>Floating Priority Waitlist</b> (Record prepayment without deducting herd headcount)</span>
                </label>

                <button type="button" class="btn ghost res-line-add" style="margin-top:10px" onclick="addReservationLine()">＋ Add to reservation</button>
                <div id="resLinesList" class="res-line-list"></div>
                <div id="resLinesTotal" class="res-lines-total"></div>
              </div>
            </div>

            <div class="field"><label>Paid Prepayment / Downpayment (₱)</label><input name="paid" type="number" min="0" value="0" placeholder="e.g. 2000"></div>
            <div class="field full"><label>Remarks / Notes</label><textarea name="notes" placeholder="Special customer instructions, delivery location, preferred traits..."></textarea></div>

            <div class="field full">
              <div class="res-cert-section">
                <div class="res-cert-head">📄 Certificate details (optional)</div>
                <label class="res-check"><input type="checkbox" id="resNotchChk" onchange="resNotchToggle()"> Include the specific <b>ear notch</b> of the reserved piglet(s)</label>
                <div id="resNotchBox" class="res-notch-box" style="display:none">
                  <div id="resNotchPick" class="res-notch-pick"></div>
                  <div class="res-notch-manual">
                    <span>Not in the registry yet? Add the notch manually:</span>
                    <div id="resNotchManualRows"></div>
                    <button type="button" class="btn ghost" onclick="resNotchAddManual()">＋ Add notch row</button>
                  </div>
                </div>
                <label class="res-check"><input type="checkbox" id="resTreatChk"> Include <b>medication / treatment history</b> on the certificate</label>
                <p class="res-vax-note">💉 Batch vaccinations recorded in the Vaccination Center are fetched automatically.</p>
              </div>
            </div>
          </div>
          <div class="form-error" id="reservationError"></div>
          <div class="actions">
            <button type="button" class="btn ghost" onclick="document.getElementById('reservationModal').remove()">Cancel</button>
            <button type="button" class="btn" onclick="saveReservation(event)">Save Reservation</button>
          </div>
        </form>
      </div>
    `);
    renderResLines();
    if (selectedBatchId) updateReservationAvailability();
  }

  function toggleFloatingMode(checked) {
    const pBox = document.getElementById('floatingPromptBox');
    if (pBox) pBox.style.display = checked ? 'block' : 'none';
  }
  window.toggleFloatingMode = toggleFloatingMode;

  function batchSuggestionHTML(b) {
    let a = available(b);
    return `<button type="button" onclick="selectReservationBatch('${b.id}')"><span><b>${b.id}</b><br><small>Sow: ${b.dam_name||b.sow||'—'} · Breed: ${b.breed||'—'}</small></span><span>Male: ${a.m}<br>Female: ${a.f}</span></button>`;
  }

  /* [REBUILD FIX 73] UPCOMING FARROWING BATCHES — virtual reservation targets
     built from pregnant sows (inseminated, not yet farrowed) so customers can
     reserve a litter that is not born yet. Always saved as Floating Waitlist;
     once the sow farrows and the real batch exists, re-assign via Edit. */
  function upcomingBatches() {
    return (F().sows || []).filter(s => {
      const active = typeof isActiveSow === 'function' ? isActiveSow(s) : !(s.culled || s.culledAt || String(s.status || '').toUpperCase() === 'CULLED');
      return active && s.insemination && !s.farrowingDate && !s.lactationStart;
    }).map(s => {
      const d = new Date(String(s.insemination).slice(0, 10) + 'T00:00:00');
      d.setDate(d.getDate() + 114);
      return { id: 'UPC-' + (s.name || s.id), legacyId: 'UPC-' + (s.id || s.name), upc: true, dam_name: s.name, sow: s.name, sire_name: s.sire || s.sire_name || '', breed: s.breed || s.customBreed || '', due: d.toISOString().slice(0, 10) };
    }).sort((a, b) => a.due.localeCompare(b.due));
  }
  /* [FIX 75] id is now UPC-<Sow Name>; legacyId keeps old UPC-<sow id> records
     (already-saved reservations) fully editable/allocatable. */
  const upcomingById = id => upcomingBatches().find(u => u.id === id || u.legacyId === id) || null;
  const batchOrUpcoming = id => batch(id) || upcomingById(id);

  function upcomingSuggestionHTML(u) {
    return `<button type="button" onclick="selectReservationBatch('${u.id}')" style="border:1.5px dashed #f59e0b"><span><b>⏳ ${esc(u.dam_name)}</b><br><small>Upcoming litter · due ~${fmtDate(u.due)} · ${esc(u.breed || '—')}</small></span><span style="color:#f59e0b;font-weight:800">Floating<br>waitlist</span></button>`;
  }

  function filterReservationBatches(q) {
    let box = document.getElementById('reservationSuggestions');
    if (!box) return;
    let term = String(q || '').trim().toLowerCase(),
      matches = (F().piglets || []).filter(b => {
        if (b.archived) return false;
        let text = `${b.id} ${b.batch_name||''} ${b.dam_name||b.sow||''} ${b.sire_name||b.sire||''} ${b.breed||''}`.toLowerCase();
        return !term || text.includes(term);
      }).sort((a, b) => {
        let aa = `${a.id} ${a.dam_name||a.sow||''}`.toLowerCase(),
          bb = `${b.id} ${b.dam_name||b.sow||''}`.toLowerCase();
        return aa.startsWith(term) === bb.startsWith(term) ? aa.localeCompare(bb) : aa.startsWith(term) ? -1 : 1;
      });
    /* [FIX 73] also offer upcoming farrowing litters (pregnant sows) */
    const ups = upcomingBatches().filter(u => {
      const text = `${u.id} ${u.dam_name} ${u.breed} upcoming litter due`.toLowerCase();
      return !term || text.includes(term);
    });
    const upHead = ups.length ? '<div style="padding:8px 10px 2px;font-size:10.5px;color:#f59e0b;font-weight:800;letter-spacing:.06em">⏳ UPCOMING FARROWING LITTERS — reserve as Floating Waitlist</div>' : '';
    const html = matches.map(batchSuggestionHTML).join('') + upHead + ups.map(upcomingSuggestionHTML).join('');
    box.innerHTML = html || '<div class="suggestion-empty">No matching piglet batches found.</div>';
    box.classList.add('open');
    box.style.display = 'block';
  }

  function selectReservationBatch(id) {
    let b = batchOrUpcoming(id),
      input = document.getElementById('reservationBatchSearch');
    if (!b) return;
    input.value = b.upc ? `⏳ ${b.dam_name||b.sow||''} · upcoming litter` : `${b.id} · ${b.dam_name||b.sow||''}`;
    document.getElementById('reservationBatchId').value = id;
    if (b.upc) {
      /* upcoming litters have no headcount yet → must queue as floating */
      const chk = document.getElementById('floatingResChk');
      if (chk && !chk.checked) { chk.checked = true; window.toggleFloatingMode && window.toggleFloatingMode(true); }
    }
    let list = document.getElementById('reservationSuggestions');
    list.classList.remove('open');
    list.style.display = 'none';
    updateReservationAvailability();
    renderResNotchPicker();
    /* [FIX 76] show the batch cost analysis + refresh price feedback */
    if (window.ARSBatchCost) window.ARSBatchCost.renderInto('batchCostPanel', id);
    window.updateResPriceFeedback && window.updateResPriceFeedback();
  }

  const resLines = () => window._resLines || (window._resLines = []);
  const stagedFor = (batchId, source, gender) =>
    resLines().filter(L => L.batch_id === batchId && L.source === source && L.gender === gender)
      .reduce((a, L) => a + L.quantity, 0);

  function addReservationLine() {
    let err = document.getElementById('reservationError');
    if (err) err.classList.remove('show');
    const fail = m => {
      if (err) { err.textContent = m; err.classList.add('show'); } else toast(m);
      return false;
    };
    let id = document.getElementById('reservationBatchId')?.value,
      b = batchOrUpcoming(id),
      source = document.querySelector('#reservationModal [name="source"]')?.value || 'breeder',
      gender = document.querySelector('#reservationModal [name="gender"]')?.value || 'male',
      q = +document.querySelector('#reservationModal [name="quantity"]')?.value,
      priceRaw = document.querySelector('#reservationModal [name="price"]')?.value,
      price = priceRaw === '' ? NaN : +priceRaw,
      isFloating = document.getElementById('floatingResChk')?.checked;

    if (!b) return fail('Search and pick a piglet batch first.');
    if (!q || q < 1) return fail('Quantity must be at least 1.');
    if (isNaN(price) || price < 0) return fail('Price per piglet is required.');
    if (b.upc && !isFloating) { /* [FIX 73] upcoming litters always queue as floating */
      const fChk = document.getElementById('floatingResChk');
      if (fChk) fChk.checked = true;
      isFloating = true;
    }

    let left = b.upc ? Infinity : Math.max(0, allocationAvailable(b, source, gender) - stagedFor(id, source, gender));
    if (q > left && !isFloating) {
      const fPrompt = document.getElementById('floatingPromptBox');
      if (fPrompt) fPrompt.style.display = 'block';
      const fChk = document.getElementById('floatingResChk');
      if (fChk) fChk.checked = true;
      return fail(`Only ${left} ${gender} piglet(s) available in ${id}'s ${source.replace('_', ' ')} allocation. To accept prepayment and queue on the waitlist, check "Accept as Floating Priority Waitlist" below.`);
    }

    resLines().push({
      batch_id: id,
      breed: b.breed || '',
      dam: b.dam_name || b.sow || '',
      sire: b.sire_name || b.sire || '',
      source, gender, quantity: q, price,
      is_floating: Boolean(isFloating)
    });

    let sInput = document.getElementById('reservationBatchSearch');
    if (sInput) sInput.value = '';
    document.getElementById('reservationBatchId').value = '';
    document.querySelector('#reservationModal [name="quantity"]').value = '1';
    document.querySelector('#reservationModal [name="price"]').value = '';
    document.getElementById('reservationBatchSummary').innerHTML = `<div class="notice">✓ Added <b>${id}</b> (${isFloating ? '⏳ Floating Waitlist' : 'Confirmed'}) — pick the next batch above, or save the reservation below.</div>`;
    renderResLines();
    renderResNotchPicker();
    return true;
  }

  function removeReservationLine(k) {
    resLines().splice(k, 1);
    renderResLines();
    updateReservationAvailability();
    renderResNotchPicker();
  }

  function renderResLines() {
    let list = document.getElementById('resLinesList'),
      tot = document.getElementById('resLinesTotal');
    if (!list) return;
    let lines = resLines();
    list.innerHTML = lines.map((L, k) => `<div class="res-line-row"><span><b>${escAttr(L.batch_id)}</b> · ${escAttr(L.breed || '—')} — ${L.quantity} ${L.gender} ${L.is_floating ? '<span class="tag warn" style="font-size:10px">⏳ Waitlist</span>' : ''}<small>${L.source.replace('_', ' ')} · @ ${peso(L.price)} / head = <b>${peso(L.quantity * L.price)}</b></small></span><button type="button" class="x" onclick="removeReservationLine(${k})">×</button></div>`).join('')
      || '<p class="res-line-empty">No batches added yet — pick a batch above, set the quantity &amp; price, then tap <b>＋ Add to reservation</b>. Reserving just one batch? Simply fill the details and save straight away.</p>';
    if (tot) {
      let heads = lines.reduce((a, L) => a + L.quantity, 0),
        amt = lines.reduce((a, L) => a + L.quantity * L.price, 0),
        bs = new Set(lines.map(L => L.batch_id)).size;
      tot.innerHTML = lines.length ? `Total: <b>${heads} head${heads === 1 ? '' : 's'}</b> from <b>${bs} batch${bs === 1 ? '' : 'es'}</b> · <b>${peso(amt)}</b>` : '';
    }
  }

  function resNotchToggle() {
    let box = document.getElementById('resNotchBox');
    if (!box) return;
    box.style.display = document.getElementById('resNotchChk')?.checked ? 'grid' : 'none';
    if (box.style.display !== 'none') renderResNotchPicker();
  }

  function resNotchBatches() {
    let ids = [...new Set(resLines().map(L => L.batch_id))];
    if (!ids.length) {
      let id = document.getElementById('reservationBatchId')?.value;
      if (id) ids = [id];
    }
    return ids.map(batch).filter(Boolean);
  }

  function notchChipMarkup(b, x, i) {
    let w = [], ws = x.weights || {};
    if (ws.birth) w.push('birth ' + ws.birth + 'kg');
    if (ws.weaning) w.push('wean ' + ws.weaning + 'kg');
    if (ws.release) w.push('release ' + ws.release + 'kg');
    else if (x.weight && !w.length) w.push(x.weight + 'kg');
    return `<button type="button" class="res-notch-chip${x._sel ? ' sel' : ''}" data-batch="${escAttr(b.id)}" data-idx="${i}" onclick="this.classList.toggle('sel')"><b>${x.sex === 'F' ? '♀' : x.sex === 'M' ? '♂' : '🐖'} ${i + 1}</b><span>R ${x.renn || '—'} · L ${x.lenn || '—'}${x.sex === 'F' && (x.teats ?? '') !== '' ? ' · ' + x.teats + ' teats' : ''}${w.length ? ' · ' + w.join(' · ') : ''}</span></button>`;
  }

  function renderResNotchPicker() {
    let wrap = document.getElementById('resNotchPick');
    if (!wrap) return;
    let bs = resNotchBatches();
    wrap.innerHTML = bs.length ? bs.map(b => {
      let roster = Array.isArray(b.roster) ? b.roster : [];
      if (!roster.length) return `<div class="res-notch-group" data-batch="${escAttr(b.id)}"><h4>${escAttr(b.id)}${b.breed ? ' · ' + escAttr(b.breed) : ''}</h4><p class="res-notch-empty">No ear-notch registry on this batch yet — add rows manually below, or fill the batch's ⚖ Batch Performance Record first.</p></div>`;
      return `<div class="res-notch-group" data-batch="${escAttr(b.id)}"><h4>${escAttr(b.id)}${b.breed ? ' · ' + escAttr(b.breed) : ''}</h4><div class="res-notch-group-chips">${roster.map((x, i) => notchChipMarkup(b, x, i)).join('')}</div><p class="res-notch-hint">Tap every piglet that goes to this reservation.</p></div>`;
    }).join('') : `<p class="res-notch-empty">No ear-notch registry on this batch yet — add rows manually below, or fill the batch's ⚖ Batch Performance Record first.</p>`;
    if (window._resNotchSel) wrap.querySelectorAll('.res-notch-chip').forEach(c => {
      let set = window._resNotchSel[c.dataset.batch];
      if (set && set.has(+c.dataset.idx)) c.classList.add('sel');
    });
  }

  document.addEventListener('click', function(e) {
    let chip = e.target.closest && e.target.closest('#resNotchPick .res-notch-chip');
    if (!chip) return;
    window._resNotchSel = window._resNotchSel || {};
    let bid = chip.dataset.batch || document.getElementById('reservationBatchId')?.value || '';
    let set = window._resNotchSel[bid] || (window._resNotchSel[bid] = new Set());
    let i = +chip.dataset.idx;
    setTimeout(() => { chip.classList.contains('sel') ? set.add(i) : set.delete(i); }, 0);
  });

  function resNotchAddManual() {
    let box = document.getElementById('resNotchManualRows');
    if (!box) return;
    box.insertAdjacentHTML('beforeend', '<div class="res-manual-row"><input data-m="renn" placeholder="R — right ear (litter no.)"><input data-m="lenn" placeholder="L — left ear (pig no.)"><input data-m="teats" type="number" min="0" placeholder="Teats (♀)"><button type="button" class="x" onclick="this.parentElement.remove()">×</button></div>');
  }

  function updateReservationAvailability() {
    let id = document.getElementById('reservationBatchId')?.value,
      b = batchOrUpcoming(id),
      out = document.getElementById('reservationBatchSummary'),
      g = document.querySelector('#reservationModal [name="gender"]')?.value || 'female',
      source = document.querySelector('#reservationModal [name="source"]')?.value || 'breeder';
    if (!b || !out) return;
    if (b.upc) { /* [FIX 73] upcoming litter — no headcount yet, always floating */
      out.innerHTML = `<div class="notice" style="border:1.5px solid #f59e0b;background:rgba(245,158,11,0.10);padding:10px 12px;border-radius:10px">⏳ <b>Upcoming litter of ${esc(b.dam_name)}</b> · due ~${fmtDate(b.due)}.<br>This customer will be queued as <b>Floating Priority Waitlist</b>; re-assign to the real batch after farrowing via Edit.</div>`;
      if (window.ARSBatchCost) window.ARSBatchCost.renderInto('batchCostPanel', id);
      window.updateResPriceFeedback && window.updateResPriceFeedback();
      return;
    }
    let m = Math.max(0, allocationAvailable(b, source, 'male') - stagedFor(id, source, 'male')),
      f = Math.max(0, allocationAvailable(b, source, 'female') - stagedFor(id, source, 'female')),
      avail = g === 'female' ? f : m;

    if (avail <= 0) {
      out.innerHTML = `
        <div class="notice warn" style="border:1.5px solid #f59e0b;background:rgba(245,158,11,0.12);padding:10px 12px;border-radius:10px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b style="color:#f59e0b">⚠️ 0 Available ${g === 'female' ? 'Female' : 'Male'} in ${source.replace('_', ' ')}</b>
            <span class="tag warn" style="background:#f59e0b;color:#000;font-weight:800">SLOT FULL</span>
          </div>
          <small class="muted" style="display:block;margin-top:4px">
            All ${g === 'female' ? 'females' : 'males'} in Batch <b>${b.id}</b> are already allocated or reserved.
            You can record this customer as a <b>Floating / Waitlist Reservation</b> to log their prepayment/deposit and place them first in queue for the next available slot or cancellation!
          </small>
        </div>
      `;
      const fPrompt = document.getElementById('floatingPromptBox');
      if (fPrompt) fPrompt.style.display = 'block';
      const fChk = document.getElementById('floatingResChk');
      if (fChk) fChk.checked = true;
    } else {
      out.innerHTML = `<div class="notice">Selected: <b>${b.id}</b> · Reserve From: <b>${source.replace('_',' ')}</b><br>Available Male: ${m} · Available Female: ${f}<br><b>Available ${g==='female'?'Female':'Male'} in ${source.replace('_',' ')}: ${avail}</b></div>`;
      const fPrompt = document.getElementById('floatingPromptBox');
      if (fPrompt && !document.getElementById('floatingResChk')?.checked) fPrompt.style.display = 'none';
    }
    /* [FIX 76] batch cost analysis follows the selected batch */
    if (window.ARSBatchCost) window.ARSBatchCost.renderInto('batchCostPanel', id);
    window.updateResPriceFeedback && window.updateResPriceFeedback();
  }

  /* [FIX 76] live margin feedback under the price field */
  window.updateResPriceFeedback = function () {
    const box = document.getElementById('priceFeedbackBox');
    if (!box || !window.ARSBatchCost) return;
    const id = document.getElementById('reservationBatchId')?.value;
    const price = document.querySelector('#reservationModal [name="price"]')?.value;
    const qty = document.querySelector('#reservationModal [name="quantity"]')?.value;
    box.innerHTML = id ? window.ARSBatchCost.priceFeedback(id, price, qty) : '';
  };

  async function saveReservation(e) {
    if (e) e.preventDefault();
    let err = document.getElementById('reservationError');
    if (err) err.classList.remove('show');
    try {
      let form = document.querySelector('#reservationModal form'),
        d = Object.fromEntries(new FormData(form)),
        lines = resLines().slice(),
        isFloating = document.getElementById('floatingResChk')?.checked || Boolean(d.is_floating);

      /* quick flow: nothing staged → one line from the entry box */
      if (!lines.length && d.batch_id) {
        let bb = batchOrUpcoming(d.batch_id),
          q = +d.quantity;
        if (!bb) throw new Error('Select a valid piglet batch.');
        if (!q || q < 1) throw new Error('Quantity must be at least 1.');
        if (bb.upc && !isFloating) { /* [FIX 73] upcoming litter ⇒ floating waitlist */
          isFloating = true;
          const fChk = document.getElementById('floatingResChk');
          if (fChk) fChk.checked = true;
        }
        lines = [{
          batch_id: bb.id,
          breed: bb.breed || '',
          dam: bb.dam_name || bb.sow || '',
          sire: bb.sire_name || bb.sire || '',
          source: d.source,
          gender: d.gender,
          quantity: q,
          price: +(d.price || 0),
          is_floating: Boolean(isFloating)
        }];
      }
      if (!lines.length) throw new Error('Select a valid piglet batch.');
      if (!d.customer?.trim()) throw new Error('Customer Name is required.');

      /* [REBUILD FIX 76] PROFIT PROTECTION — warn (never block) when any line
         is priced below the batch's real production cost per head. */
      if (window.ARSBatchCost) {
        const below = lines
          .filter(L => !String(L.batch_id || '').startsWith('UPC-'))
          .map(L => ({ L, a: window.ARSBatchCost.analyze(L.batch_id) }))
          .filter(x => x.a && x.a.costPerHead > 0 && x.L.price < x.a.costPerHead);
        if (below.length) {
          const msg = below.map(x => `• ${x.L.batch_id}: production cost ${peso(x.a.costPerHead)}/head vs your price ${peso(x.L.price)}/head → loss ${peso(x.a.costPerHead - x.L.price)}/head (suggested ${peso(x.a.suggested)})`).join('\n');
          if (!confirm(`⚠ BELOW PRODUCTION COST\n\n${msg}\n\nThe reservation quantity does NOT affect this number — it is the batch's cost ÷ saleable heads.\n\nSell at this price anyway?`)) return;
        }
      }

      // If NOT floating, enforce available headcount check
      if (!isFloating) {
        let agg = {};
        lines.forEach(L => {
          let k = L.batch_id + '|' + L.source + '|' + L.gender;
          agg[k] = (agg[k] || 0) + L.quantity;
        });
        Object.keys(agg).forEach(k => {
          let [bid, source, gender] = k.split('|'),
            bb = batchOrUpcoming(bid),
            have = bb ? (bb.upc ? Infinity : allocationAvailable(bb, source, gender)) : 0,
            want = agg[k];
          if (bb && bb.upc) return; /* [FIX 73] no headcount to check for upcoming litters */
          if (want > have) {
            const fChk = document.getElementById('floatingResChk');
            if (fChk) fChk.checked = true;
            const fPrompt = document.getElementById('floatingPromptBox');
            if (fPrompt) fPrompt.style.display = 'block';
            throw new Error(`Only ${have} ${gender} piglet(s) available in ${bid}'s ${source.replace('_', ' ')} allocation. To accept prepayment and queue this customer, check "Accept as Floating Priority Waitlist" above.`);
          }
        });

        // Deduct heads in ledger only if NOT floating
        let now = new Date().toISOString();
        lines.forEach((L, k) => {
          (F().pigletLedger || (F().pigletLedger = [])).push({
            id: 'res-ledger-' + Date.now() + '-' + k,
            farm_id: farmId,
            batch_id: L.batch_id,
            type: 'reserved',
            source: L.source,
            gender: L.gender,
            quantity: L.quantity,
            created_at: now,
            notes: d.notes || ''
          });
        });
      }

      let total = lines.reduce((a, L) => a + L.quantity * L.price, 0),
        paid = +d.paid || 0,
        genders = [...new Set(lines.map(L => L.gender))],
        batchCount = new Set(lines.map(L => L.batch_id)).size,
        now = new Date().toISOString(),
        r = {
          id: 'res-' + Date.now(),
          farm_id: farmId,
          no: (isFloating ? 'FLT-' : 'RES-') + Date.now().toString().slice(-6),
          customer: d.customer.trim(),
          contact: d.contact || '',
          batch_id: lines[0].batch_id,
          gender: genders.length === 1 ? genders[0] : 'mixed',
          source: lines[0].source,
          quantity: lines.reduce((a, L) => a + L.quantity, 0),
          lines,
          total,
          paid,
          balance: Math.max(0, total - paid),
          status: isFloating ? 'floating' : (paid >= total ? 'fully_paid' : (paid ? 'partially_paid' : 'pending')),
          is_floating: Boolean(isFloating),
          date: now.slice(0, 10),
          notes: d.notes ? (isFloating ? `[FLOATING WAITLIST] ${d.notes}` : d.notes) : (isFloating ? '[FLOATING WAITLIST]' : '')
        };

      try {
        if (document.getElementById('resNotchChk')?.checked) {
          let picks = {};
          [...document.querySelectorAll('#resNotchPick .res-notch-chip.sel')].forEach(x => {
            let bid = x.dataset.batch || r.batch_id;
            (picks[bid] || (picks[bid] = [])).push(+x.dataset.idx);
          });
          Object.keys(picks).forEach(bid => {
            let bb = batch(bid),
              roster = bb && Array.isArray(bb.roster) ? bb.roster : [],
              idxs = picks[bid];
            if (!idxs.length) return;
            let snap = idxs.map(i => {
              let x = roster[i] || {};
              return { sex: x.sex || '', renn: x.renn || '', lenn: x.lenn || '', teats: x.teats ?? '' };
            });
            lines.filter(L => L.batch_id === bid).forEach(L => { L.notch_rows = idxs; L.notch_snapshot = snap; });
            if (bid === r.batch_id) { r.notch_rows = idxs; r.notch_snapshot = snap; }
          });
          let mans = [...document.querySelectorAll('#resNotchManualRows .res-manual-row')].map(row => {
            let g = k => (row.querySelector('[data-m="' + k + '"]')?.value || '').trim();
            let re = g('renn'), le = g('lenn'), te = g('teats');
            return (re || le || te) ? { sex: '', renn: re, lenn: le, teats: te, manual: true } : null;
          }).filter(Boolean);
          if (mans.length) r.notches_manual = mans;
          r.include_notches = true;
        }
        if (document.getElementById('resTreatChk')?.checked) r.include_treatments = true;
        window._resNotchSel = {};
      } catch (e2) {}

      // Record prepayment transaction into Financials
      if (paid > 0) {
        (F().transactions || (F().transactions = [])).unshift({
          id: 'tx-res-' + Date.now(),
          date: now.slice(0, 10),
          type: 'Income',
          category: isFloating ? 'Floating Reservation Deposit' : 'Piglet Reservation Prepayment',
          description: `Deposit (${isFloating ? 'Floating Waitlist' : 'Reservation'}: ${r.no}): ${r.customer} · Batch ${r.batch_id} (${r.quantity} heads)`,
          amount: paid,
          paid: paid,
          created_at: now
        });
      }

      (F().reservations || (F().reservations = [])).unshift(r);
      window._resLines = [];
      save();
      document.getElementById('reservationModal')?.remove();
      page();
      renderAll();
      const sync = window.ARSCloud?.verifyFarmSave
        ? await ARSCloud.verifyFarmSave(window.__arsActiveFarmId || farmId, `reservation ${r.no}`)
        : { success: false, reason: 'Cloud verification is unavailable.' };
      if (sync.success) {
        toast(isFloating ? `⏳ Floating priority reservation saved and cloud-verified for ${r.customer}! (Prepayment: ${peso(paid)})` : (batchCount > 1 ? `Reservation saved and cloud-verified · ${r.quantity} heads from ${batchCount} batches` : 'Reservation saved and cloud-verified'));
      } else {
        toast(`✓ Reservation saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
        window.updateSyncIndicator?.('pending', 'Reservation pending', sync.reason || 'The reservation remains safely local until verified.');
      }
    } catch (ex) {
      if (err) {
        err.textContent = ex.message || 'Unable to save reservation.';
        err.classList.add('show');
      } else toast(ex.message || 'Unable to save reservation.');
    }
  }

  async function allocateFloatingSlot(origIndex) {
    let r = F().reservations[origIndex];
    if (!r) return;
    let b = batch(r.batch_id);
    if (!b && Array.isArray(r.lines) && r.lines.length) {
      b = batch(r.lines[0].batch_id);
    }
    if (!b) {
      /* [FIX 73] waitlist tied to an upcoming litter: guide to re-assign once farrowed */
      const isUpc = String(r.batch_id || '').startsWith('UPC-') || (Array.isArray(r.lines) && r.lines.some(l => String(l.batch_id || '').startsWith('UPC-')));
      if (isUpc) {
        toast('⏳ This waitlist is tied to an upcoming litter. Once the sow farrows, use Edit → Re-assign batch, then ⚡ Allocate Slot.');
        const idx = (F().reservations || []).indexOf(r);
        if (idx >= 0) editReservation(idx);
      } else {
        toast('Piglet batch record could not be found.');
      }
      return;
    }

    const source = r.source || 'breeder';
    const gender = r.gender === 'mixed' ? 'female' : (r.gender || 'female');
    const availableHeads = allocationAvailable(b, source, gender);
    const needed = r.quantity || 1;

    if (availableHeads < needed) {
      if (availableHeads <= 0) {
        alert(`⚠️ Currently 0 ${gender} heads available in Batch ${b.id} (${source.replace('_', ' ')}).\n\nCustomer ${r.customer} will remain at the top of the priority waitlist until a slot is freed or another reservation is cancelled.`);
        return;
      }
      if (!confirm(`Batch ${b.id} has ${availableHeads} ${gender} available in ${source.replace('_', ' ')} (Reservation requested ${needed}).\n\nAllocate the ${availableHeads} available head(s) now?`)) {
        return;
      }
    }

    const allocateQty = Math.min(needed, Math.max(1, availableHeads));

    /* [FIX H4] Partial allocation: the ledger now books only the heads that were
       actually available. Before this fix r.quantity stayed at the original
       (larger) request, so the subsequent release booked MORE heads as sold than
       were ever reserved. Shrink the reservation to the allocated quantity
       (proportionally across lines) and keep the remainder noted for a new
       reservation. */
    if (allocateQty < needed) {
      const ratio = allocateQty / needed;
      if (Array.isArray(r.lines) && r.lines.length) {
        let accounted = 0;
        r.lines.forEach((L, i) => {
          if (i === r.lines.length - 1) L.quantity = Math.max(0, allocateQty - accounted);
          else { L.quantity = Math.max(0, Math.round(L.quantity * ratio)); accounted += L.quantity; }
        });
        r.lines = r.lines.filter(L => L.quantity > 0);
      }
      r.quantity = allocateQty;
      const newTotal = r.lines.reduce((a, L) => a + (L.quantity || 0) * (L.price || 0), 0);
      if (newTotal > 0) r.total = newTotal;
      r.balance = Math.max(0, (+r.total || 0) - (+r.paid || 0));
      r.notes = `[SLOT PARTIALLY ALLOCATED] ${r.notes ? r.notes + ' · ' : ''}Only ${allocateQty} of ${needed} head(s) were available; the unallocated ${needed - allocateQty} head(s) remain in the pool for re-reservation.`;
      toast(`⚠️ Only ${allocateQty} of ${needed} head(s) were available — reservation reduced to ${allocateQty}.`);
    }

    // Convert floating to active confirmed reservation
    r.is_floating = false;
    r.status = r.paid >= r.total ? 'fully_paid' : (r.paid > 0 ? 'partially_paid' : 'pending');

    // Deduct heads in pigletLedger
    (F().pigletLedger || (F().pigletLedger = [])).push({
      id: 'res-ledger-' + Date.now(),
      farm_id: farmId,
      batch_id: b.id,
      type: 'reserved',
      source: source,
      gender: gender,
      quantity: allocateQty,
      created_at: new Date().toISOString(),
      notes: `Allocated slot from floating waitlist for ${r.customer}`
    });

    save();
    page();
    renderAll();
    const sync = window.ARSCloud?.verifyFarmSave
      ? await ARSCloud.verifyFarmSave(window.__arsActiveFarmId || farmId, `floating reservation ${r.no} allocation`)
      : { success: false, reason: 'Cloud verification is unavailable.' };
    if (sync.success) toast(`🎉 Slot successfully allocated and cloud-verified to ${r.customer} in Batch ${b.id}!`);
    else {
      toast(`✓ Slot allocated locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
      window.updateSyncIndicator?.('pending', 'Reservation pending', sync.reason || 'The allocation remains safely local until verified.');
    }
  }
  window.allocateFloatingSlot = allocateFloatingSlot;

  function nextTag(offset = 0) {
    let allTags = [];
    (F().reservations || []).forEach(r => {
      if (r.tag_no) {
        String(r.tag_no).split(',').forEach(t => {
          const clean = t.trim();
          if (clean) allTags.push(clean);
        });
      }
      if (Array.isArray(r.released_piglets)) {
        r.released_piglets.forEach(p => {
          if (p && p.tag) allTags.push(String(p.tag).trim());
        });
      }
    });

    let last = allTags.at(-1);
    if (!last) return offset > 0 ? String(offset + 1) : '';
    let m = last.match(/^(.*?)(\d+)$/);
    if (m) {
      const prefix = m[1];
      const numStr = m[2];
      const nextVal = +numStr + 1 + offset;
      return prefix + String(nextVal).padStart(numStr.length, '0');
    }
    return last + (offset > 0 ? `-${offset + 1}` : '');
  }

  function getBatchVaccinationInfo(batchId) {
    const f = F();
    const b = (f.piglets || []).find(x => x.id === batchId) || {};
    const list = [];

    // 1. Auto-retrieve from Vaccination Program / Center
    if (window.vaxRecordsFor) {
      try {
        const recs = window.vaxRecordsFor('batch', b.id, b.id);
        recs.forEach(r => {
          if (r && r.vaccine) {
            list.push({
              name: r.vaccine,
              date: r.last ? String(r.last).slice(0, 10) : (r.date ? String(r.date).slice(0, 10) : '')
            });
          }
        });
      } catch (e) {}
    }

    // 2. From vaccination_events or vaccinations collection
    const allVax = [...(f.vaccinations || []), ...(f.vaccination_events || [])];
    allVax.filter(x => x && (String(x.target_id) === String(b.id) || String(x.batch_id) === String(b.id))).forEach(v => {
      const vName = v.vaccine || v.vaccine_name || v.vaccination_name || v.name || '';
      const vDate = v.date || v.given_at || v.administered_at || v.created_at || '';
      if (vName && !list.some(item => item.name.toLowerCase() === vName.toLowerCase())) {
        list.push({
          name: vName,
          date: vDate ? String(vDate).slice(0, 10) : ''
        });
      }
    });

    // 3. From batch object fields
    if (b.vaccines_given) {
      const matchDate = b.vaccines_given.match(/\d{4}-\d{2}-\d{2}/);
      const dateStr = matchDate ? matchDate[0] : (b.vaccination_date || '');
      const cleanName = b.vaccines_given.replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/[·•,]/g, ' ').trim();
      if (cleanName && !list.some(item => item.name.toLowerCase() === cleanName.toLowerCase())) {
        list.push({
          name: cleanName,
          date: dateStr || ''
        });
      }
    } else if (b.vaccination_name) {
      if (!list.some(item => item.name.toLowerCase() === b.vaccination_name.toLowerCase())) {
        list.push({
          name: b.vaccination_name,
          date: b.vaccination_date ? String(b.vaccination_date).slice(0, 10) : ''
        });
      }
    }

    let primaryName = '';
    let primaryDate = '';
    if (list.length > 0) {
      primaryName = list.map(x => x.name).join(' · ');
      primaryDate = list.find(x => x.date)?.date || new Date().toISOString().slice(0, 10);
    } else {
      primaryDate = new Date().toISOString().slice(0, 10);
    }

    return { name: primaryName, date: primaryDate, list };
  }

  function openReleaseModal(i) {
    document.querySelectorAll('#releaseModal').forEach(el => el.remove());
    const r = F().reservations[i];
    if (!r) return;
    const b = batch(r.batch_id);
    const qty = Math.max(1, +r.quantity || 1);
    const isFemaleOrMixed = ['female', 'mixed'].includes(String(r.gender || '').toLowerCase());
    const vaxInfo = getBatchVaccinationInfo(r.batch_id);

    const headsMarkup = qty === 1
      ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div class="field" style="margin:0">
            <label>Tag Number / Ear Notch</label>
            <input name="tag_no" id="relTag_0" value="${esc(nextTag(0))}" placeholder="e.g. 425">
          </div>
          <div class="field" style="margin:0">
            <label>Weight (kg) *</label>
            <input name="weight" id="relWt_0" type="number" min="0" step="0.01" placeholder="e.g. 22.5" required>
          </div>
          ${isFemaleOrMixed ? `
            <div class="field full" style="grid-column:1/-1;margin:0">
              <label>Number of Teats (♀ Female)</label>
              <input name="teat_count" type="number" min="0" placeholder="e.g. 14">
            </div>
          ` : ''}
        </div>
      `
      : `
        <div style="background:rgba(12,28,32,0.85);border:1.2px solid rgba(145,207,202,0.22);border-radius:12px;padding:14px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <b style="font-size:13px;color:#7ae0d6">🐖 Reserved Piglet Heads (${qty} Heads · ${capG(r.gender)})</b>
            <div style="display:flex;gap:6px">
              <button type="button" class="btn ghost small" style="font-size:11px;padding:4px 9px" onclick="window.autoTagAllReleaseHeads(${qty})">↻ Auto-Tag Sequence</button>
              <button type="button" class="btn ghost small" style="font-size:11px;padding:4px 9px" onclick="window.copyFirstWeightToAll(${qty})">⚖ Copy Weight to All</button>
            </div>
          </div>
          <div style="display:grid;gap:10px;max-height:280px;overflow-y:auto;padding-right:4px">
            ${Array.from({ length: qty }).map((_, k) => `
              <div style="background:rgba(18,48,54,0.55);border:1px solid rgba(145,207,202,0.15);border-radius:9px;padding:10px 12px">
                <div style="font-size:11.5px;font-weight:750;color:#fff;margin-bottom:6px;display:flex;justify-content:space-between">
                  <span>Head #${k + 1} (${capG(r.gender)})</span>
                  <small style="color:var(--muted)">Piglet ${k + 1} of ${qty}</small>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr ${isFemaleOrMixed ? '1fr' : ''};gap:8px">
                  <div class="field" style="margin:0">
                    <label style="font-size:10px;margin-bottom:2px">Tag / Ear Notch</label>
                    <input name="tag_no_${k}" id="relTag_${k}" value="${esc(nextTag(k))}" placeholder="e.g. 425" style="padding:7px 9px;font-size:12px">
                  </div>
                  <div class="field" style="margin:0">
                    <label style="font-size:10px;margin-bottom:2px">Weight (kg) *</label>
                    <input name="weight_${k}" id="relWt_${k}" type="number" min="0" step="0.01" placeholder="e.g. 22.5" required style="padding:7px 9px;font-size:12px">
                  </div>
                  ${isFemaleOrMixed ? `
                    <div class="field" style="margin:0">
                      <label style="font-size:10px;margin-bottom:2px">Teats</label>
                      <input name="teats_${k}" type="number" min="0" placeholder="e.g. 14" style="padding:7px 9px;font-size:12px">
                    </div>
                  ` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;

    const modalHtml = `
      <div class="due-modal-bg open" id="releaseModal" onclick="if(event.target===this)this.remove()" style="z-index:999999!important">
        <form class="due-modal" onsubmit="saveRelease(event,${i})" style="max-width:640px;width:96%;text-align:left">
          <div class="modal-top" style="border-bottom:1.5px solid rgba(145,207,202,0.18);padding-bottom:12px;margin-bottom:14px">
            <div>
              <div class="eyebrow" style="color:var(--teal);letter-spacing:0.12em;font-weight:800">OFFICIAL PIGLET RELEASE</div>
              <h2 style="font-size:22px;margin:2px 0 0;color:#fff">Release Reservation</h2>
              <p style="margin:2px 0 0;color:var(--muted);font-size:12px">
                <b>${esc(r.customer)}</b> · Batch <b>${esc(b ? b.id : r.batch_id)}</b> · ${qty} Head${qty > 1 ? 's' : ''} (${capG(r.gender)})
              </p>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('releaseModal').remove()" style="font-size:26px;cursor:pointer">×</button>
          </div>

          <!-- Heads Breakdown Section -->
          ${headsMarkup}

          <!-- Financial Details & Balance Settlement -->
          <div style="background:rgba(18,48,54,0.38);border:1.2px solid ${r.balance > 0 ? 'rgba(240,182,75,0.45)' : 'rgba(145,207,202,0.2)'};border-radius:10px;padding:12px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:4px">
              <label style="font-size:11px;font-weight:800;color:${r.balance > 0 ? '#ffc266' : 'var(--teal)'};margin:0">💰 FINANCIAL &amp; BALANCE SETTLEMENT</label>
              <span style="font-size:11px;font-weight:750;color:${r.balance > 0 ? '#f0b64b' : '#64e5a0'}">
                ${r.balance > 0 ? `Outstanding Balance: ₱${(+r.balance || 0).toLocaleString()}` : '✓ Fully Paid (₱0 Balance)'}
              </span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;background:rgba(10,25,30,0.6);padding:8px 10px;border-radius:8px;margin-bottom:10px">
              <div><small style="color:var(--muted);font-size:10px;display:block">TOTAL AMOUNT</small><b style="font-size:14px;color:#fff">₱${(+r.total || 0).toLocaleString()}</b></div>
              <div><small style="color:var(--muted);font-size:10px;display:block">PREVIOUSLY PAID</small><b style="font-size:14px;color:#64e5a0">₱${(+r.paid || 0).toLocaleString()}</b></div>
              <div><small style="color:var(--muted);font-size:10px;display:block">CURRENT BALANCE</small><b style="font-size:14px;color:${r.balance > 0 ? '#f0b64b' : '#64e5a0'}">₱${(+r.balance || 0).toLocaleString()}</b></div>
            </div>
            ${r.balance > 0 ? `
              <div class="field" style="margin:0">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                  <label style="font-size:11px;font-weight:750;color:#fff;margin:0">Payment Received Upon Release (₱)</label>
                  <button type="button" class="tag" style="background:#123e37;color:#64e5a0;cursor:pointer;border:1px solid #1c5e53;padding:2px 8px;font-size:10.5px" onclick="document.getElementById('relPaymentInp').value=${r.balance}">
                    ✓ Collect Full Balance (₱${(+r.balance || 0).toLocaleString()})
                  </button>
                </div>
                <input name="release_payment" id="relPaymentInp" type="number" min="0" max="${r.total}" step="1" value="${r.balance}" placeholder="Enter amount collected on release" style="font-size:14px;font-weight:750;color:#64e5a0">
                <small style="color:var(--muted);font-size:10px;display:block;margin-top:3px">If the customer paid the remaining balance upon pickup, leave as ₱${(+r.balance || 0).toLocaleString()} to mark as fully paid.</small>
              </div>
            ` : `
              <input type="hidden" name="release_payment" value="0">
              <small style="color:#64e5a0;font-size:11px;display:block">✓ This reservation has already been settled in full.</small>
            `}
          </div>

          <!-- Auto-retrieved Vaccination Section -->
          <div style="background:rgba(18,48,54,0.38);border:1.2px solid rgba(145,207,202,0.2);border-radius:10px;padding:12px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:4px">
              <label style="font-size:11px;font-weight:800;color:var(--teal);margin:0">💉 VACCINATION PROGRAM RECORD</label>
              ${vaxInfo.list.length > 0 ? `<span style="font-size:10px;color:#57d48d;font-weight:700">✓ Auto-retrieved from Vaccination Program</span>` : `<span style="font-size:10px;color:var(--muted)">No batch vaccine on file</span>`}
            </div>
            <div style="display:grid;grid-template-columns:1.35fr 1fr;gap:10px">
              <div class="field" style="margin:0">
                <label style="font-size:10.5px">Vaccination Record / Name</label>
                <input name="vaccination" id="relVaxName" value="${esc(vaxInfo.name)}" placeholder="e.g. RespiSure · Hog Cholera">
              </div>
              <div class="field" style="margin:0">
                <label style="font-size:10.5px">Vaccination Date</label>
                <input name="vaccination_date" id="relVaxDate" type="date" value="${esc(vaxInfo.date)}">
              </div>
            </div>
            ${vaxInfo.list.length > 0 ? `
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">
                <small style="color:var(--muted);font-size:10px">Recorded batch vaccines:</small>
                ${vaxInfo.list.map(v => `
                  <button type="button" class="tag" style="background:#123e37;color:#64e5a0;cursor:pointer;border:1px solid #1c5e53;padding:3px 8px;font-size:10.5px" onclick="window.pickVaxSuggestion(decodeURIComponent('${encodeURIComponent(v.name)}'),decodeURIComponent('${encodeURIComponent(v.date)}'))">
                    💉 ${esc(v.name)} ${v.date ? `(${esc(v.date)})` : ''}
                  </button>
                `).join('')}
              </div>
            ` : ''}
          </div>

          <!-- Notes -->
          <div class="field" style="margin-bottom:16px">
            <label>Release / Vaccination Notes</label>
            <textarea name="release_notes" placeholder="Optional release remarks, buyer instructions, or health observations"></textarea>
          </div>

          <!-- Actions -->
          <div class="due-actions" style="display:flex;justify-content:flex-end;gap:10px;border-top:1.5px solid rgba(145,207,202,0.18);padding-top:14px">
            <button type="button" class="btn ghost" onclick="document.getElementById('releaseModal').remove()">Cancel</button>
            <button class="btn" style="min-width:170px">Confirm Release (${qty} Head${qty > 1 ? 's' : ''})</button>
          </div>
        </form>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  async function reservationAction(i, status) {
    let r = F().reservations[i];
    if (!r || ['released', 'cancelled'].includes(r.status)) return;
    if (status === 'released') {
      openReleaseModal(i);
      return;
    }
    r.status = 'cancelled';
    r.cancelled_at = new Date().toISOString();
    // Close any active reserved allocation without deleting its history.
    if (!r.is_floating && r.status !== 'floating') {
      const cancelLines = Array.isArray(r.lines) && r.lines.length
        ? r.lines
        : [{ batch_id: r.batch_id, source: r.source || 'breeder', gender: r.gender, quantity: r.quantity }];
      cancelLines.forEach((line, k) => {
        (F().pigletLedger || (F().pigletLedger = [])).push({
          id: 'cancel-res-' + Date.now() + (k ? '-' + k : ''),
          farm_id: farmId,
          batch_id: line.batch_id,
          type: 'cancel_reservation',
          source: line.source || r.source || 'breeder',
          gender: line.gender,
          quantity: line.quantity,
          reservation_id: r.id,
          reservation_no: r.no,
          reason: 'Reservation cancelled; reserved head returned to the allocation pool.',
          created_at: r.cancelled_at
        });
      });
    }
    save();
    page();
    renderAll();
    const sync = window.ARSCloud?.verifyFarmSave
      ? await ARSCloud.verifyFarmSave(window.__arsActiveFarmId || farmId, `reservation ${r.no} cancellation`)
      : { success: false, reason: 'Cloud verification is unavailable.' };
    if (sync.success) toast('Reservation cancelled and cloud-verified');
    else {
      toast(`✓ Reservation cancellation saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
      window.updateSyncIndicator?.('pending', 'Cancellation pending', sync.reason || 'The cancellation remains safely local until verified.');
    }

    // Check for any floating waitlist reservations for this batch
    setTimeout(() => {
      const bId = r.batch_id;
      const fRes = (F().reservations || []).find(res => (res.status === 'floating' || res.is_floating) && (res.batch_id === bId || (Array.isArray(res.lines) && res.lines.some(l => l.batch_id === bId))));
      if (fRes) {
        if (confirm(`🎉 A reservation was cancelled in Batch ${bId}!\n\nCustomer "${fRes.customer}" is waiting on the Floating Priority List (Prepaid: ₱${fRes.paid}).\n\nWould you like to allocate this slot to "${fRes.customer}" now?`)) {
          const resIdx = F().reservations.indexOf(fRes);
          if (resIdx >= 0) allocateFloatingSlot(resIdx);
        }
      }
    }, 400);
  }

  async function saveRelease(e, i) {
    e.preventDefault();
    const form = e.target;
    const d = Object.fromEntries(new FormData(form));
    const r = F().reservations[i];
    if (!r) return;
    const b = batch(r.batch_id);

    const qty = Math.max(1, +r.quantity || 1);
    const releasedPiglets = [];
    const tags = [];
    const weights = [];
    const teats = [];

    if (qty === 1) {
      const tag = String(d.tag_no || '').trim();
      const wt = parseFloat(d.weight || 0) || 0;
      const tCount = d.teat_count ? parseInt(d.teat_count, 10) : null;
      if (tag) tags.push(tag);
      if (wt > 0) weights.push(wt);
      if (tCount !== null) teats.push(tCount);
      releasedPiglets.push({
        index: 1,
        tag: tag || nextTag(0),
        weight: wt,
        teats: tCount,
        gender: r.gender
      });
    } else {
      for (let k = 0; k < qty; k++) {
        const tag = String(d[`tag_no_${k}`] || '').trim();
        const wt = parseFloat(d[`weight_${k}`] || 0) || 0;
        const tCount = d[`teats_${k}`] ? parseInt(d[`teats_${k}`], 10) : null;
        if (tag) tags.push(tag);
        if (wt > 0) weights.push(wt);
        if (tCount !== null) teats.push(tCount);
        releasedPiglets.push({
          index: k + 1,
          tag: tag || nextTag(k),
          weight: wt,
          teats: tCount,
          gender: r.gender
        });
      }
    }

    const avgWeight = weights.length > 0
      ? +(weights.reduce((a, w) => a + w, 0) / weights.length).toFixed(2)
      : (parseFloat(d.weight || 0) || null);

    // Apply release payment if collected
    const releasePayment = parseFloat(d.release_payment || 0) || 0;
    if (releasePayment > 0) {
      r.paid = (+r.paid || 0) + releasePayment;
      r.balance = Math.max(0, (+r.total || 0) - r.paid);
    }

    r.status = 'released';
    r.released_at = new Date().toISOString();
    r.released_piglets = releasedPiglets;
    r.tag_no = tags.join(', ') || (d.tag_no || null);
    r.weight = avgWeight;
    r.teat_count = teats.length > 0 ? (teats.length === 1 ? teats[0] : teats.join(', ')) : (d.teat_count ? +d.teat_count : null);
    r.vaccination_name = String(d.vaccination || '').trim();
    r.vaccination_date = d.vaccination_date || '';
    r.release_notes = String(d.release_notes || '').trim();

    if (b) {
      b.release_date = r.released_at.slice(0, 10);
      if (r.weight) b.release_weight = r.weight;
    }

    // Deduct released heads from the living herd via pigletLedger
    let soldLines = Array.isArray(r.lines) && r.lines.length
      ? r.lines
      : [{ batch_id: r.batch_id, gender: r.gender, quantity: r.quantity }];
    soldLines.forEach((L, k) => {
      (F().pigletLedger || (F().pigletLedger = [])).push({
        id: 'sale-' + Date.now() + (k ? '-' + k : ''),
        farm_id: farmId,
        batch_id: L.batch_id,
        type: 'sold',
        source: L.source || r.source || 'breeder',
        gender: L.gender,
        quantity: L.quantity,
        created_at: r.released_at,
        customer: r.customer,
        reservation_id: r.id,
        reservation_no: r.no
      });
      // A release closes the active reservation allocation. Preserve the
      // original reserved event and append a balancing cancellation so the
      // batch cannot show the same heads as both Reserved and Sold/Released.
      (F().pigletLedger || (F().pigletLedger = [])).push({
        id: 'release-res-' + Date.now() + (k ? '-' + k : ''),
        farm_id: farmId,
        batch_id: L.batch_id,
        type: 'cancel_reservation',
        source: L.source || r.source || 'breeder',
        gender: L.gender,
        quantity: L.quantity,
        reservation_id: r.id,
        reservation_no: r.no,
        reason: 'Reservation released; head moved to sold/released.',
        created_at: r.released_at
      });
    });

    /* [FIX M4] The prepayment recorded when the reservation was created is
       applied to the release sale here: it is marked 'applied' (excluded from
       the statements — the release entry is the revenue) and the release
       transaction carries only the cash actually collected at release. Before
       this, deposit transaction + full release payment double-counted cash and
       the deposit stayed a permanent "held" liability. */
    const depositTxs = (F().transactions || []).filter(t => {
      if (['applied', 'voided', 'deleted', 'undone'].includes(String(t.status || '').toLowerCase())) return false;
      const txt = `${String(t.category || '')} ${String(t.description || '')}`.toLowerCase();
      const key = String(r.no || r.id || '').toLowerCase();
      return /reservation prepayment|floating reservation deposit|customer deposit/.test(txt) && key && txt.includes(key);
    });
    const deposited = depositTxs.reduce((a, t) => a + (+t.amount || 0), 0);
    depositTxs.forEach(t => {
      t.status = 'applied';
      t.applied_to = r.id || r.no;
      t.applied_at = r.released_at;
    });

    let soldBatchCount = new Set(soldLines.map(L => L.batch_id)).size;
    (F().transactions || (F().transactions = [])).push({
      date: r.released_at.slice(0, 10),
      type: 'Income',
      category: 'Piglet Sales',
      description: `Reservation ${r.no} · Released ${qty} heads · Tag(s): ${r.tag_no || '—'}${r.weight ? ` · Avg ${r.weight}kg` : ''}${soldBatchCount > 1 ? ` · ${soldBatchCount} batches` : ''}${deposited ? ` · pre-paid ${peso(deposited)} applied` : ''}`,
      amount: r.total,
      /* [REBUILD FIX 79] the applied deposit transactions are EXCLUDED from the
         statements (isAppliedDeposit), so this release row must carry the FULL
         collected amount (deposits + release payment) — otherwise that cash and
         the remaining balance vanish from cash flow and receivables. */
      paid: (+r.paid || 0)
    });

    save();
    document.getElementById('releaseModal')?.remove();
    page();
    renderAll();
    const sync = window.ARSCloud?.verifyFarmSave
      ? await ARSCloud.verifyFarmSave(window.__arsActiveFarmId || farmId, `reservation ${r.no} release`)
      : { success: false, reason: 'Cloud verification is unavailable.' };
    if (sync.success) toast(`🎉 Successfully released and cloud-verified ${qty} piglet${qty > 1 ? 's' : ''} for ${r.customer}!`);
    else {
      toast(`✓ Release saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
      window.updateSyncIndicator?.('pending', 'Release pending', sync.reason || 'The release remains safely local until verified.');
    }
  }

  window.autoTagAllReleaseHeads = function(qty) {
    for (let k = 0; k < qty; k++) {
      const inp = document.getElementById(`relTag_${k}`);
      if (inp) inp.value = nextTag(k);
    }
    toast('Generated sequential tags for all heads.');
  };

  window.copyFirstWeightToAll = function(qty) {
    const first = document.getElementById('relWt_0')?.value;
    if (!first) {
      toast('Enter weight on Head #1 first.');
      return;
    }
    for (let k = 1; k < qty; k++) {
      const inp = document.getElementById(`relWt_${k}`);
      if (inp) inp.value = first;
    }
    toast(`Copied ${first} kg to all ${qty} heads.`);
  };

  window.pickVaxSuggestion = function(name, date) {
    const nameInp = document.getElementById('relVaxName');
    const dateInp = document.getElementById('relVaxDate');
    if (nameInp) {
      if (!nameInp.value) nameInp.value = name;
      else if (!nameInp.value.includes(name)) nameInp.value += ` · ${name}`;
    }
    if (dateInp && date) dateInp.value = date;
    toast(`Selected vaccine: ${name}`);
  };

  function editReservation(i) {
    let r = F().reservations[i];
    if (!r) return;
    /* [FIX 75] per-gender quantity editing: remember which reservation is open */
    window.__arsEditResIndex = i;
    const editLines0 = Array.isArray(r.lines) && r.lines.length ? r.lines : [{ gender: r.gender || 'female', quantity: r.quantity }];
    const g0 = r.gender === 'mixed' ? (editLines0[0]?.gender || 'female') : (r.gender || 'female');
    const q0 = editLines0.filter(L => L.gender === g0).reduce((a, L) => a + (+L.quantity || 0), 0) || r.quantity;
    document.querySelectorAll('#editReservationModal').forEach(el => el.remove());
    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg open" id="editReservationModal" onclick="if(event.target===this)this.remove()" style="z-index:999999!important">
        <form class="due-modal" onsubmit="saveReservationEdit(event,${i})" style="max-width:540px;width:96%;text-align:left">
          <div class="modal-top" style="border-bottom:1.5px solid rgba(145,207,202,0.18);padding-bottom:12px;margin-bottom:14px">
            <div>
              <div class="eyebrow" style="color:var(--teal);letter-spacing:0.12em;font-weight:800">EDIT RESERVATION &amp; PAYMENT</div>
              <h2 style="font-size:22px;margin:2px 0 0;color:#fff">${esc(r.customer)}</h2>
              <p style="margin:2px 0 0;color:var(--muted);font-size:12px">Reservation #${esc(r.no)} · ${r.quantity} head${r.quantity > 1 ? 's' : ''} (${esc(r.gender)}) · Status: <span class="tag ${r.status === 'released' ? 'dark' : (r.status === 'fully_paid' ? 'ok' : 'warn')}">${esc(r.status)}</span></p>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('editReservationModal').remove()" style="font-size:26px;cursor:pointer">×</button>
          </div>

          <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div class="field" style="margin:0">
              <label>Customer Name</label>
              <input name="customer" value="${esc(r.customer)}" required>
            </div>
            <div class="field" style="margin:0">
              <label>Contact Number</label>
              <input name="contact" value="${esc(r.contact || '')}">
            </div>
          </div>

          <div style="background:rgba(18,48,54,0.38);border:1.2px solid rgba(145,207,202,0.2);border-radius:10px;padding:12px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <label style="font-size:11px;font-weight:800;color:var(--teal);margin:0">💰 PAYMENT &amp; BALANCE SETTLEMENT</label>
              <button type="button" class="tag" style="background:#123e37;color:#64e5a0;cursor:pointer;border:1px solid #1c5e53;padding:2px 8px;font-size:10.5px" onclick="document.getElementById('editPaidInp').value=document.getElementById('editTotalInp').value;window.calcEditResBalance();">
                ✓ Settle in Full (Paid = Total)
              </button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
              <div class="field" style="margin:0">
                <label style="font-size:10.5px">Total Price (₱)</label>
                <input name="total" id="editTotalInp" type="number" min="0" value="${r.total}" required oninput="window.calcEditResBalance()">
              </div>
              <div class="field" style="margin:0">
                <label style="font-size:10.5px">Paid Amount (₱)</label>
                <input name="paid" id="editPaidInp" type="number" min="0" value="${r.paid}" required oninput="window.calcEditResBalance()">
              </div>
              <div class="field" style="margin:0">
                <label style="font-size:10.5px">Remaining Balance</label>
                <div id="editResBalDisplay" style="padding:10px;border-radius:8px;background:rgba(10,25,30,0.6);border:1px solid #244047;font-size:14px;font-weight:800;color:${r.balance > 0 ? '#f0b64b' : '#64e5a0'}">
                  ₱${(+r.balance || 0).toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <!-- [REBUILD FIX 74/75] quantity adjustment PER GENDER -->
          <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">
            <div class="field" style="margin:0">
              <label>Quantity (heads)</label>
              <input name="quantity" id="editQtyInput" type="number" min="0" value="${q0}" ${['released', 'cancelled'].includes(r.status) ? 'disabled' : ''}>
            </div>
            <div class="field" style="margin:0">
              <label>Gender</label>
              <select name="qty_gender" id="editQtyGender" onchange="window.editQtyGenderChange()" ${['released', 'cancelled'].includes(r.status) ? 'disabled' : ''} style="padding:10px;border-radius:8px;border:1px solid rgba(145,207,202,0.35);background:rgba(10,25,30,0.6);color:inherit">
                <option value="female" ${g0 === 'female' ? 'selected' : ''}>Female</option>
                <option value="male" ${g0 === 'male' ? 'selected' : ''}>Male</option>
              </select>
            </div>
            <div class="field" style="margin:0">
              <label>Price / head (₱)</label>
              <input type="number" value="${(Array.isArray(r.lines) && r.lines[0] && r.lines[0].price) || (r.quantity ? Math.round(r.total / r.quantity) : 0)}" disabled>
            </div>
          </div>
          <small class="muted" style="display:block;margin:-8px 0 12px">Quantity applies to the selected gender. Increasing re-reserves heads from the batch pool (if available); decreasing returns heads to the pool; setting 0 removes that gender's line. Floating waitlist quantities adjust freely.</small>

          <!-- [FIX 76] batch cost analysis for this reservation's batch -->
          <div id="editBatchCostPanel" style="margin-bottom:14px"></div>

          <!-- [REBUILD FIX 73/74] batch re-assignment with TYPE-AHEAD search -->
          <div style="background:rgba(18,48,54,0.38);border:1.2px solid rgba(145,207,202,0.2);border-radius:10px;padding:12px;margin-bottom:14px">
            <label style="font-size:11px;font-weight:800;color:var(--teal);margin:0 0 8px;display:block">🔁 RE-ASSIGN PIGLET BATCH (optional — type to search)</label>
            <input type="hidden" name="reassign_batch" id="reassignBatchId" value="">
            <div class="reservation-combobox">
              <input id="reassignSearchInput" autocomplete="off" placeholder="Type batch ID or sow name… (leave blank to keep ${esc(r.batch_id)})" oninput="window.filterReassignSuggestions(this.value)" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(145,207,202,0.35);background:rgba(10,25,30,0.6);color:inherit">
              <div id="reassignSuggestions" class="semen-suggestions"></div>
            </div>
            <small class="muted" style="display:block;margin-top:6px">Moves every line of this reservation to the picked batch. Reserved heads are returned to the old batch pool and re-reserved from the new one; if the new batch lacks heads (or an upcoming litter is picked) the reservation becomes Floating Waitlist.</small>
          </div>

          <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div class="field" style="margin:0">
              <label>Tag Number(s)</label>
              <input name="tag_no" value="${esc(r.tag_no || '')}" placeholder="e.g. 423, 424">
            </div>
            <div class="field" style="margin:0">
              <label>Weight (kg)</label>
              <input name="weight" type="number" min="0" step="0.01" value="${r.weight || ''}" placeholder="e.g. 22.5">
            </div>
          </div>

          <div class="field" style="margin-bottom:16px">
            <label>Remarks / Notes</label>
            <textarea name="notes" placeholder="Optional customer or release notes">${esc(r.notes || '')}</textarea>
          </div>

          <div class="due-actions" style="display:flex;justify-content:flex-end;gap:10px;border-top:1.5px solid rgba(145,207,202,0.18);padding-top:14px">
            <button type="button" class="btn ghost" onclick="document.getElementById('editReservationModal').remove()">Cancel</button>
            <button class="btn" style="min-width:140px">Save Changes</button>
          </div>
        </form>
      </div>
    `);
    /* [FIX 76] fill the cost analysis panel for this reservation's batch */
    if (window.ARSBatchCost) window.ARSBatchCost.renderInto('editBatchCostPanel', r.batch_id);
  }

  window.calcEditResBalance = function() {
    const total = parseFloat(document.getElementById('editTotalInp')?.value || 0) || 0;
    const paid = parseFloat(document.getElementById('editPaidInp')?.value || 0) || 0;
    const bal = Math.max(0, total - paid);
    const disp = document.getElementById('editResBalDisplay');
    if (disp) {
      disp.textContent = `₱${bal.toLocaleString()}`;
      disp.style.color = bal > 0 ? '#f0b64b' : '#64e5a0';
    }
  };

  async function saveReservationEdit(e, i) {
    e.preventDefault();
    let d = Object.fromEntries(new FormData(e.target)),
      r = F().reservations[i];
    if (!r) return;
    r.customer = String(d.customer || '').trim();
    r.contact = String(d.contact || '').trim();
    r.total = Math.max(0, parseFloat(d.total || 0) || 0);
    r.paid = Math.max(0, parseFloat(d.paid || 0) || 0);
    r.balance = Math.max(0, r.total - r.paid);
    if (d.tag_no !== undefined) r.tag_no = String(d.tag_no || '').trim() || null;
    if (d.weight) r.weight = parseFloat(d.weight || 0) || null;
    r.notes = String(d.notes || '').trim();

    /* [REBUILD FIX 74/75] quantity add/deduct PER GENDER with ledger pool
       consistency. The target applies to the selected gender's line; confirmed
       reservations re-reserve (increase) or return (decrease) heads; 0 removes
       that gender's line; floating waitlists adjust freely. */
    const gSel = String(d.qty_gender || '').trim() || (r.gender !== 'mixed' ? (r.gender || 'female') : 'female');
    const targetQty = parseInt(d.quantity, 10);
    if (!isNaN(targetQty) && targetQty >= 0 && !['released', 'cancelled'].includes(r.status)) {
      let lines = Array.isArray(r.lines) && r.lines.length ? r.lines : null;
      if (!lines) {
        lines = [{ batch_id: r.batch_id, breed: '', dam: '', sire: '', source: r.source || 'breeder', gender: r.gender === 'mixed' ? 'female' : (r.gender || 'female'), quantity: r.quantity, price: r.quantity ? r.total / r.quantity : 0 }];
        r.lines = lines;
      }
      const line = lines.find(L => L.gender === gSel);
      const current = line ? (+line.quantity || 0) : 0;
      const target = Math.max(0, targetQty);
      if (target === 0 && lines.length === 1) {
        toast('⚠ A reservation must keep at least one line — keep quantity ≥ 1 or delete the reservation.');
      } else if (target !== current) {
        const delta = target - current;
        const ref = line || lines[0];
        const bid = ref.batch_id;
        const b0 = batch(bid);
        const isUpcLine = String(bid || '').startsWith('UPC-');
        const confirmed = !r.is_floating && r.status !== 'floating';
        const have = (confirmed && b0 && !isUpcLine) ? allocationAvailable(b0, ref.source || 'breeder', gSel) : Infinity;
        if (delta > 0 && confirmed && delta > have) {
          toast(`⚠ Only ${have} ${gSel} head(s) available in ${bid} — ${gSel} quantity stays at ${current}.`);
        } else {
          const now = new Date().toISOString();
          if (confirmed && !isUpcLine) {
            (F().pigletLedger || (F().pigletLedger = [])).push({
              id: 'qty-adj-' + Date.now(), farm_id: farmId, batch_id: bid,
              type: delta > 0 ? 'reserved' : 'cancel_reservation',
              source: ref.source || 'breeder', gender: gSel, quantity: Math.abs(delta),
              reservation_id: r.id, reservation_no: r.no, reason: 'Quantity edited', created_at: now
            });
          }
          if (target === 0 && line) lines.splice(lines.indexOf(line), 1);
          else if (line) line.quantity = target;
          else lines.push({ batch_id: bid, breed: ref.breed || '', dam: ref.dam || '', sire: ref.sire || '', source: ref.source || 'breeder', gender: gSel, quantity: target, price: ref.price || 0, is_floating: Boolean(r.is_floating) });
          r.quantity = lines.reduce((a, L) => a + (+L.quantity || 0), 0);
          const gs = [...new Set(lines.map(L => L.gender))];
          r.gender = gs.length === 1 ? gs[0] : 'mixed';
          r.total = lines.reduce((a, L) => a + (+L.quantity || 0) * (+L.price || 0), 0);
          r.balance = Math.max(0, r.total - r.paid);
        }
      }
    }

    /* [REBUILD FIX 73] batch re-assignment (e.g. floating waitlist → real batch
       after farrowing, or correcting a wrong batch). Ledger pools stay
       consistent: old reserved heads returned, new heads re-reserved. */
    const reb = String(d.reassign_batch || '').trim();
    if (reb && reb !== r.batch_id && !['released', 'cancelled'].includes(r.status)) {
      const nb = batchOrUpcoming(reb);
      if (nb) {
        const oldLines = Array.isArray(r.lines) && r.lines.length
          ? r.lines
          : [{ batch_id: r.batch_id, source: r.source || 'breeder', gender: r.gender, quantity: r.quantity }];
        const now = new Date().toISOString();
        const wasActiveConfirmed = !r.is_floating && r.status !== 'floating';
        let shortage = false;
        if (!nb.upc) shortage = oldLines.some(L => L.quantity > allocationAvailable(nb, L.source || 'breeder', L.gender));
        if (wasActiveConfirmed) {
          oldLines.forEach((L, k) => (F().pigletLedger || (F().pigletLedger = [])).push({
            id: 'reassign-out-' + Date.now() + '-' + k, farm_id: farmId, batch_id: L.batch_id,
            type: 'cancel_reservation', source: L.source || 'breeder', gender: L.gender, quantity: L.quantity,
            reservation_id: r.id, reservation_no: r.no, reason: 'Re-assigned to ' + nb.id, created_at: now
          }));
        }
        if (!nb.upc && !shortage) {
          oldLines.forEach((L, k) => (F().pigletLedger || (F().pigletLedger = [])).push({
            id: 'reassign-in-' + Date.now() + '-' + k, farm_id: farmId, batch_id: nb.id,
            type: 'reserved', source: L.source || 'breeder', gender: L.gender, quantity: L.quantity,
            reservation_id: r.id, reservation_no: r.no, created_at: now
          }));
          r.is_floating = false;
        } else {
          r.is_floating = true; /* upcoming litter or shortage → waitlist */
        }
        r.lines = oldLines.map(L => ({ ...L, batch_id: nb.id, breed: nb.breed || L.breed, dam: nb.dam_name || L.dam, sire: nb.sire_name || L.sire }));
        r.batch_id = nb.id;
        r.reassigned_at = now;
        toast(shortage ? `⚠ Not enough heads in ${nb.id} — reservation moved to Floating Waitlist.` : `🔁 Reservation re-assigned to ${nb.id}.`);
      }
    }

    if (r.status === 'released') {
      // Preserves released state
    } else if (r.status === 'cancelled') {
      // Preserves cancelled state
    } else if (r.is_floating || r.status === 'floating') {
      r.status = 'floating';
    } else {
      r.status = r.paid >= r.total ? 'fully_paid' : (r.paid > 0 ? 'partially_paid' : 'pending');
    }

    save();
    document.getElementById('editReservationModal')?.remove();
    page();
    renderAll();
    const sync = window.ARSCloud?.verifyFarmSave
      ? await ARSCloud.verifyFarmSave(window.__arsActiveFarmId || farmId, `reservation ${r.no || r.id} edit`)
      : { success: false, reason: 'Cloud verification is unavailable.' };
    if (sync.success) toast(`✓ Reservation for ${r.customer} updated and cloud-verified!`);
    else {
      toast(`✓ Reservation edit saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
      window.updateSyncIndicator?.('pending', 'Reservation pending', sync.reason || 'The edit remains safely local until verified.');
    }
  }

  /* [REBUILD FIX 74] type-ahead batch picker inside the Edit modal */
  function reassignLabel(id) {
    const b = batch(id);
    if (b) return `${b.id} · Sow ${b.dam_name || b.sow || '—'}`;
    const u = upcomingById(id);
    if (u) return `⏳ ${u.dam_name} · due ~${fmtDate(u.due)} (upcoming litter)`;
    return id;
  }

  function filterReassignSuggestions(q) {
    const box = document.getElementById('reassignSuggestions');
    if (!box) return;
    const term = String(q || '').trim().toLowerCase();
    const cands = (F().piglets || []).filter(b => !b.archived)
      .map(b => ({ id: b.id, label: `${b.id} · Sow ${b.dam_name || b.sow || '—'}`, hay: `${b.id} ${b.batch_name || ''} ${b.dam_name || b.sow || ''} ${b.breed || ''}` }))
      .concat(upcomingBatches().map(u => ({ id: u.id, label: `⏳ ${u.dam_name} · due ~${fmtDate(u.due)} (upcoming litter)`, hay: `${u.id} ${u.dam_name} upcoming litter due ${u.breed || ''}` })))
      .filter(c => !term || c.hay.toLowerCase().includes(term))
      .slice(0, 12);
    box.innerHTML = cands.map(c => `<button type="button" onclick="window.pickReassignBatch('${String(c.id).replace(/'/g, "\\'")}')"><span><b>${esc(c.label)}</b></span></button>`).join('') || '<div class="suggestion-empty">No matching batch.</div>';
    box.classList.add('open');
  }

  function pickReassignBatch(id) {
    const hid = document.getElementById('reassignBatchId');
    const inp = document.getElementById('reassignSearchInput');
    if (hid) hid.value = id;
    if (inp) inp.value = reassignLabel(id);
    const box = document.getElementById('reassignSuggestions');
    if (box) box.classList.remove('open');
  }
  window.filterReassignSuggestions = filterReassignSuggestions;
  window.pickReassignBatch = pickReassignBatch;

  /* [FIX 75] switching the gender select shows that gender's current quantity */
  window.editQtyGenderChange = function () {
    const i = window.__arsEditResIndex;
    const r = (i !== null && i !== undefined) ? (F().reservations || [])[i] : null;
    const inp = document.getElementById('editQtyInput');
    if (!r || !inp) return;
    const g = document.getElementById('editQtyGender')?.value || 'female';
    const lines = Array.isArray(r.lines) ? r.lines : [];
    const q = lines.filter(L => L.gender === g).reduce((a, L) => a + (+L.quantity || 0), 0);
    inp.value = q || (String(r.gender) === g ? (+r.quantity || 0) : 0) || '';
  };

  /* [REBUILD FIX 74] restore an accidentally cancelled reservation */
  async function reactivateReservation(i) {
    const r = F().reservations[i];
    if (!r || r.status !== 'cancelled') return;
    if (!confirm(`↩ Reactivate reservation ${r.no || r.id} for ${r.customer}?`)) return;
    const lines = Array.isArray(r.lines) && r.lines.length
      ? r.lines
      : [{ batch_id: r.batch_id, source: r.source || 'breeder', gender: r.gender, quantity: r.quantity }];
    const now = new Date().toISOString();
    delete r.cancelled_at;
    const isUpc = lines.every(L => String(L.batch_id || '').startsWith('UPC-'));
    if (r.is_floating || isUpc) {
      r.is_floating = true;
      r.status = 'floating';
    } else {
      const short = lines.some(L => {
        const b = batch(L.batch_id);
        return !b || L.quantity > allocationAvailable(b, L.source || 'breeder', L.gender);
      });
      if (short) {
        if (!confirm('⚠ Not enough heads available in the original batch(es) right now.\nReactivate as Floating Priority Waitlist instead?')) return;
        r.is_floating = true;
        r.status = 'floating';
      } else {
        lines.forEach((L, k) => (F().pigletLedger || (F().pigletLedger = [])).push({
          id: 'reactivate-' + Date.now() + '-' + k, farm_id: farmId, batch_id: L.batch_id,
          type: 'reserved', source: L.source || 'breeder', gender: L.gender, quantity: L.quantity,
          reservation_id: r.id, reservation_no: r.no, reason: 'Reservation reactivated', created_at: now
        }));
        r.is_floating = false;
        r.status = r.paid >= r.total ? 'fully_paid' : (r.paid > 0 ? 'partially_paid' : 'pending');
      }
    }
    save();
    page();
    renderAll();
    const sync = window.ARSCloud?.verifyFarmSave
      ? await ARSCloud.verifyFarmSave(window.__arsActiveFarmId || farmId, `reservation ${r.no || r.id} reactivation`)
      : { success: false, reason: 'Cloud verification is unavailable.' };
    if (sync.success) toast(`↩ Reservation ${r.no} reactivated and cloud-verified!`);
    else {
      toast(`↩ Reservation ${r.no} reactivated locally; cloud verification pending.`);
      window.updateSyncIndicator?.('pending', 'Reactivation pending', sync.reason || '');
    }
  }
  window.reactivateReservation = reactivateReservation;

  function deleteReservation(i) {
    let r = F().reservations[i];
    if (!r) return;
    if (!confirm(`Permanently delete reservation ${r.no || r.id}? This cannot be undone.`)) return;

    const rNo = String(r.no || '').trim();
    const rId = String(r.id || '').trim();
    /* [REBUILD FIX 73] was referenced below but never defined — the resulting
       ReferenceError killed the whole delete flow ("not pushing through"). */
    const rCust = String(r.customer || '').trim();
    /* [FIX M9] Reservation tombstones must NOT land in the shared deleted_ids
       list: semen-reseller cleanup filters THAT list by name, so a customer's
       name could hide a same-named reseller from the hub. Keep reservations in
       their own list (legacy farms may still have old names in deleted_ids;
       the reseller filter now also skips reservation-looking entries). */
    F().deleted_reservation_ids = F().deleted_reservation_ids || [];
    if (rNo && !F().deleted_reservation_ids.includes(rNo)) F().deleted_reservation_ids.push(rNo);
    if (rId && !F().deleted_reservation_ids.includes(rId)) F().deleted_reservation_ids.push(rId);
    if (rNo && Array.isArray(F().deleted_ids) && !F().deleted_ids.includes(rNo)) F().deleted_ids.push(rNo);
    if (rId && Array.isArray(F().deleted_ids) && !F().deleted_ids.includes(rId)) F().deleted_ids.push(rId);

    // 2. Clean from piglet ledger
    if (Array.isArray(F().pigletLedger)) {
      F().pigletLedger = F().pigletLedger.filter(t => {
        if (!t) return false;
        if (rNo && (t.reservation_no === rNo || t.no === rNo)) return false;
        if (rId && t.reservation_id === rId) return false;
        if (rCust && t.customer === rCust && t.type === 'reserved') return false;
        return true;
      });
    }

    // 3. Remove from all local DB buckets
    if (window.DB) {
      Object.keys(DB).forEach(fKey => {
        if (DB[fKey] && Array.isArray(DB[fKey].reservations)) {
          DB[fKey].reservations = DB[fKey].reservations.filter(x => {
            if (!x) return false;
            if (rNo && (x.no === rNo || x.id === rNo)) return false;
            if (rId && (x.id === rId || x.no === rId)) return false;
            if (rCust && x.customer === rCust && x.date === r.date) return false;
            return true;
          });
        }
      });
    }

    // 4. Cancel allocation if not released
    if (!['released', 'cancelled', 'floating'].includes(r.status) && !r.is_floating) {
      let cancelLines = Array.isArray(r.lines) && r.lines.length
        ? r.lines
        : [{ batch_id: r.batch_id, source: r.source, gender: r.gender, quantity: r.quantity }];
      cancelLines.forEach((L, k) => {
        (F().pigletLedger || (F().pigletLedger = [])).push({
          id: 'cancel-' + Date.now() + (k ? '-' + k : ''),
          farm_id: farmId,
          batch_id: L.batch_id,
          type: 'cancel_reservation',
          source: L.source,
          gender: L.gender,
          quantity: L.quantity,
          created_at: new Date().toISOString()
        });
      });
    }

    save();

    // 5. Send delete requests to Supabase
    if (window.ARSCloud && typeof ARSCloud.deleteAppRecord === 'function' && farmId) {
      if (rNo) ARSCloud.deleteAppRecord(farmId, 'reservation', rNo).catch(() => {});
      if (rId && rId !== rNo) ARSCloud.deleteAppRecord(farmId, 'reservation', rId).catch(() => {});
    }

    page();
    renderAll();
    toast(`✓ Reservation ${rNo || rId} permanently deleted.`);
  }

  window.openReleaseModal = openReleaseModal;
  window.saveRelease = saveRelease;
  window.editReservation = editReservation;
  window.saveReservationEdit = saveReservationEdit;
  window.deleteReservation = deleteReservation;
  window.filterReservationBatches = filterReservationBatches;
  window.selectReservationBatch = selectReservationBatch;
  window.updateReservationAvailability = updateReservationAvailability;
  window.openReservationForm = openReservationForm;
  window.saveReservation = saveReservation;
  window.resNotchToggle = resNotchToggle;
  window.renderResNotchPicker = renderResNotchPicker;
  window.resNotchAddManual = resNotchAddManual;
  window.reservationAction = reservationAction;
  window.addReservationLine = addReservationLine;
  window.removeReservationLine = removeReservationLine;
  window.renderResLines = renderResLines;
  window.reservationsPage = page;

  const old = window.renderAll;
  window.renderAll = function() {
    (typeof old === 'function' && old());
    page();
  };
})();
