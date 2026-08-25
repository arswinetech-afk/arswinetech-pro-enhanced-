/* ═══ [REBUILD FIX 42] Semen POS sale — tap any semen record to sell it ═══
   The semen drill-down rows are now clickable and open a POS-style sale modal:
   • Customer name with auto-suggest across past buyers (semen sales + piglet
     reservations), with address + contact auto-filled on pick.
   • Semen breed + lineage (dam & sire) pulled from the boar registry.
   • Qty bottles × price/bottle → total; cash paid → balance. Bottle stock is
     deducted from the semen record on save.
   • Mode: Pick up or Shipment (shipment adds an optional charge line).
   • Catheter type: Sow or Gilt.  Status: Pending / Completed.
   • Every sale is mirrored to the POS Sales list AND Financial Management
     (Income) so the money shows up everywhere the farm tracks pesos.
   • Return / replacement log with automatic time stamps; a RETURN restores
     bottles to stock and adjusts the sale + both mirror entries.
   • 58 mm receipt that prints to a portable Bluetooth POS printer via the
     phone's print dialog (pair it once — e.g. RawBT / ESC&POS printer app). */
(function () {
  /* ── helpers ─────────────────────────────────────────────────────────── */
  const escH = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const num = v => { let n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : null; };

  async function verifySemenCloudSave(label) {
    if (window.ARSCloud?.verifyFarmSave) {
      return ARSCloud.verifyFarmSave(window.__arsActiveFarmId || farmId, label);
    }
    return { success: false, reason: 'Cloud verification is unavailable.', pending: true };
  }

  function preserveSemenRecovery(reason) {
    if (window.ARSCloud?.saveLocalRecovery) {
      try { ARSCloud.saveLocalRecovery(window.__arsActiveFarmId || farmId, F(), reason); } catch (_) {}
    }
  }

  function semenRec(i) { return (F().semen || [])[i]; }

  function boarLineage(x) {
    const boars = F().boars || [],
      hit = boars.find(b => b.id && (b.id === x.boar_id || b.id === x.boarId)) ||
            boars.find(b => b.name && (b.name === x.boar || b.name === x.boar_name)) || {};
    return { sire: x.sire || hit.sire || hit.sireRef || 'N/A', dam: x.dam || hit.dam || hit.damRef || 'N/A' };
  }

  function customerDirectory() {
    const dir = new Map();
    (F().reservations || []).forEach(r => {
      if (r.customer) dir.set(String(r.customer).trim(), { contact: r.contact || '', address: '' });
    });
    (F().semenSales || []).forEach(s => {
      if (s.customer) dir.set(String(s.customer).trim(), { contact: s.contact || dir.get(String(s.customer).trim())?.contact || '', address: s.address || '' });
    });
    return [...dir.entries()].map(([name, v]) => ({ name, contact: v.contact, address: v.address }));
  }

  let curCust = [];

  /* ── sale modal ──────────────────────────────────────────────────────── */
  let activeSaleLines = [];

  function getAvailableSemenLots() {
    return (F().semen || []).map((s, idx) => ({
      idx,
      id: s.id || '',
      boar_name: s.boar_name || s.boar || 'Semen',
      breed: s.breed || 'Breed —',
      semen_batch_no: s.semen_batch_no || s.id || 'Batch',
      collection_date: s.collection_date || s.collection || '',
      avail: s.available_bottles ?? s.bottles ?? 0,
      price: s.price || 350,
      sire: s.sire || (s.lineage ? s.lineage.sire : ''),
      dam: s.dam || (s.lineage ? s.lineage.dam : '')
    }));
  }

  let curSemenLotHits = {};

  function filterSemenLotSuggest(lineIndex, q) {
    const box = document.getElementById(`semenLotSug_${lineIndex}`);
    if (!box) return;
    const term = String(q || '').trim().toLowerCase();
    const lots = getAvailableSemenLots();

    let hits = lots.filter(L => {
      if (!term) return true;
      const haystack = (L.boar_name + ' ' + L.breed + ' ' + L.semen_batch_no + ' ' + L.sire + ' ' + L.dam).toLowerCase();
      return haystack.includes(term);
    });

    // Sort so lots with stock on hand are at the top
    hits.sort((a, b) => (b.avail > 0 ? 1 : 0) - (a.avail > 0 ? 1 : 0) || b.avail - a.avail);

    curSemenLotHits[lineIndex] = hits;

    if (!hits.length) {
      box.innerHTML = `<div class="suggestion-empty">No matching semen lots found for “${escH(term)}”.</div>`;
    } else {
      box.innerHTML = hits.slice(0, 10).map(L => {
        const inStock = L.avail > 0;
        const stockPill = inStock
          ? `<span class="tag" style="background:#059669;color:#fff;font-weight:700;padding:2px 8px;border-radius:6px;font-size:11px">${L.avail} on hand</span>`
          : `<span class="tag" style="background:rgba(255,255,255,0.08);color:var(--muted);padding:2px 8px;border-radius:6px;font-size:11px">0 on hand</span>`;
        return `
          <button type="button" class="semen-sug-item" onmousedown="window.selectSemenLotSuggest(${lineIndex}, ${L.idx})">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b>${escH(L.boar_name)} <small style="color:var(--muted)">(${escH(L.breed)})</small></b>
              ${stockPill}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px;font-size:11px;color:var(--muted)">
              <span>Batch: <b>${escH(L.semen_batch_no)}</b>${L.collection_date ? ` · Coll. ${fmtDate(L.collection_date)}` : ''}</span>
              <span style="color:var(--teal2);font-weight:600">₱${L.price}/bottle</span>
            </div>
          </button>
        `;
      }).join('');
    }

    box.classList.add('open');
    box.style.display = 'block';
  }
  window.filterSemenLotSuggest = filterSemenLotSuggest;

  function selectSemenLotSuggest(lineIndex, lotIdx) {
    lotIdx = parseInt(lotIdx, 10);
    const lots = getAvailableSemenLots();
    const lot = lots.find(L => L.idx === lotIdx);
    if (!lot) return;

    const hiddenIn = document.getElementById(`semenLotHidden_${lineIndex}`);
    if (hiddenIn) hiddenIn.value = lotIdx;

    const textIn = document.getElementById(`semenLotInput_${lineIndex}`);
    if (textIn) textIn.value = `${lot.boar_name} (${lot.breed}) · Batch: ${lot.semen_batch_no} · [${lot.avail} on hand]`;

    closeSemenLotSuggest(lineIndex);
    onSemenLotChange(lineIndex, lotIdx);
  }
  window.selectSemenLotSuggest = selectSemenLotSuggest;

  function closeSemenLotSuggest(lineIndex) {
    const box = document.getElementById(`semenLotSug_${lineIndex}`);
    if (box) {
      box.classList.remove('open');
      box.style.display = 'none';
    }
  }
  window.closeSemenLotSuggest = closeSemenLotSuggest;

  function semenLineCardHTML(line, lineIndex) {
    const lots = getAvailableSemenLots();
    const curLot = lots.find(L => L.idx === line.idx) || lots[0];
    const avail = curLot ? curLot.avail : 0;
    const canDelete = activeSaleLines.length > 1;
    const defaultText = curLot ? `${curLot.boar_name} (${curLot.breed}) · Batch: ${curLot.semen_batch_no} · [${avail} on hand]` : '';

    return `
      <div class="semen-line-card" id="semenLineCard_${lineIndex}" data-line-index="${lineIndex}">
        <div class="semen-line-head">
          <b>🧪 Semen Item #${lineIndex + 1}</b>
          ${canDelete ? `<button type="button" class="btn ghost mini danger" onclick="window.removeSemenSaleLine(${lineIndex})" title="Remove this boar from cart">✕ Remove</button>` : ''}
        </div>
        <div class="field" style="margin-bottom:8px">
          <label>Select Boar / Semen Lot * <small class="muted">— search boar, breed or batch no.</small></label>
          <div class="treat-typeahead">
            <input type="text"
                   id="semenLotInput_${lineIndex}"
                   autocomplete="off"
                   placeholder="🔍 Type boar name, breed, or batch # to search…"
                   value="${escH(defaultText)}"
                   oninput="window.filterSemenLotSuggest(${lineIndex}, this.value)"
                   onfocus="window.filterSemenLotSuggest(${lineIndex}, this.value)"
                   onblur="setTimeout(window.closeSemenLotSuggest, 200, ${lineIndex})"
                   required>
            <input type="hidden" name="semen_lot_${lineIndex}" id="semenLotHidden_${lineIndex}" value="${curLot ? curLot.idx : 0}">
            <div id="semenLotSug_${lineIndex}" class="semen-suggestions treat-sug" style="max-height:220px;overflow-y:auto"></div>
          </div>
        </div>
        <div class="semen-line-grid">
          <div class="field" style="margin-bottom:0">
            <label>Qty (bottles) * <small class="muted" id="availLabel_${lineIndex}">· max ${avail} on hand</small></label>
            <input name="qty_${lineIndex}" id="qtyInput_${lineIndex}" type="number" min="1" max="${Math.max(1, avail)}" step="1" value="${line.qty || 1}" required oninput="window.sellCalc()">
          </div>
          <div class="field" style="margin-bottom:0">
            <label>Amount / bottle (₱) *</label>
            <input name="price_${lineIndex}" id="priceInput_${lineIndex}" type="number" min="0" step="0.01" value="${line.price || curLot.price || 350}" required placeholder="350.00" oninput="window.sellCalc()">
          </div>
          <div class="field" style="margin-bottom:0">
            <label>Item Subtotal</label>
            <div id="subtotalDisplay_${lineIndex}" class="line-subtotal-box">₱0.00</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderSemenSaleLines() {
    const container = document.getElementById('semenSaleLines');
    if (!container) return;
    container.innerHTML = activeSaleLines.map((line, idx) => semenLineCardHTML(line, idx)).join('');
    sellCalc();
  }

  function addSemenSaleLine() {
    const lots = getAvailableSemenLots();
    const usedIndices = activeSaleLines.map(l => l.idx);
    const nextLot = lots.find(l => !usedIndices.includes(l.idx) && l.avail > 0) || lots[0];
    activeSaleLines.push({
      idx: nextLot ? nextLot.idx : 0,
      qty: 1,
      price: nextLot ? (nextLot.price || 350) : 350
    });
    renderSemenSaleLines();
  }
  window.addSemenSaleLine = addSemenSaleLine;

  function removeSemenSaleLine(idx) {
    if (activeSaleLines.length <= 1) return;
    activeSaleLines.splice(idx, 1);
    renderSemenSaleLines();
  }
  window.removeSemenSaleLine = removeSemenSaleLine;

  function onSemenLotChange(lineIndex, newIdx) {
    newIdx = parseInt(newIdx, 10);
    const lots = getAvailableSemenLots();
    const lot = lots.find(l => l.idx === newIdx);
    if (!lot) return;
    activeSaleLines[lineIndex].idx = newIdx;
    activeSaleLines[lineIndex].price = lot.price || 350;

    const availLbl = document.getElementById(`availLabel_${lineIndex}`);
    if (availLbl) availLbl.textContent = `· max ${lot.avail} on hand`;
    const qtyIn = document.getElementById(`qtyInput_${lineIndex}`);
    if (qtyIn) qtyIn.max = Math.max(1, lot.avail);
    const priceIn = document.getElementById(`priceInput_${lineIndex}`);
    if (priceIn) priceIn.value = lot.price || 350;

    sellCalc();
  }
  window.onSemenLotChange = onSemenLotChange;

  function openSemenSell(i = 0) {
    const x = semenRec(i);
    document.getElementById('semenSellModal')?.remove();
    document.getElementById('drillModal')?.remove();
    const today = new Date().toISOString().slice(0, 10);

    // Initialize cart with the clicked lot
    activeSaleLines = [{
      idx: i,
      qty: 1,
      price: x ? (x.price || 350) : 350
    }];

    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="semenSellModal"><form class="due-modal semen-sell" onsubmit="saveSemenSale(event,${i})">
      <div class="modal-top">
        <div>
          <div class="eyebrow">🧾 MULTI-BREED SEMEN SALE — POS</div>
          <h2>Point of Sale · Semen Checkout</h2>
        </div>
        <button type="button" class="close-reminder" onclick="document.getElementById('semenSellModal').remove()">×</button>
      </div>

      <!-- Customer Details -->
      <div class="field semen-cust-field"><label>Customer Name *</label><div class="treat-typeahead"><input name="customer" id="sellCustInput" autocomplete="off" placeholder="Type a name — returning buyers auto-suggest" oninput="sellCustFilter(this.value)" onfocus="sellCustFilter(this.value)" onblur="setTimeout(sellCustClose,180)" required><div id="sellCustSug" class="semen-suggestions treat-sug"></div></div></div>

      <div class="reminder-fields" style="margin-top:10px">
        <div class="form-grid-2">
          <div class="field"><label>Address</label><input name="address" id="sellAddr" placeholder="Barangay / town"></div>
          <div class="field"><label>Contact</label><input name="contact" id="sellContact" placeholder="Mobile number"></div>
        </div>

        <div class="form-grid-2">
          <div class="field"><label>Sale date</label><input name="date" type="date" value="${today}" required></div>
          <div class="field"><label>Delivery / Pickup Mode</label><div class="semen-mode"><label class="res-check"><input type="radio" name="mode" value="pickup" checked onchange="sellMode('pickup')"> 🧍 Pick up</label><label class="res-check"><input type="radio" name="mode" value="shipment" onchange="sellMode('shipment')"> 🚚 Shipment</label></div></div>
        </div>

        <div class="field" id="shipFeeField" style="display:none"><label>Shipment charge (₱)</label><input name="ship_fee" type="number" min="0" step="0.01" value="0" oninput="sellCalc()"><small class="field-hint">Added on top of the order total</small></div>

        <!-- Multi-Semen Items Section -->
        <div class="field full" style="margin-top:6px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <label style="margin-bottom:0;font-size:13px;font-weight:700">🧪 Semen Bottles &amp; Breeds (Cart)</label>
            <button type="button" class="btn ghost small" onclick="window.addSemenSaleLine()">＋ Add Another Boar / Breed</button>
          </div>
          <div id="semenSaleLines">
            ${semenLineCardHTML(activeSaleLines[0], 0)}
          </div>
        </div>

        <!-- Add-ons (Catheters: Sow & Gilt + Semen box) -->
        <div class="field full"><label>Add-ons (optional) — tick if the customer buys these too</label><div class="semen-addons">
          <!-- Sow Catheter -->
          <label class="res-check"><input type="checkbox" name="add_catheter_sow" onchange="sellAddons()"> 🩺 Catheter (Sow) <small class="muted">— for mature sows, priced per piece</small></label>
          <div class="semen-addon-grid semen-addon-grid-2" id="sellCathSowFields" style="display:none">
            <div class="field"><label>Sow Catheter Qty</label><input name="catheter_sow_qty" type="number" min="1" step="1" value="1" oninput="sellCalc()"></div>
            <div class="field"><label>₱ per pc</label><input name="catheter_sow_price" type="number" min="0" step="0.01" placeholder="20.00" value="20.00" oninput="sellCalc()"></div>
          </div>

          <!-- Gilt Catheter -->
          <label class="res-check"><input type="checkbox" name="add_catheter_gilt" onchange="sellAddons()"> 🩺 Catheter (Gilt) <small class="muted">— for young gilts, priced per piece</small></label>
          <div class="semen-addon-grid semen-addon-grid-2" id="sellCathGiltFields" style="display:none">
            <div class="field"><label>Gilt Catheter Qty</label><input name="catheter_gilt_qty" type="number" min="1" step="1" value="1" oninput="sellCalc()"></div>
            <div class="field"><label>₱ per pc</label><input name="catheter_gilt_price" type="number" min="0" step="0.01" placeholder="20.00" value="20.00" oninput="sellCalc()"></div>
          </div>

          <!-- Semen Box -->
          <label class="res-check"><input type="checkbox" name="add_box" onchange="sellAddons()"> 📦 Semen box <small class="muted">— carry / storage box</small></label>
          <div class="semen-addon-grid semen-addon-grid-2" id="sellBoxFields" style="display:none">
            <div class="field"><label>Box Qty</label><input name="box_qty" type="number" min="1" step="1" value="1" oninput="sellCalc()"></div>
            <div class="field"><label>₱ per pc</label><input name="box_price" type="number" min="0" step="0.01" placeholder="0.00" oninput="sellCalc()"></div>
          </div>
        </div><small class="field-hint">Add-ons are added into the total, the receipt, and POS/Financials. Unticked = not sold, no charge.</small></div>

        <!-- Paid Amount & Payment Status (Positioned at the very bottom after add-ons) -->
        <div class="field full" style="margin-top:6px;background:rgba(23,202,190,0.06);border:1px dashed rgba(23,202,190,0.3);border-radius:10px;padding:12px 14px">
          <div class="form-grid-2" style="margin-bottom:0">
            <div class="field" style="margin-bottom:0">
              <label>Amount paid / Cash Tendered (₱) *</label>
              <input name="paid" id="sellPaidInput" type="number" min="0" step="0.01" value="0" placeholder="0.00" oninput="sellCalc()">
              <small class="field-hint">Enter cash handed over to compute Change</small>
            </div>
            <div class="field" style="margin-bottom:0">
              <label>Payment Status</label>
              <select name="status" id="sellStatusSelect">
                <option value="completed">Completed (Paid in full)</option>
                <option value="pending">Pending (Unpaid / Partial)</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div class="semen-total" id="sellTotal">Total ₱0.00 · Balance ₱0.00</div>
      <div class="form-error" id="sellErr"></div>
      <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('semenSellModal').remove()">Cancel</button><button class="btn">Save sale</button></div>
    </form></div>`);
    sellCalc();
  }

  function sellCustFilter(q) {
    let box = document.getElementById('sellCustSug');
    if (!box) return;
    let term = String(q || '').trim().toLowerCase();
    curCust = customerDirectory().filter(c => !term || c.name.toLowerCase().includes(term)).slice(0, 8);
    box.innerHTML = curCust.length
      ? curCust.map((c, i) => `<button type="button" onmousedown="sellCustPick(${i})"><span><b>${escH(c.name)}</b><br><small>${escH(c.contact || 'no contact saved')}</small></span></button>`).join('')
      : '<div class="suggestion-empty">No matching buyer yet — this name will be added to your customer list on save.</div>';
    box.classList.add('open');
    box.style.display = 'block';
  }

  function sellCustPick(i) {
    let c = curCust[i];
    if (!c) return;
    document.getElementById('sellCustInput').value = c.name;
    if (c.contact) document.getElementById('sellContact').value = c.contact;
    if (c.address) document.getElementById('sellAddr').value = c.address;
    sellCustClose();
  }

  function sellCustClose() {
    let box = document.getElementById('sellCustSug');
    if (box) { box.classList.remove('open'); box.style.display = 'none'; }
  }

  function sellMode(v) {
    let f = document.getElementById('shipFeeField');
    if (f) f.style.display = v === 'shipment' ? 'block' : 'none';
    sellCalc();
  }

  function addonAmounts(d) {
    let cSowQty = (d.add_catheter_sow === 'on' || (d.add_catheter === 'on' && d.catheter_type === 'sow')) ? Math.max(1, Math.floor(num(d.catheter_sow_qty || d.catheter_qty) || 1)) : 0,
      cSowPrice = (d.add_catheter_sow === 'on' || (d.add_catheter === 'on' && d.catheter_type === 'sow')) ? Math.max(0, num(d.catheter_sow_price || d.catheter_price) || 0) : 0,
      cSowTotal = cSowQty * cSowPrice;

    let cGiltQty = (d.add_catheter_gilt === 'on' || (d.add_catheter === 'on' && d.catheter_type === 'gilt')) ? Math.max(1, Math.floor(num(d.catheter_gilt_qty || d.catheter_qty) || 1)) : 0,
      cGiltPrice = (d.add_catheter_gilt === 'on' || (d.add_catheter === 'on' && d.catheter_type === 'gilt')) ? Math.max(0, num(d.catheter_gilt_price || d.catheter_price) || 0) : 0,
      cGiltTotal = cGiltQty * cGiltPrice;

    let bQty = d.add_box === 'on' ? Math.max(1, Math.floor(num(d.box_qty) || 1)) : 0,
      bPrice = d.add_box === 'on' ? Math.max(0, num(d.box_price) || 0) : 0,
      bTotal = bQty * bPrice;

    return {
      cathSowQty: cSowQty,
      cathSowPrice: cSowPrice,
      cathSowTotal: cSowTotal,
      cathGiltQty: cGiltQty,
      cathGiltPrice: cGiltPrice,
      cathGiltTotal: cGiltTotal,
      cathQty: cSowQty + cGiltQty,
      cathPrice: (cSowQty + cGiltQty) > 0 ? (cSowTotal + cGiltTotal) / (cSowQty + cGiltQty) : 0,
      cathTotal: cSowTotal + cGiltTotal,
      boxQty: bQty,
      boxPrice: bPrice,
      boxTotal: bTotal,
      total: cSowTotal + cGiltTotal + bTotal
    };
  }

  function sellAddons() {
    let f = document.querySelector('#semenSellModal form');
    if (!f) return;
    let cs = document.getElementById('sellCathSowFields'),
      cg = document.getElementById('sellCathGiltFields'),
      bf = document.getElementById('sellBoxFields');
    if (cs) cs.style.display = f.add_catheter_sow?.checked ? 'grid' : 'none';
    if (cg) cg.style.display = f.add_catheter_gilt?.checked ? 'grid' : 'none';
    if (bf) bf.style.display = f.add_box?.checked ? 'grid' : 'none';
    sellCalc();
  }

  function sellCalc() {
    let f = document.querySelector('#semenSellModal form');
    if (!f) return;
    let d = Object.fromEntries(new FormData(f));

    let lots = getAvailableSemenLots();
    let totalSemen = 0;
    let totalBottles = 0;

    activeSaleLines.forEach((line, idx) => {
      const lineLotIdx = parseInt(d[`semen_lot_${idx}`] !== undefined ? d[`semen_lot_${idx}`] : line.idx, 10);
      const lot = lots.find(l => l.idx === lineLotIdx) || lots[0];
      const q = Math.max(0, parseInt(d[`qty_${idx}`] !== undefined ? d[`qty_${idx}`] : line.qty, 10) || 0);
      const p = Math.max(0, parseFloat(d[`price_${idx}`] !== undefined ? d[`price_${idx}`] : line.price, 10) || 0);
      const sub = q * p;
      totalSemen += sub;
      totalBottles += q;

      const subDisplay = document.getElementById(`subtotalDisplay_${idx}`);
      if (subDisplay) subDisplay.textContent = peso(sub);
    });

    let paid = Math.max(0, num(d.paid) || 0),
      ship = d.mode === 'shipment' ? Math.max(0, num(d.ship_fee) || 0) : 0,
      ad = addonAmounts(d),
      grandTotal = totalSemen + ship + ad.total,
      bal = Math.max(0, grandTotal - paid),
      change = Math.max(0, paid - grandTotal),
      out = document.getElementById('sellTotal'),
      extra = [
        ship ? `${peso(ship)} shipment` : '',
        ad.cathSowQty ? `sow catheter ×${ad.cathSowQty} ${peso(ad.cathSowTotal)}` : '',
        ad.cathGiltQty ? `gilt catheter ×${ad.cathGiltQty} ${peso(ad.cathGiltTotal)}` : '',
        ad.boxQty ? `semen box ×${ad.boxQty} ${peso(ad.boxTotal)}` : ''
      ].filter(Boolean).join(' · ');

    const statSelect = document.getElementById('sellStatusSelect');
    if (statSelect) {
      if (paid >= grandTotal && grandTotal > 0) statSelect.value = 'completed';
      else if (paid < grandTotal) statSelect.value = 'pending';
    }

    if (out) out.innerHTML = `Total <b>${peso(grandTotal)}</b> · Cash <b>${peso(paid)}</b> · ${paid >= grandTotal ? `Change <b class="pos-change">${peso(change)}</b>` : `Balance <b>${peso(bal)}</b>`}${extra ? ` <small>(${extra})</small>` : ''}`;
  }

  function mirrorSave(sale) {
    const f = F();
    f.sales = f.sales || [];
    f.transactions = f.transactions || [];
    let items = [];
    if (sale.catheter_sow_qty) items.push(`sow catheter × ${sale.catheter_sow_qty}`);
    if (sale.catheter_gilt_qty) items.push(`gilt catheter × ${sale.catheter_gilt_qty}`);
    if (!sale.catheter_sow_qty && !sale.catheter_gilt_qty && sale.catheter_qty) items.push(`${sale.catheter || 'sow'} catheter × ${sale.catheter_qty}`);
    if (sale.box_qty) items.push(`semen box × ${sale.box_qty}`);
    let extras = items.join(' + ');

    let productLabel = sale.lines && sale.lines.length > 1
      ? `Frozen semen (${sale.lines.map(l => `${l.boar} ×${l.qty}`).join(', ')}) → ${sale.customer}${extras ? ' + ' + extras : ''}`
      : `Frozen semen — ${sale.boar} (${sale.semen_batch_no || 'batch'}) × ${sale.qty} → ${sale.customer}${extras ? ' + ' + extras : ''}`;

    sale.pos_id = 'pos-' + Date.now();
    f.sales.push({
      id: sale.pos_id,
      date: sale.date,
      product: productLabel,
      qty: sale.qty,
      total: sale.amount,
      paid: sale.paid
    });
    sale.tx_id = 'tx-' + Date.now();
    f.transactions.push({
      id: sale.tx_id,
      date: sale.date,
      type: 'Income',
      category: 'Semen Sales',
      description: `${sale.boar} × ${sale.qty} bottle(s) → ${sale.customer}${extras ? ' + ' + extras : ''}${sale.mode === 'shipment' ? ' (shipment)' : ''}`,
      amount: sale.amount,
      paid: sale.paid
    });
  }

  async function saveSemenSale(e, initialIdx) {
    e.preventDefault();
    let form = e.target,
      d = Object.fromEntries(new FormData(form)),
      err = document.getElementById('sellErr');
    err.classList.remove('show');

    try {
      const customer = String(d.customer || '').trim();
      if (!customer) throw new Error('Customer name is required.');

      const saleLines = [];
      const changedSemenLots = new Set();
      let totalSemen = 0;
      let totalBottles = 0;

      activeSaleLines.forEach((line, idx) => {
        const lineLotIdx = parseInt(d[`semen_lot_${idx}`] !== undefined ? d[`semen_lot_${idx}`] : line.idx, 10);
        const lot = (F().semen || [])[lineLotIdx];
        if (!lot) throw new Error(`Semen item #${idx + 1} not found in inventory.`);

        const q = parseInt(d[`qty_${idx}`] !== undefined ? d[`qty_${idx}`] : line.qty, 10) || 0;
        const p = parseFloat(d[`price_${idx}`] !== undefined ? d[`price_${idx}`] : line.price, 10) || 0;

        if (q < 1) throw new Error(`Quantity for ${lot.boar_name || lot.boar} must be at least 1 bottle.`);
        const avail = lot.available_bottles ?? lot.bottles ?? 0;
        if (q > avail) throw new Error(`Only ${avail} bottle(s) available on hand for ${lot.boar_name || lot.boar}.`);

        const lineTotal = q * p;
        totalSemen += lineTotal;
        totalBottles += q;

        const lin = boarLineage(lot);

        saleLines.push({
          semen_index: lineLotIdx,
          semen_id: lot.id || '',
          semen_batch_no: lot.semen_batch_no || lot.id || '',
          boar: lot.boar_name || lot.boar || '',
          breed: lot.breed || '',
          sire: lin.sire || lot.sire || '',
          dam: lin.dam || lot.dam || '',
          qty: q,
          price: p,
          total: lineTotal
        });
      });

      if (!saleLines.length) throw new Error('Add at least one semen item to the purchase.');

      let paid = Math.max(0, num(d.paid) || 0),
        ship = d.mode === 'shipment' ? Math.max(0, num(d.ship_fee) || 0) : 0,
        ad = addonAmounts(d),
        grandTotal = totalSemen + ship + ad.total,
        primaryLine = saleLines[0];

      let breedSummary = [...new Set(saleLines.map(l => l.breed).filter(Boolean))].join(' / ');

      let sale = {
        id: 'ss-' + Date.now(),
        farm_id: farmId,
        date: d.date,
        semen_index: primaryLine.semen_index,
        semen_batch_no: saleLines.map(l => l.semen_batch_no).join(', '),
        boar: saleLines.length === 1 ? primaryLine.boar : `${primaryLine.boar} + ${saleLines.length - 1} other(s)`,
        breed: breedSummary || primaryLine.breed,
        sire: primaryLine.sire,
        dam: primaryLine.dam,
        customer: customer,
        address: d.address || '',
        contact: d.contact || '',
        qty: totalBottles,
        price: totalBottles > 0 ? (totalSemen / totalBottles) : primaryLine.price,
        lines: saleLines,
        mode: d.mode || 'pickup',
        ship_fee: ship,
        catheter_sow_qty: ad.cathSowQty,
        catheter_sow_price: ad.cathSowPrice,
        catheter_gilt_qty: ad.cathGiltQty,
        catheter_gilt_price: ad.cathGiltPrice,
        catheter_qty: ad.cathQty,
        catheter_price: ad.cathPrice,
        catheter: ad.cathSowQty && ad.cathGiltQty ? 'both' : (ad.cathSowQty ? 'sow' : (ad.cathGiltQty ? 'gilt' : null)),
        box_qty: ad.boxQty,
        box_price: ad.boxPrice,
        status: paid >= grandTotal ? 'completed' : (d.status || 'pending'),
        amount: grandTotal,
        paid,
        balance: Math.max(0, grandTotal - paid),
        returned_qty: 0,
        returns: [],
        created_at: new Date().toISOString()
      };

      // Deduct stock from each individual semen lot
      saleLines.forEach(l => {
        const targetLot = (F().semen || [])[l.semen_index];
        if (targetLot) {
          const current = +(targetLot.available_bottles ?? targetLot.bottles ?? 0);
          const remaining = Math.max(0, current - l.qty);
          // Keep both legacy/current stock fields identical so every inventory
          // view reads the same remaining quantity.
          targetLot.available_bottles = remaining;
          targetLot.bottles = remaining;
          targetLot.updated_at = new Date().toISOString();
          changedSemenLots.add(targetLot);
        }
      });

      mirrorSave(sale);
      (F().semenSales = F().semenSales || []).unshift(sale);
      // Commit the walk-in sale and stock deduction locally before any network
      // operation. Then verify the sale, POS/financial mirrors and every
      // affected semen lot together as one dirty farm save.
      save();
      const sync = await verifySemenCloudSave(`walk-in semen sale ${sale.id}`);
      if (!sync.success) preserveSemenRecovery('walk-in semen sale awaiting cloud verification');
      document.getElementById('semenSellModal')?.remove();
      renderAll();
      if (sync.success) {
        toast(`✔ Walk-in semen sale saved and cloud-verified — ${peso(grandTotal)} to ${sale.customer}${paid > grandTotal ? ` · change ${peso(paid - grandTotal)}` : ''}`);
      } else {
        toast(`✓ Walk-in semen sale saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
        window.updateSyncIndicator?.('pending', 'Semen sale pending', sync.reason || 'The sale and stock deduction remain safely local until verified.');
      }
      openSemenReceipt(sale.id);
    } catch (ex) {
      err.textContent = ex.message || 'Could not save the sale.';
      err.classList.add('show');
    }
  }

  /* ── receipt + print ─────────────────────────────────────────────────── */
  function findSale(id) { return (F().semenSales || []).find(s => s.id === id); }

  /* [REBUILD FIX 46] receipt layout: no "ARSWINETECH PRO" brand header, no
     lineage line, and the footer now thanks the customer in the farm's own
     name ("Thank you for trusting <farm>! Happy Breeding!"). */

  function receiptHTML(s) {
    const farm = F(),
      when = new Date(s.created_at || s.date),
      /* [REBUILD FIX 54] every return/replacement entry prints its full line
         items + net change + balance-after; legacy compact entries keep the
         one-line form. */
      ret = (s.returns || []).map(r => {
        const head = `<div class="rc-line">↩ ${r.kind === 'return' ? 'RETURN' : 'REPLACEMENT'} ×${r.qty}${(r.gives || []).length ? ' ⇄ gave ' + r.gives.reduce((a, g) => a + g.qty, 0) : ''}${r.note ? ' · ' + escH(r.note) + ' · ' : ' · '}${new Date(r.at).toLocaleString('en-PH')}</div>`;
        if (!r.lines && !r.gives) return head;
        const det = (r.lines || []).map(l => `<div class="rc-line rc-dim">− took back ${l.qty}× ${escH(l.boar)} (${escH(l.breed || '—')} · ${escH(l.batch || 'batch')}) · bought ${fmtDate(l.sale_date)} · −${peso(l.credit || 0)}</div>`).join(''),
          giv = (r.gives || []).map(g => `<div class="rc-line rc-dim">＋ gave ${g.qty}× ${escH(g.boar)} (${escH(g.breed || '—')} · ${escH(g.batch || 'batch')}) · ＋${peso(g.charge || 0)}</div>`).join(''),
          net = r.net !== undefined ? `<div class="rc-line rc-dim"><b>Net ${r.net > 0 ? '+' : r.net < 0 ? '−' : '±'}${peso(Math.abs(r.net))} · balance after: ${peso(r.balance_after || 0)}</b></div>` : '';
        return head + det + giv + net;
      }).join(''),
      pays = (s.payments || []).map(p => `<div class="rc-line">💰 ${peso(p.amount)} · ${fmtDate(p.date)}${p.note ? ' · ' + escH(p.note) : ''} · ${new Date(p.at).toLocaleString('en-PH')}</div>`).join('');
    return `<div class="rc-head"><b>${escH(farm.name || 'Farm')}</b><span>SEMEN SALE RECEIPT</span></div>
      <div class="rc-line">Receipt ${escH(s.id)}<br>${when.toLocaleString('en-PH')}</div>
      <div class="rc-sep"></div>
      <div class="rc-line">Customer: <b>${escH(s.customer)}</b></div>
      <div class="rc-line">${escH(s.address || '—')} · ${escH(s.contact || '—')}</div>
      <div class="rc-sep"></div>
      ${(s.lines && s.lines.length > 0) ? `
        <div class="rc-line" style="font-weight:700">SEMEN ITEMS:</div>
        ${s.lines.map(l => `
          <div class="rc-line"><b>${escH(l.boar)}</b> (${escH(l.breed)})<br><small class="rc-dim">Batch: ${escH(l.semen_batch_no)}</small></div>
          <div class="rc-line">${l.qty} bottle(s) × ${peso(l.price)} <b class="rc-right">${peso(l.total)}</b></div>
        `).join('')}
      ` : `
        <div class="rc-line">Semen: <b>${escH(s.boar)}</b> (${escH(s.breed)})</div>
        <div class="rc-line">Batch: ${escH(s.semen_batch_no || '—')}</div>
        <div class="rc-sep"></div>
        <div class="rc-line">${s.qty} bottle(s) × ${peso(s.price)} <b class="rc-right">${peso(s.qty * s.price)}</b></div>
      `}
      ${s.mode === 'shipment' ? `<div class="rc-line">Shipment charge <b class="rc-right">${peso(s.ship_fee || 0)}</b></div>` : ''}
      ${s.catheter_sow_qty ? `<div class="rc-line">Catheter (Sow) ×${s.catheter_sow_qty} <b class="rc-right">${peso(s.catheter_sow_qty * (s.catheter_sow_price || s.catheter_price || 0))}</b></div>` : ''}
      ${s.catheter_gilt_qty ? `<div class="rc-line">Catheter (Gilt) ×${s.catheter_gilt_qty} <b class="rc-right">${peso(s.catheter_gilt_qty * (s.catheter_gilt_price || s.catheter_price || 0))}</b></div>` : ''}
      ${(!s.catheter_sow_qty && !s.catheter_gilt_qty && s.catheter_qty) ? `<div class="rc-line">Catheter (${s.catheter === 'gilt' ? 'Gilt' : 'Sow'}) ×${s.catheter_qty} <b class="rc-right">${peso(s.catheter_qty * s.catheter_price)}</b></div>` : ''}
      ${s.box_qty ? `<div class="rc-line">Semen box ×${s.box_qty} <b class="rc-right">${peso(s.box_qty * s.box_price)}</b></div>` : ''}
      ${s.returned_qty ? `<div class="rc-line">Returned ×${s.returned_qty} <b class="rc-right">−${peso(s.returned_qty * s.price)}</b></div>` : ''}
      <div class="rc-line rc-big">TOTAL <b class="rc-right">${peso(s.amount)}</b></div>
      <div class="rc-line">Cash <b class="rc-right">${peso(s.paid)}</b></div>
      ${+s.paid > +s.amount ? `<div class="rc-line">CHANGE <b class="rc-right">${peso(Math.max(0, (+s.paid || 0) - (+s.amount || 0)))}</b></div>` : ''}
      <div class="rc-line">Balance <b class="rc-right">${peso(s.balance)}</b></div>
      <div class="rc-line">Mode: ${s.mode === 'shipment' ? 'Shipment' : 'Pick up'} · Status: ${String(s.status).toUpperCase()}</div>
      ${ret ? '<div class="rc-sep"></div><div class="rc-line"><b>Returns / replacements log</b></div>' + ret : ''}
      ${pays ? '<div class="rc-sep"></div><div class="rc-line"><b>Payments log</b></div>' + pays : ''}
      <div class="rc-sep"></div>
      <div class="rc-foot">Thank you for trusting ${escH(farm.name || 'our farm')}! Happy Breeding!</div>`;
  }

  function openSemenReceipt(id) {
    const s = findSale(id);
    if (!s) return;
    document.getElementById('semenReceipt')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="drill-bg" id="semenReceipt"><div class="semen-receipt-wrap"><div class="sale-receipt">${receiptHTML(s)}</div><div class="due-actions no-print" style="justify-content:center"><button class="btn ghost" onclick="closeSemenReceipt()">Close</button><button class="btn ghost" onclick="openSemenAdjust('${s.id}')">↩ Return / replacement</button><button class="btn ghost" onclick="openSemenPayment('${s.id}')">💰 Payment</button><button class="btn" onclick="window.print()">🖨 Print receipt</button></div><div class="bt-panel no-print"><div class="eyebrow">DIRECT BLUETOOTH PRINTER</div><div id="btStatus" class="bt-status"></div><div class="bt-row"><button class="btn ghost" id="btScanBtn" onclick="btScanPrinter()">🔍 Scan &amp; connect</button><button class="btn" id="btPrintBtn" onclick="btPrintReceipt()">🖨 Print via Bluetooth</button><button class="btn ghost" id="btDiscBtn" style="display:none" onclick="btDisconnect()">Disconnect</button></div><p class="rc-hint" style="margin:0">💡 Works with BLE thermal POS printers. If yours pairs as classic Bluetooth only, use the 🖨 Print receipt button (system dialog) instead.</p></div></div></div>`);
    document.body.classList.add('semen-receipt-open');
    lastReceiptSale = s;
    btUi();
    /* 58 mm print styling is injected only while the receipt is on screen so the
       A4/Letter rules for certificates stay untouched. */
    if (!document.getElementById('semenPrintStyle'))
      document.head.insertAdjacentHTML('beforeend', `<style id="semenPrintStyle">@media print{@page{size:58mm auto;margin:1.5mm 2mm}body.semen-receipt-open:has(>#semenReceipt)>*:not(#semenReceipt){display:none!important}body.semen-receipt-open #semenReceipt{position:static!important;inset:auto!important;background:#fff!important;backdrop-filter:none!important;filter:none!important;padding:0!important;margin:0!important;z-index:auto!important;overflow:visible!important}body.semen-receipt-open #semenReceipt,body.semen-receipt-open #semenReceipt *{visibility:visible!important}body.semen-receipt-open .semen-receipt-wrap{transform:none!important;box-shadow:none!important}body.semen-receipt-open .no-print{display:none!important}}</style>`);
  }

  function closeSemenReceipt() {
    document.getElementById('semenReceipt')?.remove();
    document.body.classList.remove('semen-receipt-open');
  }

  /* ── [REBUILD FIX 46] DIRECT BLUETOOTH THERMAL PRINTING (Web Bluetooth ESC/POS Engine) ──
     Scan-and-connect directly from inside the app to BLE portable POS thermal
     printers (PT-210, MPT-II, POS-58, GOOJPRT, Xprinter, Netum, Milestone, etc.)
     and stream formatted ESC/POS receipts and account statements. */
  const BT_PRINTER_SERVICES = [
    "000018f0-0000-1000-8000-00805f9b34fb", // Standard ESC/POS
    "0000ff00-0000-1000-8000-00805f9b34fb", // PT210 / MPT-II / POS-58 / GOOJPRT
    "0000ffe0-0000-1000-8000-00805f9b34fb", // CC2540 / CC2541 / HM-10 / Xprinter
    "0000ffe5-0000-1000-8000-00805f9b34fb", // MPT-II alternate
    "0000fee7-0000-1000-8000-00805f9b34fb", // Tencent / Microchip / Milestone
    "0000af30-0000-1000-8000-00805f9b34fb", // ZJiang / POS58 BLE
    "0000ae00-0000-1000-8000-00805f9b34fb", // Rongta / XP58
    "0000fff0-0000-1000-8000-00805f9b34fb", // POS80 / Generic Android POS
    "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC transparent UART (IS1678 / BM70)
    "6e400001-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART Service
    "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // Custom ESC/POS
    "0000180a-0000-1000-8000-00805f9b34fb", // Device Info
    "00001800-0000-1000-8000-00805f9b34fb"  // Generic Access
  ];

  const KNOWN_TX_UUIDS = [
    "0000ff02-0000-1000-8000-00805f9b34fb", // PT210 / GOOJPRT TX
    "0000ffe1-0000-1000-8000-00805f9b34fb", // HM-10 / MPT-II TX
    "49535343-1e4d-4bd9-ba61-23c647249616", // ISSC TX Data pipe (NOT 8841 control!)
    "6e400002-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART TX
    "0000af31-0000-1000-8000-00805f9b34fb", // ZJiang TX
    "0000ae01-0000-1000-8000-00805f9b34fb", // XP58 TX
    "0000fff2-0000-1000-8000-00805f9b34fb", // POS80 TX
    "00002af1-0000-1000-8000-00805f9b34fb", // 0x18F0 TX
    "0000ff01-0000-1000-8000-00805f9b34fb", // PT210 single-char
    "0000fff1-0000-1000-8000-00805f9b34fb",
    "0000ffe2-0000-1000-8000-00805f9b34fb"
  ];

  let btDev = null, btChar = null, lastReceiptSale = null, lastStatementCustomer = null;

  const btSetStatus = t => {
    document.querySelectorAll("#btStatus, #btCustStatus, #btResStatus, .bt-status").forEach(el => {
      el.textContent = t;
    });
  };

  function btApi() {
    if (window.__ARS_BT_MOCK) return window.__ARS_BT_MOCK;
    if (window.__ARS_NO_BT) return null;
    return (navigator.bluetooth && navigator.bluetooth.requestDevice) ? navigator.bluetooth : null;
  }

  function btUi() {
    let has = !!btApi();
    const isConn = !!(btDev && btDev.gatt && btDev.gatt.connected && btChar);

    // 1. Single Sale Receipt Panel
    const scan = document.getElementById("btScanBtn");
    const prn = document.getElementById("btPrintBtn");
    const disc = document.getElementById("btDiscBtn");
    if (scan) {
      scan.disabled = !has;
      if (prn) prn.disabled = !isConn;
      if (disc) disc.style.display = isConn ? "" : "none";
    }

    // 2. Consolidated Customer Statement Panel
    const custScan = document.getElementById("btCustScanBtn");
    const custPrn = document.getElementById("btCustPrintBtn");
    const custDisc = document.getElementById("btCustDiscBtn");
    if (custScan) {
      custScan.disabled = !has;
      if (custPrn) custPrn.disabled = !isConn;
      if (custDisc) custDisc.style.display = isConn ? "" : "none";
    }

    // 3. Reseller Receipt & Statement Panels
    const resScan = document.getElementById("btResScanBtn");
    const resPrn = document.getElementById("btResPrintBtn");
    const resDisc = document.getElementById("btResDiscBtn");
    if (resScan) {
      resScan.disabled = !has;
      if (resPrn) resPrn.disabled = !isConn;
      if (resDisc) resDisc.style.display = isConn ? "" : "none";
    }

    if (!has) {
      btSetStatus("⚠ This browser has no Bluetooth access — use Chrome on Android (HTTPS) or system print.");
    } else {
      btSetStatus(isConn ? `✔ Connected: ${btDev?.name || "Portable Thermal Printer"}` : "No printer connected yet — tap 🔍 Scan & connect.");
    }
  }

  async function btFindChar(server) {
    let candidates = [];
    
    // Try to get all primary services
    let services = await server.getPrimaryServices().catch(() => []);
    if (!services || !services.length) {
      for (const su of BT_PRINTER_SERVICES) {
        const svc = await server.getPrimaryService(su).catch(() => null);
        if (svc) services.push(svc);
      }
    }
    
    for (const svc of services) {
      let chars = await svc.getCharacteristics().catch(() => []);
      for (const c of chars) {
        const props = c.properties || {};
        const uuid = String(c.uuid).toLowerCase();
        let isWritable = props.writeWithoutResponse || props.write;
        if (!isWritable) continue;
        
        let score = 0;
        if (KNOWN_TX_UUIDS.includes(uuid)) {
          score += 1000;
        } else if (uuid.includes("ff02") || uuid.includes("ffe1") || uuid.includes("1e4d") || uuid.includes("af31") || uuid.includes("ae01")) {
          score += 800;
        } else if (props.writeWithoutResponse) {
          score += 500;
        } else if (props.write) {
          score += 200;
        }
        
        // Exclude / downrank known control endpoints that do not print
        if (uuid.includes("8841") || uuid.includes("2a00") || uuid.includes("2a01") || uuid.includes("2a29") || uuid.includes("2a24")) {
          score -= 1000;
        }
        
        candidates.push({ char: c, score, uuid });
      }
    }
    
    candidates.sort((a, b) => b.score - a.score);
    return candidates.length ? candidates[0].char : null;
  }

  async function btScanPrinter() {
    let api = btApi();
    if (!api) {
      btSetStatus("⚠ This browser has no Bluetooth access — use Chrome on Android (HTTPS) or system print.");
      if (window.toast) toast("⚠ Web Bluetooth requires Chrome on Android or a supported BLE browser.");
      btUi();
      return;
    }
    try {
      btSetStatus("🔎 Scanning… select your thermal printer in the dialog.");
      let dev = await api.requestDevice({
        acceptAllDevices: true,
        optionalServices: BT_PRINTER_SERVICES
      });
      btSetStatus(`🔗 Connecting to ${dev.name || "printer"}…`);
      dev.addEventListener("gattserverdisconnected", () => {
        btDev = null;
        btChar = null;
        btUi();
        btSetStatus("🔌 Printer disconnected.");
        if (window.toast) toast("🔌 Bluetooth printer disconnected.");
      });
      let server = await dev.gatt.connect();
      let char = await btFindChar(server);
      if (!char) throw new Error("Could not find a writable print channel — is this a BLE thermal printer?");
      btDev = dev;
      btChar = char;
      btUi();
      btSetStatus(`✔ Connected: ${dev.name || "Bluetooth Printer"}`);
      if (window.toast) toast(`✔ Connected to ${dev.name || "Bluetooth Printer"}`);
    } catch (e) {
      btDev = null;
      btChar = null;
      btUi();
      let m = String((e && e.message) || e);
      btSetStatus(/cancel/i.test(m) ? "Scan cancelled — no printer connected." : "⚠ " + m);
    }
  }

  function btDisconnect() {
    try {
      if (btDev && btDev.gatt && btDev.gatt.connected) btDev.gatt.disconnect();
    } catch (e) {}
    btDev = null;
    btChar = null;
    btUi();
    btSetStatus("🔌 Printer disconnected.");
  }

  async function sendEscPosBytes(bytes) {
    if (!btChar) throw new Error("No Bluetooth printer connected — tap 🔍 Scan & connect.");
    
    // Auto-reconnect if connection was dropped
    if (btDev && btDev.gatt && !btDev.gatt.connected) {
      btSetStatus("🔄 Reconnecting to printer…");
      let server = await btDev.gatt.connect();
      btChar = await btFindChar(server);
      if (!btChar) throw new Error("Printer reconnected but print service was unavailable.");
    }

    const CHUNK = 20; // Safe BLE MTU payload across all devices
    for (let off = 0; off < bytes.length; off += CHUNK) {
      let chunk = bytes.slice(off, off + CHUNK);
      let written = false;
      
      if (btChar.properties && btChar.properties.writeWithoutResponse && btChar.writeValueWithoutResponse) {
        try {
          await btChar.writeValueWithoutResponse(chunk);
          written = true;
        } catch (err) {
          // fall through to writeValueWithResponse
        }
      }
      if (!written && btChar.writeValueWithResponse) {
        try {
          await btChar.writeValueWithResponse(chunk);
          written = true;
        } catch (err) {
          // fall through to writeValue
        }
      }
      if (!written && btChar.writeValue) {
        await btChar.writeValue(chunk);
        written = true;
      }
      await new Promise(r => setTimeout(r, 25)); // 25ms packet pacing
    }
  }

  /* ESC/POS layout — 32 columns (58 mm), ASCII-safe; mirrors the receipt */
  function receiptTextLines(s) {
    const W = 32, farm = F(),
      P = v => "P" + (+v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      sep = "-".repeat(W),
      row = (l, r) => { let g = W - String(l).length - String(r).length; return String(l) + " ".repeat(Math.max(1, g)) + String(r); },
      ctr = t => { t = String(t); return t.length >= W ? t : " ".repeat(Math.max(0, (W - t.length) >> 1)) + t; },
      wrap = t => { let out = [], cur = ""; String(t).split(/\s+/).forEach(w => { if ((cur + " " + w).trim().length > W) { if (cur.trim()) out.push(cur.trim()); cur = w; } else cur = cur ? cur + " " + w : w; }); if (cur.trim()) out.push(cur.trim()); return out; },
      when = new Date(s.created_at || s.date),
      L = [];
    const add = (t, o = {}) => L.push({ t: String(t).replace(/·/g, "-").replace(/↩/g, "<-").replace(/×/g, "x").replace(/₱/g, "P").replace(/[^\x20-\x7E]/g, ""), c: !!o.c, b: !!o.b });
    add(farm.name || "Farm Operations", { c: 1, b: 1 });
    add("SEMEN SALE RECEIPT", { c: 1 });
    add(`Receipt ${s.id}`);
    add(when.toLocaleString("en-PH"));
    add(sep);
    add(`Customer: ${s.customer}`);
    add(`${s.address || "-"} - ${s.contact || "-"}`);
    add(sep);
    if (s.lines && s.lines.length > 0) {
      add("SEMEN ITEMS:", { b: 1 });
      s.lines.forEach(l => {
        add(`${l.boar} (${l.breed})`);
        add(`  Batch: ${l.semen_batch_no || "-"}`);
        add(row(`  ${l.qty} bottle(s) x ${P(l.price)}`, P(l.total)));
      });
      add(sep);
    } else {
      add(`Semen: ${s.boar} (${s.breed})`);
      add(`Batch: ${s.semen_batch_no || "-"}`);
      add(sep);
      add(row(`${s.qty} bottle(s) x ${P(s.price)}`, P(s.qty * s.price)));
    }
    if (s.mode === "shipment") add(row("Shipment charge", P(s.ship_fee || 0)));
    if (s.catheter_sow_qty) add(row(`Catheter (Sow) x${s.catheter_sow_qty}`, P(s.catheter_sow_qty * (s.catheter_sow_price || s.catheter_price || 0))));
    if (s.catheter_gilt_qty) add(row(`Catheter (Gilt) x${s.catheter_gilt_qty}`, P(s.catheter_gilt_qty * (s.catheter_gilt_price || s.catheter_price || 0))));
    if (!s.catheter_sow_qty && !s.catheter_gilt_qty && s.catheter_qty) add(row(`Catheter (${s.catheter === "gilt" ? "Gilt" : "Sow"}) x${s.catheter_qty}`, P(s.catheter_qty * s.catheter_price)));
    if (s.box_qty) add(row(`Semen box x${s.box_qty}`, P(s.box_qty * s.box_price)));
    if (s.returned_qty) add(row(`Returned x${s.returned_qty}`, "-" + P(s.returned_qty * s.price)));
    add(row("TOTAL", P(s.amount)), { b: 1 });
    if (+s.paid > +s.amount) {
      const changeAmt = Math.max(0, (+s.paid || 0) - (+s.amount || 0));
      add(row("Cash", P(s.paid)));
      add(row("CHANGE", P(changeAmt)), { b: 1 });
    } else {
      add(row("Paid", P(s.paid)));
    }
    add(row("Balance", P(s.balance)));
    add(`Mode: ${s.mode === "shipment" ? "Shipment" : "Pick up"} - Status: ${String(s.status).toUpperCase()}`);
    if ((s.returns || []).length) {
      add(sep);
      add("Returns / replacements log", { b: 1 });
      s.returns.forEach(r => {
        wrap(`${r.kind === "return" ? "RETURN" : "REPLACEMENT"} x${r.qty}${(r.gives || []).length ? " <-> gave " + r.gives.reduce((a, g) => a + g.qty, 0) : ""}${r.note ? " - " + r.note : ""} - ${new Date(r.at).toLocaleString("en-PH")}`).forEach(w => add(w));
        (r.lines || []).forEach(l => wrap(`- took back ${l.qty}x ${l.boar} (${l.breed || "-"}) -${P(l.credit || 0)}`).forEach(w => add(w)));
        (r.gives || []).forEach(g => wrap(`+ gave ${g.qty}x ${g.boar} (${g.breed || "-"}) +${P(g.charge || 0)}`).forEach(w => add(w)));
        if (r.net !== undefined) wrap(`Net ${r.net > 0 ? "+" : r.net < 0 ? "-" : "+-"}${P(Math.abs(r.net))} - balance after: ${P(r.balance_after || 0)}`).forEach(w => add(w));
      });
    }
    if ((s.payments || []).length) {
      add(sep);
      add("Payments log", { b: 1 });
      s.payments.forEach(p => wrap(`Payment ${fmtDate(p.date)} ${P(p.amount)}${p.note ? " - " + p.note : ""}`).forEach(w => add(w)));
    }
    add(sep);
    wrap(`Thank you for trusting ${farm.name || "our farm"}! Happy Breeding!`).forEach(t => add(t, { c: 1 }));
    return L;
  }

  function escPosBytes(s) {
    let enc = new TextEncoder(), parts = [
      new Uint8Array([0x1B, 0x40]),       // ESC @ init
      new Uint8Array([0x1B, 0x74, 0x00]), // ESC t 0
      new Uint8Array([0x1B, 0x32])        // ESC 2
    ];
    receiptTextLines(s).forEach(l => {
      parts.push(new Uint8Array([0x1B, 0x61, l.c ? 1 : 0])); // ESC a — align
      parts.push(new Uint8Array([0x1B, 0x45, l.b ? 1 : 0])); // ESC E — bold
      parts.push(enc.encode(l.t + "\n"));
    });
    parts.push(new Uint8Array([0x1B, 0x64, 0x04]));        // ESC d — feed 4 lines
    parts.push(new Uint8Array([0x1D, 0x56, 0x42, 0x00]));  // GS V — feed&cut
    parts.push(enc.encode("\n\n\n\n"));
    let n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n), o = 0;
    parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  }

  async function btPrintReceipt() {
    if (!btChar || !lastReceiptSale) {
      btSetStatus("⚠ No printer connected — tap 🔍 Scan & connect first.");
      if (window.toast) toast("⚠ Please connect your Bluetooth thermal printer first.");
      btScanPrinter();
      return;
    }
    btSetStatus("🖨 Sending receipt to printer…");
    if (window.toast) toast(`🖨 Printing receipt on ${btDev?.name || "printer"}…`);
    try {
      let bytes = escPosBytes(lastReceiptSale);
      await sendEscPosBytes(bytes);
      btSetStatus(`✔ Printed ${bytes.length} bytes on ${btDev?.name || "printer"}.`);
      if (window.toast) toast(`✔ Receipt printed successfully!`);
    } catch (e) {
      btSetStatus("⚠ Print failed: " + ((e && e.message) || e) + " — try reconnecting.");
      if (window.toast) toast("⚠ Print failed: " + ((e && e.message) || e));
    }
  }

  /* ── 58mm ESC/POS STATEMENT GENERATOR (32 Columns) ── */
  function statementTextLines(customerName, lastPaidAmount, lastPaidNote) {
    const W = 32, farm = F(),
      P = v => "P" + (+v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      sep = "-".repeat(W),
      row = (l, r) => {
        let lStr = String(l || "").slice(0, 18);
        let rStr = String(r || "");
        let g = W - lStr.length - rStr.length;
        return lStr + " ".repeat(Math.max(1, g)) + rStr;
      },
      wrap = t => {
        let out = [], cur = "";
        String(t).split(/\s+/).forEach(w => {
          if ((cur + " " + w).trim().length > W) {
            if (cur.trim()) out.push(cur.trim());
            cur = w;
          } else {
            cur = cur ? cur + " " + w : w;
          }
        });
        if (cur.trim()) out.push(cur.trim());
        return out;
      },
      now = new Date(),
      L = [];

    const add = (t, o = {}) => L.push({
      t: String(t).replace(/·/g, "-").replace(/↩/g, "<-").replace(/×/g, "x").replace(/₱/g, "P").replace(/[^\x20-\x7E]/g, ""),
      c: !!o.c,
      b: !!o.b
    });

    const cleanCust = String(customerName || "").trim().toLowerCase();
    const allSales = (F().semenSales || []).filter(s => {
      const sCust = String(s.customer || "").trim().toLowerCase();
      return !cleanCust || sCust === cleanCust;
    }).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    const totalBilled = allSales.reduce((a, s) => a + (+s.amount || 0), 0);
    const totalPaid = allSales.reduce((a, s) => a + (+s.paid || 0), 0);
    const totalBalance = Math.max(0, totalBilled - totalPaid);

    add(farm.name || "Farm Operations", { c: 1, b: 1 });
    add("STATEMENT OF ACCOUNT", { c: 1, b: 1 });
    add(now.toLocaleDateString("en-PH") + " " + now.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }), { c: 1 });
    add(sep);
    add("Customer: " + (customerName || "Customer"), { b: 1 });
    add(sep);
    add("ITEMIZED INVOICES:", { b: 1 });

    if (allSales.length) {
      allSales.forEach(s => {
        const billed = +s.amount || 0;
        const paid = +s.paid || 0;
        const bal = Math.max(0, billed - paid);
        const boar = String(s.boar || "Semen").slice(0, 12);
        const qty = s.qty || 1;
        const dStr = String(s.date || "").slice(5, 10);
        add(row(`${dStr} ${boar} x${qty}`, P(billed)));
        if (bal > 0) {
          add(row(`  Bal: ${P(bal)}`, `Paid: ${P(paid)}`));
        } else {
          add(`  Paid: ${P(paid)} [SETTLED]`);
        }
      });
    } else {
      add("No open transactions.");
    }

    const newBalance = lastPaidAmount > 0 ? Math.max(0, totalBalance - lastPaidAmount) : totalBalance;

    add(sep);
    add(row("TOTAL BILLED:", P(totalBilled)));
    if (totalPaid > 0) {
      add(row("PAID PREVIOUSLY:", P(totalPaid)));
    }
    if (lastPaidAmount && lastPaidAmount > 0) {
      add(row("PAYMENT RECEIVED:", "-" + P(lastPaidAmount)), { b: 1 });
      if (lastPaidNote) {
        wrap("Ref: " + lastPaidNote).forEach(n => add(n));
      }
      add(row("NEW BALANCE OWED:", P(newBalance)), { b: 1 });
    } else {
      add(row("REMAINING BALANCE:", P(totalBalance)), { b: 1 });
    }
    add(sep);
    wrap(`Thank you for trusting ${farm.name || "our farm"}! Happy Breeding!`).forEach(t => add(t, { c: 1 }));

    return L;
  }

  function escPosStatementBytes(customerName, lastPaidAmount, lastPaidNote) {
    let enc = new TextEncoder();
    let parts = [
      new Uint8Array([0x1B, 0x40]),       // ESC @ (Initialize)
      new Uint8Array([0x1B, 0x74, 0x00]), // ESC t 0 (Code page PC437)
      new Uint8Array([0x1B, 0x32])        // ESC 2 (Default line spacing)
    ];
    statementTextLines(customerName, lastPaidAmount, lastPaidNote).forEach(l => {
      parts.push(new Uint8Array([0x1B, 0x61, l.c ? 1 : 0])); // ESC a (align)
      parts.push(new Uint8Array([0x1B, 0x45, l.b ? 1 : 0])); // ESC E (bold)
      parts.push(enc.encode(l.t + "\n"));
    });
    parts.push(new Uint8Array([0x1B, 0x64, 0x04]));       // ESC d 4 (Feed 4 lines)
    parts.push(new Uint8Array([0x1D, 0x56, 0x42, 0x00])); // GS V (Cut)
    parts.push(enc.encode("\n\n\n\n"));                   // Extra buffer flush newlines
    let n = parts.reduce((a, p) => a + p.length, 0);
    let out = new Uint8Array(n);
    let o = 0;
    parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  }

  async function btPrintCustStatement(targetCust, explicitAmount, explicitNote) {
    let custName = targetCust || lastStatementCustomer;
    if (!custName) {
      const modalH2 = document.querySelector("#custConsolidatedPayModal h2");
      if (modalH2) custName = modalH2.textContent.replace(/^[\s🏪]+/, "").trim();
    }
    custName = custName || "Customer";
    lastStatementCustomer = custName;

    if (!btChar) {
      btSetStatus("⚠ No printer connected — tap 🔍 Scan & connect first.");
      if (window.toast) toast("⚠ Tap “🔍 Scan & connect” to pair your Bluetooth printer first.");
      btScanPrinter();
      return;
    }

    btSetStatus(`🖨 Streaming statement for ${custName} to printer…`);
    if (window.toast) toast(`🖨 Printing statement on ${btDev?.name || "Bluetooth POS"}…`);

    try {
      const amountInput = explicitAmount !== undefined ? explicitAmount : parseFloat(document.querySelector("#custConsolidatedPayModal input[name=\"amount\"]")?.value || "0");
      const noteInput = explicitNote !== undefined ? explicitNote : (document.querySelector("#custConsolidatedPayModal input[name=\"note\"]")?.value || "");

      let bytes = escPosStatementBytes(custName, amountInput > 0 ? amountInput : null, noteInput);
      await sendEscPosBytes(bytes);

      btSetStatus(`✔ Statement printed (${bytes.length} bytes) on ${btDev?.name || "printer"}.`);
      if (window.toast) toast(`✔ Statement printed successfully on ${btDev?.name || "PT210"}`);
    } catch (e) {
      console.warn("Bluetooth statement print error:", e);
      btSetStatus("⚠ Print error: " + ((e && e.message) || e));
      if (window.toast) toast("⚠ Bluetooth print error: " + ((e && e.message) || e));
    }
  }


  /* ── [REBUILD FIX 54] returns & replacements — item-level & transactional ──
     The old single "qty + note" log becomes a real take-back / swap desk:
       • The ORIGINAL purchase is fetched automatically (boar, breed, batch,
         purchase date, qty bought, already-returned bottles, unit price).
       • "+ another transaction of this customer" searches ALL of the same
         customer's transactions (auto-suggest; collectibles flagged) so one
         entry can take bottles back from several past purchases at once.
       • Replacement / additional items are picked from the live SEMEN
         inventory (auto-suggest with on-hand counts) — any number of lines,
         each with qty + unit price (pre-filled from that batch's last sale).
       • Credits (returned qty × original unit price) and charges (given qty
         × price) recalculate every touched sale: amount, balance, stock and
         BOTH money mirrors realign — the live recon box previews the net
         effect, and the entry is saved with a full timestamped reference.
       • Type Return with items given = "return + extra purchase"; type
         Replacement REQUIRES at least one replacement item.
       • The receipt (and the 58 mm Bluetooth print) lists every line with
         the net change and the balance after the adjustment. */
  let adjState = null;

  function saleRemain(t) { return Math.max(0, (+t.qty || 0) - (+t.returned_qty || 0)); }
  function lastPriceOf(idx) {
    const ss = (F().semenSales || []);
    for (let i = 0; i < ss.length; i++) if (ss[i].semen_index === idx && ss[i].price) return ss[i].price;
    return null;
  }
  function syncSaleMoney(t) {
    /* Mirrors + balance follow amount exactly; when a return pulls the bill
       BELOW the money already received, `paid` realigns down to the new bill
       (the customer owes nothing more on this ticket). Called ONCE per
       touched sale after ALL of its amount mutations — syncing an
       in-between state would clamp paid permanently. */
    t.paid = Math.min(+t.paid || 0, +t.amount || 0);
    t.balance = Math.max(0, (+t.amount || 0) - (+t.paid || 0));
    let pos = (F().sales || []).find(p => p.id === t.pos_id);
    if (pos) { pos.total = t.amount; pos.paid = t.paid; }
    let tx = (F().transactions || []).find(x => x.id === t.tx_id);
    if (tx) { tx.amount = t.amount; tx.paid = t.paid; }
  }
  function applyReturnLine(t, q) {
    /* stock back + qty/amount bookkeeping ONLY — the caller syncs mirrors
       once the sale's final amount is known */
    let x = semenRec(t.semen_index);
    if (x) {
      if (x.available_bottles !== undefined) x.available_bottles += q;
      if (x.bottles !== undefined) x.bottles += q;
    }
    t.returned_qty = (+t.returned_qty || 0) + q;
    const credit = q * (+t.price || 0);
    t.amount = Math.max(0, (+t.amount || 0) - credit);
    return credit;
  }

  function openSemenAdjust(id) {
    const s = findSale(id);
    if (!s) return;
    document.getElementById('semenAdjustModal')?.remove();
    adjState = { mainId: id, extra: [], gives: [], curOther: [], curGive: [] };
    const ret = +s.returned_qty || 0, remain = saleRemain(s);
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="semenAdjustModal"><form class="due-modal semen-adjust" onsubmit="saveSemenAdjust(event,'${id}')"><div class="modal-top"><div><div class="eyebrow">RETURN / REPLACEMENT</div><h2>${escH(s.boar)} → ${escH(s.customer)}</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('semenAdjustModal').remove()">×</button></div>
      <div class="adj-card adj-origin"><div class="adj-card-title">📦 Original purchase (auto-fetched)</div>
        <b>${escH(s.boar)}</b> ${escH(s.breed || '—')} · batch ${escH(s.semen_batch_no || '—')}<br>
        <span>🗓 bought ${fmtDate(s.date)} · ${s.qty} bottle(s) × ${peso(s.price)} · already returned ${ret} · <b>${remain} returnable</b></span>
      </div>
      <div class="field"><label>Type</label><select name="kind" onchange="adjCalc()"><option value="return">↩ Return (bottle back to stock, sale adjusted)</option><option value="replacement">🔁 Replacement (return + give other bottle types — money realigns)</option></select></div>
      <div class="field"><label>Qty returned from THIS purchase</label><input name="qty" id="adjMainQty" type="number" step="1" value="${Math.min(1, remain)}" required oninput="adjCalc()"><small class="field-hint">max ${remain} returnable bottle(s) — set 0 when only older transactions are being returned below. [FIX 54] No native min/max here on purpose: over-limit entries fall through to the explicit validation message below.</small></div>
      <div class="field"><label>＋ Return bottles from another ${escH(s.customer)} transaction (optional)</label>
        <div class="treat-typeahead"><input id="adjOtherInput" autocomplete="off" placeholder="Search this customer's transactions — boar, batch or date…" oninput="adjOtherFilter(this.value)" onfocus="adjOtherFilter(this.value)" onblur="setTimeout(adjOtherClose,180)"><div id="adjOtherSug" class="semen-suggestions treat-sug"></div></div>
        <div id="adjOtherList" class="adj-lines"></div>
      </div>
      <div class="field"><label>🔁 Replacement / additional items taken (from semen inventory)</label>
        <div class="treat-typeahead"><input id="adjGiveInput" autocomplete="off" placeholder="Search semen batches to give — boar, breed or batch no…" oninput="adjGiveFilter(this.value)" onfocus="adjGiveFilter(this.value)" onblur="setTimeout(adjGiveClose,180)"><div id="adjGiveSug" class="semen-suggestions treat-sug"></div></div>
        <small class="field-hint">required for a Replacement; optional on a Return (customer takes extra stock — the charges go onto this sale's balance)</small>
        <div id="adjGiveList" class="adj-lines"></div>
      </div>
      <div class="field"><label>Note</label><input name="note" placeholder="Reason / straw lot replaced…"></div>
      <div class="adj-recon" id="adjRecon"></div>
      <p class="field-hint">Every line is saved with an automatic date &amp; time stamp; POS sales and collectibles realign to the new balance.</p>
      <div class="form-error" id="adjErr"></div>
      <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('semenAdjustModal').remove()">Cancel</button><button class="btn">Log entry</button></div></form></div>`);
    adjCalc();
  }

  /* ── other-transaction returns (same customer) ───────────────────────── */
  function otherCandidates() {
    const s = findSale(adjState?.mainId);
    if (!s) return [];
    return (F().semenSales || []).filter(t => t.id !== s.id && String(t.customer || '').trim().toLowerCase() === String(s.customer || '').trim().toLowerCase() && saleRemain(t) > 0)
      .filter(t => !adjState.extra.some(x => x.saleId === t.id));
  }
  function adjOtherFilter(q) {
    let box = document.getElementById('adjOtherSug');
    if (!box) return;
    const term = String(q || '').trim().toLowerCase(),
      hits = otherCandidates().filter(t => !term || (t.boar + ' ' + (t.breed || '') + ' ' + (t.semen_batch_no || '') + ' ' + t.date).toLowerCase().includes(term));
    adjState.curOther = hits;
    box.innerHTML = hits.length
      ? hits.map((t, i) => {
        const bal = Math.max(0, (+t.amount || 0) - (+t.paid || 0));
        return `<button type="button" onmousedown="adjOtherPick(${i})"><span><b>${escH(t.boar)}</b><small>${escH(t.breed || '—')} · ${escH(t.semen_batch_no || 'batch')}</small></span><span class="treat-sug-heads">🗓 ${fmtDate(t.date)} · ${t.qty} bought · <b>${saleRemain(t)} returnable</b>${bal > 0 ? ` · 💰 collectible ${peso(bal)}` : ''}</span></button>`;
      }).join('')
      : `<div class="suggestion-empty">${term ? 'No matching transaction.' : 'No other transaction with returnable bottles for this customer.'}</div>`;
    box.classList.add('open');
    box.style.display = 'block';
  }
  function adjOtherPick(i) {
    const t = adjState.curOther[i];
    if (!t) return;
    adjState.extra.push({ saleId: t.id, qty: 1 });
    document.getElementById('adjOtherInput').value = '';
    adjOtherClose();
    renderAdjExtras();
    adjCalc();
  }
  function adjOtherClose() { let b = document.getElementById('adjOtherSug'); if (b) { b.classList.remove('open'); b.style.display = 'none'; } }
  function adjOtherQty(saleId, v) { const x = adjState.extra.find(y => y.saleId === saleId); if (x) x.qty = Math.floor(num(v) || 0); adjCalc(); }
  function adjOtherRemove(saleId) { adjState.extra = adjState.extra.filter(x => x.saleId !== saleId); renderAdjExtras(); adjCalc(); }
  function renderAdjExtras() {
    const box = document.getElementById('adjOtherList');
    if (!box) return;
    box.innerHTML = adjState.extra.map(x => {
      const t = findSale(x.saleId);
      if (!t) return '';
      return `<div class="adj-card"><div class="adj-card-title">↩ also return from an earlier purchase <button type="button" class="adj-x" onclick="adjOtherRemove('${t.id}')" title="Remove">×</button></div>
        <b>${escH(t.boar)}</b> ${escH(t.breed || '—')} · batch ${escH(t.semen_batch_no || '—')}<br>
        <span>🗓 bought ${fmtDate(t.date)} · ${t.qty} bottle(s) × ${peso(t.price)} · ${saleRemain(t)} returnable</span>
        <div class="adj-qty-row"><label>Qty to return</label><input type="number" step="1" value="${x.qty}" oninput="adjOtherQty('${t.id}', this.value)"><span>× ${peso(t.price)} = <b id="adj-cred-${t.id}"></b></span></div>
      </div>`;
    }).join('');
    adjState.extra.forEach(x => {
      const t = findSale(x.saleId), el = document.getElementById('adj-cred-' + x.saleId);
      if (t && el) el.textContent = peso((x.qty || 0) * (+t.price || 0));
    });
  }

  /* ── replacement / additional items from inventory ───────────────────── */
  function giveCandidates() {
    return (F().semen || []).map((x, i) => x.deleted_at ? null : ({ idx: i, boar: x.boar_name || x.boar || 'Boar', batch: x.semen_batch_no || x.batch_no || 'batch', breed: x.breed || '', stock: +(x.available_bottles ?? x.bottles ?? 0), lastPrice: lastPriceOf(i) }))
      .filter(Boolean).filter(c => c.stock > 0 && !adjState.gives.some(g => g.idx === c.idx));
  }
  function adjGiveFilter(q) {
    let box = document.getElementById('adjGiveSug');
    if (!box) return;
    const term = String(q || '').trim().toLowerCase(),
      hits = giveCandidates().filter(c => !term || (c.boar + ' ' + c.breed + ' ' + c.batch).toLowerCase().includes(term));
    adjState.curGive = hits;
    box.innerHTML = hits.length
      ? hits.map((c, i) => `<button type="button" onmousedown="adjGivePick(${i})"><span><b>${escH(c.boar)}</b><small>${escH(c.breed || '—')} · ${escH(c.batch)}</small></span><span class="treat-sug-heads">${c.stock} bottle(s) on hand${c.lastPrice ? ' · last sold ' + peso(c.lastPrice) : ''}</span></button>`).join('')
      : `<div class="suggestion-empty">${term ? 'No semen batch matches.' : 'No semen stock available to give.'}</div>`;
    box.classList.add('open');
    box.style.display = 'block';
  }
  function adjGivePick(i) {
    const c = adjState.curGive[i];
    if (!c) return;
    adjState.gives.push({ idx: c.idx, qty: 1, price: c.lastPrice ?? 0 });
    document.getElementById('adjGiveInput').value = '';
    adjGiveClose();
    renderAdjGives();
    adjCalc();
  }
  function adjGiveClose() { let b = document.getElementById('adjGiveSug'); if (b) { b.classList.remove('open'); b.style.display = 'none'; } }
  function adjGiveQty(idx, v) { const g = adjState.gives.find(y => y.idx === idx); if (g) g.qty = Math.floor(num(v) || 0); adjCalc(); }
  function adjGivePrice(idx, v) { const g = adjState.gives.find(y => y.idx === idx); if (g) g.price = Math.max(0, num(v) || 0); adjCalc(); }
  function adjGiveRemove(idx) { adjState.gives = adjState.gives.filter(g => g.idx !== idx); renderAdjGives(); adjCalc(); }
  function renderAdjGives() {
    const box = document.getElementById('adjGiveList');
    if (!box) return;
    box.innerHTML = adjState.gives.map(g => {
      const c = giveCandidates().find(z => z.idx === g.idx) || (() => { const x = (F().semen || [])[g.idx]; return x ? { idx: g.idx, boar: x.boar_name || x.boar || 'Boar', batch: x.semen_batch_no || 'batch', breed: x.breed || '', stock: +(x.available_bottles ?? x.bottles ?? 0) } : null; })();
      if (!c) return '';
      return `<div class="adj-card adj-give"><div class="adj-card-title">🔁 give / sell as replacement <button type="button" class="adj-x" onclick="adjGiveRemove(${g.idx})" title="Remove">×</button></div>
        <b>${escH(c.boar)}</b> ${escH(c.breed || '—')} · batch ${escH(c.batch)} · ${c.stock} on hand
        <div class="adj-qty-row"><label>Qty</label><input type="number" step="1" value="${g.qty}" oninput="adjGiveQty(${g.idx}, this.value)"><label>₱/bottle</label><input type="number" min="0" step="0.01" value="${g.price}" oninput="adjGivePrice(${g.idx}, this.value)"></div>
      </div>`;
    }).join('');
  }

  /* ── live reconciliation preview ─────────────────────────────────────── */
  function adjTotals() {
    const s = findSale(adjState?.mainId), f = document.querySelector('#semenAdjustModal form'),
      d = f ? Object.fromEntries(new FormData(f)) : {},
      mainQ = Math.min(Math.floor(num(d.qty) || 0), s ? saleRemain(s) : 0),
      credMain = s ? mainQ * (+s.price || 0) : 0,
      credExtra = adjState ? adjState.extra.reduce((a, x) => { const t = findSale(x.saleId); return a + (t ? Math.min(x.qty || 0, saleRemain(t)) * (+t.price || 0) : 0); }, 0) : 0,
      charge = adjState ? adjState.gives.reduce((a, g) => a + (g.qty || 0) * (g.price || 0), 0) : 0;
    return { mainQ, credit: credMain + credExtra, charge, retCount: mainQ + (adjState ? adjState.extra.reduce((a, x) => a + Math.max(0, x.qty || 0), 0) : 0) };
  }
  function adjCalc() {
    const el = document.getElementById('adjRecon');
    if (!el) return;
    const t = adjTotals(), net = t.charge - t.credit,
      kind = document.querySelector('#semenAdjustModal [name="kind"]')?.value;
    el.innerHTML = t.credit || t.charge
      ? `Return credit <b>−${peso(t.credit)}</b> · Items given <b>＋${peso(t.charge)}</b> · Net <b class="${net > 0 ? 'adj-net-up' : net < 0 ? 'adj-net-down' : ''}">${net > 0 ? '+' : net < 0 ? '−' : '±'}${peso(Math.abs(net))}</b><small>${net > 0 ? 'collectible increases (charged onto this sale)' : net < 0 ? 'customer pays less (credit applied)' : 'even swap — balance unchanged'}</small>`
      : `No money movement yet — add return quantities or replacement items.${kind === 'replacement' ? ' <b>Replacement requires at least one item below.</b>' : ''}`;
    renderAdjExtras();
  }

  async function saveSemenAdjust(e, id) {
    e.preventDefault();
    const err = document.getElementById('adjErr'),
      show = m => { err.textContent = m; err.classList.add('show'); };
    err.classList.remove('show');
    const d = Object.fromEntries(new FormData(e.target)),
      s = findSale(id),
      kind = d.kind === 'replacement' ? 'replacement' : 'return';
    if (!s || !adjState) return;
    try {
      const mainQ = Math.floor(num(d.qty) || 0);
      if (mainQ < 0 || mainQ > saleRemain(s)) throw new Error(`This purchase has only ${saleRemain(s)} returnable bottle(s).`);
      adjState.extra.forEach(x => {
        const t = findSale(x.saleId);
        if (!t) throw new Error('One selected transaction no longer exists.');
        if (!(x.qty >= 0) || x.qty > saleRemain(t)) throw new Error(`${t.boar} (${fmtDate(t.date)}) has only ${saleRemain(t)} returnable bottle(s).`);
      });
      if (kind === 'replacement' && !adjState.gives.some(g => g.qty > 0))
        throw new Error('A replacement must give the customer at least one replacement item — add it below, or switch the type back to Return.');
      adjState.gives.forEach(g => {
        const cands = (F().semen || [])[g.idx],
          stock = cands ? +(cands.available_bottles ?? cands.bottles ?? 0) : 0;
        if (!cands) throw new Error('One selected semen batch no longer exists.');
        if (g.qty < 1) throw new Error(`Set a quantity for ${cands.boar_name || cands.boar || 'the chosen batch'} (or remove the line).`);
        if (g.qty > stock) throw new Error(`Only ${stock} bottle(s) on hand for ${cands.boar_name || cands.boar} (${cands.semen_batch_no || 'batch'}).`);
      });
      if (mainQ + adjState.extra.reduce((a, x) => a + (x.qty || 0), 0) < 1 && !adjState.gives.length)
        throw new Error('Nothing to log — enter at least one returned bottle or one item given.');

      const at = new Date().toISOString(),
        lines = [], gives = [];
      /* credits — every touched sale realigns (stock back + money mirrors) */
      let credit = 0;
      if (mainQ > 0) {
        const c = applyReturnLine(s, mainQ);
        credit += c;
        lines.push({ sale_id: s.id, boar: s.boar, breed: s.breed, batch: s.semen_batch_no, sale_date: s.date, qty: mainQ, unit_price: +s.price || 0, credit: c, main: true });
      }
      adjState.extra.filter(x => (x.qty || 0) > 0).forEach(x => {
        const t = findSale(x.saleId), c = applyReturnLine(t, x.qty);
        credit += c;
        lines.push({ sale_id: t.id, boar: t.boar, breed: t.breed, batch: t.semen_batch_no, sale_date: t.date, qty: x.qty, unit_price: +t.price || 0, credit: c, main: false });
        syncSaleMoney(t); /* this sale is fully mutated by its return line */
        /* leave a compact reference on that sale too (renders in its receipt) */
        (t.returns = t.returns || []).push({ id: 'adjx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5), kind, qty: x.qty, note: (String(d.note || '').trim() ? String(d.note || '').trim() + ' · ' : '') + `logged with the ${s.boar} → ${s.customer} adjustment`, at, via: s.id });
      });
      /* charges — replacement items leave stock and are charged onto THIS sale */
      let charge = 0;
      adjState.gives.filter(g => g.qty > 0).forEach(g => {
        const x = semenRec(g.idx), ch = g.qty * (+g.price || 0);
        if (x.available_bottles !== undefined) x.available_bottles = Math.max(0, x.available_bottles - g.qty);
        if (x.bottles !== undefined) x.bottles = Math.max(0, x.bottles - g.qty);
        charge += ch;
        gives.push({ semen_index: g.idx, boar: x.boar_name || x.boar || '', breed: x.breed || '', batch: x.semen_batch_no || '', qty: g.qty, unit_price: +g.price || 0, charge: ch });
      });
      if (charge > 0) {
        s.charged_extra = (+s.charged_extra || 0) + charge;
        s.amount = Math.max(0, (+s.amount || 0) + charge);
      }
      syncSaleMoney(s);
      const totalRet = lines.reduce((a, l) => a + l.qty, 0);
      s.returns = s.returns || [];
      s.returns.push({ id: 'adj-' + Date.now(), kind, qty: totalRet, note: String(d.note || '').trim(), at, lines, gives, credit, charge, net: charge - credit, balance_after: s.balance });
      save();
      const sync = await verifySemenCloudSave(`semen return/replacement ${id}`);
      if (!sync.success) preserveSemenRecovery('semen return/replacement awaiting cloud verification');
      document.getElementById('semenAdjustModal')?.remove();
      adjState = null;
      renderAll();
      if (sync.success) {
        toast(`${kind === 'replacement' ? '🔁 Replacement' : '↩ Return'} logged and cloud-verified — ${totalRet} back to stock${gives.length ? ` · ${gives.reduce((a, g) => a + g.qty, 0)} given` : ''}`);
      } else {
        toast(`✓ ${kind === 'replacement' ? 'Replacement' : 'Return'} saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
        window.updateSyncIndicator?.('pending', 'Semen adjustment pending', sync.reason || 'The stock change remains safely local until verified.');
      }
      document.getElementById('semenReceipt')?.remove();
      openSemenReceipt(id); /* re-render the receipt with the new reference */
    } catch (ex) {
      show(ex.message || 'Could not log the entry.');
    }
  }

  /* ── [REBUILD FIX 54] partial / installment payments ───────────────────
     "💰 Payment" (on the receipt AND on every open sale in the POS
     collectibles panel) books money against the running balance. The
     amount defaults to the FULL balance so settling is one tap, but any
     smaller amount is accepted as a partial payment. Every payment is
     kept with its date, note and an automatic time stamp, prints on the
     receipt (and the 58 mm Bluetooth slip), and realigns the sale's POS
     Sales + Financials mirrors so collectibles are correct everywhere. */
  function openSemenPayment(id) {
    const s = findSale(id);
    if (!s) return;
    const bal = Math.max(0, (+s.amount || 0) - (+s.paid || 0));
    if (bal <= 0) { toast('✔ This sale is already fully settled.'); return; }
    document.getElementById('semenPayModal')?.remove();
    const today = new Date().toISOString().slice(0, 10);
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="semenPayModal"><form class="due-modal semen-pay" onsubmit="saveSemenPayment(event,'${id}')"><div class="modal-top"><div><div class="eyebrow">💰 PAYMENT — SEMEN SALE</div><h2>${escH(s.boar)} → ${escH(s.customer)}</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('semenPayModal').remove()">×</button></div>
      <div class="adj-card"><div class="adj-card-title">📋 Account standing</div>
        <span>Billed <b>${peso(s.amount)}</b> · paid so far <b>${peso(s.paid)}</b> · collectible <b class="sb-bal">${peso(bal)}</b></span>
        ${(s.payments || []).length ? `<div class="pay-history">${s.payments.map(p => `<div class="rc-line rc-dim">💰 ${peso(p.amount)} · ${fmtDate(p.date)}${p.note ? ' · ' + escH(p.note) : ''} · ${new Date(p.at).toLocaleString('en-PH')}</div>`).join('')}</div>` : '<span class="muted" style="display:block;margin-top:4px">No payments recorded on this sale yet.</span>'}
      </div>
      <div class="reminder-fields" style="margin-top:10px">
        <div class="field"><label>Amount received (₱) *</label><input name="amount" type="number" min="0.01" max="${bal}" step="0.01" value="${bal}" required><small class="field-hint">defaults to the full ${peso(bal)} balance — type a smaller amount for a partial payment</small></div>
        <div class="field"><label>Payment date</label><input name="date" type="date" value="${today}" required></div>
        <div class="field full"><label>Note</label><input name="note" value="Partial payment" placeholder="e.g. Partial payment · full settlement"></div>
      </div>
      <div class="form-error" id="payErr"></div>
      <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('semenPayModal').remove()">Cancel</button><button class="btn">💰 Save payment</button></div>
    </form></div>`);
  }

  async function saveSemenPayment(e, id) {
    e.preventDefault();
    const err = document.getElementById('payErr'),
      show = m => { err.textContent = m; err.classList.add('show'); };
    err.classList.remove('show');
    const d = Object.fromEntries(new FormData(e.target)), s = findSale(id);
    if (!s) return;
    try {
      const bal = Math.max(0, (+s.amount || 0) - (+s.paid || 0));
      if (bal <= 0) throw new Error('This sale is already fully settled.');
      let amt = num(d.amount);
      if (amt === null || amt <= 0) throw new Error('Enter the amount actually received.');
      if (amt > bal) amt = bal; /* never over-collect: cap at the balance */
      (s.payments = s.payments || []).push({ id: 'pay-' + Date.now(), amount: amt, date: d.date || new Date().toISOString().slice(0, 10), note: String(d.note || '').trim(), at: new Date().toISOString() });
      s.paid = Math.min(+s.amount || 0, (+s.paid || 0) + amt);
      s.balance = Math.max(0, (+s.amount || 0) - (+s.paid || 0));
      /* mirrors realign — POS Sales + Financials follow the new paid amount */
      let pos = (F().sales || []).find(p => p.id === s.pos_id);
      if (pos) pos.paid = s.paid;
      let tx = (F().transactions || []).find(x => x.id === s.tx_id);
      if (tx) tx.paid = s.paid;
      save();
      const sync = await verifySemenCloudSave(`semen sale payment ${id}`);
      if (!sync.success) preserveSemenRecovery('semen sale payment awaiting cloud verification');
      document.getElementById('semenPayModal')?.remove();
      renderAll();
      if (sync.success) toast(s.balance === 0 ? `✔ Fully settled and cloud-verified — ${s.customer} paid the last ${peso(amt)}` : `✔ Payment ${peso(amt)} recorded and cloud-verified — ${peso(s.balance)} still collectible from ${s.customer}`);
      else {
        toast(`✓ Payment saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
        window.updateSyncIndicator?.('pending', 'Semen payment pending', sync.reason || 'The payment remains safely local until verified.');
      }
      document.getElementById('semenReceipt')?.remove();
      openSemenReceipt(id); /* receipt re-renders with the payments log */
    } catch (ex) {
      show(ex.message || 'Could not record the payment.');
    }
  }

  /* ── [REBUILD FIX 54 ENHANCED] SEMEN COLLECTIBLES & CUSTOMER ACCOUNT SETTLEMENT ──
     • Clickable "collectible ₱XX,XXX" banner opens Consolidated Account Payment Modal.
     • Supports Partial Payment with automated FIFO allocation across oldest invoices.
     • 58mm Bluetooth Thermal POS Statement Receipt printing.
     • Collapsible & Expandable: shows first 3 latest sales by default with
       "▾ Show N older sales" toggle button. */

  function posCollectiblesPanel() {
    const open = (F().semenSales || []).filter(s => Math.max(0, (+s.amount || 0) - (+s.paid || 0)) > 0)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    if (!open.length)
      return `<div class="notice sb-coll"><div class="sb-coll-head"><div><b>💰 Semen collectibles</b><span>All settled — no branch owes anything on semen sales right now.</span></div></div></div>`;

    const total = open.reduce((a, s) => a + Math.max(0, (+s.amount || 0) - (+s.paid || 0)), 0),
      byCust = new Map();

    open.forEach(s => {
      const k = String(s.customer || "Unknown").trim();
      if (!byCust.has(k)) byCust.set(k, []);
      byCust.get(k).push(s);
    });

    const cards = [...byCust.entries()]
      .sort((a, b) => b[1].reduce((x, s) => x + Math.max(0, (+s.amount || 0) - (+s.paid || 0)), 0) - a[1].reduce((x, s) => x + Math.max(0, (+s.amount || 0) - (+s.paid || 0)), 0))
      .map(([cust, arr], custIdx) => {
        const cBal = arr.reduce((a, s) => a + Math.max(0, (+s.amount || 0) - (+s.paid || 0)), 0);
        const custId = "cust-coll-" + custIdx;
        const visibleSales = arr.slice(0, 3);
        const hiddenSales = arr.slice(3);
        const hasMore = hiddenSales.length > 0;
        const hiddenBal = hiddenSales.reduce((a, s) => a + Math.max(0, (+s.amount || 0) - (+s.paid || 0)), 0);
        const safeCustParam = encodeURIComponent(cust);

        const renderSale = s => {
          const bal = Math.max(0, (+s.amount || 0) - (+s.paid || 0));
          return `<div class="sb-sale"><div class="sb-sale-info"><b>${escH(s.boar)}</b> ${escH(s.breed || "—")} · ${escH(s.semen_batch_no || "batch")} × ${s.qty}<br><small>🗓 ${fmtDate(s.date)} · billed ${peso(s.amount)} · paid ${peso(s.paid)} · <b class="sb-bal">balance ${peso(bal)}</b></small></div><div class="sb-actions"><button type="button" class="btn ghost" onclick="openSemenReceipt('${s.id}')">🧾 Receipt</button><button type="button" class="btn ghost" onclick="openSemenPayment('${s.id}')">💰 Payment</button></div></div>`;
        };

        return `
          <div class="sb-cust" id="${custId}">
            <div class="sb-cust-head clickable-cust-head" onclick="window.openCustomerConsolidatedPayment(decodeURIComponent('${safeCustParam}'))" title="Tap to settle balance or print customer statement">
              <div>
                <b>🏪 ${escH(cust)}</b>
                <span class="cust-sub-line">${arr.length} open sale(s) · <span class="tap-settle-hint">Tap to settle account ➔</span></span>
              </div>
              <div class="sb-head-right">
                <b class="sb-bal-badge">collectible ${peso(cBal)}</b>
                <span class="pay-chip-btn">💰 Settle Account</span>
              </div>
            </div>
            <div class="sb-sales-container">
              ${visibleSales.map(renderSale).join("")}
              ${hasMore ? `
                <div class="sb-hidden-sales" style="display:none">
                  ${hiddenSales.map(renderSale).join("")}
                </div>
                <div class="sb-expand-tray">
                  <button type="button" class="btn ghost small sb-toggle-btn" data-orig-text="▾ Show ${hiddenSales.length} older sales (${peso(hiddenBal)})" onclick="window.toggleCustomerSales(this, '${custId}')">
                    ▾ Show ${hiddenSales.length} older sales (${peso(hiddenBal)})
                  </button>
                </div>
              ` : ""}
            </div>
          </div>
        `;
      }).join("");

    return `<div class="notice sb-coll sb-coll-open"><div class="sb-coll-head"><div><b>💰 Semen collectibles</b><span>Per-branch balances still owed — tap any customer balance to settle or print statement</span></div><b class="sb-total">${peso(total)} outstanding</b></div>${cards}</div>`;
  }

  // Toggle expand / collapse customer sales
  window.toggleCustomerSales = function(btn, custId) {
    const card = document.getElementById(custId);
    if (!card) return;
    const hiddenWrap = card.querySelector(".sb-hidden-sales");
    if (!hiddenWrap) return;
    const isHidden = hiddenWrap.style.display === "none";
    hiddenWrap.style.display = isHidden ? "block" : "none";
    const origText = btn.dataset.origText || "▾ Show older sales";
    btn.textContent = isHidden ? "▴ Show less (hide older sales)" : origText;
  };

  // Open Consolidated Customer Account Payment Modal
  window.openCustomerConsolidatedPayment = function(customerName) {
    document.getElementById("custConsolidatedPayModal")?.remove();

    const openSales = (F().semenSales || []).filter(s => String(s.customer || "").trim() === String(customerName).trim() && Math.max(0, (+s.amount || 0) - (+s.paid || 0)) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    if (!openSales.length) {
      if (window.toast) window.toast(`✔ ${customerName} has no outstanding balances.`);
      return;
    }

    const totalBilled = openSales.reduce((a, s) => a + (+s.amount || 0), 0);
    const totalPaid = openSales.reduce((a, s) => a + (+s.paid || 0), 0);
    const totalCollectible = Math.max(0, totalBilled - totalPaid);
    const today = new Date().toISOString().slice(0, 10);
    const safeCust = escH(customerName);
    const safeCustParam = encodeURIComponent(customerName);

    const modalHTML = `
      <div class="due-modal-bg" id="custConsolidatedPayModal">
        <form class="due-modal cust-consolidated-pay" onsubmit="window.saveCustomerConsolidatedPayment(event, decodeURIComponent('${safeCustParam}'))">
          <div class="modal-top">
            <div>
              <div class="eyebrow">ACCOUNT SETTLEMENT &amp; RECEIPT</div>
              <h2>🏪 ${safeCust}</h2>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('custConsolidatedPayModal').remove()">×</button>
          </div>

          <div class="cust-balance-hero">
            <div class="cb-stat"><small>Open Invoices</small><b>${openSales.length} sales</b></div>
            <div class="cb-stat"><small>Total Billed</small><b>${peso(totalBilled)}</b></div>
            <div class="cb-stat"><small>Paid So Far</small><b>${peso(totalPaid)}</b></div>
            <div class="cb-stat total"><small>Total Outstanding</small><b class="cb-total-num">${peso(totalCollectible)}</b></div>
          </div>

          <div class="fc-subhead" style="margin-top:14px"><b>Itemized open invoices (${openSales.length} lines)</b><small class="muted">Payments automatically settle oldest invoices first (FIFO)</small></div>
          <div class="cust-sales-scroll">
            <table class="cust-sales-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item / Boar</th>
                  <th>Billed</th>
                  <th>Paid</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                ${openSales.map((s, i) => {
                  const bal = Math.max(0, (+s.amount || 0) - (+s.paid || 0));
                  return `
                    <tr>
                      <td><small>${fmtDate(s.date)}</small></td>
                      <td><b>${escH(s.boar)}</b> <small>(${escH(s.breed || "—")} × ${s.qty})</small></td>
                      <td>${peso(s.amount)}</td>
                      <td>${peso(s.paid)}</td>
                      <td><b class="sb-bal">${peso(bal)}</b></td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>

          <div class="reminder-fields" style="margin-top:14px">
            <div class="form-grid-2">
              <div class="field">
                <label>Amount Received (₱) *</label>
                <input name="amount" type="number" min="0.01" max="${totalCollectible}" step="0.01" value="${totalCollectible}" required>
                <small class="field-hint">Defaults to full ${peso(totalCollectible)} — enter any partial amount</small>
              </div>

              <div class="field">
                <label>Payment Date *</label>
                <input name="date" type="date" value="${today}" required>
              </div>
            </div>

            <div class="field full">
              <label>Payment Method / Reference Note</label>
              <input name="note" value="Account settlement" placeholder="e.g. Full settlement, Cash, GCash ref #12345...">
            </div>
          </div>

          <!-- DIRECT BLUETOOTH PRINTER CONTROL PANEL (Scan & Connect + Print via Bluetooth) -->
          <div class="bt-panel no-print" style="margin-top:14px">
            <div class="eyebrow">DIRECT BLUETOOTH PRINTER</div>
            <div id="btCustStatus" class="bt-status">No printer connected yet — tap 🔍 Scan &amp; connect.</div>
            <div class="bt-row">
              <button type="button" class="btn ghost" id="btCustScanBtn" onclick="btScanPrinter()">🔍 Scan &amp; connect</button>
              <button type="button" class="btn" id="btCustPrintBtn" onclick="window.btPrintCustStatement()">🖨 Print via Bluetooth</button>
              <button type="button" class="btn ghost" id="btCustDiscBtn" style="display:none" onclick="btDisconnect()">Disconnect</button>
            </div>
            <p class="rc-hint" style="margin:0">💡 Connects directly to PT210, MPT-II or 58mm BLE POS thermal printers to stream this statement.</p>
          </div>

          <div class="form-error" id="custPayErr"></div>

          <div class="due-actions" style="margin-top:14px">
            <button type="button" class="btn ghost" onclick="window.printCustomerStatement(decodeURIComponent('${safeCustParam}'))">🖨️ Print Statement (Phone Dialog)</button>
            <button type="button" class="btn ghost" onclick="document.getElementById('custConsolidatedPayModal').remove()">Cancel</button>
            <button type="submit" class="btn">💰 Process Payment</button>
          </div>
        </form>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHTML);
    lastStatementCustomer = customerName;
    btUi();
  };

  window.saveCustomerConsolidatedPayment = function(e, customerName) {
    e.preventDefault();
    const form = e.target;
    const err = document.getElementById("custPayErr");
    if (err) err.classList.remove("show");

    const amountInput = parseFloat(form.amount.value || "0");
    const payDate = form.date.value || new Date().toISOString().slice(0, 10);
    const payNote = form.note.value.trim() || "Account payment";

    if (isNaN(amountInput) || amountInput <= 0) {
      if (err) { err.textContent = "Please enter a valid payment amount."; err.classList.add("show"); }
      return;
    }

    const openSales = (F().semenSales || []).filter(s => String(s.customer || "").trim() === String(customerName).trim() && Math.max(0, (+s.amount || 0) - (+s.paid || 0)) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    let remainingPayment = amountInput;
    let settledCount = 0;

    for (const s of openSales) {
      if (remainingPayment <= 0) break;

      const saleBal = Math.max(0, (+s.amount || 0) - (+s.paid || 0));
      const payThisSale = Math.min(saleBal, remainingPayment);

      (s.payments = s.payments || []).push({
        id: "pay-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5),
        amount: payThisSale,
        date: payDate,
        note: `${payNote} (Account payment: ${peso(amountInput)})`,
        at: new Date().toISOString()
      });

      s.paid = Math.min(+s.amount || 0, (+s.paid || 0) + payThisSale);
      s.balance = Math.max(0, (+s.amount || 0) - (+s.paid || 0));

      const pos = (F().sales || []).find(p => p.id === s.pos_id);
      if (pos) pos.paid = s.paid;
      const tx = (F().transactions || []).find(x => x.id === s.tx_id);
      if (tx) tx.paid = s.paid;

      if (s.balance === 0) settledCount++;
      remainingPayment -= payThisSale;
    }

    if (window.save && typeof window.save === "function") window.save();
    document.getElementById("custConsolidatedPayModal")?.remove();
    if (window.renderAll && typeof window.renderAll === "function") window.renderAll();

    const remainingBal = Math.max(0, openSales.reduce((a, s) => a + Math.max(0, (+s.amount || 0) - (+s.paid || 0)), 0));

    if (window.toast) {
      window.toast(remainingBal === 0
        ? `✔ Fully settled! ${customerName} paid ${peso(amountInput)} (${settledCount} invoices cleared)`
        : `✔ Payment ${peso(amountInput)} recorded! ${peso(remainingBal)} remaining for ${customerName}`);
    }

    window.printCustomerStatement(customerName, amountInput, payNote);
  };

  // Print 58mm Bluetooth Thermal Statement Receipt
  window.printCustomerStatement = function(customerName, lastPaidAmount, lastPaidNote) {
    document.getElementById("customerStatementSlip")?.remove();

    const allSales = (F().semenSales || []).filter(s => String(s.customer || "").trim() === String(customerName).trim())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    if (!allSales.length) return;

    const farm = F();
    const totalBilled = allSales.reduce((a, s) => a + (+s.amount || 0), 0);
    const totalPaid = allSales.reduce((a, s) => a + (+s.paid || 0), 0);
    const totalBalance = Math.max(0, totalBilled - totalPaid);
    const now = new Date();

    const slipHTML = `
      <div class="drill-bg" id="customerStatementSlip">
        <div class="pos-receipt">
          <button class="close-reminder" onclick="document.getElementById('customerStatementSlip').remove()">×</button>
          
          <div class="rc-print-area">
            <div class="rc-head">
              <h2>${escH(farm.name || "RM'S HOG FARM")}</h2>
              <p>${escH(farm.address || farm.barangay || "Farm Operations")}</p>
              <div class="rc-title">STATEMENT OF ACCOUNT / RECEIPT</div>
            </div>

            <div class="rc-meta-block">
              <div>Customer: <b>${escH(customerName)}</b></div>
              <div>Date: ${now.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })} ${now.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>

            <div class="rc-divider">--------------------------------</div>
            <div class="rc-sec-title">ITEMIZED INVOICES:</div>

            <div class="rc-items">
              ${allSales.map(s => {
                const bal = Math.max(0, (+s.amount || 0) - (+s.paid || 0));
                return `
                  <div class="rc-item-line">
                    <span>${fmtDate(s.date)} · ${escH(s.boar)} ×${s.qty}</span>
                    <b>${peso(s.amount)}</b>
                  </div>
                  <div class="rc-sub-line">
                    <span>Paid: ${peso(s.paid)} · Bal: ${peso(bal)}</span>
                  </div>
                `;
              }).join("")}
            </div>

            <div class="rc-divider">--------------------------------</div>

            <div class="rc-total-block">
              <div class="rc-trow"><span>TOTAL BILLED:</span> <b>${peso(totalBilled)}</b></div>
              <div class="rc-trow"><span>TOTAL PAID:</span> <b>${peso(totalPaid)}</b></div>
              ${lastPaidAmount ? `<div class="rc-trow highlight"><span>PAYMENT RECEIVED:</span> <b>−${peso(lastPaidAmount)}</b></div>` : ""}
              <div class="rc-trow grand"><span>REMAINING BALANCE:</span> <b>${peso(totalBalance)}</b></div>
            </div>

            <div class="rc-divider">--------------------------------</div>

            <div class="rc-foot">
              <p>Thank you for trusting ${escH(farm.name || "our farm")}!<br>Happy Breeding!</p>
            </div>
          </div>

          <div class="rc-actions" style="flex-wrap:wrap;gap:8px">
            <button type="button" class="btn" style="background:#0284c7;color:#fff" onclick="window.btPrintStatement(decodeURIComponent('${encodeURIComponent(customerName)}'), ${lastPaidAmount || 0})">📶 Print via Bluetooth POS</button>
            <button type="button" class="btn ghost" onclick="window.print()">🖨️ Print (Phone Dialog)</button>
            <button type="button" class="btn ghost" onclick="document.getElementById('customerStatementSlip').remove()">Done</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", slipHTML);
  };


  /* ── [REBUILD FIX 43] STOCK-IN — restock existing batch / add new batch ──
     The Semen Inventory drill-down "Quick action" button opens a chooser:
       • 📦 Restock existing batch — add bottles to a batch already on the
         list (new collection, or extra doses bought from another farm for
         the same batch). Every restock is logged with an automatic date &
         time stamp; an optional cost is mirrored to Financial Management as
         a "Semen Purchase" expense.
       • 🧪 Add new semen batch — register a brand-new lot from an on-farm
         boar, or from another farm. Outside sources become lineage
         REFERENCES (never counted as boars — same rule as the insemination
         modal's "Register New Semen Source"). Batch numbers auto-generate
         with the same ABC-YYYYMMDD-001 shape as everywhere else. */
  const uidS = p => p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

  function semenBottleCount(x) { return +(x.available_bottles ?? x.bottles ?? 0); }

  function openSemenDiscardModal() {
    document.getElementById('semenStockMenu')?.remove();
    document.getElementById('semenDiscardModal')?.remove();
    const lots = (F().semen || []).map((lot, index) => ({ lot, index })).filter(x => !x.lot.deleted_at && semenBottleCount(x.lot) > 0);
    if (!lots.length) { toast('No semen bottles are currently available to discard.'); return; }
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="semenDiscardModal"><form class="due-modal" style="text-align:left" onsubmit="saveSemenDiscard(event)"><div class="modal-top"><div><div class="eyebrow">🗑 SEMEN STOCK ADJUSTMENT</div><h2>Discard semen bottles</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('semenDiscardModal')?.remove()">×</button></div><p class="field-hint">Discarded doses are removed from available stock and recorded with a reason. Sales and reseller pickups are not changed.</p><div class="field"><label>Collection batch *</label><select name="lot_index" id="semenDiscardLot">${lots.map(x => `<option value="${x.index}">${escH(x.lot.boar_name || x.lot.boar || 'Semen')} · ${escH(x.lot.semen_batch_no || x.lot.id || 'batch')} · ${semenBottleCount(x.lot)} available</option>`).join('')}</select></div><div class="reminder-fields"><div class="field"><label>Bottles to discard *</label><input name="qty" type="number" min="1" max="${semenBottleCount(lots[0].lot)}" step="1" value="1" required></div><div class="field"><label>Reason *</label><select name="reason"><option>Expired</option><option>Damaged container</option><option>Contaminated / failed quality check</option><option>Temperature excursion</option><option>Lost / broken</option><option>Other</option></select></div></div><div class="field"><label>Notes</label><textarea name="notes" placeholder="Optional discard details"></textarea></div><div class="form-error" id="semenDiscardErr"></div><div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('semenDiscardModal')?.remove()">Cancel</button><button class="btn danger-btn">Discard bottles</button></div></form></div>`);
    const select = document.getElementById('semenDiscardLot');
    select?.addEventListener('change', () => {
      const lot = (F().semen || [])[+select.value];
      const input = document.querySelector('#semenDiscardModal [name="qty"]');
      if (input && lot) { input.max = semenBottleCount(lot); input.value = Math.min(+input.value || 1, semenBottleCount(lot)); }
    });
  }

  async function saveSemenDiscard(e) {
    e.preventDefault();
    const form = e.target;
    const err = document.getElementById('semenDiscardErr');
    err.classList.remove('show');
    try {
      const d = Object.fromEntries(new FormData(form));
      const lot = (F().semen || [])[+d.lot_index];
      if (!lot) throw new Error('Select a valid semen collection batch.');
      const qty = Math.floor(num(d.qty) || 0);
      const available = semenBottleCount(lot);
      if (qty < 1 || qty > available) throw new Error(`Enter a discard quantity from 1 to ${available}.`);
      const remaining = available - qty;
      lot.available_bottles = remaining;
      lot.bottles = remaining;
      lot.discarded_bottles = (+lot.discarded_bottles || 0) + qty;
      lot.discard_history = lot.discard_history || [];
      lot.discard_history.push({ id: 'sd-' + Date.now(), date: new Date().toISOString().slice(0, 10), qty, reason: d.reason, notes: String(d.notes || '').trim(), remaining, at: new Date().toISOString() });
      lot.updated_at = new Date().toISOString();
      save();
      const sync = await verifySemenCloudSave(`semen discard ${lot.semen_batch_no || lot.id || ''}`);
      if (!sync.success) preserveSemenRecovery('semen discard awaiting cloud verification');
      document.getElementById('semenDiscardModal')?.remove();
      renderAll();
      if (window.refreshOpenDrilldown) refreshOpenDrilldown();
      if (sync.success) toast(`🗑 Discarded ${qty} bottle${qty === 1 ? '' : 's'} from ${lot.semen_batch_no || lot.boar_name || lot.boar || 'semen batch'}. ${remaining} remain and cloud-verified.`);
      else {
        toast(`✓ Discard saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
        window.updateSyncIndicator?.('pending', 'Semen discard pending', sync.reason || 'The stock change remains safely local until verified.');
      }
    } catch (error) {
      err.textContent = error.message || 'Could not record the discard.';
      err.classList.add('show');
    }
  }

  function bumpBottles(x, qty) {
    /* the reverse of the sale deduction: grow whichever bottle fields exist */
    if (x.available_bottles !== undefined || x.bottles === undefined)
      x.available_bottles = +(x.available_bottles ?? x.bottles ?? 0) + qty;
    if (x.bottles !== undefined) x.bottles = +(x.bottles ?? 0) + qty;
  }

  function genBatchNo(boarName, dateStr) {
    /* same ABC-YYYYMMDD-001 shape as the insemination modal's generator */
    let lots = F().semen || [],
      prefix = (boarName || 'SEM').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'SEM',
      day = (dateStr || new Date().toISOString().slice(0, 10)).replaceAll('-', ''),
      seq = String(lots.filter(x => String(x.semen_batch_no || x.batch_no || '').startsWith(prefix + '-' + day)).length + 1).padStart(3, '0');
    return `${prefix}-${day}-${seq}`;
  }

  function openSemenStockMenu() {
    document.getElementById('semenStockMenu')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="semenStockMenu"><div class="due-modal" style="text-align:left"><div class="modal-top"><div><div class="eyebrow">SEMEN STOCK — QUICK ACTION</div><h2>Semen stock actions</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('semenStockMenu').remove()">×</button></div>
      <div class="semen-stock-menu">
        <button type="button" onclick="openSemenRestock()"><span class="ss-icon">📦</span><span><b>Restock existing batch</b><small>Add bottles to a batch already on the list — a fresh collection, or extra doses bought from another farm for the same batch.</small></span></button>
        <button type="button" onclick="openSemenNewBatch()"><span class="ss-icon">🧪</span><span><b>Add new semen batch</b><small>Register a brand-new batch — your own boar's collection, or semen bought from another farm (saved as a lineage reference, never counted as a boar).</small></span></button>
        <button type="button" onclick="openSemenDiscardModal()"><span class="ss-icon">🗑</span><span><b>Discard semen bottles</b><small>Record expired, damaged, contaminated, or otherwise unusable doses and deduct them from available stock.</small></span></button>
        <button type="button" onclick="document.getElementById('semenStockMenu')?.remove();document.getElementById('drillModal')?.remove();go('semen')"><span class="ss-icon">📅</span><span><b>Next collection suggestions</b><small>See which active live boars are due or due soon based on their last collection date.</small></span></button>
      </div>
      <p class="field-hint" style="margin-top:12px">💰 To <b>sell</b> semen instead, close this and tap any batch row in the list.</p>
    </div></div>`);
  }

  let curRestockLots = [];

  function openSemenRestock() {
    document.getElementById('semenStockMenu')?.remove();
    document.getElementById('semenRestockModal')?.remove();
    let all = F().semen || [];
    curRestockLots = all.map((x, i) => x.deleted_at ? null : ({ idx: i, boar: x.boar_name || x.boar || 'Boar', batch: x.semen_batch_no || x.batch_no || 'batch', breed: x.breed || '', stock: semenBottleCount(x) })).filter(Boolean);
    if (!curRestockLots.length) { toast('No semen batch yet — register a new batch first.'); openSemenNewBatch(); return; }
    /* [REBUILD FIX 44] the batch picker is an auto-suggest type-ahead (tap to
       list, type to narrow by boar name / batch number / breed) instead of a
       plain dropdown — same interaction as the customer name suggest. */
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="semenRestockModal"><form class="due-modal" style="text-align:left" onsubmit="saveSemenRestock(event)"><div class="modal-top"><div><div class="eyebrow">📦 RESTOCK SEMEN</div><h2>Add bottles to a batch</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('semenRestockModal').remove()">×</button></div>
      <div class="reminder-fields">
        <div class="field full"><label>Semen batch *</label><div class="treat-typeahead"><input id="restockBatchInput" autocomplete="off" placeholder="Type boar name or batch number…" oninput="restockBatchFilter(this.value)" onfocus="restockBatchFilter(this.value)" onblur="setTimeout(restockBatchClose,180)"><input type="hidden" name="idx" id="restockBatchIdx"><div id="restockBatchSug" class="semen-suggestions treat-sug"></div></div><small class="field-hint">Matching batches auto-suggest while you type, with their current stock</small></div>
        <div class="field"><label>Bottles to add *</label><input name="qty" type="number" min="1" step="1" required></div>
        <div class="field"><label>Date</label><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></div>
        <div class="field full"><label>Source / note</label><input name="source" placeholder="Own collection · or the farm bought from…"></div>
        <div class="field"><label>Total cost (₱, optional)</label><input name="cost" type="number" min="0" step="0.01" placeholder="0.00"><small class="field-hint">Logged to Financials as a Semen Purchase expense</small></div>
      </div>
      <div class="form-error" id="restockErr"></div>
      <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('semenRestockModal').remove()">Cancel</button><button class="btn">Save restock</button></div>
    </form></div>`);
  }

  function restockBatchFilter(q) {
    let box = document.getElementById('restockBatchSug'),
      hid = document.getElementById('restockBatchIdx');
    if (!box) return;
    if (hid) hid.value = ''; /* any re-typing must be re-confirmed by a pick */
    let term = String(q || '').trim().toLowerCase(),
      hits = curRestockLots.filter(l => !term || (l.boar + ' ' + l.batch + ' ' + l.breed).toLowerCase().includes(term));
    box.innerHTML = hits.length
      ? hits.map(l => `<button type="button" onmousedown="restockBatchPick(${l.idx})"><b>${escH(l.boar)}</b><span>${escH(l.batch)}${l.breed ? ' · ' + escH(l.breed) : ''} — ${l.stock} bottle(s) on hand</span></button>`).join('')
      : '<div class="suggestion-empty">No matching batch — check the spelling, or add it first via Quick action → Add new semen batch.</div>';
    box.classList.add('open');
    box.style.display = 'block';
  }

  function restockBatchPick(i) {
    let l = curRestockLots.find(x => x.idx === i);
    if (!l) return;
    document.getElementById('restockBatchIdx').value = i;
    document.getElementById('restockBatchInput').value = `${l.boar} · ${l.batch}`;
    restockBatchClose();
  }

  function restockBatchClose() {
    let box = document.getElementById('restockBatchSug');
    if (box) { box.classList.remove('open'); box.style.display = 'none'; }
  }

  async function saveSemenRestock(e) {
    e.preventDefault();
    let d = Object.fromEntries(new FormData(e.target)),
      err = document.getElementById('restockErr');
    err.classList.remove('show');
    try {
      let idxv = d.idx;
      if (idxv === undefined || idxv === '') {
        /* typed but never picked: accept an exact label / batch-no match */
        let t = String(document.getElementById('restockBatchInput')?.value || '').trim().toLowerCase(),
          l = curRestockLots.find(x => `${x.boar} · ${x.batch}`.toLowerCase() === t) || curRestockLots.find(x => String(x.batch).toLowerCase() === t);
        if (l) idxv = String(l.idx);
      }
      if (idxv === undefined || idxv === '') throw new Error('Pick a semen batch from the suggestions.');
      let x = (F().semen || [])[+idxv];
      if (!x) throw new Error('Pick a semen batch from the suggestions.');
      let qty = Math.floor(num(d.qty) || 0),
        cost = Math.max(0, num(d.cost) || 0);
      if (qty < 1) throw new Error('Bottles to add must be at least 1.');
      bumpBottles(x, qty);
      let log = { id: uidS('rs'), date: d.date, qty, cost, source: String(d.source || '').trim(), at: new Date().toISOString() };
      (x.restocks = x.restocks || []).push(log);
      if (cost > 0) {
        log.tx_id = 'tx-' + Date.now();
        (F().transactions = F().transactions || []).push({ id: log.tx_id, date: d.date, type: 'Expense', category: 'Semen Purchase', description: `Restock ${x.semen_batch_no || 'batch'} — ${x.boar_name || x.boar || ''} +${qty} bottle(s)${log.source ? ' · ' + log.source : ''}`, amount: cost, paid: cost });
      }
      save();
      const sync = await verifySemenCloudSave(`semen restock ${x.semen_batch_no || x.id || ''}`);
      if (!sync.success) preserveSemenRecovery('semen restock awaiting cloud verification');
      document.getElementById('semenRestockModal')?.remove();
      renderAll();
      if (window.refreshOpenDrilldown) refreshOpenDrilldown();
      if (sync.success) toast(`✔ Restocked ${x.semen_batch_no || 'batch'} — now ${semenBottleCount(x)} bottle(s), cloud-verified.`);
      else {
        toast(`✓ Restock saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
        window.updateSyncIndicator?.('pending', 'Semen restock pending', sync.reason || 'The stock change remains safely local until verified.');
      }
    } catch (ex) {
      err.textContent = ex.message || 'Could not save the restock.';
      err.classList.add('show');
    }
  }

  let cachedSemenSourceHits = [];

  function filterSemenSourceSuggest(query) {
    const dropdown = document.getElementById('semenSourceDropdown');
    const clearBtn = document.getElementById('semenSourceClear');
    if (!dropdown) return;

    const f = F();
    const boars = f.boars || [];
    const q = String(query || '').trim().toLowerCase();

    if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

    const list = [];
    boars.forEach((b, idx) => {
      const isOwn = !b.lineage_only && (b.status || 'Active') === 'Active' && b.status !== 'Reference';
      const code = b.id || b.tag || b.code || '';
      const hasDistinctCode = code && code !== b.name;
      const displayTitle = hasDistinctCode ? `(${code}) ${b.name}` : b.name;
      list.push({
        idx,
        val: String(idx),
        id: code,
        name: b.name || b.id,
        displayTitle,
        breed: b.breed || 'Boar Stud',
        isOwn,
        title: `${displayTitle} ${b.breed || ''}`,
        sub: `${b.breed || 'Boar'} · ${isOwn ? 'Active Boar on this farm' : 'Lineage Reference'}`
      });
    });

    cachedSemenSourceHits = list.filter(item => {
      if (!q) return true;
      return (item.displayTitle + ' ' + (item.id || '') + ' ' + (item.breed || '') + ' ' + (item.isOwn ? 'Active Boar Farm' : 'Reference')).toLowerCase().includes(q);
    });

    let html = '';
    if (cachedSemenSourceHits.length) {
      html += cachedSemenSourceHits.map((item, hIdx) => `
        <div class="suggest-item" onmousedown="window.selectSemenSourceByIndex(${hIdx})" ontouchstart="window.selectSemenSourceByIndex(${hIdx})" style="cursor:pointer">
          <div class="suggest-ico boar" style="background:${item.isOwn ? '#0d8d91' : '#64748b'};color:#fff">♂</div>
          <div class="suggest-meta">
            <b>${escH(item.displayTitle)}</b>
            <small>${escH(item.breed)} · <span class="badge ${item.isOwn ? 'ok' : ''}" style="font-size:10px">${item.isOwn ? 'Boar on Farm' : 'Lineage Reference'}</span></small>
          </div>
        </div>
      `).join('');
    } else {
      html += `<div class="suggest-empty" style="padding:10px 12px;color:var(--muted);font-size:13px">No boars matching "${escH(q)}".</div>`;
    }

    // Always append outside farm option at the bottom
    html += `
      <div class="suggest-item" onmousedown="window.selectSemenSourceOutside()" ontouchstart="window.selectSemenSourceOutside()" style="border-top:1px dashed var(--line);background:rgba(13,141,145,0.06);margin-top:4px;cursor:pointer">
        <div class="suggest-ico" style="background:#0ea5e9;color:#fff">🌾</div>
        <div class="suggest-meta">
          <b>🌾 Another farm / new outside source…</b>
          <small>Register outside semen without creating an active boar</small>
        </div>
      </div>
    `;

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
  }

  function selectSemenSourceByIndex(hIdx) {
    const item = cachedSemenSourceHits[hIdx];
    if (!item) return;

    const input = document.getElementById('semenSourceInput');
    const hidden = document.getElementById('semenSourceVal');
    const clearBtn = document.getElementById('semenSourceClear');
    const dropdown = document.getElementById('semenSourceDropdown');

    if (input) input.value = `${item.displayTitle}${item.breed ? ' · ' + item.breed : ''}`;
    if (hidden) hidden.value = item.val;
    if (clearBtn) clearBtn.style.display = 'block';
    if (dropdown) dropdown.style.display = 'none';

    semenNewBatchSource(item.val);
  }

  function selectSemenSourceOutside() {
    const input = document.getElementById('semenSourceInput');
    const hidden = document.getElementById('semenSourceVal');
    const clearBtn = document.getElementById('semenSourceClear');
    const dropdown = document.getElementById('semenSourceDropdown');

    if (input) input.value = '🌾 Another farm / new outside source…';
    if (hidden) hidden.value = '__outside';
    if (clearBtn) clearBtn.style.display = 'block';
    if (dropdown) dropdown.style.display = 'none';

    semenNewBatchSource('__outside');
  }

  function clearSemenSourceSuggest() {
    const input = document.getElementById('semenSourceInput');
    const hidden = document.getElementById('semenSourceVal');
    const clearBtn = document.getElementById('semenSourceClear');

    if (input) { input.value = ''; try { input.focus(); } catch (e) {} }
    if (hidden) hidden.value = '';
    if (clearBtn) clearBtn.style.display = 'none';

    semenNewBatchSource('');
    filterSemenSourceSuggest('');
  }

  function openSemenNewBatch(defaultBoar = '') {
    document.getElementById('semenStockMenu')?.remove();
    document.getElementById('semenNewBatchModal')?.remove();
    let boars = F().boars || [];
    let initialVal = '', initialText = '';

    if (defaultBoar !== '' && defaultBoar !== null && defaultBoar !== undefined) {
      let bIdx = -1;
      if (typeof defaultBoar === 'number') {
        bIdx = defaultBoar;
      } else {
        bIdx = boars.findIndex(b => b.id === defaultBoar || b.name === defaultBoar);
      }
      if (bIdx >= 0 && boars[bIdx]) {
        initialVal = String(bIdx);
        initialText = `${boars[bIdx].name}${boars[bIdx].breed ? ' · ' + boars[bIdx].breed : ''}`;
      }
    }

    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="semenNewBatchModal"><form class="due-modal" style="text-align:left" onsubmit="saveSemenNewBatch(event)"><div class="modal-top"><div><div class="eyebrow">🧪 NEW SEMEN BATCH</div><h2>Add semen stock</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('semenNewBatchModal').remove()">×</button></div>
      <div class="reminder-fields">
        <div class="field full suggest-field" style="position:relative">
          <label>Semen source * <small class="field-hint">type to search boars or pick outside source</small></label>
          <div class="suggest-input-wrap">
            <input type="text" id="semenSourceInput" class="suggest-input" placeholder="Type boar name or breed to search..." autocomplete="off" value="${escH(initialText)}" onfocus="window.filterSemenSourceSuggest(this.value)" oninput="window.filterSemenSourceSuggest(this.value)" onblur="setTimeout(()=>{const d=document.getElementById('semenSourceDropdown');if(d)d.style.display='none';},220)">
            <input type="hidden" name="boar_pick" id="semenSourceVal" value="${escH(initialVal)}" required>
            <button type="button" class="suggest-clear-btn" id="semenSourceClear" onclick="window.clearSemenSourceSuggest()" style="display:${initialText ? 'block' : 'none'}">✕</button>
            <div class="suggest-dropdown" id="semenSourceDropdown" style="display:none"></div>
          </div>
        </div>
        <div class="field semen-out-only" style="display:none"><label>Boar name *</label><input name="out_boar_name" placeholder="e.g. KR Duroc 7"></div>
        <div class="field semen-out-only" style="display:none"><label>Breed</label><input name="out_breed" placeholder="e.g. Duroc"></div>
        <div class="field semen-out-only" style="display:none"><label>Source farm</label><input name="out_source_farm" placeholder="Farm bought from"></div>
        <div class="field semen-out-only" style="display:none"><label>Boar sire record / ID</label><input name="out_sire" placeholder="Optional — kept for lineage"></div>
        <div class="field semen-out-only" style="display:none"><label>Boar dam record / ID</label><input name="out_dam" placeholder="Optional — kept for lineage"></div>
        <div class="field"><label>Collection date *</label><input name="collection_date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></div>
        <div class="field"><label>Expiration date</label><input name="expiration_date" type="date"></div>
        <div class="field"><label>Batch number</label><input name="batch_no" placeholder="Auto-generated if blank"></div>
        <div class="field"><label>Bottles (initial stock) *</label><input name="bottles" type="number" min="0" step="1" value="0" required><small class="field-hint">How many doses you have now — restock later anytime</small></div>
        <div class="field"><label>Total cost (₱, optional)</label><input name="cost" type="number" min="0" step="0.01" placeholder="0.00"><small class="field-hint">Logged to Financials as a Semen Purchase expense</small></div>
        <div class="field full"><label>Notes</label><input name="notes" placeholder="Collection / purchase notes"></div>
      </div>
      <p class="field-hint">Outside sources are saved as <b>lineage references</b> — their pedigree is kept for inbreeding checks but they are never counted as boars on the dashboard.</p>
      <div class="form-error" id="newBatchErr"></div>
      <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('semenNewBatchModal').remove()">Cancel</button><button class="btn">Save new batch</button></div>
    </form></div>`);
  }

  function semenNewBatchSource(v) {
    document.querySelectorAll('#semenNewBatchModal .semen-out-only').forEach(f => f.style.display = v === '__outside' ? '' : 'none');
  }

  async function saveSemenNewBatch(e) {
    e.preventDefault();
    let d = Object.fromEntries(new FormData(e.target)),
      err = document.getElementById('newBatchErr');
    err.classList.remove('show');
    try {
      let f = F(), boars = (f.boars = f.boars || []), boar;
      if (d.boar_pick === '__outside') {
        let name = String(d.out_boar_name || '').trim();
        if (!name) throw new Error('Boar name is required for an outside source.');
        boar = boars.find(b => (b.name || '').toLowerCase() === name.toLowerCase());
        if (!boar) {
          boar = { id: uidS('boar'), name, breed: String(d.out_breed || '').trim(), sireRef: String(d.out_sire || '').trim(), damRef: String(d.out_dam || '').trim(), source_farm: String(d.out_source_farm || '').trim(), status: 'Reference', lineage_only: true, source_role: 'reference' };
          boars.push(boar);
        }
      } else {
        boar = boars[+d.boar_pick];
        if (!boar || d.boar_pick === '') throw new Error('Choose where the semen came from.');
      }
      let qty = Math.max(0, Math.floor(num(d.bottles) || 0)),
        cost = Math.max(0, num(d.cost) || 0),
        coll = d.collection_date || new Date().toISOString().slice(0, 10),
        batchNo = String(d.batch_no || '').trim() || genBatchNo(boar.name, coll),
        lot = { id: uidS('semen'), farm_id: farmId, boar_id: boar.id, boar_name: boar.name, boar: boar.name, breed: boar.breed || String(d.out_breed || '').trim(), semen_batch_no: batchNo, collection_date: coll, collection: coll, expiration_date: d.expiration_date || null, available_bottles: qty, bottles: qty, source_farm: boar.source_farm || String(d.out_source_farm || '').trim() || '', notes: String(d.notes || '').trim(), manual_source: true, boar_role: (boar.lineage_only || boar.status === 'Reference') ? 'reference' : 'active', restocks: [], created_at: new Date().toISOString() };
      if (qty > 0 || cost > 0) {
        let log = { id: uidS('rs'), date: coll, qty, cost, source: lot.source_farm ? `Bought from ${lot.source_farm}` : 'Initial stock', at: new Date().toISOString() };
        lot.restocks.push(log);
        if (cost > 0) {
          log.tx_id = 'tx-' + Date.now();
          (f.transactions = f.transactions || []).push({ id: log.tx_id, date: coll, type: 'Expense', category: 'Semen Purchase', description: `New batch ${batchNo} — ${boar.name} × ${qty} bottle(s)${lot.source_farm ? ' · ' + lot.source_farm : ''}`, amount: cost, paid: cost });
        }
      }
      (f.semen = f.semen || []).push(lot);
      save();
      const sync = await verifySemenCloudSave(`new semen batch ${batchNo}`);
      if (!sync.success) preserveSemenRecovery('new semen batch awaiting cloud verification');
      document.getElementById('semenNewBatchModal')?.remove();
      renderAll();
      if (window.refreshOpenDrilldown) refreshOpenDrilldown();
      if (sync.success) toast(`🧪 New batch ${batchNo} saved and cloud-verified — ${qty} bottle(s) on hand`);
      else {
        toast(`✓ New semen batch saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
        window.updateSyncIndicator?.('pending', 'New semen batch pending', sync.reason || 'The new batch remains safely local until verified.');
      }
    } catch (ex) {
      err.textContent = ex.message || 'Could not save the batch.';
      err.classList.add('show');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SEMEN RESELLERS & CONSIGNMENT / WHOLESALE HUB
     ═══════════════════════════════════════════════════════════════════════════ */
  function ensureResellerData() {
    const f = F();
    if (!Array.isArray(f.semenResellers)) f.semenResellers = [];
    if (!Array.isArray(f.semenResellerTx)) f.semenResellerTx = [];
    if (!Array.isArray(f.semenResellerAdjustments)) f.semenResellerAdjustments = [];

    // Filter out any tombstoned items. [FIX M9] reservation numbers (and legacy
    // customer names written into the shared list by older builds) never hide a
    // reseller — reservations now tombstone in deleted_reservation_ids and the
    // shared legacy list only governs reseller records.
    const deletedSet = new Set((f.deleted_ids || []).map(id => String(id).trim().toLowerCase()).filter(id => id && !/^(RES|FLT)-\d/.test(id) && !/^res-\d+$/.test(id)));
    if (deletedSet.size > 0) {
      f.semenResellers = f.semenResellers.filter(r => {
        if (!r) return false;
        const rId = String(r.id || '').trim().toLowerCase();
        const rName = String(r.name || '').trim().toLowerCase();
        return !deletedSet.has(rId) && !deletedSet.has(rName);
      });
      f.semenResellerTx = f.semenResellerTx.filter(tx => {
        if (!tx) return false;
        const txId = String(tx.id || '').trim().toLowerCase();
        const txRId = String(tx.reseller_id || '').trim().toLowerCase();
        const txRName = String(tx.reseller_name || '').trim().toLowerCase();
        return !deletedSet.has(txId) && !deletedSet.has(txRId) && !deletedSet.has(txRName);
      });
    }
  }

  function resellerTxBalance(tx) {
    const billed = Math.max(0, +(tx?.total_amount || 0));
    const discount = Math.min(billed, Math.max(0, +(tx?.discount_amount || 0)));
    const paid = Math.max(0, +(tx?.paid_amount || 0));
    return Math.max(0, billed - discount - paid);
  }

  function resellerTxDiscount(tx) {
    return Math.min(Math.max(0, +(tx?.total_amount || 0)), Math.max(0, +(tx?.discount_amount || 0)));
  }

  function resellerTransactionsFor(f, reseller) {
    return (f.semenResellerTx || []).filter(tx => tx && (tx.reseller_id === reseller.id || tx.reseller_name === reseller.name));
  }

  function resellerAccountTotals(f, reseller) {
    const txs = resellerTransactionsFor(f, reseller);
    const billed = txs.reduce((sum, tx) => sum + Math.max(0, +(tx.total_amount || 0)), 0);
    const discounts = txs.reduce((sum, tx) => sum + resellerTxDiscount(tx), 0);
    const paid = txs.reduce((sum, tx) => sum + Math.max(0, +(tx.paid_amount || 0)), 0);
    const balance = txs.reduce((sum, tx) => sum + resellerTxBalance(tx), 0);
    return { txs, billed, discounts, netBilled: Math.max(0, billed - discounts), paid, balance };
  }

  function sortResellerTransactions(txs) {
    return txs.slice().sort((a, b) => String(a.timestamp || a.date || a.created_at || '').localeCompare(String(b.timestamp || b.date || b.created_at || '')));
  }

  function recalculateResellerTx(tx) {
    tx.discount_amount = resellerTxDiscount(tx);
    tx.balance = resellerTxBalance(tx);
    tx.status = tx.balance === 0
      ? (tx.discount_amount > 0 && +(tx.paid_amount || 0) < +(tx.total_amount || 0) ? 'settled_discounted' : 'paid')
      : (+(tx.paid_amount || 0) > 0 ? 'partially_paid' : 'active');
    tx.updated_at = new Date().toISOString();
    return tx;
  }

  function openSemenResellerHub() {
    ensureResellerData();
    const f = F();
    const resellers = f.semenResellers || [];
    const txs = f.semenResellerTx || [];

    // Calculate Summary Metrics
    const totalDispatched = txs.reduce((acc, tx) => acc + (tx.lines || []).reduce((la, l) => la + (+l.qty || 0), 0), 0);
    const totalBilled = txs.reduce((acc, tx) => acc + Math.max(0, +(tx.total_amount || 0)), 0);
    const totalDiscounts = txs.reduce((acc, tx) => acc + resellerTxDiscount(tx), 0);
    const totalCollected = txs.reduce((acc, tx) => acc + Math.max(0, +(tx.paid_amount || 0)), 0);
    const totalBalance = txs.reduce((acc, tx) => acc + resellerTxBalance(tx), 0);
    const totalReturns = txs.reduce((acc, tx) => acc + (tx.lines || []).reduce((la, l) => la + (+l.returned_qty || 0), 0), 0);

    document.getElementById('semenResellerHub')?.remove();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg" id="semenResellerHub" style="z-index:999999!important">
        <div class="due-modal reseller-hub-wrap">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:var(--teal2);font-weight:800">SEMEN CONSIGNMENT &amp; WHOLESALE DISPATCH</div>
              <h2>👥 Semen Reseller Center</h2>
              <p class="muted">Track initial bottle pick-ups, live balances, returns/replacements &amp; Bluetooth thermal receipts.</p>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('semenResellerHub').remove()">×</button>
          </div>

          <!-- KPI Summary Grid -->
          <div class="reseller-kpi-grid">
            <div class="reseller-kpi-box">
              <small>Registered Resellers</small>
              <b>${resellers.length} Accounts</b>
            </div>
            <div class="reseller-kpi-box">
              <small>Total Doses Dispatched</small>
              <b>${totalDispatched} Bottles</b>
            </div>
            <div class="reseller-kpi-box">
              <small>Total Collected</small>
              <b style="color:var(--ok)">${peso(totalCollected)}</b>
            </div>
            <div class="reseller-kpi-box">
              <small>Outstanding Receivables</small>
              <b style="color:${totalBalance > 0 ? 'var(--warn)' : 'var(--ok)'}">${peso(totalBalance)}</b>
            </div>
          </div>
          <div class="reseller-discount-summary">⚖ Total discounts / readjustments applied: <b>${peso(totalDiscounts)}</b> · These reduce reseller receivables but do not count as cash collected.</div>

          <!-- Action Toolbar -->
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button type="button" class="btn" onclick="openResellerPickupModal()" style="background:#0ea5e9;color:#fff">＋ Record Semen Pickup</button>
              <button type="button" class="btn ghost" onclick="openResellerProfileModal()">＋ Add Reseller Profile</button>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <button type="button" class="btn ghost small" onclick="btScanPrinter()">📶 Bluetooth Printer</button>
            </div>
          </div>

          <!-- Search & Filter Bar -->
          <div class="toolbar" style="margin-bottom:12px">
            <input type="search" class="search" style="width:100%;max-width:380px" placeholder="🔍 Search reseller name, contact, address..." oninput="window.filterResellerAccounts(this.value)">
            <div class="tag" id="resellerCountTag">${resellers.length} Reseller Profiles</div>
          </div>

          <!-- Resellers Directory (Collapsible / Expandable Cards) -->
          <div id="resellerListContainer">
            ${resellers.map((r, rIdx) => renderResellerAccountCardHTML(r, rIdx, txs)).join('') || `
              <div class="panel empty" style="padding:28px">
                <h3>No registered semen resellers yet</h3>
                <p class="muted">Tap "＋ Add Reseller Profile" or "＋ Record Semen Pickup" to start logging consignments.</p>
              </div>
            `}
          </div>
        </div>
      </div>
    `);
  }

  function renderResellerAccountCardHTML(r, rIdx, allTxs) {
    const account = resellerAccountTotals(F(), r);
    const rTxs = account.txs;
    const rBilled = account.billed;
    const rDiscounts = account.discounts;
    const rPaid = account.paid;
    const rBal = account.balance;
    const rBottles = rTxs.reduce((acc, tx) => acc + (tx.lines || []).reduce((la, l) => la + (+l.qty || 0), 0), 0);

    return `
      <div class="reseller-card" id="resCard_${r.id}">
        <div class="reseller-card-header" onclick="window.toggleResellerCollapse('${r.id}')">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:22px">👤</span>
            <div>
              <b style="font-size:15px;color:var(--ink)">${escH(r.name)}</b>
              <small class="muted" style="display:block">${escH(r.contact || 'No phone')} · ${escH(r.address || 'Field Reseller')}</small>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <div style="text-align:right">
              <small class="muted" style="display:block;font-size:11px">${rBottles} bottles picked up</small>
              <b style="font-size:14.5px;color:${rBal > 0 ? 'var(--warn)' : 'var(--ok)'}">Balance: ${peso(rBal)}</b>
              ${rDiscounts > 0 ? `<small style="display:block;color:var(--ok);font-size:10px">Discounts: ${peso(rDiscounts)}</small>` : ''}
            </div>
            <span id="resArrow_${r.id}" style="font-size:14px;color:var(--muted)">▼</span>
          </div>
        </div>

        <div class="reseller-card-body" id="resBody_${r.id}">
          <!-- Quick Action Buttons for this Reseller -->
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
            <button type="button" class="btn small" onclick="openResellerPickupModal('${r.id}')">＋ Record Pickup</button>
            <button type="button" class="btn small ghost" onclick="openResellerPaymentModal('${r.id}')">💰 Log Payment</button>
            <button type="button" class="btn small ghost" onclick="openResellerStatement('${r.id}')">📜 Statement</button>
            <button type="button" class="btn small ghost" onclick="window.btPrintResellerStatement('${r.id}')">🖨 Print BLE Statement</button>
            <button type="button" class="btn small ghost" onclick="openResellerProfileModal('${r.id}')">✎ Edit Profile</button>
            <button type="button" class="btn small ghost delete-action" onclick="deleteResellerProfile('${r.id}')" style="color:var(--danger);border-color:rgba(255,92,104,0.35)">🗑 Delete Profile</button>
          </div>

          <!-- Transactions List -->
          <div class="reseller-tx-list">
            ${rTxs.map((tx, txIdx) => renderResellerTxRowHTML(tx, txIdx, r)).join('') || `
              <div class="empty" style="padding:14px;font-size:12.5px">No pick-up transactions logged yet for ${escH(r.name)}.</div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  function renderResellerTxRowHTML(tx, txIdx, r) {
    const hasReturn = (tx.lines || []).some(l => l.is_returned_replaced || l.returned_qty > 0 || l.replaced_qty > 0);
    const when = tx.timestamp ? new Date(tx.timestamp).toLocaleString([], {month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'}) : fmtDate(tx.date);

    return `
      <div class="reseller-tx-row" id="txRow_${tx.id}">
        <div class="reseller-tx-top">
          <div>
            ${hasReturn ? `<span class="blinking-tag-return">🔄 Returned &amp; Replaced</span> ` : ''}
            <b style="color:var(--ink)">Pickup #${escH(tx.id)}</b>
            <small class="muted" style="display:block;margin-top:2px">🗓 ${escH(when)}${tx.notes ? ' · Note: ' + escH(tx.notes) : ''}</small>
            ${tx.sync_status === 'pending' ? '<small class="reseller-sync-pending">☁ Pending cloud verification — safely retained on this device</small>' : ''}
          </div>
          <div style="text-align:right">
            <b style="font-size:14px;color:var(--ink)">${peso(tx.total_amount)}</b>
            ${resellerTxDiscount(tx) > 0 ? `<small style="display:block;font-size:11px;color:var(--ok)">Discount / readjustment: <b>−${peso(resellerTxDiscount(tx))}</b></small>` : ''}
            <small class="muted" style="display:block;font-size:11px">Paid: <b>${peso(tx.paid_amount || 0)}</b> · Bal: <b style="color:${resellerTxBalance(tx) > 0 ? 'var(--warn)' : 'var(--ok)'}">${peso(resellerTxBalance(tx))}</b></small>
          </div>
        </div>

        <!-- Semen Lines -->
        <div style="margin:8px 0">
          ${(tx.lines || []).map(l => `
            <div class="reseller-line-item">
              <div>
                <b>${escH(l.boar)} (${escH(l.breed)})</b>
                <small class="muted" style="display:block">Batch: ${escH(l.semen_batch_no || '—')} · ${l.qty} bottle(s) × ${peso(l.rate)}</small>
                ${l.returned_qty ? `<small style="color:#d97706;display:block">↩ Returned: <b>${l.returned_qty} bottle(s)</b> (${escH(l.return_reason || 'Unused')})</small>` : ''}
                ${l.replaced_qty ? `<small style="color:var(--teal2);display:block">🔁 Replaced with: <b>${escH(l.replacement_boar)} (${escH(l.replacement_breed)})</b> × ${l.replaced_qty} @ ${peso(l.replacement_rate)}</small>` : ''}
              </div>
              <b>${peso(l.amount)}</b>
            </div>
          `).join('')}
        </div>

        <!-- Row Actions -->
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:10px;padding-top:8px;border-top:1px solid var(--line)">
          <button type="button" class="btn ghost small" onclick="openResellerTxReceipt('${tx.id}')">🧾 Receipt &amp; BLE</button>
          <button type="button" class="btn ghost small" onclick="openResellerReturnReplaceModal('${tx.id}')">↩ Return / Replace</button>
          <button type="button" class="btn ghost small" onclick="openResellerPaymentModal('${r.id}', '${tx.id}')">💰 Payment</button>
          <button type="button" class="btn ghost small" onclick="openEditResellerTxModal('${tx.id}')">✎ Edit</button>
          <button type="button" class="btn ghost small delete-action" onclick="deleteResellerTx('${tx.id}')">🗑 Delete</button>
        </div>
      </div>
    `;
  }

  window.toggleResellerCollapse = function(rId) {
    const body = document.getElementById(`resBody_${rId}`);
    const arrow = document.getElementById(`resArrow_${rId}`);
    if (!body) return;
    const isHidden = body.classList.contains('collapsed') || body.style.display === 'none';
    if (isHidden) {
      body.classList.remove('collapsed');
      body.style.display = 'block';
      if (arrow) arrow.textContent = '▲';
    } else {
      body.classList.add('collapsed');
      body.style.display = 'none';
      if (arrow) arrow.textContent = '▼';
    }
  };

  window.filterResellerAccounts = function(q) {
    const term = String(q || '').trim().toLowerCase();
    const cards = document.querySelectorAll('.reseller-card');
    let matches = 0;
    cards.forEach(c => {
      const match = !term || c.textContent.toLowerCase().includes(term);
      c.style.display = match ? '' : 'none';
      if (match) matches++;
    });
    const tag = document.getElementById('resellerCountTag');
    if (tag) tag.textContent = term ? `${matches} Matching` : `${cards.length} Reseller Profiles`;
  };

  /* ── Add / Edit Reseller Profile Modal ── */
  function openResellerProfileModal(editId = null) {
    ensureResellerData();
    const f = F();
    const r = editId ? (f.semenResellers || []).find(x => x.id === editId) : null;

    document.getElementById('resellerProfileModal')?.remove();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg" id="resellerProfileModal" style="z-index:9999999!important">
        <form class="due-modal" onsubmit="window.saveResellerProfile(event, '${editId || ''}')">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:var(--teal2);font-weight:700">RESELLER DIRECTORY</div>
              <h2>${r ? 'Edit Reseller Profile' : '＋ Add Reseller Profile'}</h2>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('resellerProfileModal').remove()">×</button>
          </div>

          <div class="reminder-fields" style="text-align:left">
            <div class="field full">
              <label>Reseller Name *</label>
              <input type="text" name="name" value="${escH(r?.name || '')}" required placeholder="e.g. Mang Cardo / Sorsogon AI Services">
            </div>
            <div class="field">
              <label>Contact / Phone Number *</label>
              <input type="tel" name="contact" value="${escH(r?.contact || '')}" required placeholder="e.g. 09171234567">
            </div>
            <div class="field">
              <label>Location / Barangay / Town</label>
              <input type="text" name="address" value="${escH(r?.address || '')}" placeholder="e.g. Brgy. San Jose, Sorsogon">
            </div>
            <div class="field full">
              <label>Notes / Terms</label>
              <textarea name="notes" placeholder="e.g. Consignment basis, weekly settlement, preferred Duroc breed">${escH(r?.notes || '')}</textarea>
            </div>
          </div>

          <div class="due-actions" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center">
            ${r ? `<button type="button" class="btn danger-btn delete-action" onclick="deleteResellerProfile('${r.id}')" style="margin-right:auto">🗑 Delete Profile</button>` : '<div></div>'}
            <div style="display:flex;gap:8px">
              <button type="button" class="btn ghost" onclick="document.getElementById('resellerProfileModal').remove()">Cancel</button>
              <button type="submit" class="btn">${r ? 'Save Changes' : '✓ Register Reseller'}</button>
            </div>
          </div>
        </form>
      </div>
    `);
  }
  window.openResellerProfileModal = openResellerProfileModal;

  /* ── Delete Reseller Profile ── */
  function deleteResellerProfile(resellerId) {
    ensureResellerData();
    const f = F();
    const r = (f.semenResellers || []).find(x => x.id === resellerId || x.name === resellerId);
    if (!r) return;

    const rId = String(r.id || '').trim();
    const rName = String(r.name || '').trim();

    const rTxs = (f.semenResellerTx || []).filter(tx => tx.reseller_id === r.id || tx.reseller_name === r.name || String(tx.reseller_id) === rId || String(tx.reseller_name || '').toLowerCase() === rName.toLowerCase());
    const rBal = rTxs.reduce((acc, tx) => acc + resellerTxBalance(tx), 0);

    const warnMsg = rBal > 0
      ? `Permanently delete reseller profile "${r.name}"?\n\n⚠️ This reseller has an outstanding balance of ${peso(rBal)} and ${rTxs.length} transaction(s).\n\nThis will permanently delete the profile and clear its associated records.`
      : `Permanently delete reseller profile "${r.name}"? This cannot be undone.`;

    if (!confirm(warnMsg)) return;

    // 1. Add reseller ID and Name to persistent tombstones so sync never resurrects it
    f.deleted_ids = f.deleted_ids || [];
    if (rId && !f.deleted_ids.includes(rId)) f.deleted_ids.push(rId);
    if (rName && !f.deleted_ids.includes(rName)) f.deleted_ids.push(rName);
    if (resellerId && !f.deleted_ids.includes(resellerId)) f.deleted_ids.push(resellerId);

    // Also tombstone all associated transaction IDs
    rTxs.forEach(tx => {
      if (tx.id && !f.deleted_ids.includes(tx.id)) {
        f.deleted_ids.push(tx.id);
      }
    });

    // 2. Remove reseller profile and transactions from ALL local DB buckets
    if (window.DB) {
      Object.keys(DB).forEach(fKey => {
        if (DB[fKey]) {
          if (Array.isArray(DB[fKey].semenResellers)) {
            DB[fKey].semenResellers = DB[fKey].semenResellers.filter(x => {
              const xId = String(x.id || '').trim();
              const xName = String(x.name || '').trim();
              return xId !== rId && xName.toLowerCase() !== rName.toLowerCase() && x.id !== resellerId;
            });
          }
          if (Array.isArray(DB[fKey].semenResellerTx)) {
            DB[fKey].semenResellerTx = DB[fKey].semenResellerTx.filter(tx => {
              const txRId = String(tx.reseller_id || '').trim();
              const txRName = String(tx.reseller_name || '').trim();
              return txRId !== rId && txRName.toLowerCase() !== rName.toLowerCase() && !rTxs.some(t => t.id === tx.id);
            });
          }
          if (Array.isArray(DB[fKey].deleted_ids)) {
            if (rId && !DB[fKey].deleted_ids.includes(rId)) DB[fKey].deleted_ids.push(rId);
            if (rName && !DB[fKey].deleted_ids.includes(rName)) DB[fKey].deleted_ids.push(rName);
          }
        }
      });
    }

    // 3. Purge from cloud database
    const currentFarmId = window.farmId || (typeof getFarmId === 'function' ? getFarmId() : 'farm-rm');
    if (window.ARSCloud && typeof ARSCloud.deleteAppRecord === 'function' && currentFarmId) {
      if (rId) ARSCloud.deleteAppRecord(currentFarmId, 'semen_reseller', rId).catch(() => {});
      if (rName) ARSCloud.deleteAppRecord(currentFarmId, 'semen_reseller', rName).catch(() => {});
      rTxs.forEach(tx => {
        if (tx.id) ARSCloud.deleteAppRecord(currentFarmId, 'semen_reseller_tx', tx.id).catch(() => {});
      });
    }

    save();
    document.getElementById('resellerProfileModal')?.remove();
    toast(`✓ Reseller profile "${r.name}" deleted permanently.`);
    openSemenResellerHub();
  }
  window.deleteResellerProfile = deleteResellerProfile;

  window.saveResellerProfile = function(e, editId) {
    if (e) e.preventDefault();
    const form = e.target;
    const d = Object.fromEntries(new FormData(form));
    const name = String(d.name || '').trim();
    if (!name) { toast('Please enter a reseller name.'); return; }

    ensureResellerData();
    const f = F();

    if (editId) {
      const r = (f.semenResellers || []).find(x => x.id === editId);
      if (r) {
        r.name = name;
        r.contact = d.contact || '';
        r.address = d.address || '';
        r.notes = d.notes || '';
      }
    } else {
      f.semenResellers.push({
        id: 'res-' + Date.now().toString(36),
        name,
        contact: d.contact || '',
        address: d.address || '',
        notes: d.notes || '',
        created_at: new Date().toISOString()
      });
    }

    save();
    document.getElementById('resellerProfileModal')?.remove();
    toast(`✓ Reseller profile "${name}" saved!`);
    openSemenResellerHub();
  };

  /* ── Record Semen Pickup / Consignment Modal ── */
  let activePickupLines = [];

  function openResellerPickupModal(preResellerId = '') {
    ensureResellerData();
    const f = F();
    const resellers = f.semenResellers || [];
    const availableSemen = (f.semen || []).filter(s => +(s.available_bottles ?? s.bottles ?? 0) > 0);

    activePickupLines = [
      { boar: '', breed: '', semen_batch_no: '', qty: 1, rate: 350, amount: 350 }
    ];

    document.getElementById('resellerPickupModal')?.remove();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg" id="resellerPickupModal" style="z-index:9999999!important">
        <form class="due-modal reseller-hub-wrap" onsubmit="window.saveResellerPickup(event)">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:var(--teal2);font-weight:700">CONSIGNMENT DISPATCH &amp; PICKUP</div>
              <h2>📦 Record Semen Pickup</h2>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('resellerPickupModal').remove()">×</button>
          </div>

          <div class="reminder-fields" style="text-align:left">
            <!-- 1. Select Reseller -->
            <div class="field full suggest-field">
              <label>1. Select Reseller * <small class="field-hint">type to search or add new below</small></label>
              <div class="suggest-input-wrap">
                <input type="text" id="resellerPickInput" class="suggest-input" placeholder="Type reseller name or contact..." autocomplete="off" onfocus="window.filterResellerPickSuggest(this.value)" oninput="window.filterResellerPickSuggest(this.value)">
                <input type="hidden" id="resellerPickId" name="reseller_id" required value="${preResellerId || ''}">
                <button type="button" class="suggest-clear-btn" id="resellerPickClear" onclick="window.clearResellerPickSuggest()" style="display:none">✕</button>
                <div class="suggest-dropdown" id="resellerPickDropdown" style="display:none"></div>
              </div>
            </div>

            <!-- 2. Pickup Timestamp -->
            <div class="field full">
              <label>2. Pickup Date &amp; Time *</label>
              <input type="datetime-local" id="resellerPickupTime" name="timestamp" value="${localDateTimeValue()}" required class="suggest-input">
            </div>

            <!-- 3. Semen Lines -->
            <div class="field full" style="margin-top:6px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <label style="margin:0;font-weight:800">3. Semen Bottles Picked Up (From Available Stock) *</label>
                <button type="button" class="btn ghost small" onclick="window.addPickupLine()">＋ Add Bottle Line</button>
              </div>
              <div id="pickupLinesWrap"></div>
            </div>

            <!-- 4. Initial Payment & Notes -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div class="field">
                <label>Initial Payment / Deposit (₱)</label>
                <input type="number" min="0" step="1" id="pickupPaidInput" name="paid_amount" value="0" oninput="window.calcPickupTotals()" class="suggest-input">
              </div>
              <div class="field">
                <label>Payment Method</label>
                <select name="pay_method" class="rfid-select">
                  <option value="Cash">Cash</option>
                  <option value="GCash">GCash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Unpaid / Credit">Unpaid (Full Consignment)</option>
                </select>
              </div>
            </div>

            <div class="field full">
              <label>Caretaker / Transporter Notes</label>
              <input type="text" name="notes" placeholder="e.g. Picked up by helper, styro box packed with ice gel" class="suggest-input">
            </div>

            <!-- Total Bill Preview -->
            <div style="background:rgba(13,141,145,0.08);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-top:10px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <small class="muted" style="display:block;font-size:11px">TOTAL BILL AMOUNT</small>
                <b id="pickupTotalBill" style="font-size:18px;color:var(--ink)">₱0.00</b>
              </div>
              <div style="text-align:right">
                <small class="muted" style="display:block;font-size:11px">REMAINING BALANCE</small>
                <b id="pickupBalance" style="font-size:18px;color:var(--warn)">₱0.00</b>
              </div>
            </div>
          </div>

          <div class="due-actions" style="margin-top:18px">
            <button type="button" class="btn ghost" onclick="document.getElementById('resellerPickupModal').remove()">Cancel</button>
            <button type="submit" class="btn" style="background:#0ea5e9;color:#fff">✓ Finalize &amp; Print Bluetooth Receipt</button>
          </div>
        </form>
      </div>
    `);

    renderPickupLines();

    if (preResellerId) {
      const r = (f.semenResellers || []).find(x => x.id === preResellerId);
      if (r) {
        const inp = document.getElementById('resellerPickInput');
        if (inp) inp.value = `${r.name} (${r.contact || 'Reseller'})`;
      }
    }
  }
  window.openResellerPickupModal = openResellerPickupModal;

  function renderPickupLines() {
    const wrap = document.getElementById('pickupLinesWrap');
    if (!wrap) return;

    const f = F();
    const available = (f.semen || []).filter(s => +(s.available_bottles ?? s.bottles ?? 0) > 0);

    wrap.innerHTML = activePickupLines.map((line, lIdx) => `
      <div class="reseller-pickup-line-card" id="pickupLineCard_${lIdx}" style="background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px">
        <!-- Row 1: Semen Batch Selector -->
        <div class="field" style="margin:0 0 10px 0">
          <label style="font-size:11.5px;font-weight:750">Semen Batch / Boar Line ${lIdx + 1} *</label>
          <select class="rfid-select" onchange="window.onPickupBatchSelect(${lIdx}, this.value)" style="width:100%">
            <option value="">— Choose Available Semen —</option>
            ${available.map(s => `
              <option value="${s.id}" ${line.semen_id === s.id ? 'selected' : ''}>
                ${s.boar_name || s.boar} (${s.breed}) · ${s.semen_batch_no || 'Batch'} · ${s.available_bottles ?? s.bottles} left (₱${s.price || 350})
              </option>
            `).join('')}
          </select>
        </div>

        <!-- Row 2: Qty, Price, Subtotal, Delete -->
        <div style="display:grid;grid-template-columns:minmax(85px,1fr) minmax(105px,1.2fr) minmax(95px,1fr) auto;gap:10px;align-items:end">
          <div class="field" style="margin:0">
            <label style="font-size:11px;font-weight:700">Qty (bottles) *</label>
            <input type="number" min="1" step="1" inputmode="numeric" id="lineQty_${lIdx}" value="${line.qty || 1}" class="suggest-input" style="font-size:15px;font-weight:bold;text-align:center" onfocus="this.select()" oninput="window.onPickupLineQtyChange(${lIdx}, this.value)" onblur="window.onPickupLineQtyBlur(${lIdx}, this.value)">
          </div>

          <div class="field" style="margin:0">
            <label style="font-size:11px;font-weight:700">Price / Bottle (₱)</label>
            <input type="number" min="0" step="1" inputmode="numeric" id="lineRate_${lIdx}" value="${line.rate ?? 350}" class="suggest-input" style="font-size:15px;font-weight:bold;text-align:center" onfocus="this.select()" oninput="window.onPickupLineRateChange(${lIdx}, this.value)" onblur="window.onPickupLineRateBlur(${lIdx}, this.value)">
          </div>

          <div class="field" style="margin:0;text-align:right">
            <label style="font-size:11px;font-weight:700">Subtotal</label>
            <b id="lineSubtotal_${lIdx}" style="display:block;padding:8px 0;font-size:15px;color:var(--ink)">${peso(line.amount || 0)}</b>
          </div>

          ${activePickupLines.length > 1 ? `
            <div style="margin-bottom:2px">
              <button type="button" class="btn ghost small delete-action" onclick="window.removePickupLine(${lIdx})" title="Remove line" style="padding:8px 10px">✕</button>
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');

    calcPickupTotals();
  }

  window.addPickupLine = function() {
    activePickupLines.push({ boar: '', breed: '', semen_batch_no: '', qty: 1, rate: 350, amount: 350 });
    renderPickupLines();
  };

  window.removePickupLine = function(lIdx) {
    activePickupLines.splice(lIdx, 1);
    renderPickupLines();
  };

  window.onPickupBatchSelect = function(lIdx, semenId) {
    const f = F();
    const s = (f.semen || []).find(x => x.id === semenId);
    const l = activePickupLines[lIdx];
    if (!l) return;

    if (s) {
      l.semen_id = s.id;
      l.boar = s.boar_name || s.boar || 'Semen';
      l.breed = s.breed || 'Commercial';
      l.semen_batch_no = s.semen_batch_no || '';
      l.rate = +(s.price || 350);
      l.amount = (l.qty || 1) * l.rate;

      const rateInp = document.getElementById(`lineRate_${lIdx}`);
      if (rateInp) rateInp.value = l.rate;

      const subtotalEl = document.getElementById(`lineSubtotal_${lIdx}`);
      if (subtotalEl) subtotalEl.textContent = peso(l.amount);

      calcPickupTotals();
    } else {
      l.semen_id = '';
      l.boar = '';
      l.breed = '';
      l.semen_batch_no = '';
    }
  };

  window.onPickupLineQtyChange = function(lIdx, q) {
    const l = activePickupLines[lIdx];
    if (!l) return;
    const val = parseFloat(q);
    l.qty = isNaN(val) ? 0 : val;
    l.amount = l.qty * (l.rate || 0);

    const subtotalEl = document.getElementById(`lineSubtotal_${lIdx}`);
    if (subtotalEl) subtotalEl.textContent = peso(l.amount);

    calcPickupTotals();
  };

  window.onPickupLineQtyBlur = function(lIdx, q) {
    const l = activePickupLines[lIdx];
    if (!l) return;
    if (!l.qty || l.qty < 1) {
      l.qty = 1;
      const inp = document.getElementById(`lineQty_${lIdx}`);
      if (inp) inp.value = 1;
      l.amount = l.qty * (l.rate || 0);
      const subtotalEl = document.getElementById(`lineSubtotal_${lIdx}`);
      if (subtotalEl) subtotalEl.textContent = peso(l.amount);
      calcPickupTotals();
    }
  };

  window.onPickupLineRateChange = function(lIdx, r) {
    const l = activePickupLines[lIdx];
    if (!l) return;
    const val = parseFloat(r);
    l.rate = isNaN(val) ? 0 : val;
    l.amount = (l.qty || 0) * l.rate;

    const subtotalEl = document.getElementById(`lineSubtotal_${lIdx}`);
    if (subtotalEl) subtotalEl.textContent = peso(l.amount);

    calcPickupTotals();
  };

  window.onPickupLineRateBlur = function(lIdx, r) {
    const l = activePickupLines[lIdx];
    if (!l) return;
    if (isNaN(l.rate) || l.rate < 0) {
      l.rate = 350;
      const inp = document.getElementById(`lineRate_${lIdx}`);
      if (inp) inp.value = 350;
      l.amount = (l.qty || 0) * l.rate;
      const subtotalEl = document.getElementById(`lineSubtotal_${lIdx}`);
      if (subtotalEl) subtotalEl.textContent = peso(l.amount);
      calcPickupTotals();
    }
  };

  function calcPickupTotals() {
    const total = activePickupLines.reduce((acc, l) => acc + (l.amount || 0), 0);
    const paidInput = document.getElementById('pickupPaidInput');
    const paid = Math.max(0, parseFloat(paidInput?.value || 0) || 0);
    const bal = Math.max(0, total - paid);

    const totEl = document.getElementById('pickupTotalBill');
    const balEl = document.getElementById('pickupBalance');
    if (totEl) totEl.textContent = peso(total);
    if (balEl) balEl.textContent = peso(bal);
  }
  window.calcPickupTotals = calcPickupTotals;

  /* Reseller Auto-Suggest */
  window.filterResellerPickSuggest = function(query) {
    const dropdown = document.getElementById("resellerPickDropdown");
    const clearBtn = document.getElementById("resellerPickClear");
    if (!dropdown) return;

    const f = F();
    const list = f.semenResellers || [];
    const q = String(query || "").trim().toLowerCase();
    if (clearBtn) clearBtn.style.display = q ? "block" : "none";

    const hits = list.filter(r => !q || `${r.name} ${r.contact} ${r.address}`.toLowerCase().includes(q));

    dropdown.innerHTML = `
      ${hits.map((r, idx) => `
        <div class="suggest-item" onmousedown="window.selectResellerPick('${r.id}', '${escH(r.name).replace(/'/g, "\\'")}', '${escH(r.contact || '').replace(/'/g, "\\'")}')">
          <div class="suggest-ico" style="background:#0ea5e9;color:#fff">👤</div>
          <div class="suggest-meta">
            <b>${escH(r.name)}</b>
            <small>${escH(r.contact || 'No phone')} · ${escH(r.address || '')}</small>
          </div>
        </div>
      `).join('')}
      <div class="suggest-item" onmousedown="openResellerProfileModal()" style="border-top:1px dashed var(--line);background:rgba(14,165,233,0.08)">
        <div class="suggest-ico" style="background:#0ea5e9;color:#fff">＋</div>
        <div class="suggest-meta">
          <b>＋ Add New Reseller Profile</b>
          <small>Register a new reseller directly</small>
        </div>
      </div>
    `;

    dropdown.style.display = "block";
  };

  window.selectResellerPick = function(id, name, contact) {
    const input = document.getElementById("resellerPickInput");
    const hidden = document.getElementById("resellerPickId");
    const clearBtn = document.getElementById("resellerPickClear");
    const dropdown = document.getElementById("resellerPickDropdown");

    if (input) input.value = `${name} (${contact || 'Reseller'})`;
    if (hidden) hidden.value = id;
    if (clearBtn) clearBtn.style.display = "block";
    if (dropdown) dropdown.style.display = "none";
  };

  window.clearResellerPickSuggest = function() {
    const input = document.getElementById("resellerPickInput");
    const hidden = document.getElementById("resellerPickId");
    const clearBtn = document.getElementById("resellerPickClear");

    if (input) { input.value = ""; input.focus(); }
    if (hidden) hidden.value = "";
    if (clearBtn) clearBtn.style.display = "none";
    window.filterResellerPickSuggest("");
  };

  window.saveResellerPickup = async function(e) {
    if (e) e.preventDefault();
    const f = F();
    const form = e.target;
    const d = Object.fromEntries(new FormData(form));

    const rId = d.reseller_id;
    if (!rId) { toast('Please search and select a reseller.'); return; }
    const reseller = (f.semenResellers || []).find(x => x.id === rId);
    if (!reseller) { toast('Reseller profile not found.'); return; }

    const validLines = activePickupLines.filter(l => l.boar && l.qty > 0);
    if (!validLines.length) { toast('Please choose at least one valid semen bottle line.'); return; }
    const changedSemenLots = new Set();

    /* [FIX M8] the old pickup silently clamped stock at 0 (max(0, stock − qty)),
       so a 50-bottle line against 10 on hand still billed 50 bottles. Validate
       every line against real on-hand stock before any deduction. */
    const resolved = [];
    for (const l of validLines) {
      let s = null;
      if (l.semen_id) s = (f.semen || []).find(x => x.id === l.semen_id);
      if (!s && l.semen_batch_no) s = (f.semen || []).find(x => x.semen_batch_no === l.semen_batch_no);
      if (!s && l.boar) s = (f.semen || []).find(x => (x.boar === l.boar || x.boar_name === l.boar) && +(x.available_bottles ?? x.bottles ?? 0) > 0);
      if (!s) { toast(`⚠️ Semen batch for "${l.boar}" could not be found. Re-select the stock lot and try again.`); return; }
      const stock = Math.max(0, +(s.available_bottles ?? s.bottles ?? 0));
      if (l.qty > stock) { toast(`⚠️ Only ${stock} bottle(s) on hand for ${s.boar_name || s.boar} — reduce the line quantity (or restock first). Nothing was saved.`); return; }
      resolved.push({ lot: s, qty: Math.floor(l.qty) });
    }

    // Deduct stock from available semen (stock already validated)
    resolved.forEach(({ lot: s, qty }) => {
      const remaining = Math.max(0, +(s.available_bottles ?? s.bottles ?? 0) - qty);
      s.available_bottles = remaining;
      s.bottles = remaining;
      s.updated_at = new Date().toISOString();
      if (remaining === 0) s.status = 'exhausted';
      changedSemenLots.add(s);
    });

    const totalAmt = validLines.reduce((acc, l) => acc + (l.amount || 0), 0);
    const paidAmt = Math.max(0, parseFloat(d.paid_amount || 0) || 0);
    const balance = Math.max(0, totalAmt - paidAmt);

    const txId = 'RTX-' + Date.now().toString(36).toUpperCase();
    const txObj = {
      id: txId,
      reseller_id: reseller.id,
      reseller_name: reseller.name,
      reseller_contact: reseller.contact,
      reseller_address: reseller.address,
      date: (d.timestamp || new Date().toISOString()).slice(0, 10),
      timestamp: d.timestamp ? new Date(d.timestamp).toISOString() : new Date().toISOString(),
      type: 'pickup',
      lines: validLines.map(l => ({
        ...l,
        returned_qty: 0,
        replaced_qty: 0,
        is_returned_replaced: false
      })),
      total_amount: totalAmt,
      discount_amount: 0,
      discount_history: [],
      paid_amount: paidAmt,
      balance: balance,
      pay_method: d.pay_method || 'Cash',
      notes: d.notes || '',
      status: balance === 0 ? 'paid' : (paidAmt > 0 ? 'partially_paid' : 'active')
    };

    ensureResellerData();
    f.semenResellerTx.unshift(txObj);

    // If paid amount > 0, log to farm income
    if (paidAmt > 0) {
      (f.transactions = f.transactions || []).unshift({
        date: txObj.date,
        type: 'Income',
        category: 'Semen Sales',
        description: `Reseller Pickup: ${reseller.name} (${validLines.length} batch lines)`,
        amount: paidAmt,
        paid: paidAmt
      });
    }

    // Commit the complete pickup locally first. A network failure must never
    // leave the modal looking unsaved or discard the reseller transaction.
    txObj.sync_status = 'pending';
    txObj.sync_last_attempt_at = new Date().toISOString();
    save();

    const syncFailures = [];
    if (window.ARSCloud?.syncFarmRecord && window.arsContextReady && window.__arsCloudBaselineReady) {
      const syncPayloads = [
        { entityType: 'semen_reseller_tx', payload: txObj },
        ...[...changedSemenLots].map(lot => ({ entityType: 'semen_inventory', payload: lot }))
      ];
      for (const item of syncPayloads) {
        try {
          const syncResult = await ARSCloud.syncFarmRecord(window.__arsActiveFarmId || farmId, item.entityType, item.payload);
          if (!syncResult || syncResult.success === false) syncFailures.push(syncResult?.reason || `${item.entityType} sync is pending`);
        } catch (syncError) {
          syncFailures.push(syncError.message || String(syncError));
        }
      }
    } else {
      syncFailures.push('verified cloud sync is not ready');
    }

    // The transaction is now visible regardless of network state. Pending
    // changes remain dirty and are retried by the safe background synchronizer.
    txObj.sync_status = syncFailures.length ? 'pending' : 'synced';
    txObj.sync_last_error = syncFailures.join(' · ');
    if (syncFailures.length && window.ARSCloud?.saveLocalRecovery) {
      ARSCloud.saveLocalRecovery(window.__arsActiveFarmId || farmId, F(), 'reseller pickup awaiting cloud synchronization');
    }
    renderAll();
    if (window.refreshOpenDrilldown) window.refreshOpenDrilldown();
    document.getElementById('resellerPickupModal')?.remove();
    if (syncFailures.length) {
      toast(`✔ Pickup #${txId} saved on this device · cloud sync pending`);
      if (window.updateSyncIndicator) window.updateSyncIndicator('pending', 'Pickup pending', 'The pickup is preserved locally and will retry cloud synchronization.');
    } else {
      toast(`✔ Pickup #${txId} recorded and cloud-verified for ${reseller.name}!`);
    }
    openSemenResellerHub();

    // Open receipt with Bluetooth printing immediately
    openResellerTxReceipt(txId);
  };

  /* ── Return & Replacement Workflow ── */
  let activeReturnTxId = null;

  function openResellerReturnReplaceModal(txId) {
    ensureResellerData();
    const f = F();
    const tx = (f.semenResellerTx || []).find(x => x.id === txId);
    if (!tx) { toast('Pickup transaction not found.'); return; }

    activeReturnTxId = txId;
    const available = (f.semen || []).filter(s => +(s.available_bottles ?? s.bottles ?? 0) > 0);

    document.getElementById('resellerReturnModal')?.remove();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg" id="resellerReturnModal" style="z-index:9999999!important">
        <form class="due-modal reseller-hub-wrap" onsubmit="window.saveResellerReturnReplace(event, '${tx.id}')">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:#d97706;font-weight:800">RESELLER RETURN &amp; REPLACEMENT ADJUSTMENT</div>
              <h2>↩ Return / Replace Semen Bottles</h2>
              <p class="muted">Pickup #${escH(tx.id)} · Reseller: <b>${escH(tx.reseller_name)}</b></p>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('resellerReturnModal').remove()">×</button>
          </div>

          <div class="reminder-fields" style="text-align:left">
            <p class="field-hint" style="margin:0 0 10px">Specify returned bottles from this dispatch. Replaced bottles will adjust the bill and automatically deduct stock from the newly chosen semen batch.</p>

            ${(tx.lines || []).map((l, lIdx) => `
              <div style="background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:12px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <b>Line ${lIdx + 1}: ${escH(l.boar)} (${escH(l.breed)})</b>
                  <span class="tag">Original: ${l.qty} @ ${peso(l.rate)} = ${peso(l.amount)}</span>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
                  <div class="field" style="margin:0">
                    <label style="font-size:11px">Returned Qty (bottles)</label>
                    <input type="number" min="0" max="${l.qty}" step="1" name="ret_qty_${lIdx}" value="${l.returned_qty || 0}" class="suggest-input">
                  </div>
                  <div class="field" style="margin:0">
                    <label style="font-size:11px">Return Reason</label>
                    <select name="ret_reason_${lIdx}" class="rfid-select">
                      <option value="Unused / Unsold">Unused / Unsold</option>
                      <option value="Expired">Expired</option>
                      <option value="Cold-Shocked / Dead Motility">Cold-Shocked / Dead Motility</option>
                      <option value="Customer Cancellation">Customer Cancellation</option>
                      <option value="Wrong Breed Dispatched">Wrong Breed Dispatched</option>
                    </select>
                  </div>
                  <div class="field" style="margin:0">
                    <label style="font-size:11px">Inventory Action</label>
                    <select name="ret_action_${lIdx}" class="rfid-select">
                      <option value="discard">Discard / Expired (No Restock)</option>
                      <option value="restock">Restock to Available Bottles</option>
                    </select>
                  </div>
                </div>

                <!-- Replacement Line -->
                <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--line)">
                  <label style="font-size:11px;font-weight:700;color:var(--teal2)">🔁 Give Replacement Semen (Optional)</label>
                  <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;align-items:end">
                    <div class="field" style="margin:0">
                      <select name="rep_semen_${lIdx}" class="rfid-select">
                        <option value="">— No Replacement (Bill Deducted) —</option>
                        ${available.map(s => `
                          <option value="${s.id}">
                            ${s.boar_name || s.boar} (${s.breed}) · ${s.available_bottles ?? s.bottles} left (₱${s.price || 350})
                          </option>
                        `).join('')}
                      </select>
                    </div>
                    <div class="field" style="margin:0">
                      <input type="number" min="0" step="1" name="rep_qty_${lIdx}" placeholder="Replaced Qty" value="${l.replaced_qty || 0}" class="suggest-input">
                    </div>
                    <div class="field" style="margin:0">
                      <input type="number" min="0" step="1" name="rep_rate_${lIdx}" placeholder="New Rate (₱)" value="${l.replacement_rate || l.rate || 350}" class="suggest-input">
                    </div>
                  </div>
                </div>
              </div>
            `).join('')}

            <div class="field full">
              <label>Adjustment Remarks / Signature Note</label>
              <textarea name="adj_notes" placeholder="e.g. 2 Duroc bottles returned due to expired viability; replaced with 2 Large White doses."></textarea>
            </div>
          </div>

          <div class="due-actions" style="margin-top:18px">
            <button type="button" class="btn ghost" onclick="document.getElementById('resellerReturnModal').remove()">Cancel</button>
            <button type="submit" class="btn" style="background:#d97706;color:#fff">✓ Save Adjustment &amp; Print BLE Slip</button>
          </div>
        </form>
      </div>
    `);
  }
  window.openResellerReturnReplaceModal = openResellerReturnReplaceModal;

  window.saveResellerReturnReplace = function(e, txId) {
    if (e) e.preventDefault();
    const f = F();
    const tx = (f.semenResellerTx || []).find(x => x.id === txId);
    if (!tx) { toast('Transaction not found.'); return; }

    const form = e.target;
    const d = Object.fromEntries(new FormData(form));

    let newTotal = 0;
    (tx.lines || []).forEach((l, lIdx) => {
      const retQty = Math.max(0, parseInt(d[`ret_qty_${lIdx}`] || 0, 10) || 0);
      /* [FIX M8] the return/replace form only limited qty by the HTML max
         attribute — a hand-typed value could return MORE bottles than were ever
         dispatched. Cap at what is actually returnable. */
      const alreadyReturned = Math.max(0, +l.returned_qty || 0);
      const returnable = Math.max(0, (+l.qty || 0) - alreadyReturned);
      const realRetQty = Math.min(returnable, retQty);
      if (retQty > returnable) toast(`⚠️ Line ${lIdx + 1}: capped return at ${returnable} bottle(s) (${l.qty} dispatched, ${alreadyReturned} already returned).`);
      const retReason = d[`ret_reason_${lIdx}`] || 'Unused';
      const retAction = d[`ret_action_${lIdx}`] || 'discard';
      const repSemenId = d[`rep_semen_${lIdx}`] || '';
      const repQty = Math.max(0, parseInt(d[`rep_qty_${lIdx}`] || 0, 10) || 0);
      const repRate = Math.max(0, parseFloat(d[`rep_rate_${lIdx}`] || l.rate || 350) || 350);

      l.returned_qty = alreadyReturned + realRetQty;
      l.return_reason = retReason;
      l.return_action = retAction;

      // Handle stock return (uses the validated realRetQty)
      if (realRetQty > 0 && retAction === 'restock') {
        let s = null;
        if (l.semen_id) s = (f.semen || []).find(x => x.id === l.semen_id);
        if (!s && l.semen_batch_no) s = (f.semen || []).find(x => x.semen_batch_no === l.semen_batch_no);
        if (s) {
          const restored = +(s.available_bottles !== undefined ? s.available_bottles : (s.bottles || 0)) + realRetQty;
          s.available_bottles = restored;
          s.bottles = restored;
          if (s.status === 'exhausted' && restored > 0) s.status = 'active';
        }
      }

      // Handle replacement stock deduction — validate against on-hand before deducting
      if (repQty > 0 && repSemenId) {
        const repSemen = (f.semen || []).find(x => x.id === repSemenId || x.semen_batch_no === repSemenId);
        if (repSemen) {
          const repStock = Math.max(0, +(repSemen.available_bottles !== undefined ? repSemen.available_bottles : (repSemen.bottles || 0)));
          if (repQty > repStock) {
            toast(`⚠️ Replacement for line ${lIdx + 1}: capped at ${repStock} bottle(s) on hand for ${repSemen.boar_name || repSemen.boar}.`);
            repQty = repStock;
          }
          const remaining = Math.max(0, repStock - repQty);
          repSemen.available_bottles = remaining;
          repSemen.bottles = remaining;
          if (remaining === 0) repSemen.status = 'exhausted';
          l.replacement_boar = repSemen.boar_name || repSemen.boar || 'Boar';
          l.replacement_breed = repSemen.breed || 'Breed';
          l.replacement_batch_no = repSemen.semen_batch_no || '';
          l.replacement_rate = repRate;
          l.replaced_qty = repQty;
        }
      }

      if (realRetQty > 0 || repQty > 0) {
        l.is_returned_replaced = true;
      }

      // Re-align line amount (kept = original − cumulative returns)
      const keptQty = Math.max(0, l.qty - l.returned_qty);
      l.amount = (keptQty * l.rate) + (repQty * repRate);
      newTotal += l.amount;
    });

    tx.total_amount = newTotal;
    tx.balance = Math.max(0, newTotal - (tx.paid_amount || 0));
    tx.status = 'returned_replaced';
    tx.adjustment_notes = d.adj_notes || '';
    tx.adjusted_at = new Date().toISOString();

    save();
    renderAll();
    if (window.refreshOpenDrilldown) window.refreshOpenDrilldown();
    document.getElementById('resellerReturnModal')?.remove();
    toast(`✓ Return & Replacement adjustment saved for #${tx.id}!`);
    openSemenResellerHub();

    // Open receipt with Bluetooth printing
    openResellerTxReceipt(tx.id);
  };

  function resellerPaymentPreview(fromDiscount = false) {
    const original = Math.max(0, parseFloat(document.getElementById('resellerPayOriginalBalance')?.value || 0) || 0);
    const discountInput = document.getElementById('resellerDiscountAmount');
    const paymentInput = document.getElementById('resellerPaymentAmount');
    const discount = Math.max(0, parseFloat(discountInput?.value || 0) || 0);
    const net = Math.max(0, original - discount);
    if (fromDiscount && paymentInput && (paymentInput.dataset.autoBalance === 'true' || Math.abs((parseFloat(paymentInput.value || 0) || 0) - original) < 0.005)) {
      paymentInput.value = net.toFixed(2);
      paymentInput.dataset.autoBalance = 'true';
    }
    if (!fromDiscount && paymentInput) paymentInput.dataset.autoBalance = 'false';
    const payment = Math.max(0, parseFloat(paymentInput?.value || 0) || 0);
    const preview = document.getElementById('resellerSettlementPreview');
    if (preview) {
      preview.innerHTML = discount > original
        ? `<b style="color:var(--danger)">Discount cannot exceed the current balance of ${peso(original)}.</b>`
        : `Net balance after adjustment: <b>${peso(net)}</b> · Payment to record: <b>${peso(payment)}</b> · Remaining after this entry: <b>${peso(Math.max(0, net - payment))}</b>`;
    }
    const reason = document.getElementById('resellerDiscountReason');
    const reasonLabel = document.getElementById('resellerDiscountReasonRequired');
    if (reason) reason.required = discount > 0;
    if (reasonLabel) reasonLabel.style.color = discount > 0 ? 'var(--danger)' : '';
  }
  window.resellerPaymentPreview = resellerPaymentPreview;

  /* ── Record Reseller Payment Modal ── */
  function openResellerPaymentModal(resellerId, txId = '') {
    ensureResellerData();
    const f = F();
    const r = (f.semenResellers || []).find(x => x.id === resellerId);
    if (!r) { toast('Reseller profile not found.'); return; }

    const account = resellerAccountTotals(f, r);
    const rTxs = account.txs;
    const rBilled = account.billed;
    const rDiscounts = account.discounts;
    const rPaid = account.paid;
    const rBal = account.balance;

    document.getElementById('resellerPayModal')?.remove();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg" id="resellerPayModal" style="z-index:9999999!important">
        <form class="due-modal" style="text-align:left" onsubmit="window.saveResellerPayment(event, '${r.id}', '${txId || ''}')">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:var(--ok);font-weight:700">COLLECTION &amp; SETTLEMENT</div>
              <h2>💰 Log Reseller Payment</h2>
              <p class="muted">Reseller: <b>${escH(r.name)}</b> · Current Balance: <b style="color:var(--warn)">${peso(rBal)}</b></p>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('resellerPayModal').remove()">×</button>
          </div>

          <input type="hidden" id="resellerPayOriginalBalance" value="${rBal}">
          <div class="reseller-settlement-summary">
            <span>Gross billed <b>${peso(rBilled)}</b></span>
            <span>Existing discounts <b>${peso(rDiscounts)}</b></span>
            <span>Paid so far <b>${peso(rPaid)}</b></span>
            <span>Current balance <b>${peso(rBal)}</b></span>
          </div>
          <div class="reminder-fields">
            <div class="field">
              <label>Payment Amount (₱)</label>
              <input type="number" min="0" max="${rBal}" step="0.01" name="amount" id="resellerPaymentAmount" value="${rBal || 0}" placeholder="e.g. 1500" class="suggest-input" style="font-size:18px;font-weight:bold;color:var(--ok)" data-auto-balance="true" oninput="window.resellerPaymentPreview(false)">
              <small class="field-hint">Enter 0 for a discount/readjustment-only entry.</small>
            </div>
            <div class="field">
              <label>Discount / Readjustment Amount (₱)</label>
              <input type="number" min="0" max="${rBal}" step="0.01" name="discount_amount" id="resellerDiscountAmount" value="0" placeholder="e.g. 250" class="suggest-input" oninput="window.resellerPaymentPreview(true)">
              <small class="field-hint">Reduces the receivable; it is not cash collected.</small>
            </div>
            <div class="field full">
              <label>Reason for Discount / Readjustment <span id="resellerDiscountReasonRequired" class="muted">(required when amount is entered)</span></label>
              <input type="text" name="discount_reason" id="resellerDiscountReason" placeholder="e.g. Loyalty discount, damaged stock, approved price correction" class="suggest-input">
            </div>
            <div class="field full">
              <div id="resellerSettlementPreview" class="reseller-settlement-preview">Net balance after adjustment: <b>${peso(rBal)}</b> · Payment to record: <b>${peso(rBal)}</b></div>
            </div>
            <div class="field">
              <label>Payment Date &amp; Time * </label>
              <input type="datetime-local" name="timestamp" value="${localDateTimeValue()}" required class="suggest-input">
            </div>
            <div class="field">
              <label>Payment Method *</label>
              <select name="method" class="rfid-select">
                <option value="Cash">Cash</option>
                <option value="GCash">GCash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Check">Check</option>
              </select>
            </div>
            <div class="field full">
              <label>Reference / Official Receipt / Remarks</label>
              <input type="text" name="notes" placeholder="e.g. GCash Ref #123456789 or Weekly Remittance" class="suggest-input">
            </div>
          </div>
          <div class="form-error" id="resellerPayError" role="alert"></div>

          <div class="due-actions" style="margin-top:16px">
            <button type="button" class="btn ghost" onclick="document.getElementById('resellerPayModal').remove()">Cancel</button>
            <button type="submit" class="btn" style="background:var(--ok);color:#fff">✓ Save Settlement &amp; Print BLE</button>
          </div>
        </form>
      </div>
    `);
  }
  window.openResellerPaymentModal = openResellerPaymentModal;

  window.saveResellerPayment = function(e, resellerId, txId) {
    if (e) e.preventDefault();
    const f = F();
    const r = (f.semenResellers || []).find(x => x.id === resellerId);
    const form = e?.target;
    const errorBox = document.getElementById('resellerPayError');
    const showError = message => {
      if (errorBox) {
        errorBox.textContent = message;
        errorBox.classList.add('show');
      } else toast(message);
    };
    if (!r || !form) return;

    const d = Object.fromEntries(new FormData(form));
    const account = resellerAccountTotals(f, r);
    const payAmt = Math.max(0, parseFloat(d.amount || 0) || 0);
    const discountAmt = Math.max(0, parseFloat(d.discount_amount || 0) || 0);
    const discountReason = String(d.discount_reason || '').trim();
    const netAfterDiscount = Math.max(0, account.balance - discountAmt);
    const entryDate = d.timestamp && !Number.isNaN(new Date(d.timestamp).getTime())
      ? new Date(d.timestamp).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    if (payAmt <= 0 && discountAmt <= 0) {
      showError('Enter a payment amount, a discount/readjustment amount, or both.');
      return;
    }
    if (discountAmt > account.balance) {
      showError(`The discount cannot exceed the current outstanding balance of ${peso(account.balance)}.`);
      return;
    }
    if (discountAmt > 0 && !discountReason) {
      showError('A reason is required whenever a discount or readjustment is entered.');
      document.getElementById('resellerDiscountReason')?.focus();
      return;
    }
    if (payAmt > netAfterDiscount) {
      showError(`Payment exceeds the balance after adjustment (${peso(netAfterDiscount)}). Reduce the payment amount.`);
      return;
    }

    // Apply any approved discount/readjustment FIFO to open pickup invoices.
    // The original billed amount remains intact; the discount is recorded as a
    // separate contra-revenue adjustment and the invoice balance is recalculated.
    const originalOpen = sortResellerTransactions(account.txs.filter(tx => resellerTxBalance(tx) > 0));
    const ordered = [];
    if (txId) {
      const specific = originalOpen.find(tx => tx.id === txId);
      if (specific) ordered.push(specific);
    }
    originalOpen.forEach(tx => { if (!ordered.includes(tx)) ordered.push(tx); });

    let remainingDiscount = discountAmt;
    const discountAllocations = [];
    const adjustmentId = `RADJ-${Date.now().toString(36).toUpperCase()}`;
    ordered.forEach(tx => {
      if (remainingDiscount <= 0) return;
      const available = resellerTxBalance(tx);
      const applied = Math.min(available, remainingDiscount);
      if (applied <= 0) return;
      tx.discount_amount = resellerTxDiscount(tx) + applied;
      tx.discount_history = Array.isArray(tx.discount_history) ? tx.discount_history : [];
      tx.discount_history.push({
        id: adjustmentId,
        amount: applied,
        reason: discountReason,
        date: entryDate,
        at: new Date().toISOString(),
        type: 'discount_readjustment'
      });
      recalculateResellerTx(tx);
      discountAllocations.push({ tx_id: tx.id, amount: applied });
      remainingDiscount -= applied;
    });
    if (remainingDiscount > 0.005) {
      showError('The discount could not be allocated across the reseller invoices. No entry was saved.');
      return;
    }

    if (discountAmt > 0) {
      f.semenResellerAdjustments = Array.isArray(f.semenResellerAdjustments) ? f.semenResellerAdjustments : [];
      f.semenResellerAdjustments.unshift({
        id: adjustmentId,
        reseller_id: r.id,
        reseller_name: r.name,
        type: 'discount_readjustment',
        amount: discountAmt,
        reason: discountReason,
        date: entryDate,
        timestamp: d.timestamp || new Date().toISOString(),
        allocation: discountAllocations,
        status: 'active',
        created_at: new Date().toISOString()
      });
      // Keep this in the reseller subledger. It reduces the reseller
      // receivable but is not cash collected. The existing farm financial
      // transaction policy remains unchanged until full accrual accounting is
      // explicitly enabled for reseller invoices.
    }

    // Allocate the actual cash payment only after the adjustment is applied.
    let remainingPay = payAmt;
    const paymentAllocations = [];
    ordered.forEach(tx => {
      if (remainingPay <= 0) return;
      const available = resellerTxBalance(tx);
      const applied = Math.min(available, remainingPay);
      if (applied <= 0) return;
      tx.paid_amount = Math.max(0, +(tx.paid_amount || 0)) + applied;
      recalculateResellerTx(tx);
      paymentAllocations.push({ tx_id: tx.id, amount: applied });
      remainingPay -= applied;
    });
    if (remainingPay > 0.005) {
      showError('The payment could not be allocated safely. No entry was saved.');
      return;
    }

    if (payAmt > 0) {
      (f.transactions = f.transactions || []).unshift({
        id: `tx-${Date.now().toString(36)}-respay`,
        date: entryDate,
        type: 'Income',
        category: 'Semen Sales',
        description: `Reseller Payment: ${r.name} (${d.method || 'Cash'}${d.notes ? ' · ' + d.notes : ''})`,
        amount: payAmt,
        paid: payAmt,
        reseller_id: r.id,
        payment_allocations: paymentAllocations,
        created_at: new Date().toISOString()
      });
    }

    save();
    document.getElementById('resellerPayModal')?.remove();
    const current = resellerAccountTotals(f, r);
    const actionText = discountAmt > 0 && payAmt > 0
      ? `payment ${peso(payAmt)} + discount ${peso(discountAmt)}`
      : discountAmt > 0 ? `discount/readjustment ${peso(discountAmt)}` : `payment ${peso(payAmt)}`;
    toast(`✔ ${actionText} recorded for ${r.name} · remaining balance ${peso(current.balance)}`);
    openSemenResellerHub();

    // Print the updated account statement, including the discount reason.
    window.btPrintResellerStatement(r.id, payAmt, discountAmt, discountReason);
  };

  /* ── Edit Reseller Transaction Modal ── */
  function openEditResellerTxModal(txId) {
    ensureResellerData();
    const f = F();
    const tx = (f.semenResellerTx || []).find(x => x.id === txId);
    if (!tx) { toast('Transaction not found.'); return; }

    document.getElementById('editResellerTxModal')?.remove();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg" id="editResellerTxModal" style="z-index:9999999!important">
        <form class="due-modal" style="text-align:left" onsubmit="window.saveEditResellerTx(event, '${tx.id}')">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:var(--teal2);font-weight:700">CORRECT TRANSACTION</div>
              <h2>✎ Edit Pickup #${escH(tx.id)}</h2>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('editResellerTxModal').remove()">×</button>
          </div>

          <div class="reminder-fields">
            <div class="field full">
              <label>Pickup Date &amp; Time</label>
              <input type="datetime-local" name="timestamp" value="${localDateTimeValue(tx.timestamp || new Date())}" required class="suggest-input">
            </div>
            <div class="field">
              <label>Total Amount (₱)</label>
              <input type="number" min="0" step="1" name="total_amount" value="${tx.total_amount}" required class="suggest-input">
            </div>
            <div class="field">
              <label>Paid Amount (₱)</label>
              <input type="number" min="0" step="1" name="paid_amount" value="${tx.paid_amount}" required class="suggest-input">
            </div>
            <div class="field full">
              <label>Notes / Remarks</label>
              <textarea name="notes" placeholder="Notes">${escH(tx.notes || '')}</textarea>
            </div>
          </div>

          <div class="due-actions" style="margin-top:16px">
            <button type="button" class="btn ghost" onclick="document.getElementById('editResellerTxModal').remove()">Cancel</button>
            <button type="submit" class="btn">✓ Save Changes</button>
          </div>
        </form>
      </div>
    `);
  }
  window.openEditResellerTxModal = openEditResellerTxModal;

  window.saveEditResellerTx = function(e, txId) {
    if (e) e.preventDefault();
    const f = F();
    const tx = (f.semenResellerTx || []).find(x => x.id === txId);
    if (!tx) return;

    const form = e.target;
    const d = Object.fromEntries(new FormData(form));

    tx.timestamp = d.timestamp ? new Date(d.timestamp).toISOString() : tx.timestamp;
    tx.date = tx.timestamp.slice(0, 10);
    tx.total_amount = Math.max(0, parseFloat(d.total_amount || 0) || 0);
    tx.paid_amount = Math.max(0, parseFloat(d.paid_amount || 0) || 0);
    tx.balance = Math.max(0, tx.total_amount - tx.paid_amount);
    tx.notes = d.notes || '';

    save();
    document.getElementById('editResellerTxModal')?.remove();
    toast(`✓ Pickup #${txId} updated.`);
    openSemenResellerHub();
  };

  /* ── Delete Reseller Transaction ── */
  function deleteResellerTx(txId) {
    ensureResellerData();
    const f = F();
    const tx = (f.semenResellerTx || []).find(x => x.id === txId);
    if (!tx) return;

    if (!confirm(`Delete pickup transaction #${tx.id} for ${tx.reseller_name}?\n\nThis removes the record, restores the semen stock, and recalculates the balance.`)) return;

    const cleanTxId = String(tx.id || txId).trim();

    // 1. Add to persistent tombstones so sync never resurrects it
    f.deleted_ids = f.deleted_ids || [];
    if (cleanTxId && !f.deleted_ids.includes(cleanTxId)) {
      f.deleted_ids.push(cleanTxId);
    }

    // 2. Restore deducted bottles back to semen stock
    (tx.lines || []).forEach(l => {
      if (l.qty > 0) {
        let s = null;
        if (l.semen_id) s = (f.semen || []).find(x => x.id === l.semen_id);
        if (!s && l.semen_batch_no) s = (f.semen || []).find(x => x.semen_batch_no === l.semen_batch_no);
        if (!s && l.boar) s = (f.semen || []).find(x => x.boar === l.boar || x.boar_name === l.boar);
        if (s) {
          const restored = +(s.available_bottles !== undefined ? s.available_bottles : (s.bottles || 0)) + (+l.qty || 0);
          s.available_bottles = restored;
          s.bottles = restored;
          if (s.status === 'exhausted' && restored > 0) s.status = 'active';
        }
      }
    });

    // 3. Remove transaction from ALL local DB buckets
    if (window.DB) {
      Object.keys(DB).forEach(fKey => {
        if (DB[fKey]) {
          if (Array.isArray(DB[fKey].semenResellerTx)) {
            DB[fKey].semenResellerTx = DB[fKey].semenResellerTx.filter(x => String(x.id).trim() !== cleanTxId);
          }
          if (Array.isArray(DB[fKey].deleted_ids) && cleanTxId && !DB[fKey].deleted_ids.includes(cleanTxId)) {
            DB[fKey].deleted_ids.push(cleanTxId);
          }
        }
      });
    }

    // 4. Purge from cloud database
    const currentFarmId = window.farmId || (typeof getFarmId === 'function' ? getFarmId() : 'farm-rm');
    if (window.ARSCloud && typeof ARSCloud.deleteAppRecord === 'function' && currentFarmId && cleanTxId) {
      ARSCloud.deleteAppRecord(currentFarmId, 'semen_reseller_tx', cleanTxId).catch(() => {});
    }

    save();
    renderAll();
    if (window.refreshOpenDrilldown) window.refreshOpenDrilldown();
    toast(`✓ Transaction #${cleanTxId} deleted permanently.`);
    openSemenResellerHub();
  }
  window.deleteResellerTx = deleteResellerTx;

  /* ── 58mm Receipt & Bluetooth Printing for Reseller Pickups ── */
  function openResellerTxReceipt(txId) {
    ensureResellerData();
    const f = F();
    const tx = (f.semenResellerTx || []).find(x => x.id === txId);
    if (!tx) { toast('Transaction not found.'); return; }

    const when = tx.timestamp ? new Date(tx.timestamp).toLocaleString([], {month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'}) : fmtDate(tx.date);
    const hasReturn = (tx.lines || []).some(l => l.is_returned_replaced || l.returned_qty > 0 || l.replaced_qty > 0);

    document.getElementById('resellerReceiptModal')?.remove();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="drill-bg" id="resellerReceiptModal" style="z-index:9999999!important">
        <div class="semen-receipt-wrap">
          <div class="sale-receipt">
            <div class="rc-farm">${escH(f.name || 'RM\'s Hog Farm')}</div>
            <div class="rc-tag">SEMEN CONSIGNMENT PICKUP RECEIPT</div>
            <div class="rc-rule"></div>
            <div class="rc-meta">
              <div>Receipt: <b>${escH(tx.id)}</b></div>
              <div>Date: ${escH(when)}</div>
              <div>Reseller: <b>${escH(tx.reseller_name)}</b></div>
              <div>Contact: ${escH(tx.reseller_contact || '—')}</div>
            </div>
            <div class="rc-rule"></div>

            <!-- Items -->
            ${(tx.lines || []).map(l => `
              <div style="margin-bottom:6px">
                <div style="display:flex;justify-content:space-between">
                  <b>${escH(l.boar)} (${escH(l.breed)})</b>
                  <b>${peso(l.amount)}</b>
                </div>
                <small class="muted" style="display:block">Batch: ${escH(l.semen_batch_no || '—')} · ${l.qty} bottle(s) × ${peso(l.rate)}</small>
                ${l.returned_qty ? `<small style="color:#d97706;display:block">↩ Returned: ${l.returned_qty} bottle(s) (${escH(l.return_reason || '')})</small>` : ''}
                ${l.replaced_qty ? `<small style="color:var(--teal2);display:block">🔁 Replaced with: ${escH(l.replacement_boar)} × ${l.replaced_qty} @ ${peso(l.replacement_rate)}</small>` : ''}
              </div>
            `).join('')}

            <div class="rc-rule"></div>
            <div class="rc-totals">
              <div style="display:flex;justify-content:space-between"><span>TOTAL BILLED:</span><b>${peso(tx.total_amount)}</b></div>
              ${resellerTxDiscount(tx) > 0 ? `<div style="display:flex;justify-content:space-between"><span>DISCOUNT / READJUSTMENT:</span><b style="color:var(--ok)">−${peso(resellerTxDiscount(tx))}</b></div>` : ''}
              <div style="display:flex;justify-content:space-between"><span>PAID AMOUNT:</span><b style="color:var(--ok)">${peso(tx.paid_amount || 0)}</b></div>
              <div style="display:flex;justify-content:space-between"><span>BALANCE DUE:</span><b style="color:${resellerTxBalance(tx) > 0 ? 'var(--warn)' : 'var(--ok)'}">${peso(resellerTxBalance(tx))}</b></div>
            </div>
            ${hasReturn ? `<div style="text-align:center;margin-top:8px"><span class="blinking-tag-return">🔄 ADJUSTMENT APPLIED</span></div>` : ''}
            <div class="rc-rule"></div>
            <div style="text-align:center;font-size:11px;color:var(--muted)">Thank you for trusting ${escH(f.name || 'our farm')}!</div>
          </div>

          <div class="due-actions no-print" style="justify-content:center;margin-top:14px">
            <button type="button" class="btn ghost" onclick="document.getElementById('resellerReceiptModal').remove()">Close</button>
            <button type="button" class="btn ghost" onclick="window.print()">🖨 System Print</button>
            <button type="button" class="btn" style="background:#0ea5e9;color:#fff" onclick="window.btPrintResellerTx('${tx.id}')">📶 Print via Bluetooth</button>
          </div>

          <!-- DIRECT BLUETOOTH PRINTER CONTROL PANEL -->
          <div class="bt-panel no-print" style="margin-top:14px">
            <div class="eyebrow">DIRECT BLUETOOTH THERMAL PRINTER</div>
            <div id="btResStatus" class="bt-status"></div>
            <div class="bt-row">
              <button type="button" class="btn ghost" id="btResScanBtn" onclick="btScanPrinter()">🔍 Scan &amp; connect</button>
              <button type="button" class="btn" id="btResPrintBtn" onclick="window.btPrintResellerTx('${tx.id}')">🖨 Print via Bluetooth</button>
              <button type="button" class="btn ghost" id="btResDiscBtn" style="display:none" onclick="btDisconnect()">Disconnect</button>
            </div>
            <p class="rc-hint" style="margin:0">💡 Connects directly to 58mm BLE POS thermal printers to stream this receipt.</p>
          </div>
        </div>
      </div>
    `);
    btUi();
  }
  window.openResellerTxReceipt = openResellerTxReceipt;

  /* ── Print Reseller Statement ── */
  function openResellerStatement(resellerId) {
    ensureResellerData();
    const f = F();
    const r = (f.semenResellers || []).find(x => x.id === resellerId);
    if (!r) return;

    const account = resellerAccountTotals(f, r);
    const rTxs = account.txs;
    const rBilled = account.billed;
    const rDiscounts = account.discounts;
    const rPaid = account.paid;
    const rNetBilled = account.netBilled;
    const rBal = account.balance;
    const adjustments = (f.semenResellerAdjustments || []).filter(adj => adj.reseller_id === r.id).sort((a, b) => String(b.timestamp || b.date || '').localeCompare(String(a.timestamp || a.date || '')));

    document.getElementById('resellerStatementModal')?.remove();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="drill-bg" id="resellerStatementModal" style="z-index:9999999!important">
        <div class="semen-receipt-wrap">
          <div class="sale-receipt">
            <div class="rc-farm">${escH(f.name || 'RM\'s Hog Farm')}</div>
            <div class="rc-tag">STATEMENT OF ACCOUNT · RESELLER</div>
            <div class="rc-rule"></div>
            <div class="rc-meta">
              <div>Reseller: <b>${escH(r.name)}</b></div>
              <div>Contact: ${escH(r.contact || '—')}</div>
              <div>Address: ${escH(r.address || '—')}</div>
              <div>Date Generated: ${new Date().toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})}</div>
            </div>
            <div class="rc-rule"></div>

            <div style="font-size:11px;font-weight:bold;margin-bottom:6px">TRANSACTION HISTORY:</div>
            ${rTxs.map(tx => `
              <div style="font-size:11.5px;padding:4px 0;border-bottom:1px dashed var(--line)">
                <div style="display:flex;justify-content:space-between">
                  <span>${fmtDate(tx.date)} · #${escH(tx.id)}</span>
                  <b>${peso(tx.total_amount)}</b>
                </div>
                ${resellerTxDiscount(tx) > 0 ? `<small style="display:block;color:var(--ok)">Discount / readjustment: −${peso(resellerTxDiscount(tx))}</small>` : ''}
                <small class="muted">Paid: ${peso(tx.paid_amount || 0)} · Bal: ${peso(resellerTxBalance(tx))}</small>
              </div>
            `).join('') || '<p class="muted">No transactions on file.</p>'}

            ${adjustments.length ? `<div class="rc-rule"></div><div style="font-size:11px;font-weight:bold;margin-bottom:6px">DISCOUNTS / READJUSTMENTS:</div>${adjustments.map(adj => `<div style="font-size:11.5px;padding:4px 0;border-bottom:1px dashed var(--line)"><div style="display:flex;justify-content:space-between"><span>${fmtDate(adj.date)} · ${escH(adj.type === 'discount_readjustment' ? 'Discount / Readjustment' : 'Adjustment')}</span><b style="color:var(--ok)">−${peso(adj.amount)}</b></div><small class="muted">Reason: ${escH(adj.reason || '—')}</small></div>`).join('')}` : ''}

            <div class="rc-rule"></div>
            <div class="rc-totals">
              <div style="display:flex;justify-content:space-between"><span>TOTAL BILLED:</span><b>${peso(rBilled)}</b></div>
              <div style="display:flex;justify-content:space-between"><span>DISCOUNTS / READJUSTMENTS:</span><b style="color:var(--ok)">−${peso(rDiscounts)}</b></div>
              <div style="display:flex;justify-content:space-between"><span>NET AMOUNT DUE:</span><b>${peso(rNetBilled)}</b></div>
              <div style="display:flex;justify-content:space-between"><span>TOTAL COLLECTED:</span><b style="color:var(--ok)">${peso(rPaid)}</b></div>
              <div style="display:flex;justify-content:space-between"><span>OUTSTANDING BALANCE:</span><b style="color:${rBal > 0 ? 'var(--warn)' : 'var(--ok)'}">${peso(rBal)}</b></div>
            </div>
          </div>

          <div class="due-actions no-print" style="justify-content:center;margin-top:14px">
            <button type="button" class="btn ghost" onclick="document.getElementById('resellerStatementModal').remove()">Close</button>
            <button type="button" class="btn ghost" onclick="window.print()">🖨 Print / PDF</button>
            <button type="button" class="btn" style="background:#0ea5e9;color:#fff" onclick="window.btPrintResellerStatement('${r.id}')">📶 Print via Bluetooth</button>
          </div>

          <!-- DIRECT BLUETOOTH PRINTER CONTROL PANEL -->
          <div class="bt-panel no-print" style="margin-top:14px">
            <div class="eyebrow">DIRECT BLUETOOTH THERMAL PRINTER</div>
            <div id="btResStatus" class="bt-status"></div>
            <div class="bt-row">
              <button type="button" class="btn ghost" id="btResScanBtn" onclick="btScanPrinter()">🔍 Scan &amp; connect</button>
              <button type="button" class="btn" id="btResPrintBtn" onclick="window.btPrintResellerStatement('${r.id}')">🖨 Print via Bluetooth</button>
              <button type="button" class="btn ghost" id="btResDiscBtn" style="display:none" onclick="btDisconnect()">Disconnect</button>
            </div>
            <p class="rc-hint" style="margin:0">💡 Connects directly to 58mm BLE POS thermal printers to stream this statement.</p>
          </div>
        </div>
      </div>
    `);
    btUi();
  }
  window.openResellerStatement = openResellerStatement;

  /* ── Direct Web Bluetooth ESC/POS Printing for Reseller Receipts & Statements ── */
  async function btPrintResellerTx(txId) {
    ensureResellerData();
    const f = F();
    const tx = (f.semenResellerTx || []).find(x => x.id === txId);
    if (!tx) { toast('Transaction not found.'); return; }

    if (!btChar) {
      if (window.toast) toast("⚠ Please connect your Bluetooth thermal printer first.");
      await btScanPrinter();
      if (!btChar) return;
    }

    if (window.toast) toast(`🖨 Printing receipt on ${btDev?.name || "Bluetooth POS"}…`);

    try {
      const W = 32;
      const P = v => "P" + (+v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const sep = "-".repeat(W);
      const row = (l, r) => { let g = W - String(l).length - String(r).length; return String(l) + " ".repeat(Math.max(1, g)) + String(r); };

      const L = [];
      const add = (t, o = {}) => L.push({ t: String(t).replace(/·/g, "-").replace(/↩/g, "<-").replace(/×/g, "x").replace(/₱/g, "P").replace(/[^\x20-\x7E]/g, ""), c: !!o.c, b: !!o.b });

      add(f.name || "Farm Operations", { c: 1, b: 1 });
      add("RESELLER PICKUP RECEIPT", { c: 1 });
      add(`Receipt ${tx.id}`);
      add(new Date(tx.timestamp || tx.date).toLocaleString("en-PH"));
      add(sep);
      add(`Reseller: ${tx.reseller_name}`);
      add(`Contact: ${tx.reseller_contact || "-"}`);
      add(sep);

      add("SEMEN BOTTLES:", { b: 1 });
      (tx.lines || []).forEach(l => {
        add(`${l.boar} (${l.breed})`);
        add(`  Batch: ${l.semen_batch_no || "-"}`);
        add(row(`  ${l.qty} bottle(s) x ${P(l.rate)}`, P(l.amount)));
        if (l.returned_qty) add(`  [!] RET: ${l.returned_qty} bottle(s)`);
        if (l.replaced_qty) add(`  [+] REP: ${l.replacement_boar} x${l.replaced_qty} @ ${P(l.replacement_rate)}`);
      });

      add(sep);
      add(row("TOTAL BILLED:", P(tx.total_amount)));
      if (resellerTxDiscount(tx) > 0) add(row("DISCOUNT / READJ:", "-" + P(resellerTxDiscount(tx))));
      add(row("PAID AMOUNT:", P(tx.paid_amount || 0)));
      add(row("BALANCE DUE:", P(resellerTxBalance(tx))));
      if (tx.status === 'returned_replaced') add("** ADJUSTMENT APPLIED **", { c: 1 });
      add(sep);
      add("Thank you for your business!", { c: 1 });

      const bytes = escPosFromLines(L);
      await sendEscPosBytes(bytes);
      if (window.toast) toast("✔ Bluetooth receipt printed successfully!");
    } catch (e) {
      console.warn("BT print error:", e);
      if (window.toast) toast("⚠ Bluetooth print error: " + ((e && e.message) || e));
    }
  }
  window.btPrintResellerTx = btPrintResellerTx;

  async function btPrintResellerStatement(resellerId, justPaid = 0, justDiscount = 0, discountReason = '') {
    ensureResellerData();
    const f = F();
    const r = (f.semenResellers || []).find(x => x.id === resellerId);
    if (!r) return;
    const account = resellerAccountTotals(f, r);

    if (!btChar) {
      if (window.toast) toast("⚠ Please connect your Bluetooth thermal printer first.");
      await btScanPrinter();
      if (!btChar) return;
    }

    if (window.toast) toast(`🖨 Printing statement for ${r.name} on ${btDev?.name || "Bluetooth POS"}…`);

    try {
      const rTxs = account.txs;
      const rBilled = account.billed;
      const rDiscounts = account.discounts;
      const rNetBilled = account.netBilled;
      const rPaid = account.paid;
      const rBal = account.balance;

      const W = 32;
      const P = v => "P" + (+v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const sep = "-".repeat(W);
      const row = (l, r) => { let g = W - String(l).length - String(r).length; return String(l) + " ".repeat(Math.max(1, g)) + String(r); };
      const wrap = text => {
        const lines = [];
        let current = '';
        String(text || '').split(/\s+/).forEach(word => {
          if ((current + ' ' + word).trim().length > W) {
            if (current.trim()) lines.push(current.trim());
            current = word;
          } else current = current ? current + ' ' + word : word;
        });
        if (current.trim()) lines.push(current.trim());
        return lines;
      };

      const L = [];
      const add = (t, o = {}) => L.push({ t: String(t).replace(/·/g, "-").replace(/↩/g, "<-").replace(/×/g, "x").replace(/₱/g, "P").replace(/[^\x20-\x7E]/g, ""), c: !!o.c, b: !!o.b });

      add(f.name || "Farm Operations", { c: 1, b: 1 });
      add("RESELLER STATEMENT", { c: 1 });
      add(`Account: ${r.name}`, { b: 1 });
      add(`Contact: ${r.contact || "-"}`);
      add(`Date: ${new Date().toLocaleDateString("en-PH")}`);
      add(sep);

      if (justPaid > 0) {
        add(row("PAYMENT RECEIVED:", P(justPaid)), { b: 1 });
      }
      if (justDiscount > 0) {
        add(row("DISCOUNT APPLIED:", "-" + P(justDiscount)), { b: 1 });
        if (discountReason) wrap("Reason: " + discountReason).forEach(line => add(line));
      }
      if (justPaid > 0 || justDiscount > 0) add(sep);

      add("RECENT TRANSACTIONS:", { b: 1 });
      rTxs.slice(0, 6).forEach(tx => {
        add(`${tx.date} #${tx.id.slice(-6)}:`);
        add(row(`  Billed ${P(tx.total_amount)}`, `Bal ${P(resellerTxBalance(tx))}`));
        if (resellerTxDiscount(tx) > 0) add(row(`  Disc ${P(resellerTxDiscount(tx))}`, `Paid ${P(tx.paid_amount || 0)}`));
      });

      add(sep);
      add(row("TOTAL BILLED:", P(rBilled)));
      add(row("DISCOUNTS / READJ:", "-" + P(rDiscounts)));
      add(row("NET AMOUNT DUE:", P(rNetBilled)));
      add(row("TOTAL COLLECTED:", P(rPaid)));
      add(row("OUTSTANDING BAL:", P(rBal)), { b: 1 });
      add(sep);
      add("ARSwineTech Pro System", { c: 1 });

      const bytes = escPosFromLines(L);
      await sendEscPosBytes(bytes);
      if (window.toast) toast("✔ Reseller statement printed via Bluetooth!");
    } catch (e) {
      console.warn("BT statement print error:", e);
      if (window.toast) toast("⚠ Bluetooth print error: " + ((e && e.message) || e));
    }
  }
  window.btPrintResellerStatement = btPrintResellerStatement;

  function escPosFromLines(L) {
    const bytes = [0x1B, 0x40]; // ESC @ init
    L.forEach(line => {
      if (line.c) bytes.push(0x1B, 0x61, 0x01); // Center
      else bytes.push(0x1B, 0x61, 0x00); // Left
      if (line.b) bytes.push(0x1B, 0x45, 0x01); // Bold on
      else bytes.push(0x1B, 0x45, 0x00); // Bold off

      for (let i = 0; i < line.t.length; i++) {
        bytes.push(line.t.charCodeAt(i) & 0xFF);
      }
      bytes.push(0x0A); // Linefeed
    });
    bytes.push(0x0A, 0x0A, 0x0A); // Feed 3 lines
    bytes.push(0x1D, 0x56, 0x42, 0x00); // GS V B 0 Cut paper
    return new Uint8Array(bytes);
  }

  /* ── exports ─────────────────────────────────────────────────────────── */
  window.openSemenDiscardModal = openSemenDiscardModal;
  window.saveSemenDiscard = saveSemenDiscard;
  window.openSemenResellerHub = openSemenResellerHub;
  window.openResellerProfileModal = openResellerProfileModal;
  window.deleteResellerProfile = deleteResellerProfile;
  window.openResellerPickupModal = openResellerPickupModal;
  window.onPickupBatchSelect = onPickupBatchSelect;
  window.onPickupLineQtyChange = onPickupLineQtyChange;
  window.onPickupLineQtyBlur = onPickupLineQtyBlur;
  window.onPickupLineRateChange = onPickupLineRateChange;
  window.onPickupLineRateBlur = onPickupLineRateBlur;
  window.addPickupLine = addPickupLine;
  window.removePickupLine = removePickupLine;
  window.calcPickupTotals = calcPickupTotals;
  window.openResellerReturnReplaceModal = openResellerReturnReplaceModal;
  window.openResellerPaymentModal = openResellerPaymentModal;
  window.openEditResellerTxModal = openEditResellerTxModal;
  window.deleteResellerTx = deleteResellerTx;
  window.openResellerTxReceipt = openResellerTxReceipt;
  window.openResellerStatement = openResellerStatement;
  window.btPrintResellerTx = btPrintResellerTx;
  window.btPrintResellerStatement = btPrintResellerStatement;
  window.filterResellerAccounts = filterResellerAccounts;
  window.toggleResellerCollapse = toggleResellerCollapse;
  window.openSemenSell = openSemenSell;
  window.openSemenStockMenu = openSemenStockMenu;
  window.openSemenRestock = openSemenRestock;
  window.restockBatchFilter = restockBatchFilter;
  window.restockBatchPick = restockBatchPick;
  window.restockBatchClose = restockBatchClose;
  window.saveSemenRestock = saveSemenRestock;
  window.openSemenNewBatch = openSemenNewBatch;
  window.filterSemenSourceSuggest = filterSemenSourceSuggest;
  window.selectSemenSourceByIndex = selectSemenSourceByIndex;
  window.selectSemenSourceOutside = selectSemenSourceOutside;
  window.clearSemenSourceSuggest = clearSemenSourceSuggest;
  window.semenNewBatchSource = semenNewBatchSource;
  window.saveSemenNewBatch = saveSemenNewBatch;
  window.sellCustFilter = sellCustFilter;
  window.sellCustPick = sellCustPick;
  window.sellCustClose = sellCustClose;
  window.sellMode = sellMode;
  window.sellAddons = sellAddons;
  window.sellCalc = sellCalc;
  window.saveSemenSale = saveSemenSale;
  window.openSemenReceipt = openSemenReceipt;
  window.closeSemenReceipt = closeSemenReceipt;
  window.openSemenAdjust = openSemenAdjust;
  window.saveSemenAdjust = saveSemenAdjust;
  /* [REBUILD FIX 54] adjust-desk pickers/calc + payments + collectibles */
  window.adjOtherFilter = adjOtherFilter;
  window.adjOtherPick = adjOtherPick;
  window.adjOtherClose = adjOtherClose;
  window.adjOtherQty = adjOtherQty;
  window.adjOtherRemove = adjOtherRemove;
  window.adjGiveFilter = adjGiveFilter;
  window.adjGivePick = adjGivePick;
  window.adjGiveClose = adjGiveClose;
  window.adjGiveQty = adjGiveQty;
  window.adjGivePrice = adjGivePrice;
  window.adjGiveRemove = adjGiveRemove;
  window.adjCalc = adjCalc;
  window.openSemenPayment = openSemenPayment;
  window.saveSemenPayment = saveSemenPayment;
  window.posCollectiblesPanel = posCollectiblesPanel;
  window.receiptTextLines = receiptTextLines;
  window.btScanPrinter = btScanPrinter;
  window.btPrintReceipt = btPrintReceipt;
  window.btPrintCustStatement = btPrintCustStatement;
  window.btPrintStatement = btPrintCustStatement;
  window.btDisconnect = btDisconnect;
  window.statementTextLines = statementTextLines;
  window.escPosStatementBytes = escPosStatementBytes;
  
})();