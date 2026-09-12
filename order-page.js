/* ═══════════════════════════════════════════════════════════════════════════
   [FIX 188] js/order-page.js — the reseller-facing half of the ordering link.

   Loaded only by order.html (a public page): no app code, no service worker, no
   login. It keeps no data — the cart lives in this tab's localStorage so a reload
   does not lose a reseller's picks, and every number that matters is recomputed
   server-side by ars_place_order() from the farm's ORDER MENU. Nothing here mentions
   stock, because a reseller's request is not gated by the cooler; if this file were
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

  const itemKey = it => String(it.item_key || it.key || it.breed_id || it.breed || it.boar || '');

  /* A calendar day in the VIEWER's timezone, never UTC's. `toISOString().slice(0,10)`
     looked right in the afternoon and was yesterday's date every evening between
     midnight and 8 AM Philippine time — which is exactly when a reseller plans a pick-up
     for tomorrow. offsetMinutes is Date#getTimezoneOffset()'s own convention (UTC+8 →
     -480), and passing it in keeps this testable without rewriting the host's clock. */
  function localDay(value, offsetMinutes) {
    const d = new Date(value === undefined ? Date.now() : value);
    if (isNaN(d.getTime())) return '';
    const off = offsetMinutes === undefined ? d.getTimezoneOffset() : +offsetMinutes;
    const shifted = new Date(d.getTime() - off * 60000);
    const p = n => String(n).padStart(2, '0');
    return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`;
  }

  /* No stock maths here on purpose: a reseller orders a BREED and the farm decides
     which boar to collect, so the only limits are "is this still on the menu" and the
     farm's 999-bottle-per-line ceiling. Any clamping the page used to do was a promise
     about the farm's cooler that the page has no business making. */
  const MAX_QTY = 999;
  function clampCart(c, cat) {
    const byKey = {};
    (cat || []).forEach(it => { byKey[itemKey(it)] = it; });
    const out = {}, warnings = [];
    Object.keys(c || {}).forEach(k => {
      const it = byKey[k];
      const q = Math.min(MAX_QTY, Math.max(0, Math.floor(+c[k] || 0)));
      if (!it) { warnings.push('One of your picks is no longer on this farm’s menu — it was removed from your order.'); return; }
      if (q <= 0) return;
      if ((+c[k] || 0) > MAX_QTY) warnings.push(`${esc(it.boar || it.breed)} is capped at ${MAX_QTY} bottles per order — send another order if you need more.`);
      out[k] = q;
    });
    return { cart: out, warnings };
  }

  function cartTotals(c, cat) {
    const byKey = {};
    (cat || []).forEach(it => { byKey[itemKey(it)] = it; });
    const lines = [];
    let bottles = 0, total = 0, unpriced = 0;
    Object.keys(c || {}).forEach(k => {
      const it = byKey[k];
      const q = Math.floor(+c[k] || 0);
      if (!it || q <= 0) return;
      const rate = +it.price || 0;           /* 0 = the farm has not priced this breed yet */
      const amount = +(q * rate).toFixed(2);
      bottles += q; total += amount;
      if (!(rate > 0)) unpriced++;
      lines.push({ k, item_key: k, breed_id: it.breed_id || k, boar: it.boar || it.breed, breed: it.breed, qty: q, rate, amount });
    });
    return { lines, bottles, total: +total.toFixed(2), unpriced };
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
      wrap.innerHTML = `<div class="err">This farm has not put any breeds on its order menu yet. Message them and they will add what you can order.</div>`;
      return;
    }
    wrap.innerHTML = catalog.map(it => {
      const key = itemKey(it), name = it.boar || it.breed || 'Semen', q = +cart[key] || 0;
      const priced = it.priced === undefined ? (+it.price || 0) > 0 : !!it.priced;
      return `<div class="card">
        <div class="pic">🧬</div>
        <div class="mid">
          <b>${esc(name)}</b>
          <em>${priced ? `${money(it.price)} a bottle` : 'Price confirmed by the farm'}</em>
          ${it.blurb ? `<span class="blurb">${esc(it.blurb)}</span>` : ''}
        </div>
        <div class="price">${q ? (priced ? money(q * (+it.price || 0)) : `<small>${q} bottle${q > 1 ? 's' : ''}</small>`) : '<small>&nbsp;</small>'}</div>
        <div class="qty">
          <button type="button" aria-label="One fewer" onclick="ArsOrderPage.step('${esc(key)}',-1)" ${q <= 0 ? 'disabled' : ''}>−</button>
          <input type="number" inputmode="numeric" min="0" max="${MAX_QTY}" value="${q}" aria-label="How many bottles" onchange="ArsOrderPage.set('${esc(key)}',this.value)">
          <button type="button" aria-label="One more" onclick="ArsOrderPage.step('${esc(key)}',1)" ${q >= MAX_QTY ? 'disabled' : ''}>＋</button>
        </div>
      </div>`;
    }).join('');
  }

  /* The basket bar is fixed, so the LAST thing on the page is always the thing under it.
     A hardcoded body padding was the bug: two lines of hint text (or a notched phone, or
     the Messenger webview's own chrome) pushed the bar taller than the padding and the
     reseller's own order row sat unreachable behind it. So the bar is measured, not
     guessed, and re-measured whenever its content changes. */
  function syncBarSpace() {
    try {
      const bar = els && els.bar;
      if (!bar || bar.hidden) return;
      const h = bar.offsetHeight || (bar.getBoundingClientRect && bar.getBoundingClientRect().height) || 0;
      if (!(h > 0)) return;
      document.documentElement.style.setProperty('--ars-bar-h', Math.ceil(h) + 'px');
    } catch (_) { /* the CSS fallback (a generous --ars-bar-h default) still applies */ }
  }

  function watchBarSize() {
    syncBarSpace();
    try {
      if (typeof ResizeObserver !== 'undefined' && els && els.bar) new ResizeObserver(syncBarSpace).observe(els.bar);
    } catch (_) {}
    try {
      if (window.addEventListener) {
        window.addEventListener('resize', syncBarSpace);
        window.addEventListener('orientationchange', syncBarSpace);
      }
    } catch (_) {}
  }

  function paintBar(warn) {
    const t = cartTotals(cart, catalog);
    els.basket.textContent = t.bottles ? `${t.bottles} bottle${t.bottles > 1 ? 's' : ''} · ${t.lines.length} breed${t.lines.length > 1 ? 's' : ''}` : 'Nothing picked yet';
    els.sum.textContent = money(t.total);
    els.send.disabled = !t.bottles;
    els.hint.innerHTML = warn || (t.unpriced
      ? `${t.unpriced} line${t.unpriced > 1 ? 's have' : ' has'} no price on the menu yet — the farm will confirm the amount when they accept.`
      : 'The farm confirms every order and chooses which boar to collect — nothing is charged yet.');
    syncBarSpace();          /* the hint line above can wrap to two lines — re-measure it */
    return t;
  }

  function paintOrders(rows) {
    const list = Array.isArray(rows) ? rows : (rows && rows.rows) || [];
    if (!list.length) { els.mine.innerHTML = `<li><span>No orders from this link yet.</span></li>`; syncBarSpace(); return; }
    els.mine.innerHTML = list.map(r => {
      return orderRowHTML(r);
    }).join('');
    syncBarSpace();
  }

  function orderRowHTML(r) {
    const st = statusOf(r.status);
    const when = r.placed_at ? localDay(r.placed_at) : '';
    const bottles = +r.bottles || 0;
    /* ₱0.00 with bottles in it does not mean free — it means the farm had not priced
       that breed on its menu yet. Say that, on both sides of the transaction. */
    const amount = !(+r.total > 0) && bottles > 0
      ? '<span style="color:#f0b64b">price to confirm</span>' : money(r.total);
    return `<li><span><b>${bottles} bottle${bottles === 1 ? '' : 's'}</b> · ${amount}${when ? ` · <span style="color:#9dc3bf">${esc(when)}</span>` : ''}${r.note ? `<br><span style="color:#9dc3bf">“${esc(r.note)}”</span>` : ''}${r.decision_note ? `<br><span style="color:#f0b64b">Farm: ${esc(r.decision_note)}</span>` : ''}</span><span class="chip ${st.key}">${st.label}</span></li>`;
  }

  function refreshOrders() {
    return rpc('ars_order_status', { p_token: token }).then(paintOrders).catch(() => {});
  }

  function say(html, kind) { els.msg.innerHTML = html ? `<div class="${kind || 'err'}">${html}</div>` : ''; }

  /* ── actions ─────────────────────────────────────────────────────────────── */
  function step(key, delta) {
    const next = Math.min(MAX_QTY, Math.max(0, (+cart[key] || 0) + delta));
    if (next > 0) cart[key] = next; else delete cart[key];
    saveDraft(); paintList(); paintBar();
  }
  function set(key, value) {
    const n = Math.min(MAX_QTY, Math.max(0, Math.floor(+value || 0)));
    if (n > 0) cart[key] = n; else delete cart[key];
    saveDraft(); paintList();
    paintBar((+value || 0) > MAX_QTY ? `An order line is capped at ${MAX_QTY} bottles — send another order if you need more.` : '');
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
      const extra = Array.isArray(out.removed) && out.removed.length
        ? `<br><b>Not sent:</b> ${out.removed.map(c => `${c.requested} × ${esc(c.breed || c.boar || '?')} (${esc(c.why)})`).join('; ')}` : '';
      cart = {}; saveDraft(); paintList(); paintBar();
      refreshOrders();
      els.shop.innerHTML = `<h3 style="margin:0 0 6px">✓ Order sent</h3>
        ${out.bottles || t.bottles} bottle${(out.bottles || t.bottles) === 1 ? '' : 's'} · <b>${money(out.total != null ? out.total : t.total)}</b>
        <br>The farm has been notified and will confirm which boar they collect. Nothing is charged until they accept.${extra}
        <br><span style="color:#9dc3bf">Keep this link open — its status updates right here.</span>`;
      els.main.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      syncBarSpace();
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
    const today = localDay();          /* their today, not the server's */
    els.needBy.min = today; els.needBy.value = '';
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
      els.shop.innerHTML = `Ordering as <b>${esc(name)}</b><span>Send it whenever you need bottles — the farm confirms the price and which boar to collect before anything is reserved.</span>`;
      catalog = Array.isArray(cat) ? cat : [];
      cart = clampCart(loadDraft(), catalog).cart;   /* a draft saved yesterday drops breeds the farm retired */
      els.main.hidden = false; els.bar.hidden = false;
      paintList(); paintBar(); refreshOrders();
      watchBarSize();
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
    localDay, orderRowHTML,
    __state: () => ({ token, catalog, cart })
  };
})();
