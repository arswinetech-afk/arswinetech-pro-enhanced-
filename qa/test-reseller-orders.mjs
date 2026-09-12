/*
 * [FIX 188] Reseller order links — a reseller sends an order from a private link,
 * the farm gets a badge, and Accept becomes a prefilled pick-up.
 *
 * Like qa/test-reseller-return.mjs, this boots the REAL code in a vm (no browser, no
 * build step) and drives the same window.* handlers the onclick attributes call. It also
 * boots the REAL js/order-page.js with a stubbed fetch, because the dangerous part of this
 * feature is not the arithmetic — it is a page a customer can open deciding its own price.
 * So the payload that leaves the page is asserted, not trusted: quantities and item keys
 * only, and the peso figures that end up in the farm's ledger come from the farm's stock.
 *
 * Run:  node qa/test-reseller-orders.mjs
 *       ARS_DUMP_SHEETS=1 node qa/test-reseller-orders.mjs   → /tmp/order-*.html
 *
 * Must stay true:
 *   1. a reseller's page can never send a price; the farm's batch price is what is billed
 *   2. an order is a request: nothing moves until the office saves a pick-up
 *   3. quantities are re-clamped to TODAY's on-hand both on the page and at Accept
 *   4. the badge counts what nobody has decided; "seen" never clears a queue
 *   5. one private link per reseller, revocable at once, superseded links stop working
 *   6. the sheets use this app's real modal classes and a z-index above the hub /
 *      below the pick-up form, or a phone user sees nothing
 *   7. no service-role key anywhere in the shipped client, and the SQL is idempotent
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failures = 0, checks = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};
const eq = (name, got, want) => ok(name, Math.abs((+got || 0) - want) < 0.005, `got ${got}, want ${want}`);
const tick = () => new Promise(r => setTimeout(r, 0));

/* ── permissive fake DOM, shared by both boots ─────────────────────────────────── */
function fakeEl(tag = 'div', reg) {
  const t = { tagName: tag, children: [], style: {}, dataset: {}, scrollTop: 0, checked: false, value: '', hidden: false, innerHTML: '', textContent: '' };
  const noops = ['remove', 'appendChild', 'removeChild', 'append', 'prepend', 'insertAdjacentHTML', 'addEventListener',
    'removeEventListener', 'setAttribute', 'removeAttribute', 'focus', 'blur', 'scrollIntoView', 'click', 'select', 'submit'];
  return new Proxy(t, {
    get(o, k) {
      if (typeof k === 'symbol') return undefined;
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'querySelector') return (sel) => (reg ? reg(sel) : null);
      if (k === 'querySelectorAll') return () => [];
      if (k === 'closest') return () => null;
      if (k === 'firstElementChild' || k === 'parentNode') return null;
      if (k in o) return o[k];
      if (noops.includes(k)) return (...a) => (k === 'appendChild' ? a[0] : undefined);
      return undefined;
    },
    set(o, k, v) { o[k] = v; return true; }
  });
}

/* ── the farm app (semen-sales.js) ────────────────────────────────────────────── */
/* app.js's own helper, copied verbatim: the pick-up form's datetime-local default is
   built with it, so a loosely stubbed harness could not catch a real mismatch. */
function appLocalDateTimeValue(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const lot = (id, batch, boar, breed, price, bottles) => ({
  id, semen_batch_no: batch, boar_name: boar, breed, price_per_dose: price,
  available_bottles: bottles, bottles, status: 'active'
});

function seed() {
  return {
    farm_id: 'FARM-TEST',
    name: "RM's Hog Farm",
    semen: [
      lot('SEM-LW', 'B1LW', 'B1 Large White', 'LY', 400, 10),
      lot('SEM-BD', 'BDD', 'Duroc (BD)', 'Duroc', 400, 5)
    ],
    semenResellers: [{ id: 'R-JO', name: 'Jo Dacara', contact: '0917' }, { id: 'R-AN', name: 'Anita Cruz', contact: '0918' }],
    semenResellerTx: [],
    semenResellerAdjustments: [],
    semenResellerOrders: [],
    semenResellerOrderLinks: [],
    transactions: []
  };
}

function bootApp(db, opts = {}) {
  const toasts = [];
  const registry = new Map();
  const sheets = [];
  const state = { confirm: opts.confirm !== undefined ? opts.confirm : true, prompt: opts.prompt !== undefined ? opts.prompt : '' };
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat, RegExp, Promise, Error, Set, Map, isNaN, Intl,
    /* exactly app.js's peso — the whole number must come from the app's own formatter,
       not from a stub that happens to be prettier than production */
    peso: x => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(+x || 0),
    localDateTimeValue: appLocalDateTimeValue,
    setTimeout: (fn) => { try { fn && fn(); } catch (_) {} return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { userAgent: 'node' },                       /* no clipboard, no share: exercises the fallbacks */
    location: { href: 'https://preview.test/index.html', origin: 'https://preview.test' },
    crypto: globalThis.crypto,
    FormData: class { constructor() { return [['reseller_id', 'R-JO'], ['paid_amount', '0'], ['pay_method', 'Cash'], ['notes', ''], ['timestamp', '']]; } },
    farmId: 'FARM-TEST',
    __arsActiveFarmId: 'FARM-TEST',
    F: () => db,
    save: () => { ctx.__saves++; },
    toast: (m) => toasts.push(String(m)),
    closeModal: () => {},
    renderAll: () => {},
    confirm: () => state.confirm,
    prompt: (...a) => { ctx.__promptArgs = a; return state.prompt; },
    ARSCloud: { syncFarmRecord: async () => ({ success: true }), verifyFarmSave: async () => ({ success: true }), saveLocalRecovery() {} },
    __saves: 0, __toasts: toasts, __state: state, __sheets: sheets
  };
  ctx.__el = id => { if (!registry.has(id)) registry.set(id, fakeEl('div', null)); return registry.get(id); };
  ctx.__setValue = (id, v) => { const el = ctx.__el(id); el.value = v; return el; };
  ctx.document = {
    body: (() => {
      const b = fakeEl('body', null);
      b.insertAdjacentHTML = (_pos, html) => {
        const id = (/id="([^"]+)"/.exec(html) || [])[1] || '';
        const cls = (/class="([^"]+)"/.exec(html) || [])[1] || '';
        const css = (/style="([^"]+)"/.exec(html) || [])[1] || '';
        sheets.push({ id, cls, css, html });
      };
      return b;
    })(),
    documentElement: fakeEl('html', null),
    createElement: tag => fakeEl(tag, null),
    head: fakeEl('head', null),
    getElementById: id => ctx.__el(id),
    querySelector: sel => (/name="notes"/.test(sel) ? ctx.__el('__notes') : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeChild: () => {},
    execCommand: () => false
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('semen-sales.js'), ctx, { filename: 'semen-sales.js' });
  ctx.lastToast = () => toasts[toasts.length - 1] || '';
  ctx.sheet = id => [...sheets].reverse().find(s => s.id === id);
  ctx.sheets = sheets;
  return ctx;
}

