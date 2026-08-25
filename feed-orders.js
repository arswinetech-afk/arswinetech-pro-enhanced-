/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 52] js/feed-orders.js — Feed ordering, delivery tracking &
   time-stamped order history.

   Adds a "📦 Orders" function to the Feed Inventory drill-down (and a button
   on the Feed Inventory page) where the manager can:
     • AUTO-SUGGEST — one tap per feed type pre-fills an order using the live
       Feeding Guide engine (computeFeedPlan, 30-day horizon): only types
       whose requirement exceeds current stock are suggested, with exactly the
       planner's bag count ("order Shortage N bags").
     • MANUAL ENTRY — create an order for ANY feed type (existing or custom)
       with bags, price/bag, ORDER DATE and expected DELIVERY DATE + note.
     • TRACK STATUS — ORDERED → PARTIAL DELIVERY → DELIVERED (complete).
       "🚚 Receive delivery" records how many bags arrived (with date + note);
       partial arrivals flip the card to PARTIAL DELIVERY and keep the
       remaining count; full arrivals complete the order.
     • INVENTORY SYNC — every delivery instantly ADDS its bags to the Feed
       Inventory stock (existing stock + delivered bags); a brand-new feed
       type is created on the fly. The stock card price follows the latest
       purchase price.
     • FINANCIALS — every delivery books its exact amount (bags × price) as an
       Expense transaction (category "Feed", fully paid) on the delivery date,
       so Financial Summary / Net Profit stay truthful.
     • HISTORY — completed and cancelled orders stay in a time-stamped history
       (each card shows when it was ordered and every delivery's recorded
       timestamp + note).
   Orders live in F().feedOrders; expense rows are normal F().transactions
   entries linked back by id.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsq = v => "'" + String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + "'";
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const round2 = n => Math.round((+n || 0) * 100) / 100;
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad2 = n => String(n).padStart(2, '0');
  const dstr = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const today = () => dstr(new Date());
  const isoOff = (base, n) => { const d = new Date(String(base || today()) + 'T00:00:00'); d.setDate(d.getDate() + (+n || 0)); return dstr(d); };
  const fmtD = s => { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }); };
  /* time-stamp line for the history cards: "Aug 8, 2026 · 7:41 AM" */
  const fmtDT = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const pesoN = n => (typeof peso === 'function' ? peso(n) : '₱' + round2(n).toLocaleString());

  const orders = () => (F().feedOrders = Array.isArray(F().feedOrders) ? F().feedOrders : []);
  const findOrder = id => orders().find(o => o.id === id) || null;
  const feedRow = t => (F().feed || []).find(x => String(x.type).toLowerCase() === String(t).toLowerCase()) || null;
  const remaining = o => Math.max(0, (+o.bags || 0) - (+o.delivered_bags || 0));
  const orderValue = o => round2((+o.bags || 0) * (+o.price_bag || 0));
  const META = {
    ordered:   { pill: '⚪ ORDERED', cls: 'dark' },
    partial:   { pill: '🟡 PARTIAL DELIVERY', cls: 'warn' },
    delivered: { pill: '🟢 DELIVERED', cls: 'green' },
    cancelled: { pill: '⛔ CANCELLED', cls: 'dark' }
  };

  /* ── auto-suggest: planner shortages (30-day horizon) ─────────────── */
  function orderSuggestions() {
    if (!(F() && F().feedPlan && F().feedPlan.configured) || !window.computeFeedPlan) return null;
    const c = computeFeedPlan(30);
    return Object.keys(c.req)
      .filter(t => c.req[t].order > 0)
      .sort((a, b) => c.req[b].order - c.req[a].order)
      .map(t => ({ type: t, bags: c.req[t].order, need: c.req[t].req, stock: c.req[t].stock, price: (feedRow(t) || {}).price || 0 }));
  }

  /* ── order / delivery cards ───────────────────────────────────────── */
  function cardHTML(o, historic) {
    const m = META[o.status] || META.ordered,
      dels = (o.deliveries || []).map((d, i) => `<div class="ford-delivery"><span>🚚 <b>${d.bags} bag${d.bags > 1 ? 's' : ''}</b> · ${fmtD(d.date)} · ${pesoN(d.amount)}</span>${d.note ? `<span class="ford-note">📝 ${esc(d.note)}</span>` : ''}<small>recorded ${fmtDT(d.at)}</small></div>`).join(''),
      rem = remaining(o),
      canAct = !historic && o.status !== 'delivered' && o.status !== 'cancelled';
    
    const searchTerms = [
      o.feed_type,
      o.status,
      o.note || '',
      ...(o.deliveries || []).map(d => `${d.note || ''} ${d.bags || ''} ${d.date || ''}`),
      fmtD(o.order_date),
      fmtD(o.expect_date),
      o.order_date,
      o.expect_date,
      m.pill
    ].filter(Boolean).join(' ').toLowerCase();

    return `<div class="ford-card ${o.status}" data-order="${esc(o.id)}" data-search="${esc(searchTerms)}">
      <div class="ford-top">
        <div><b>🌾 ${esc(o.feed_type)}</b><span class="ford-sub">${o.bags} bag${o.bags > 1 ? 's' : ''} · ${pesoN(o.price_bag)}/bag · order value ${pesoN(orderValue(o))}</span></div>
        <span class="tag ${m.cls} ford-pill">${m.pill}</span>
      </div>
      <div class="ford-meta">
        <span>🧾 Ordered: <b>${fmtD(o.order_date)}</b></span>
        <span>🚛 Expected: <b>${fmtD(o.expect_date)}</b></span>
        ${o.delivered_bags > 0 ? `<span>📦 Received: <b>${o.delivered_bags}/${o.bags} bags</b></span>` : ''}
        ${canAct ? `<span>⏳ Remaining: <b>${rem} bag${rem > 1 ? 's' : ''}</b></span>` : ''}
      </div>
      ${o.note ? `<div class="ford-note">📝 ${esc(o.note)}</div>` : ''}
      ${dels ? `<div class="ford-deliveries">${dels}</div>` : ''}
      <small class="ford-stamp">🕒 order logged ${fmtDT(o.created_at)}${o.updated_at && o.updated_at !== o.created_at ? ' · last update ' + fmtDT(o.updated_at) : ''}</small>
      ${canAct ? `<div class="ford-actions">
        <button class="btn" onclick="openDeliveryForm(${jsq(o.id)})">🚚 Receive delivery</button>
        <button class="btn ghost" onclick="openOrderForm(${jsq(o.id)})">✏️ Edit</button>
        ${o.delivered_bags > 0 ? '' : `<button class="btn ghost delete-action" onclick="cancelFeedOrder(${jsq(o.id)})" title="Cancel this order">✕</button>`}
      </div>` : ''}
    </div>`;
  }

  let isOrderHistoryExpanded = false;

  window.toggleFeedOrderHistoryCollapse = function() {
    isOrderHistoryExpanded = !isOrderHistoryExpanded;
    const box = document.getElementById('fordOlderHistory');
    const btn = document.getElementById('btnToggleOrderHistory');
    if (!box || !btn) return;
    if (isOrderHistoryExpanded) {
      box.style.display = 'block';
      btn.innerHTML = '▲ Collapse older order history';
    } else {
      box.style.display = 'none';
      const count = box.querySelectorAll ? box.querySelectorAll('.ford-card').length : (box.children ? box.children.length : 0);
      btn.innerHTML = `▼ Show ${count} older order records…`;
    }
  };

  function historyCardsHTML(history) {
    if (!history || !history.length) {
      return '<div class="empty">No completed orders yet. Deliveries land here with their recorded date &amp; time.</div>';
    }
    isOrderHistoryExpanded = false;

    if (history.length <= 5) {
      return `<div class="ford-recent-history">${history.map(o => cardHTML(o, true)).join('')}</div>`;
    }

    const recent = history.slice(0, 5);
    const older = history.slice(5);

    return `
      <div class="ford-recent-history">
        ${recent.map(o => cardHTML(o, true)).join('')}
      </div>
      <button type="button" class="btn ghost" id="btnToggleOrderHistory" onclick="window.toggleFeedOrderHistoryCollapse()" style="width:100%;margin:10px 0 6px 0;padding:12px 14px;font-weight:750;background:rgba(13,141,145,0.09);color:var(--teal2);border:1.5px dashed var(--teal);border-radius:10px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer">
        ▼ Show ${older.length} older order records…
      </button>
      <div id="fordOlderHistory" style="display:none">
        ${older.map(o => cardHTML(o, true)).join('')}
      </div>
    `;
  }

  function filterFeedOrders(q) {
    q = String(q || '').trim().toLowerCase();
    const olderBox = document.getElementById('fordOlderHistory');
    const toggleBtn = document.getElementById('btnToggleOrderHistory');

    if (q && olderBox) {
      olderBox.style.display = 'block';
      if (toggleBtn) toggleBtn.style.display = 'none';
    } else if (!q && olderBox) {
      olderBox.style.display = isOrderHistoryExpanded ? 'block' : 'none';
      if (toggleBtn) {
        toggleBtn.style.display = 'flex';
        const count = olderBox.querySelectorAll ? olderBox.querySelectorAll('.ford-card').length : (olderBox.children ? olderBox.children.length : 0);
        toggleBtn.innerHTML = isOrderHistoryExpanded ? '▲ Collapse older order history' : `▼ Show ${count} older order records…`;
      }
    }

    document.querySelectorAll('#feedOrdersModal .ford-card').forEach(card => {
      const searchData = (card.getAttribute && card.getAttribute('data-search') ? card.getAttribute('data-search') : card.textContent || '').toLowerCase();
      card.style.display = (!q || searchData.includes(q)) ? '' : 'none';
    });
  }
  window.filterFeedOrders = filterFeedOrders;

  /* ── main panel ───────────────────────────────────────────────────── */
  function openFeedOrders() {
    document.getElementById('feedOrdersModal')?.remove();
    const list = orders().slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
      active = list.filter(o => o.status === 'ordered' || o.status === 'partial'),
      history = list.filter(o => o.status === 'delivered' || o.status === 'cancelled'),
      sug = orderSuggestions();
    const sugBox = sug === null
      ? `<div class="ford-sug muted">💡 Set up the <b>Feeding Guide</b> (Feed page → ⚙ Set up feeding guide) to get automatic order suggestions from your herd's real needs.</div>`
      : sug.length
        ? `<div class="ford-sug"><div class="ford-sug-title">🛒 Suggested orders — shortfall for the next 30 days</div>${sug.map(s => `<button class="ford-sug-chip" onclick="openOrderForm(null,${jsq(s.type)},${s.bags})">${esc(s.type)} · <b>short ${s.bags} bag${s.bags > 1 ? 's' : ''}</b><small>needs ${s.need.toFixed(1)} · on hand ${s.stock}</small><em>＋ order</em></button>`).join('')}</div>`
        : `<div class="ford-sug ford-sug-ok">✓ All feed types are covered for the next 30 days — nothing to order right now.</div>`;
    document.body.insertAdjacentHTML('beforeend', `<div class="drill-bg" id="feedOrdersModal"><div class="drill-panel ford-panel">
      <div class="drill-header"><div><div class="eyebrow">FEED PURCHASING</div><h2>📦 Feed orders &amp; deliveries</h2><p>${active.length} ongoing · ${history.length} in history</p></div><div><button class="btn ghost no-print" onclick="openFeedReport()" title="Printable report: stocks, to-order &amp; delivered + financial summary">🖨 Report / PDF</button><button class="btn" onclick="openOrderForm()">＋ New order</button><button class="close-reminder" onclick="closeFeedOrders()">×</button></div></div>
      ${sugBox}

      <!-- Search Bar with Live Filtering across types, statuses, dates & notes -->
      <div class="drill-controls" style="margin:12px 0 16px 0">
        <input class="search" id="fordSearchInput" placeholder="🔍 Search orders by feed type, status, dates, or recorded notes..." oninput="window.filterFeedOrders(this.value)">
      </div>

      <div class="ford-sec-title">ONGOING ORDERS</div>
      <div id="fordActive">${active.map(o => cardHTML(o, false)).join('') || '<div class="empty">No ongoing orders — tap a suggestion above or ＋ New order.</div>'}</div>
      <div class="ford-sec-title">ORDER HISTORY <small>— time-stamped (${history.length} records)</small></div>
      <div id="fordHistory">${historyCardsHTML(history)}</div>
    </div></div>`);
  }
  function closeFeedOrders() { document.getElementById('feedOrdersModal')?.remove(); }
  function refreshFeedOrders() {
    /* drill refresh FIRST: it removes & re-appends #drillModal — re-opening the
       orders panel afterwards keeps it on top of the overlay stack. */
    const open = !!document.getElementById('feedOrdersModal');
    closeFeedOrders();
    if (window.refreshOpenDrilldown) window.refreshOpenDrilldown(); /* stock rows may have moved */
    if (open) openFeedOrders();
  }

  /* ── new / edit order form ────────────────────────────────────────── */
  function openOrderForm(orderId, presetType, presetBags) {
    document.getElementById('feedOrderForm')?.remove();
    const o = orderId ? findOrder(orderId) : null,
      types = [...new Set((F().feed || []).map(x => x.type).concat(['Pre Starter', 'Starter', 'Grower', 'Finisher', 'Booster', 'Gestating', 'Lactating']))],
      curType = o ? o.feed_type : (presetType || ''),
      isCustom = !!(curType && !types.some(t => t.toLowerCase() === String(curType).toLowerCase())),
      selVal = isCustom ? '__custom__' : curType,
      price = o ? o.price_bag : (feedRow(curType) || {}).price || '';
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="feedOrderForm"><form class="reminder-modal perf-modal" onsubmit="saveFeedOrder(event)">
      <div class="modal-top"><div><div class="eyebrow">FEED PURCHASE ORDER</div><h2>${o ? '✏️ Edit order' : '🌾 New feed order'}</h2><p>${o ? esc(o.feed_type) + ' — deliveries already logged stay untouched.' : 'Bags are added to stock automatically as deliveries arrive.'}</p></div><button type="button" class="close-reminder" onclick="document.getElementById('feedOrderForm').remove()">×</button></div>
      <input type="hidden" id="foId" value="${o ? esc(o.id) : ''}">
      <div class="reminder-fields">
        <div class="field"><label>Feed type *</label><select id="foType" onchange="foTypeChanged()">${types.map(t => `<option value="${esc(t)}"${selVal === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}<option value="__custom__"${isCustom ? ' selected' : ''}>✏️ Custom type…</option></select></div>
        <div class="field" id="foCustomWrap" style="display:${isCustom ? '' : 'none'}"><label>Custom feed name *</label><input id="foCustom" placeholder="e.g. Sow Pellets Premium" value="${isCustom ? esc(curType) : ''}"></div>
        <div class="field"><label>Bags to order *</label><input id="foBags" type="number" min="1" step="1" inputmode="numeric" value="${o ? o.bags : (presetBags || '')}" required oninput="foCalc()"></div>
        <div class="field"><label>Price per bag (₱) *</label><input id="foPrice" type="number" min="0" step="0.01" inputmode="decimal" value="${price}" required oninput="foCalc()"></div>
        <div class="field"><label>Order date *</label><input id="foOrder" type="date" value="${o ? esc(o.order_date) : today()}" required></div>
        <div class="field"><label>Expected delivery *</label><input id="foExpect" type="date" value="${o ? esc(o.expect_date) : isoOff(today(), 3)}" required></div>
        <div class="field full"><label>Note on this order</label><input id="foNote" placeholder="Supplier, truck, promo price…" value="${o && o.note ? esc(o.note) : ''}"></div>
        <div class="field full"><div class="ford-total" id="foTotal"></div>${o && o.delivered_bags > 0 ? `<small class="field-hint">⚠ ${o.delivered_bags} bag(s) already delivered — bags can't go below that.</small>` : ''}</div>
      </div>
      <div class="form-error" id="foErr"></div>
      <div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('feedOrderForm').remove()">Cancel</button><button class="btn">🌾 ${o ? 'Save changes' : 'Place order'}</button></div>
    </form></div>`);
    foCalc();
  }
  function foTypeChanged() {
    const sel = document.getElementById('foType'),
      custom = sel.value === '__custom__';
    document.getElementById('foCustomWrap').style.display = custom ? '' : 'none';
    if (!custom) { /* prefill current stock price for convenience */
      const r = feedRow(sel.value);
      if (r && r.price != null) document.getElementById('foPrice').value = r.price;
    }
    foCalc();
  }
  function foCalc() {
    const b = num(document.getElementById('foBags')?.value) || 0,
      p = num(document.getElementById('foPrice')?.value) || 0,
      el = document.getElementById('foTotal');
    if (el) el.innerHTML = `Order value: <b>${pesoN(round2(b * p))}</b><small> — booked to expenses on each delivery</small>`;
  }
  function saveFeedOrder(ev) {
    ev.preventDefault();
    const err = document.getElementById('foErr'),
      show = m => { err.textContent = m; err.classList.add('show'); };
    err.classList.remove('show');
    const id = document.getElementById('foId').value,
      o = id ? findOrder(id) : null,
      sel = document.getElementById('foType').value,
      type = sel === '__custom__' ? (document.getElementById('foCustom').value || '').trim() : sel,
      bags = num(document.getElementById('foBags').value),
      price = num(document.getElementById('foPrice').value),
      orderDate = document.getElementById('foOrder').value,
      expect = document.getElementById('foExpect').value,
      note = (document.getElementById('foNote').value || '').trim();
    if (!type) return show('Pick or type the feed type.');
    if (!bags || bags < 1) return show('Bags to order must be at least 1.');
    if (price === null || price < 0) return show('Enter the price per bag.');
    if (!orderDate || !expect) return show('Order date and expected delivery are required.');
    const now = new Date().toISOString();
    if (o) {
      if (bags < (+o.delivered_bags || 0)) return show(`${o.delivered_bags} bag(s) are already delivered — bags can't drop below that.`);
      Object.assign(o, { feed_type: type, bags, price_bag: price, order_date: orderDate, expect_date: expect, note, updated_at: now });
      if (o.delivered_bags >= bags) { o.status = 'delivered'; } /* edited down to the delivered count */
      else if (o.status === 'delivered') { o.status = (+o.delivered_bags || 0) > 0 ? 'partial' : 'ordered'; } /* edited back up — delivery reopens */
    } else {
      orders().push({
        id: newId('fo-'), feed_type: type, bags, price_bag: price,
        order_date: orderDate, expect_date: expect,
        status: 'ordered', delivered_bags: 0, deliveries: [], tx_ids: [],
        note, created_at: now, updated_at: now
      });
    }
    save();
    document.getElementById('feedOrderForm')?.remove();
    renderAll();
    refreshFeedOrders();
    toast(o ? 'Order updated' : `Order placed: ${bags} bag${bags > 1 ? 's' : ''} ${type} (${pesoN(round2(bags * price))})`);
  }
  function cancelFeedOrder(id) {
    const o = findOrder(id);
    if (!o) return;
    if ((+o.delivered_bags || 0) > 0) { toast('Deliveries already arrived — edit the order instead.'); return; }
    if (!confirm(`Cancel the order for ${o.bags} bag(s) of ${o.feed_type} (${pesoN(orderValue(o))})? It moves to history as cancelled.`)) return;
    o.status = 'cancelled';
    o.updated_at = new Date().toISOString();
    save();
    renderAll();
    refreshFeedOrders();
    toast('Order cancelled');
  }

  /* ── receive a delivery (partial or complete) ─────────────────────── */
  function openDeliveryForm(id) {
    const o = findOrder(id);
    if (!o) return;
    document.getElementById('feedDeliveryForm')?.remove();
    const rem = remaining(o);
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="feedDeliveryForm"><form class="reminder-modal perf-modal" onsubmit="saveFeedDelivery(event)">
      <div class="modal-top"><div><div class="eyebrow">RECEIVE DELIVERY</div><h2>🚚 ${esc(o.feed_type)}</h2><p>${o.delivered_bags}/${o.bags} bags received so far — <b>${rem} remaining</b> · ${pesoN(o.price_bag)}/bag.</p></div><button type="button" class="close-reminder" onclick="document.getElementById('feedDeliveryForm').remove()">×</button></div>
      <input type="hidden" id="fdId" value="${esc(o.id)}">
      <div class="reminder-fields">
        <div class="field"><label>Bags arrived *</label><input id="fdBags" type="number" min="1" max="${rem}" step="1" inputmode="numeric" value="${rem}" required oninput="fdCalc()"><small class="field-hint">enter less than ${rem} for a <b>partial delivery</b></small></div>
        <div class="field"><label>Delivery date *</label><input id="fdDate" type="date" value="${today()}" required></div>
        <div class="field full"><label>Note on this delivery</label><input id="fdNote" placeholder="Truck, condition of sacks, received by…"></div>
        <div class="field full"><div class="ford-total" id="fdTotal"></div></div>
      </div>
      <div class="form-error" id="fdErr"></div>
      <div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('feedDeliveryForm').remove()">Cancel</button><button class="btn">✓ Receive into inventory</button></div>
    </form></div>`);
    fdCalc();
  }
  function fdCalc() {
    const o = findOrder(document.getElementById('fdId')?.value),
      n = num(document.getElementById('fdBags')?.value) || 0,
      el = document.getElementById('fdTotal');
    if (o && el) el.innerHTML = `Adds <b>${n} bag${n > 1 ? 's' : ''}</b> to <b>${esc(o.feed_type)}</b> stock &amp; books <b>${pesoN(round2(n * (+o.price_bag || 0)))}</b> to expenses`;
  }
  function saveFeedDelivery(ev) {
    ev.preventDefault();
    const err = document.getElementById('fdErr'),
      show = m => { err.textContent = m; err.classList.add('show'); };
    err.classList.remove('show');
    const o = findOrder(document.getElementById('fdId').value);
    if (!o) return;
    const n = num(document.getElementById('fdBags').value),
      date = document.getElementById('fdDate').value,
      note = (document.getElementById('fdNote').value || '').trim(),
      rem = remaining(o);
    if (!n || n < 1) return show('Bags arrived must be at least 1.');
    if (n > rem) return show(`Only ${rem} bag(s) remain on this order — reduce the count.`);
    if (!date) return show('Pick the delivery date.');
    const now = new Date().toISOString(),
      amount = round2(n * (+o.price_bag || 0));
    /* 1) order tracking */
    o.delivered_bags = (+o.delivered_bags || 0) + n;
    (o.deliveries = Array.isArray(o.deliveries) ? o.deliveries : []).push({ id: newId('fdl-'), date, bags: n, amount, note, at: now });
    o.status = remaining(o) === 0 ? 'delivered' : 'partial';
    o.updated_at = now;
    /* 2) inventory: existing stock + delivered bags (price follows latest purchase) */
    (F().feed = Array.isArray(F().feed) ? F().feed : []);
    let row = feedRow(o.feed_type);
    if (row) {
      row.bags = round2((+row.bags || 0) + n);
      row.price = +o.price_bag || row.price;
      row.id = row.id || `feed-${String(o.feed_type).toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      row._ars_cloud_local_id = row._ars_cloud_local_id || row.id;
      row.feed_revision = Date.now();
      row.updated_at = now;
    } else {
      const newFeed = { type: o.feed_type, bags: n, price: +o.price_bag || 0, id: `feed-${String(o.feed_type).toLowerCase().replace(/[^a-z0-9]/g, '-')}`, feed_revision: Date.now(), updated_at: now };
      newFeed._ars_cloud_local_id = newFeed.id;
      F().feed.push(newFeed);
    }
    /* 3) financials: the delivered amount is a real expense on the delivery date */
    (F().transactions = Array.isArray(F().transactions) ? F().transactions : []);
    const tx = {
      id: newId('tx-'), date, type: 'Expense', category: 'Feed',
      description: `Feed delivery — ${o.feed_type} × ${n} bag${n > 1 ? 's' : ''}` + ((o.deliveries || []).length > 1 ? ` (delivery ${(o.deliveries || []).length} of order)` : ''),
      amount, paid: amount
    };
    F().transactions.push(tx);
    (o.tx_ids = Array.isArray(o.tx_ids) ? o.tx_ids : []).push(tx.id);
    save();
    document.getElementById('feedDeliveryForm')?.remove();
    renderAll();
    refreshFeedOrders();
    if (window.refreshOpenDrilldown) window.refreshOpenDrilldown();
    toast(`+${n} bag${n > 1 ? 's' : ''} ${o.feed_type} added to stock · ${pesoN(amount)} booked to expenses` + (o.status === 'delivered' ? ' — order complete' : ''));
  }

  /* ── [REBUILD FIX 53] professional print / PDF report ───────────────
     Three ledgers in one certificate: current stocks, feed-to-order
     (planner suggestions + placed orders awaiting delivery) and the
     delivered history — closed by a financial summary. Print isolation
     mirrors the vaccination report (body.feed-report-open). */
  function openFeedReport() {
    document.getElementById('feedReport')?.remove();
    const farm = F(),
      feed = Array.isArray(farm.feed) ? farm.feed : [],
      ords = orders(),
      farmLogo = document.querySelector('.sidebar .logo-img')?.src || '',
      appLogo = document.querySelector('.sidebar .logo-img')?.dataset.defaultSrc || farmLogo,
      created = new Date();
    const sug = orderSuggestions() || [],
      ongoing = ords.filter(o => o.status === 'ordered' || o.status === 'partial').sort((a, b) => String(a.expect_date).localeCompare(String(b.expect_date))),
      deliveries = [];
    ords.forEach(o => (o.deliveries || []).forEach(d => deliveries.push({ o, d })));
    deliveries.sort((a, b) => String(b.d.date + (b.d.at || '')).localeCompare(String(a.d.date + (a.d.at || ''))));
    const invVal = round2(feed.reduce((a, x) => a + (+x.bags || 0) * (+x.price || 0), 0)),
      invBags = feed.reduce((a, x) => a + (+x.bags || 0), 0),
      sugCost = round2(sug.reduce((a, s) => a + s.bags * (s.price || 0), 0)),
      committed = round2(ongoing.reduce((a, o) => a + orderValue(o), 0)),
      receivedOngoing = round2(ongoing.reduce((a, o) => a + (+o.delivered_bags || 0) * (+o.price_bag || 0), 0)),
      remainingCost = round2(ongoing.reduce((a, o) => a + remaining(o) * (+o.price_bag || 0), 0)),
      deliveredTotal = round2(deliveries.reduce((a, x) => a + (+x.d.amount || 0), 0)),
      deliveredBags = deliveries.reduce((a, x) => a + (+x.d.bags || 0), 0);

    const tr = (cells, head) => `<tr>${cells.map(c => head ? `<th>${c}</th>` : `<td>${c}</td>`).join('')}</tr>`;
    const stockTable = feed.length
      ? `<table class="vax-rep">${tr(['Feed type', 'Bags on hand', 'Price / bag', 'Inventory value'], true)}${feed.map(x => tr([`<b>${esc(x.type)}</b>`, x.bags, pesoN(x.price || 0), `<b>${pesoN(round2((+x.bags || 0) * (+x.price || 0)))}</b>`])).join('')}${tr(['<b>TOTAL</b>', `<b>${invBags} bags</b>`, '', `<b>${pesoN(invVal)}</b>`])}</table>`
      : '<p class="vax-rep-empty">No feed stocks recorded yet.</p>';
    const sugTable = !(farm.feedPlan && farm.feedPlan.configured)
      ? '<p class="vax-rep-empty">Feeding guide is not set up yet — suggestions appear once it is configured (Feed page → ⚙ Set up feeding guide).</p>'
      : sug.length
        ? `<table class="vax-rep">${tr(['Feed type', 'Needed (30 days)', 'On hand', 'To order', 'Est. cost'], true)}${sug.map(s => tr([`<b>${esc(s.type)}</b>`, s.need.toFixed(1) + ' bags', s.stock, `<b>${s.bags} bag${s.bags > 1 ? 's' : ''}</b>`, `<b>${pesoN(round2(s.bags * (s.price || 0)))}</b>`])).join('')}${tr(['<b>TOTAL</b>', '', '', '', `<b>${pesoN(sugCost)}</b>`])}</table>`
        : '<p class="vax-rep-empty">✓ All feed types are covered for the next 30 days — nothing needs ordering.</p>';
    const ongoingTable = ongoing.length
      ? `<table class="vax-rep">${tr(['Feed type', 'Ordered', 'Received', 'Remaining', 'Price/bag', 'Order value', 'Ordered on', 'Expected', 'Status'], true)}${ongoing.map(o => {
        const m = META[o.status] || META.ordered;
        return tr([`<b>${esc(o.feed_type)}</b>` + (o.note ? `<br><small>📝 ${esc(o.note)}</small>` : ''), o.bags + ' bags', o.delivered_bags + ' bags', `<b>${remaining(o)} bags</b>`, pesoN(o.price_bag), `<b>${pesoN(orderValue(o))}</b>`, fmtD(o.order_date), fmtD(o.expect_date), `<b>${m.pill}</b>`]);
      }).join('')}${tr(['<b>TOTAL committed</b>', '', '', '', '', `<b>${pesoN(committed)}</b>`, '', '', ''])}</table>`
      : '<p class="vax-rep-empty">No orders are awaiting delivery.</p>';
    const delTable = deliveries.length
      ? `<table class="vax-rep">${tr(['Delivery date', 'Feed type', 'Bags', 'Amount', 'Recorded', 'Note'], true)}${deliveries.map(x => tr([`<b>${fmtD(x.d.date)}</b>`, `<b>${esc(x.o.feed_type)}</b>`, x.d.bags, `<b>${pesoN(x.d.amount)}</b>`, `<small>${fmtDT(x.d.at)}</small>`, x.d.note ? `<small>📝 ${esc(x.d.note)}</small>` : '—'])).join('')}${tr(['<b>TOTAL</b>', '', `<b>${deliveredBags} bags</b>`, `<b>${pesoN(deliveredTotal)}</b>`, '', ''])}</table>`
      : '<p class="vax-rep-empty">No deliveries received yet — they land here the moment "Receive delivery" is used.</p>';
    const finTable = `<table class="vax-rep">${tr(['Financial line', 'Amount'], true)}${tr(['Feed inventory value (stock on hand)', `<b>${pesoN(invVal)}</b>`])}${tr(['Suggested purchases — next 30 days (guide shortfall)', `<b>${pesoN(sugCost)}</b>`])}${tr(['Committed in ongoing orders', `<b>${pesoN(committed)}</b>`])}${tr(['Received so far on ongoing orders', `<b>${pesoN(receivedOngoing)}</b>`])}${tr(['Still to receive (and pay) on ongoing orders', `<b>${pesoN(remainingCost)}</b>`])}${tr(['Feed deliveries booked to expenses — all time', `<b>${pesoN(deliveredTotal)}</b>`])}</table>`;

    document.body.insertAdjacentHTML('beforeend', `<div class="drill-bg" id="feedReport"><div class="feed-report-toolbar no-print"><button type="button" class="btn ghost" onclick="closeFeedReport()">× Close report</button><span>Feed Stock &amp; Purchasing Report</span></div><article class="certificate">
      <header class="cert-header">
        <div class="cert-logo"><img src="${farmLogo}" alt="${esc(farm.name || 'Farm')} logo"></div>
        <div class="cert-actions no-print"><button class="btn" onclick="printFeedReport()">🖨 Print / Save PDF</button><button class="btn ghost" onclick="closeFeedReport()">Close report</button></div>
        <div class="cert-title"><small>ARS WINETECH PRO · FEED PURCHASING</small><h1>Feed Stock &amp; Purchasing Report</h1><h2>${esc(farm.name || 'Farm')}</h2></div>
        <div class="cert-app-logo"><img src="${appLogo}" alt="ARSwineTech"><b>Breed. Feed. Predict.</b></div>
        <button class="close-reminder no-print" onclick="closeFeedReport()">×</button>
      </header>
      <main class="cert-grid">
        <section class="cert-card cert-wide"><h3>📦 Current feed stocks</h3><p class="vax-rep-note">Live inventory snapshot — bags on hand and their value.</p>${stockTable}</section>
        <section class="cert-card cert-wide"><h3>🛒 Feed to order — guide suggestions (next 30 days)</h3>${sugTable}</section>
        <section class="cert-card cert-wide"><h3>⏳ Feed to order — placed orders awaiting delivery</h3>${ongoingTable}</section>
        <section class="cert-card cert-wide"><h3>🚚 Feed delivered — time-stamped delivery log</h3>${delTable}</section>
        <section class="cert-card cert-wide"><h3>💰 Financial summary</h3><p class="vax-rep-note">Deliveries are booked to expenses automatically on their delivery date (category: Feed, fully paid).</p>${finTable}</section>
      </main>
      <footer class="cert-footer"><div>▣<span>Generated On<b>${created.toLocaleString('en-PH')}</b></span></div><div>♙<span>Generated By<b>${esc(farm.name || 'Farm')}</b></span></div><div>📦<span>Feed Types Stocked<b>${feed.length} · ${invBags} bags</b></span></div><div>◇<span>Orders Tracked<b>${ongoing.length} ongoing · ${ords.filter(o => o.status === 'delivered').length} delivered · ${ords.filter(o => o.status === 'cancelled').length} cancelled</b></span></div></footer>
      <div class="cert-end"><span>This document is system generated by ARSwineTech Pro</span><b>Order on time — never run out of feed.</b></div>
      <div class="cert-sign"><span>Prepared by (Farm Representative)</span><span>Noted by (Farm Owner)</span></div>
    </article></div>`);
    document.body.classList.add('feed-report-open');
  }
  function printFeedReport() {
    const article = document.querySelector('#feedReport .certificate');
    if (!article) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast('Please allow pop-ups to print or save the feed report as PDF.');
      return;
    }
    const printCss = `
      @page{size:A4;margin:12mm}
      *{box-sizing:border-box}
      body{margin:0;background:#fff;color:#172327;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.35}
      .certificate{width:100%;max-width:100%;background:#fff;color:#172327;padding:0}
      .cert-header{display:grid;grid-template-columns:70px 1fr auto 28px;gap:10px;align-items:center;border-bottom:3px solid #0e7c74;padding:8px 0 10px;margin-bottom:12px}
      .cert-logo img,.cert-app-logo img{width:60px;height:48px;object-fit:contain}
      .cert-title small{font-size:8px;letter-spacing:.12em;color:#0e7c74;font-weight:800}
      .cert-title h1{font-size:19px;line-height:1.1;margin:3px 0;color:#10282c}
      .cert-title h2{font-size:13px;margin:0;color:#37505a}
      .cert-app-logo{text-align:center;font-size:8px;color:#0e7c74}
      .cert-grid{display:block}
      .cert-card{border:1px solid #cfdddd;border-radius:7px;padding:9px 10px;margin:0 0 10px;break-inside:avoid}
      .cert-card h3{margin:0 0 6px;color:#0e7c74;font-size:12px;border-bottom:1px solid #d7e6e4;padding-bottom:4px}
      .vax-rep{width:100%;border-collapse:collapse;font-size:9.5px}
      .vax-rep th{background:#eaf6f4;color:#0e6963;text-align:left;font-size:9px;text-transform:uppercase;padding:5px;border-bottom:1px solid #9ccbc5}
      .vax-rep td{padding:5px;border-bottom:1px solid #e4eded;vertical-align:top}
      .vax-rep tr:last-child td{border-bottom:0}
      .vax-rep-note{font-size:9px;color:#637174;margin:0 0 6px}
      .vax-rep-empty{color:#637174;font-size:10px}
      .cert-footer{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;border-top:1px solid #cfdddd;padding:8px 0;font-size:9px;break-inside:avoid}
      .cert-footer>div{display:flex;gap:5px;color:#0e7c74}.cert-footer span{color:#637174}.cert-footer b{display:block;color:#172327}
      .cert-end{display:flex;justify-content:space-between;border-top:1px solid #0e7c74;padding:7px 0;font-size:9px;break-inside:avoid}
      .cert-sign{display:flex;justify-content:space-between;padding:24px 28px 0;font-size:9px;break-inside:avoid}.cert-sign span{width:210px;border-top:1px solid #637174;padding-top:4px}
      .no-print{display:none!important}
    `;
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Feed Stock & Purchasing Report</title><style>${printCss}</style></head><body>${article.outerHTML}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 350);
  }

  function closeFeedReport() {
    document.getElementById('feedReport')?.remove();
    document.body.classList.remove('feed-report-open');
  }

  /* ── entry-point buttons (drill-down header + Feed page strip) ────── */
  window.openFeedOrders = openFeedOrders;
  window.closeFeedOrders = closeFeedOrders;
  window.openOrderForm = openOrderForm;
  window.saveFeedOrder = saveFeedOrder;
  window.cancelFeedOrder = cancelFeedOrder;
  window.openDeliveryForm = openDeliveryForm;
  window.saveFeedDelivery = saveFeedDelivery;
  window.openFeedReport = openFeedReport; /* [REBUILD FIX 53] */
  window.printFeedReport = printFeedReport;
  window.closeFeedReport = closeFeedReport; /* [REBUILD FIX 53] */
  window.foTypeChanged = foTypeChanged;
  window.foCalc = foCalc;
  window.fdCalc = fdCalc;
  window.feedOrdersBtn = () => `<button class="btn ghost" onclick="openFeedOrders()" title="Feed orders, deliveries & history">📦 Orders</button>`;
  window.feedOrdersPageBtn = () => ` <button class="btn ghost" style="margin-left:8px;padding:6px 11px;font-size:11px" onclick="openFeedOrders()" title="Feed orders, deliveries & history">📦 Orders</button>`;
  /* test/state helper */
  window.feedOrderSuggestions = orderSuggestions;
})();
