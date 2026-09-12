/* ═══════════════════════════════════════════════════════════════════════════
   [FIX 188] js/order-page.js — the reseller-facing half of the ordering link.

   Loaded only by order.html (a public page): no app code, no service worker, no
   login. It keeps no data — the cart lives in this tab's localStorage so a reload
   does not lose a reseller's picks, and every number that matters is recomputed
   server-side by ars_place_order() from YOUR stock. The clamping here is only so
   the reseller sees "you can take 4 of these" while typing; if this file were
   deleted, an order would still arrive correct.

   Pure parts (parseToken / clampCart / cartTotals / rpcBody / statusOf) are unit
   tested in qa/test-reseller-orders.mjs without a browser, because the money
   arithmetic on a screen a customer can open is exactly where a silent clamp
   would hurt.
   ═══════════════════════════════════════════════════════════════════════════ */
window.ArsOrderPage = (function () {
  const DRAFT = 'ars-order-cart-v1:';
  let token = '', catalog = [], cart = {}, els = null;

  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = n => '₱' + (+n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* The link is a farm-generated UUID: ?k=… — nothing else is trusted or parsed. */
  function parseToken(search) {
    const m = /[?&]k=([0-9a-fA-F][0-9a-fA-F-]{6,63})/.exec(String(search || ''));
    return m ? m[1] : '';
  }

  const itemKey = it => String(it.item_key || it.key || it.semen_batch_no || '');

  function clampCart(c, cat) {
    const byKey = {};
    (cat || []).forEach(it => { byKey[itemKey(it)] = it; });
    const out = {}, warnings = [];
    Object.keys(c || {}).forEach(k => {
      const it = byKey[k];
      let q = Math.floor(+c[k] || 0);
      if (!it) { warnings.push('That item is no longer listed — it was removed from your order.'); return; }
      const max = Math.max(0, +it.on_hand || 0);
      if (q > max) {
        q = max;
        warnings.push(`Only ${max} of ${esc(it.boar)} (${esc(it.semen_batch_no)}) ${max === 1 ? 'is' : 'are'} left, so your order asks for ${max}.`);
      }
      if (q <= 0) { if (max === 0) warnings.push(`${esc(it.boar)} ran out — removed from your order.`); return; }
      out[k] = q;
    });
    return { cart: out, warnings };
  }

  function cartTotals(c, cat) {
    const byKey = {};
    (cat || []).forEach(it => { byKey[itemKey(it)] = it; });
    const lines = [];
    let bottles = 0, total = 0;
    Object.keys(c || {}).forEach(k => {
      const it = byKey[k];
      const q = Math.floor(+c[k] || 0);
      if (!it || q <= 0) return;
      const rate = +it.price || 0;
      const amount = +(q * rate).toFixed(2);
      bottles += q; total += amount;
      lines.push({ k, item_key: k, semen_batch_no: it.semen_batch_no, boar: it.boar, breed: it.breed, qty: q, rate, amount });
    });
    return { lines, bottles, total: +total.toFixed(2) };
  }

  /* Quantities only — price is never sent, so a tampered page cannot set its own rate. */
  function rpcBody(tok, lines, note, needBy) {
    return {
      p_token: String(tok || ''),
      p_lines: (lines || []).map(l => ({ k: String(l.k ?? l.item_key ?? ''), qty: Math.floor(+l.qty || 0) })),
      p_note: String(note || '').trim().slice(0, 240) || null,
      p_need_by: /^\d{4}-\d{2}-\d{2}$/.test(String(needBy || '')) ? String(needBy) : null
    };
  }

  const ORDER_WORDS = { pending: 'Waiting for the farm', accepted: 'Accepted — ready to pick up', declined: 'Declined', cancelled: 'Cancelled', done: 'Picked up' };
  function statusOf(s) {
    const k = String(s || 'pending').toLowerCase();
    return { key: ORDER_WORDS[k] ? k : 'pending', label: ORDER_WORDS[k] || ORDER_WORDS.pending };
  }

  /* ── network ─────────────────────────────────────────────────────────────── */
  async function rpc(name, body) {
    const cfg = window.ARS_SUPABASE_CONFIG || {};
    if (!cfg.url || !cfg.anonKey) throw new Error('The app configuration did not load — reopen the link.');
    const res = await fetch(`${String(cfg.url).replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, Prefer: 'return=representation' },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { message: text }; }
    if (!res.ok) throw new Error((data && (data.message || data.hint)) || `The farm could not be reached (${res.status}).`);
    return data;
  }

  /* ── rendering ───────────────────────────────────────────────────────────── */
  function saveDraft() {
    try { localStorage.setItem(DRAFT + token, JSON.stringify(cart)); } catch (_) {}
  }
  function loadDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT + token) || '{}') || {}; } catch (_) { return {}; }
  }

  function paintList() {
    const wrap = els.list;
    if (!catalog.length) {
      wrap.innerHTML = `<div class="err">No bottles are listed for pick-up right now. Message the farm directly and ask them to publish stock.</div>`;
      return;
    }
    wrap.innerHTML = catalog.map(it => {
      const key = itemKey(it), max = Math.max(0, +it.on_hand || 0), q = +cart[key] || 0;
      return `<div class="card">
        <div class="pic">🧪</div>
        <div class="mid">
          <b>${esc(it.boar)}</b>
          <em>${esc(it.semen_batch_no)}${it.breed && it.breed !== '—' ? ` · ${esc(it.breed)}` : ''} · ${money(it.price)} a bottle</em>
          <span class="left${max <= 3 ? ' low' : ''}">${max} left</span>
        </div>
        <div class="price">${q ? money(q * (+it.price || 0)) : '<small>&nbsp;</small>'}</div>
        <div class="qty">
          <button type="button" aria-label="One fewer" onclick="ArsOrderPage.step('${esc(key)}',-1)" ${q <= 0 ? 'disabled' : ''}>−</button>
          <input type="number" inputmode="numeric" min="0" max="${max}" value="${q}" aria-label="How many bottles" onchange="ArsOrderPage.set('${esc(key)}',this.value)">
          <button type="button" aria-label="One more" onclick="ArsOrderPage.step('${esc(key)}',1)" ${q >= max ? 'disabled' : ''}>＋</button>
        </div>
      </div>`;
    }).join('');
  }

  function paintBar(warn) {
    const t = cartTotals(cart, catalog);
    els.basket.textContent = t.bottles ? `${t.bottles} bottle${t.bottles > 1 ? 's' : ''} · ${t.lines.length} batch${t.lines.length > 1 ? 'es' : ''}` : 'Nothing picked yet';
    els.sum.textContent = money(t.total);
    els.send.disabled = !t.bottles;
    els.hint.innerHTML = warn || 'Prices are today\u2019s batch price and the farm confirms every order \u2014 nothing is charged yet.';
    return t;
  }

  function paintOrders(rows) {
    const list = Array.isArray(rows) ? rows : (rows && rows.rows) || [];
    if (!list.length) { els.mine.innerHTML = `<li><span>No orders from this link yet.</span></li>`; return; }
    els.mine.innerHTML = list.map(r => {
      const st = statusOf(r.status);
      const when = String(r.placed_at || '').slice(0, 10);
      return `<li><span><b>${r.bottles || 0} bottle${(+r.bottles || 0) === 1 ? '' : 's'}</b> · ${money(r.total)}${when ? ` · <span style="color:#9dc3bf">${esc(when)}</span>` : ''}${r.note ? `<br><span style="color:#9dc3bf">“${esc(r.note)}”</span>` : ''}${r.decision_note ? `<br><span style="color:#f0b64b">Farm: ${esc(r.decision_note)}</span>` : ''}</span><span class="chip ${st.key}">${st.label}</span></li>`;
    }).join('');
  }

  function refreshOrders() {
    return rpc('ars_order_status', { p_token: token }).then(paintOrders).catch(() => {});
  }

  function say(html, kind) { els.msg.innerHTML = html ? `<div class="${kind || 'err'}">${html}</div>` : ''; }

  /* ── actions ─────────────────────────────────────────────────────────────── */
  function step(key, delta) {
    const it = catalog.find(x => itemKey(x) === key);
    const max = Math.max(0, +((it || {}).on_hand) || 0);
    const next = Math.min(max, Math.max(0, (+cart[key] || 0) + delta));
    if (next > 0) cart[key] = next; else delete cart[key];
    saveDraft(); paintList(); paintBar();
  }
  function set(key, value) {
    const it = catalog.find(x => itemKey(x) === key);
    const max = Math.max(0, +((it || {}).on_hand) || 0);
    const n = Math.min(max, Math.max(0, Math.floor(+value || 0)));
    if (n > 0) cart[key] = n; else delete cart[key];
    saveDraft(); paintList();
    paintBar(n === +value || !max ? '' : `That batch has ${max} left — your order will ask for ${max}.`);
  }

  let busy = false;
  async function submit() {
    if (busy) return;
    const clamped = clampCart(cart, catalog);
    cart = clamped.cart; saveDraft(); paintList();
    const t = paintBar(clamped.warnings.join(' '));
    if (!t.bottles) { say('Pick at least one bottle first.'); return; }
    busy = true; els.send.disabled = true; els.send.textContent = 'Sending…';
    try {
      const r = await rpc('ars_place_order', rpcBody(token, t.lines, els.note.value, els.needBy.value));
      const out = Array.isArray(r) ? r[0] : r;
      if (!out || out.ok !== true) { say(esc((out && out.error) || 'The farm did not accept the order. Try again or call them.')); return; }
      const extra = Array.isArray(out.clamped) && out.clamped.length
        ? `<br><b>Note from the farm's stock:</b> ${out.clamped.map(c => `${c.requested} × ${esc(c.boar || '?')} → ${c.granted} (${esc(c.why)})`).join('; ')}` : '';
      cart = {}; saveDraft(); paintList(); paintBar();
      refreshOrders();
      els.shop.innerHTML = `<h3 style="margin:0 0 6px">✓ Order sent</h3>
        ${out.bottles || t.bottles} bottle${(out.bottles || t.bottles) === 1 ? '' : 's'} · <b>${money(out.total != null ? out.total : t.total)}</b>
        <br>The farm has been notified and will confirm. Nothing is charged until they accept.${extra}
        <br><span style="color:#9dc3bf">Keep this link open — its status updates right here.</span>`;
      els.main.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      say(esc(e && e.message ? e.message : 'Could not reach the farm. Check your connection and try again.'));
    } finally {
      busy = false; els.send.textContent = 'Place order'; paintBar();
    }
  }

  async function boot() {
    token = parseToken(location.search);
    /* #farmName sits outside #main on purpose (the header always shows), so every lookup
       goes through the document — a root-scoped query would miss it and die on a null. */
    if (!els || !els.main || !token) {
      say('<b>This link is incomplete.</b><br>Ask the farm to send the full ordering link again (it starts with their site address and ends with <code>?k=…</code>).');
      if (els && els.farmName) els.farmName.textContent = 'Ordering link';
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    els.needBy.min = today; els.needBy.value = today;
    try {
      const [shop, cat] = await Promise.all([
        rpc('ars_order_shop', { p_token: token }).catch(() => null),
        rpc('ars_order_catalog', { p_token: token })
      ]);
      const s = Array.isArray(shop) ? shop[0] : shop;
      if (s && s.error) { say(esc(s.error)); els.farmName.textContent = 'Link expired'; return; }
      const name = (s && (s.reseller_name || s.farm_name)) || 'Your account';
      els.farmName.textContent = (s && s.farm_name) ? s.farm_name : 'ARSwineTech farm';
      els.shop.hidden = false;
      els.shop.innerHTML = `Ordering as <b>${esc(name)}</b><span>Send it whenever you need bottles — the farm confirms stock and price before anything is reserved.</span>`;
      catalog = Array.isArray(cat) ? cat : [];
      cart = clampCart(loadDraft(), catalog).cart;
      els.main.hidden = false; els.bar.hidden = false;
      paintList(); paintBar(); refreshOrders();
    } catch (e) {
      say(esc(e && e.message ? e.message : 'Could not reach the farm.'));
    }
  }

  function init() {
    if (els) return;
    const id = x => document.getElementById(x);
    els = {
      farmName: id('farmName'), shop: id('shop'), msg: id('msg'), main: id('main'),
      list: id('list'), mine: id('mine'), note: id('note'), needBy: id('needBy'),
      bar: id('bar'), basket: id('basket'), sum: id('sum'), send: id('send'), hint: id('hint')
    };
    if (!els.send) return;            /* mounted somewhere without the page: stay silent */
    els.send.addEventListener('click', submit);
    boot();
  }

  return {
    init, step, set, submit,
    /* pure, unit-tested */
    parseToken, clampCart, cartTotals, rpcBody, statusOf, money, itemKey,
    __state: () => ({ token, catalog, cart })
  };
})();