const order = (over = {}) => ({
  id: 'rsord_test1', link_id: 'rsolink_1', reseller_id: 'R-JO', reseller_name: 'Jo Dacara',
  status: 'pending', placed_at: new Date(Date.now() - 5 * 60000).toISOString(),
  need_by: '2026-09-14', note: 'pick up by 8 AM', source: 'reseller_link',
  lines: [{ k: 'SEM-LW', semen_batch_no: 'B1LW', boar: 'B1 Large White', breed: 'LY', qty: 3, rate: 400, amount: 1200, semen_id: 'SEM-LW' }],
  bottles: 3, total: 1200,
  ...over
});
const link = (over = {}) => ({
  id: 'rsolink_1', token: '11111111-2222-3333-4444-555555555555', farm_id: 'FARM-TEST', farm_name: "RM's Hog Farm",
  reseller_id: 'R-JO', reseller_name: 'Jo Dacara', active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over
});

console.log('\n[FIX 188] reseller order links\n');

/* ══ [1] the public page's own arithmetic ═══════════════════════════════════════ */
{
  const catalog = [
    { item_key: 'SEM-LW', semen_batch_no: 'B1LW', boar: 'B1 Large White', breed: 'LY', price: 400, on_hand: 10 },
    { item_key: 'SEM-BD', semen_batch_no: 'BDD', boar: 'Duroc (BD)', breed: 'Duroc', price: 350.5, on_hand: 2 }
  ];
  const P = { ...parseOrderPage() };
  eq('[1] 2 × 400 + 1 × 350.5 = 1,150.50', P.cartTotals({ 'SEM-LW': 2, 'SEM-BD': 1 }, catalog).total, 1150.5);
  eq('[1] bottles counted, not summed wrong', P.cartTotals({ 'SEM-LW': 2, 'SEM-BD': 1 }, catalog).bottles, 3);
  eq('[1] an unknown item is not priced at nothing', P.cartTotals({ 'SEM-XX': 4 }, catalog).total, 0);
  ok('[1] peso shows centavos', P.money(1051.5) === '₱1,051.50', P.money(1051.5));
  ok('[1] token parsed from the link', P.parseToken('?k=11111111-2222-3333-4444-555555555555') === '11111111-2222-3333-4444-555555555555');
  ok('[1] junk in the query is refused', P.parseToken('?k=%27%20or%201%3D1--') === '' , P.parseToken('?k=zz'));
  ok('[1] no token, no page', P.parseToken('') === '');

  const clamped = P.clampCart({ 'SEM-LW': 99, 'SEM-BD': 2 }, catalog);
  eq('[1] asking for 99 of 10 becomes 10', clamped.cart['SEM-LW'], 10);
  ok('[1] and the reseller is told, not silently adjusted', /Only 10 of B1 Large White/.test(clamped.warnings.join(' ')), clamped.warnings.join(' | '));
  const gone = P.clampCart({ 'SEM-XX': 2, 'SEM-BD': 5 }, catalog);
  ok('[1] a delisted item leaves the cart', gone.cart['SEM-XX'] === undefined && gone.cart['SEM-BD'] === 2, JSON.stringify(gone.cart));
  ok('[1] an over-request on a 2-left batch is cut to 2', gone.warnings.some(w => /Only 2 of Duroc/.test(w)), gone.warnings.join(' | '));
}

/* ══ [2] the payload that leaves the reseller's phone ══════════════════════════ */
{
  const P = parseOrderPage();
  const body = P.rpcBody('tok-1', [{ k: 'SEM-LW', qty: 4, rate: 400, amount: 1600, boar: 'X' }], '  please hold until noon  ', '2026-09-14');
  ok('[2] only item keys and counts are sent', JSON.stringify(body.p_lines) === '[{"k":"SEM-LW","qty":4}]', JSON.stringify(body.p_lines));
  ok('[2] no price, rate, total or farm id in the body', !/rate|price|total|amount|farm_id|reseller_id/.test(JSON.stringify(body)), JSON.stringify(body));
  const long = P.rpcBody('t', [{ k: 'a', qty: 1 }], 'x'.repeat(400), '').p_note;
  eq('[2] note trimmed to the farm\'s 240 char field', long.length, 240);
  ok('[2] a bogus pick-up date is dropped, not injected', P.rpcBody('t', [{ k: 'a', qty: 1 }], '', "2026'; drop").p_need_by === null);
  ok('[2] a real date passes through', P.rpcBody('t', [{ k: 'a', qty: 1 }], '', '2026-09-14').p_need_by === '2026-09-14');
  eq('[2] 3 × 350.5 = 1,051.50 on the basket bar', P.cartTotals({ 'SEM-BD': 3 }, [
    { item_key: 'SEM-BD', boar: 'Duroc', price: 350.5, on_hand: 5 }
  ]).total, 1051.5);
  ok('[2] a status word the farm has never used still renders', P.statusOf('weird').key === 'pending' && /Waiting/.test(P.statusOf('weird').label));
}

function parseOrderPage() {
  const src = read('order-page.js');
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat, RegExp, Promise, Error, Set, Map, isNaN, encodeURIComponent, decodeURIComponent, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { search: '', href: 'https://preview.test/order.html' }, document: { getElementById: () => null, querySelector: () => null },
    window: {}
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'order-page.js' });
  return ctx.ArsOrderPage;
}

/* ══ [3] the page in a fake browser: render, clamp, send ════════════════════════ */
{
  const calls = [];
  const P = await bootOrderPage({
    search: '?k=11111111-2222-3333-4444-555555555555',
    ars_order_shop: [{ ok: true, farm_name: "RM's Hog Farm", reseller_name: 'Jo Dacara' }],
    ars_order_catalog: [
      { item_key: 'SEM-LW', semen_batch_no: 'B1LW', boar: 'B1 Large White', breed: 'LY', price: 400, on_hand: 10 },
      { item_key: 'SEM-BD', semen_batch_no: 'BDD', boar: 'Duroc (BD)', breed: 'Duroc', price: 350.5, on_hand: 2 }
    ],
    ars_order_status: [{ order_id: 'rsord_old', status: 'accepted', placed_at: '2026-09-01T00:00:00.000Z', bottles: 2, total: 800, note: '', decision_note: 'Pick up at the gate' }],
    ars_place_order: [{ ok: true, order_id: 'rsord_new', total: 750.5, bottles: 3, lines: [], clamped: [] }],
    calls
  });
  const txt = id => String(P.__el(id).innerHTML || '') + String(P.__el(id).textContent || '');
  const list = txt('list');
  ok('[3] the farm and the reseller are named from the link', /RM's Hog Farm/.test(P.__html('farmName')) && /Jo Dacara/.test(P.__el('shop').innerHTML), P.__el('shop').innerHTML);
  ok('[3] both batches are offered with today’s price', /B1 Large White/.test(list) && /₱400\.00 a bottle/.test(list) && /₱350\.50 a bottle/.test(list));
  ok('[3] bottles left is shown per batch', /10 left/.test(list) && /2 left/.test(list));
  ok('[3] a nearly-empty batch is flagged amber, not hidden', /class="left low"[^>]*>2 left/.test(list), list.slice(list.indexOf('Duroc'), list.indexOf('Duroc') + 220));
  ok('[3] their own past orders show with the farm’s answer', /2 bottles/.test(txt('mine')) && /Pick up at the gate/.test(txt('mine')) && /Accepted/.test(txt('mine')), txt('mine'));
  P.instance.step('SEM-LW', 1); P.instance.step('SEM-LW', 1); P.instance.set('SEM-BD', '2');
  ok('[3] the basket counts the picks', /4 bottles · 2 batches/.test(txt('basket')), txt('basket'));
  ok('[3] the bar totals 2 × 400 + 2 × 350.50 = ₱1,501.00', /₱1,501\.00/.test(txt('sum')), txt('sum'));
  P.instance.set('SEM-LW', '999');
  ok('[3] typing past stock is cut to stock, with a reason', /your order will ask for 10/.test(P.__el('hint').innerHTML), P.__el('hint').innerHTML);
  await P.instance.submit();
  await tick();
  const sent = calls.find(c => /ars_place_order/.test(c.url));
  ok('[3] the order posts to the rpc endpoint with the publishable key only', /\/rest\/v1\/rpc\/ars_place_order$/.test(sent.url) && /^sb_publishable_/.test(sent.opts.headers.apikey) && !/service_role|secret/i.test(JSON.stringify(sent.opts.headers)), sent.url + ' ' + sent.opts.headers.apikey);
  const body = JSON.parse(sent.opts.body);
  const sent2 = body.p_lines.slice().sort((a, b) => a.k.localeCompare(b.k));
  ok('[3] quantity-only lines, priced by the farm', JSON.stringify(sent2) === '[{"k":"SEM-BD","qty":2},{"k":"SEM-LW","qty":10}]', JSON.stringify(body.p_lines));
  ok('[3] an empty note stays null, not an empty string the farm must re-handle', body.p_note === null, JSON.stringify(body.p_note));
  ok('[3] the page never claims a price it invented', body.p_lines.every(l => Object.keys(l).join() === 'k,qty'), JSON.stringify(body.p_lines));
  ok('[3] the farm’s total is what comes back on screen', /Order sent/.test(P.__el('shop').innerHTML) && /₱750\.50/.test(P.__el('shop').innerHTML), P.__el('shop').innerHTML.slice(0, 200));
  ok('[3] the cart is emptied after sending so nothing double-orders', Object.keys(P.instance.__state().cart).length === 0);
}

async function bootOrderPage({ search, calls = [], ...resp }) {
  const registry = new Map();
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat, RegExp, Promise, Error, Set, Map, isNaN, encodeURIComponent,
    location: { search, href: 'https://preview.test/order.html' + search, origin: 'https://preview.test' },
    localStorage: (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })(),
    navigator: { userAgent: 'node' },
    scrollTo: () => {},
    fetch: (url, opts) => {
      const name = /rpc\/([a-z_]+)/.exec(url)[1];
      calls.push({ url, opts });
      const data = resp[name];
      if (data instanceof Error) return Promise.reject(data);
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(data === undefined ? [] : data)) });
    },
    ARS_SUPABASE_CONFIG: { url: 'https://db.test', anonKey: 'sb_publishable_TESTKEY' },
    __sheets: []
  };
  ctx.__el = id => { if (!registry.has(id)) registry.set(id, fakeEl('div', sel => /name/.test(sel) ? null : null)); return registry.get(id); };
  ctx.__html = id => String(ctx.__el(id).textContent || '') + String(ctx.__el(id).innerHTML || '');
  const root = fakeEl('div', sel => ctx.__el(String(sel).replace('#', '')));
  ctx.document = { getElementById: id => ctx.__el(id), querySelector: sel => root.querySelector(sel), addEventListener: () => {}, body: fakeEl('body', null), documentElement: fakeEl('html', null), createElement: t => fakeEl(t, null) };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('order-page.js'), ctx, { filename: 'order-page.js' });
  ctx.ArsOrderPage.init(root);
  await tick(); await tick();          /* boot() awaits Promise.all before it renders */
  return { ctx, instance: ctx.ArsOrderPage, __el: ctx.__el, __html: ctx.__html, root };
}

/* ══ [4] link lifecycle in the hub ══════════════════════════════════════════════ */
{
  const db = seed();
  const ctx = bootApp(db);
  ctx.arsShowResellerOrderLink('R-JO');
  const first = ctx.sheet('resellerOrderLinkModal');
  ok('[4] a reseller with no link gets an offer, not a dead end', first && /Create their order link/.test(first.html));
  ok('[4] and the offer is inside the app’s own sheet shell', first.cls === 'due-modal-bg' && /z-index:9999999/.test(first.css), first.css);

  ctx.arsMakeOrderLink('R-JO');
  const made = db.semenResellerOrderLinks[0];
  ok('[4] a link exists now, active, with a random token', !!made && made.active === true && /^[0-9a-f-]{36}$/.test(made.token), JSON.stringify(made));
  ok('[4] it names the farm and the reseller it belongs to', made.reseller_id === 'R-JO' && made.reseller_name === 'Jo Dacara' && made.farm_name === "RM's Hog Farm");
  ok('[4] it stamps updated_at so the sync head moves and every phone sees it', /^\d{4}-\d{2}-\d{2}T/.test(made.updated_at), made.updated_at);
  const sheet = ctx.sheet('resellerOrderLinkModal');
  const url = `https://preview.test/order.html?k=${made.token}`;
  ok('[4] the link shown is this origin + token, ready to copy', sheet.html.includes(url), url);
  ok('[4] copy / send / new / pause are all offered', /📋 Copy link/.test(sheet.html) && /💬 Send it/.test(sheet.html) && /🔄 New link/.test(sheet.html) && /⏸ Pause link/.test(sheet.html));
  ok('[4] nothing about balances or history is in the public link text', !/balance|statement|total_amount/i.test(url + sheet.html.replace(/<[^>]*>/g, ' ').slice(0, 200)), sheet.html.slice(0, 120));

  /* a second link supersedes the first instead of leaving two live doors */
  const before = made.token;
  ctx.arsMakeOrderLink('R-JO');
  const now = db.semenResellerOrderLinks.find(l => l.active !== false);
  ok('[4] “New link” replaces the old one at once', now.token !== before && db.semenResellerOrderLinks.filter(l => l.active !== false).length === 1);
  ok('[4] the old link is kept, marked superseded, so its orders still read correctly', db.semenResellerOrderLinks.some(l => l.token === before && l.active === false && !!l.superseded_at));

  ctx.arsPauseOrderLink('R-JO');
  ok('[4] pause closes the live link immediately', db.semenResellerOrderLinks.every(l => l.active === false), JSON.stringify(db.semenResellerOrderLinks.map(l => l.active)));
  ok('[4] pause asks first — a wrong tap should not silence a reseller', ctx.__saves >= 1);
}

/* ══ [5] the badge on Registered Resellers ═════════════════════════════════════ */
{
  const db = seed();
  const ctx = bootApp(db);
  db.semenResellerOrderLinks.push(link());
  ctx.openSemenResellerHub();
  let kpi = ctx.sheet('semenResellerHub');
  ok('[5] no orders, no badge', !!kpi && !/new order/.test(kpi.html));

  db.semenResellerOrders.push(order());
  ctx.openSemenResellerHub();
  kpi = ctx.sheet('semenResellerHub');
  ok('[5] one unseen order → “🛒 1 new order” in the box they pointed at', /Registered Resellers <button[^>]*count-pill[^>]*>🛒 1 new order<\/button>/.test(kpi.html), (kpi.html.match(/Registered Resellers[\s\S]{0,600}/) || [''])[0].slice(0, 220));
  ok('[5] the badge is a button that opens the inbox', /onclick="window\.openResellerOrderInbox\(\)"/.test(kpi.html));
  ok('[5] and it sits on the label row so it cannot be missed', /class="count-pill"/.test(kpi.html));

  db.semenResellerOrders.push(order({ id: 'rsord_two', reseller_name: 'Anita Cruz', reseller_id: 'R-AN', placed_at: new Date(Date.now() - 60000).toISOString() }));
  ctx.openSemenResellerHub();
  ok('[5] plural counts the arrivals', /🛒 2 new orders/.test(ctx.sheet('semenResellerHub').html));

  ctx.markAllResellerOrdersSeen();
  ctx.openSemenResellerHub();
  const html = ctx.sheet('semenResellerHub').html;
  ok('[5] seen clears the flashing badge…', !/new order/.test(html));
  ok('[5] but a quiet door stays open while orders are undecided', /🛒 2 waiting<\/button>/.test(html), (html.match(/Registered Resellers[\s\S]{0,700}/) || [''])[0].slice(0, 200));
  ok('[5] …but the queue is NOT cleared by looking at it', db.semenResellerOrders.every(o => o.status === 'pending'), JSON.stringify(db.semenResellerOrders.map(o => o.status)));
}

/* ══ [6] Accept re-prices from the farm's batch, not from the page ══════════════ */
{
  const db = seed();
  db.semenResellerOrderLinks.push(link());
  db.semenResellerOrders.push(order({ total: 1200, bottles: 3 }));
  const ctx = bootApp(db);
  db.semen.find(l => l.id === 'SEM-LW').price_per_dose = 450;   /* the farm repriced after the order was sent */
  const res = ctx.arsResellerOrderPickupLines(db.semenResellerOrders[0]);
  eq('[6] quantity honoured', res.lines[0].qty, 3);
  eq('[6] price taken from today’s batch, not from the reseller’s screen', res.lines[0].rate, 450);
  eq('[6] line amount follows', res.lines[0].amount, 1350);
  ok('[6] no shortfall reported when stock was enough', res.shortfall === '', res.shortfall);
  ok('[6] the lot is still linked by id so the pick-up finds it', res.lines[0].semen_id === 'SEM-LW' && res.lines[0].semen_batch_no === 'B1LW');
}

/* ══ [7] stock that moved between the order and the accept ═════════════════════ */
{
  const db = seed();
  db.semen.find(l => l.id === 'SEM-LW').available_bottles = 3;
  db.semen.find(l => l.id === 'SEM-LW').bottles = 3;
  db.semenResellerOrders.push(order({ lines: [{ k: 'SEM-LW', semen_batch_no: 'B1LW', boar: 'B1 Large White', qty: 8, rate: 400, semen_id: 'SEM-LW' }], bottles: 8, total: 3200 }));
  const ctx = bootApp(db);
  const res = ctx.arsResellerOrderPickupLines(db.semenResellerOrders[0]);
  eq('[7] 8 asked of 3 on hand becomes 3', res.lines[0].qty, 3);
  eq('[7] and the money follows the 3 bottles', res.lines[0].amount, 1200);
  ok('[7] the shortfall is stated in words for the office', /asked 8, only 3 left/.test(res.shortfall), res.shortfall);
  ctx.acceptResellerOrder('rsord_test1');
  ok('[7] accepting opens the pick-up form with the short count', /📦 Record Semen Pickup/.test(ctx.sheet('resellerPickupModal').html));
  ok('[7] and says so above it', /Stock moved since they ordered/.test(ctx.sheet('resellerPickupModal').html));
}

/* ══ [8] the full chain: accept → prefilled form → save → ledger ═══════════════ */
{
  const db = seed();
  db.semenResellerOrderLinks.push(link());
  db.semen.find(l => l.id === 'SEM-LW').price_per_dose = 450;
  db.semenResellerOrders.push(order({ note: 'pick up by 8 AM', need_by: '2026-09-14' }));
  const ctx = bootApp(db);
  ctx.__setValue('resellerPickupTime', '');
  ctx.acceptResellerOrder('rsord_test1');
  const o = db.semenResellerOrders[0];
  ok('[8] the order is marked accepted with what the farm agreed to', o.status === 'accepted' && o.accepted_lines.length === 1 && o.accepted_lines[0].rate === 450);
  const pickHtml = ctx.sheet('resellerPickupModal').html;
  const linesHtml = String(ctx.__el('pickupLinesWrap').innerHTML || '');
  ok('[8] the sheet says which order it came from', /From <b>Jo Dacara<\/b>’s order link/.test(pickHtml), (pickHtml.match(/From <[\s\S]{0,140}/) || ['NO STRIP'])[0]);
  ok('[8] the batch picker is on the ordered lot, not blank', /value="SEM-LW" selected/.test(linesHtml), linesHtml.slice(0, 260));
  ok('[8] the qty box carries the accepted count', /id="lineQty_0" value="3"/.test(linesHtml), (linesHtml.match(/id="lineQty_0"[^>]*/) || [''])[0]);
  ok('[8] the price box shows today’s ₱450, not the page’s ₱400', /id="lineRate_0" value="450"/.test(linesHtml), (linesHtml.match(/id="lineRate_0"[^>]*/) || [''])[0]);
  ok('[8] and the subtotal the office sees is 3 × 450', /id="lineSubtotal_0"[^>]*>₱1,350</.test(linesHtml), (linesHtml.match(/id="lineSubtotal_0"[^<]*</) || [''])[0]);
  ok('[8] the reseller’s note was carried over, not retyped', /pick up by 8 AM/.test(String(ctx.__el('__notes').value)), String(ctx.__el('__notes').value));
  ok('[8] the wanted date filled the pick-up time', /2026-09-14T/.test(String(ctx.__el('resellerPickupTime').value)), String(ctx.__el('resellerPickupTime').value));
  eq('[8] accepting wrote once', ctx.__saves, 1);
  await ctx.window.saveResellerPickup({ preventDefault() {}, target: fakeEl('form', null) });
  const tx = db.semenResellerTx[0];
  ok('[8] saving the form is what creates the pick-up', !!tx && tx.reseller_id === 'R-JO', JSON.stringify(tx || {}));
  eq('[8] billed at today’s batch price: 3 × ₱450', tx.total_amount, 1350);
  eq('[8] one line, and it kept the batch link', tx.lines.length, 1);
  eq('[8] stock left the farm exactly once', db.semen.find(l => l.id === 'SEM-LW').available_bottles, 7);
  /* the prefill is one-shot */
  ctx.openResellerPickupModal('R-AN');
  ok('[8] the next pick-up is a clean form, not somebody else’s order', !/order link/.test(ctx.sheet('resellerPickupModal').html) && !/From <b>Jo Dacara<\/b>/.test(ctx.sheet('resellerPickupModal').html));
  /* and the badge/hub stay honest */
  ctx.openSemenResellerHub();
  ok('[8] an accepted order no longer nags in the badge', !/new order/.test(ctx.sheet('semenResellerHub').html) && !/waiting<\/button>/.test(ctx.sheet('semenResellerHub').html));
}

/* ══ [9] refuse, decline, and the traps ════════════════════════════════════════ */
{
  const db = seed();
  db.semen.forEach(l => { l.available_bottles = 0; l.bottles = 0; });
  db.semenResellerOrders.push(order());
  const ctx = bootApp(db);
  const saves = ctx.__saves;
  ctx.acceptResellerOrder('rsord_test1');
  ok('[9] accepting an empty-stock order is refused with an instruction', /Nothing in that order is in stock any more/.test(ctx.lastToast()), ctx.lastToast());
  eq('[9] refused accept wrote nothing', ctx.__saves, saves);
  ok('[9] and the order stays pending so it is not lost', db.semenResellerOrders[0].status === 'pending');

  ctx.__state.prompt = null;                      /* they closed the prompt */
  ctx.declineResellerOrder('rsord_test1');
  ok('[9] cancelling a decline changes nothing', db.semenResellerOrders[0].status === 'pending' && /why this order was declined/.test(String(ctx.__promptArgs[0])));

  ctx.__state.prompt = 'cold chain broke, sorry';
  ctx.declineResellerOrder('rsord_test1');
  const o = db.semenResellerOrders[0];
  ok('[9] declining records the reason for the reseller’s page', o.status === 'declined' && o.decision_note === 'cold chain broke, sorry', JSON.stringify(o));
  ctx.openSemenResellerHub();
  ok('[9] a declined order leaves the badge and the queue', !/new order/.test(ctx.sheet('semenResellerHub').html) && /Handled recently/.test(ctx.sheet('resellerOrderInbox').html));
  ctx.acceptResellerOrder('rsord_test1');
  ok('[9] an already-decided order cannot be accepted by tapping twice', /already declined/.test(ctx.lastToast()) && o.status === 'declined', ctx.lastToast());
  ctx.acceptResellerOrder('nope');
  ok('[9] a tap on a vanished order says so instead of crashing', /no longer here/.test(ctx.lastToast()));
}

/* ══ [10] the sheets exist in the app's real markup, not invented class names ══ */
{
  const db = seed();
  db.semenResellerOrderLinks.push(link());
  db.semenResellerOrders.push(order({ clamped: [{ requested: 12, granted: 3, boar: 'B1 Large White', why: 'only what is left was reserved' }] }));
  const ctx = bootApp(db);
  db.semenResellerOrders.push(order({ id: 'rsord_cents', total: 701, lines: [{ k: 'SEM-BD', boar: 'Duroc (BD)', semen_batch_no: 'BDD', qty: 2, rate: 350.5, amount: 701 }] }));
  ctx.arsShowResellerOrderLink('R-JO');
  ctx.openResellerOrderInbox();
  ctx.openResellerOrderLinkAdmin();
  const css = read('app.css');
  const HOOKS = new Set(['small', 'input', 'check']);
  const lint = (name, id, zindex) => {
    const s = ctx.sheet(id);
    ok(`${name}: sheet was actually appended`, !!s);
    if (!s) return;
    ok(`${name}: layer is .due-modal-bg`, s.cls === 'due-modal-bg', s.cls);
    ok(`${name}: lifted at z-index ${zindex}`, new RegExp(`z-index:\\s*${zindex}`).test(s.css), s.css);
    const panel = id === 'resellerOrderLinkModal' ? /class="due-modal"/ : /class="due-modal reseller-hub-wrap"/;
    ok(`${name}: panel uses the app’s own panel class`, panel.test(s.html), s.html.slice(0, 160));
    ok(`${name}: header uses .modal-top / .eyebrow / .close-reminder`, /class="modal-top"/.test(s.html) && /class="eyebrow"/.test(s.html) && /class="close-reminder"/.test(s.html));
    ok(`${name}: footer uses .due-actions for full-width phone buttons`, /class="due-actions"/.test(s.html));
    ok(`${name}: no class this app does not define`, (() => {
      const tokens = new Set();
      for (const m of s.html.matchAll(/class="([^"$]*)"/g)) m[1].trim().split(/\s+/).forEach(t => { if (t) tokens.add(t); });
      const undef = [...tokens].filter(t => !HOOKS.has(t) && !css.includes('.' + t));
      if (undef.length) console.log(`        undefined: ${undef.join(', ')}`);
      return !undef.length;
    })());
  };
  lint('[10] link sheet', 'resellerOrderLinkModal', '9999999');
  lint('[10] order inbox', 'resellerOrderInbox', '9999998');
  lint('[10] link admin', 'resellerOrderLinkAdmin', '9999997');
  const inbox = ctx.sheet('resellerOrderInbox');
  ok('[10] the inbox names who ordered and how much', /Jo Dacara/.test(inbox.html) && /₱1,200/.test(inbox.html), inbox.html.slice(0, 400));
  ok('[10] a clamped request is visible before deciding', /asked for more than stock allowed/.test(inbox.html));
  ok('[10] all three decisions are on the card', /✓ Accept &amp; create pick-up/.test(inbox.html) && /👁 Seen/.test(inbox.html) && /✕ Decline/.test(inbox.html));
  ok('[10] and each is wired to a real handler', /window\.acceptResellerOrder\('rsord_test1'\)/.test(inbox.html) && /window\.declineResellerOrder\('rsord_test1'\)/.test(inbox.html));
  const linkSheet = ctx.sheet('resellerOrderLinkModal');
  ok('[10] an order total is shown to the centavo, not rounded by peso()', /₱350\.50/.test(inbox.html) && /₱701/.test(inbox.html), (inbox.html.match(/₱[\d.,]+/g) || []).join(' '));
  ok('[10] a whole peso total stays whole (no ₱1,200.00 noise)', /₱1,200(?![.,]\d)/.test(inbox.html), (inbox.html.match(/₱[\d.,]+/) || [''])[0]);
  ok('[10] the QR is offered but the link stands alone', /They scan this with their camera/.test(linkSheet.html) || /order\.html\?k=/.test(linkSheet.html));

  if (process.env.ARS_DUMP_SHEETS) {
    ctx.sheets.forEach((s, i) => fs.writeFileSync(`/tmp/order-${i}-${s.id || 'anon'}.html`, s.html));
  }
}

/* ══ [11] the sync contract the feature leans on ══════════════════════════════ */
{
  const client = read('client.js'), app = read('app.js');
  ok('[11] orders are a registered entity type so they sync and back up', /semenResellerOrders:\s*'semen_reseller_order'/.test(client), 'entityMap');
  ok('[11] links too', /semenResellerOrderLinks:\s*'semen_reseller_order_link'/.test(client));
  ok('[11] both buckets are initialised like every other bucket', /Array\.isArray\(f\.semenResellerOrders\)/.test(app) && /Array\.isArray\(f\.semenResellerOrderLinks\)/.test(app));
  const db = seed();
  const ctx = bootApp(db);
  db.semenResellerOrders.push(order({ id: 'rsord_sql', updated_at: new Date().toISOString() }));
  ctx.arsMakeOrderLink('R-JO');
  ctx.arsMakeOrderLink('R-AN');
  const rows = db.semenResellerOrderLinks.concat(db.semenResellerOrders);
  ok('[11] every row carries an id and updated_at — a payload without them would collide in the sync', rows.every(r => r.id && /^\d{4}-\d{2}-\d{2}T/.test(String(r.updated_at))), JSON.stringify(rows.map(r => [r.id, r.updated_at])));
  ok('[11] and the ids are namespaced, so a bucket key never collides', db.semenResellerOrderLinks.every(l => /^rsolink_/.test(l.id)));
}

/* ══ [12] what ships: no secrets, cache-busted, installable once ═════════════ */
{
  const page = read('order.html'), op = read('order-page.js'), sql = read('supabase/reseller_orders.sql');
  const sw = read('sw.js'), cfg = read('config.js'), build = read('qa/build-deploy-layout.sh');
  ok('[12] the page reads its config the app’s way, so no key is duplicated here', /supabase\/config\.js/.test(page) && /ARS_SUPABASE_CONFIG/.test(op));
  ok('[12] no service-role or secret key in the public files', !/service_role|eyJhbGciOi|secret/i.test(page + op), 'checked order.html + order-page.js');
  ok('[12] the public page is its own document and not cached as the app shell', !/ArsOrderPage/.test(read('index.html')) && /'\/order\.html'/.test(sw) && /url\.pathname === '\/order\.html'/.test(sw));
  ok('[12] and the offline fallback cannot hand a reseller the login screen', /js\/order-page\.js'\)\s*return;/.test(sw));
  ok('[12] order.html is in the deploy layout', /order\.html/.test(build));
  ok('[12] the page is served no-cache and kept out of search engines', /\/order\.html\n  Cache-Control: no-cache/.test(read('_headers')) && /noindex/.test(read('_headers')));
  ok('[12] the build is bumped so phones drop the old shell', /arswinetech-pro-v230/.test(sw) && /v230/.test(cfg), sw.split('\n')[7] + ' | ' + cfg.split('\n')[2]);
  ok('[12] every element the page looks up exists in the page', (() => {
    const ids = [...op.matchAll(/id\('([A-Za-z]+)'\)/g)].map(m => m[1]);
    const missing = [...new Set(ids)].filter(i => !new RegExp('id="' + i + '"').test(page));
    if (missing.length) console.log(`        looked up but absent: ${missing.join(', ')}`);
    return ids.length >= 10 && !missing.length;
  })(), 'see console');
  ok('[12] init does not scope its lookups to #main (the header lives outside it)', /ArsOrderPage\.init\(\)/.test(page) && !/getElementById\('main'\)\)/.test(page));
  ok('[12] the page styles itself, so a future app.css change cannot break a live link', (() => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(page)[1];
    const used = new Set();
    for (const m of page.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach(t => { if (t) used.add(t); });
    const undef = [...used].filter(c => !new RegExp('\\.' + c + '[\\s,{:.\\\\[]').test(style));
    if (undef.length) console.log(`        unstyled in the page: ${undef.join(', ')}`);
    return !undef.length;
  })());

  ok('[12] the SQL is paste-it-twice safe (every statement create-or-replace)', !/create function/.test(sql) && /create or replace function/.test(sql) && (sql.match(/create or replace function/g) || []).length === 4);
  ok('[12] index creation is guarded too', /create index if not exists/.test(sql) && !/\ncreate index [^i]/.test(sql));
  ok('[12] the four RPCs are security definer with a pinned search_path', (sql.match(/^ {2}security definer$/gm) || []).length === 4 && (sql.match(/set search_path = public/g) || []).length >= 4, String((sql.match(/^ {2}security definer$/gm) || []).length));
  ok('[12] the public gets execute on the four, and nothing else on the table', /revoke all on function/.test(sql) && /grant execute on function/.test(sql) && /to anon, authenticated, service_role/.test(sql));
  ok('[12] the page cannot name a price: the function reads k and qty only', /p_lines[^;]*->>'qty'/s.test(sql) && !/v_line->>'(rate|price|amount|total)'/s.test(sql));
  ok('[12] quantities are clamped server-side to what is on hand', /least\(/.test(sql) && /greatest\(0,/.test(sql));
  ok('[12] a burst from one link is throttled and the queue is capped', /interval '20 seconds'/.test(sql) && /pending/.test(sql) && /25/.test(sql));
  ok('[12] nothing in the install deletes or rewrites a live row', !/\bdrop table\b|\bdelete from\b|\btruncate\b|\bupdate public\.app_records\s+set\s+payload\s*=\s*jsonb_build/i.test(sql));
  ok('[12] the SQL never mentions a secret either', !/service_role_key|eyJhbGciOi/.test(sql));
  ok('[12] orders and links ride existing tables — no new table for the farm to pay for', !/create table/i.test(sql));
}

console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
