/*
 * [FIX 188 + FIX 189] Reseller order links, farm-owned order menu, and the pop-up.
 *
 * v231 changed what an order MEANS after the first live phone test: the reseller orders
 * a BREED from a menu the farm owns (not whatever happens to be in the cooler), the
 * ₱/bottle comes from that menu (a Semen Inventory batch stores a collection cost and has
 * no selling price, which is why every card read ₱0.00), and the arrival interrupts the
 * office with a pop-up, a beep and a chip on that reseller's card.
 *
 * Like qa/test-reseller-return.mjs, this boots the REAL code in a vm — including the REAL
 * public page with a stubbed fetch — because the dangerous part of this feature is a page
 * a customer can open deciding its own money. So the payload that leaves the page is
 * asserted, not trusted, and the ledger figures after Accept are checked against the farm's
 * own numbers.
 *
 * Run:  node qa/test-reseller-orders.mjs
 *       ARS_DUMP_SHEETS=1 node qa/test-reseller-orders.mjs   → /tmp/order-*.html
 *
 * Must stay true:
 *   1. a reseller's page can never send a price; the menu's ₱/bottle is what is billed
 *   2. an order is a request: nothing moves until the office saves a pick-up
 *   3. stock NEVER gates ordering, and accepting never over-promises bottles:
 *      Record Semen Pickup still refuses a line the cooler cannot cover
 *   4. choosing the boar stays the farm's decision — Accept leaves the batch blank
 *   5. the badge counts what nobody has decided; "seen" never clears a queue; a chip names
 *      it on that reseller's own card; the pop-up interrupts, once per order
 *   6. one private link per reseller, revocable at once, superseded links stop working
 *   7. every sheet is built from this app's real modal classes at a z-index that works on
 *      a phone, and no class is invented
 *   8. no service-role key in the shipped client; the SQL is idempotent and its loop
 *      variables are jsonb (the v230 "operator does not exist: record ->> unknown" bug)
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

/* ── permissive fake DOM ─────────────────────────────────────────────────────── */
function fakeEl(tag = 'div') {
  const t = { tagName: tag, children: [], style: {}, dataset: {}, scrollTop: 0, checked: false, value: '', hidden: false, innerHTML: '', textContent: '' };
  const noops = ['remove', 'appendChild', 'removeChild', 'append', 'prepend', 'insertAdjacentHTML', 'addEventListener',
    'removeEventListener', 'setAttribute', 'removeAttribute', 'focus', 'blur', 'scrollIntoView', 'click', 'select', 'submit'];
  return new Proxy(t, {
    get(o, k) {
      if (typeof k === 'symbol') return undefined;
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'querySelector') return () => null;
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

/* app.js's own helper, copied verbatim: the pick-up form's datetime-local default is
   built with it, so a loosely stubbed harness could not catch a real mismatch. */
function appLocalDateTimeValue(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const lot = (id, batch, boar, breed, bottles) => ({
  id, semen_batch_no: batch, boar_name: boar, breed, available_bottles: bottles, bottles, status: 'active'
});
const breed = (i, name, price, active = true) => ({
  id: 'rsobreed_' + i, name, price, blurb: '', active, sort: i,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString()
});

function seed(withMenu = true) {
  return {
    farm_id: 'FARM-TEST',
    name: "RM's Hog Farm",
    semen: [
      lot('SEM-LW', 'B1LW', 'B1 Large White', 'Largewhite', 10),
      lot('SEM-BD', 'BDD', 'Duroc (BD)', 'Duroc', 5)
    ],
    semenResellers: [{ id: 'R-JO', name: 'Jo Dacara', contact: '0917' }, { id: 'R-AN', name: 'Greg Biron', contact: '0918' }],
    semenResellerTx: [],
    semenResellerAdjustments: [],
    semenResellerOrders: [],
    semenResellerOrderLinks: [],
    semenOrderBreeds: withMenu ? [breed(1, 'Largewhite', 400), breed(2, 'Duroc', 450), breed(3, 'Duroc Pietrain', 0), breed(4, 'Hamruc Pietrain', 400, false)] : [],
    semenOrderMenuConfigured: withMenu,
    transactions: []
  };
}

function bootApp(db, opts = {}) {
  const toasts = [];
  const registry = new Map();
  const sheets = [];
  const store = new Map();
  const state = { confirm: opts.confirm !== undefined ? opts.confirm : true, prompt: opts.prompt !== undefined ? opts.prompt : '' };
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat, RegExp, Promise, Error, Set, Map, isNaN, Intl,
    /* exactly app.js's peso — the figure on screen must come from the app's formatter */
    peso: x => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(+x || 0),
    localDateTimeValue: appLocalDateTimeValue,
    setTimeout: (fn) => { try { fn && fn(); } catch (_) {} return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    navigator: { userAgent: 'node' },                    /* no clipboard, no share, no vibrate */
    location: { href: 'https://preview.test/index.html', origin: 'https://preview.test' },
    crypto: globalThis.crypto,
    addEventListener: () => {},
    FormData: class { constructor() { return [['reseller_id', 'R-JO'], ['paid_amount', '0'], ['pay_method', 'Cash'], ['notes', ''], ['timestamp', '']]; } },
    farmId: 'FARM-TEST',
    __arsActiveFarmId: 'FARM-TEST',
    F: () => db,
    save: () => { ctx.__saves++; },
    toast: (m) => toasts.push(String(m)),
    closeModal: () => {},
    renderAll: () => {},
    confirm: (m) => { ctx.__confirmArgs = String(m || ''); return state.confirm; },
    prompt: (...a) => { ctx.__promptArgs = a; return state.prompt; },
    ARSCloud: { syncFarmRecord: async () => ({ success: true }), verifyFarmSave: async () => ({ success: true }), saveLocalRecovery() {} },
    __saves: 0, __toasts: toasts, __state: state, __sheets: sheets, __store: store
  };
  ctx.__el = id => { if (!registry.has(id)) registry.set(id, fakeEl('div')); return registry.get(id); };
  ctx.__setValue = (id, v) => { ctx.__el(id).value = v; return ctx.__el(id); };
  ctx.__setChecked = (id, v) => { ctx.__el(id).checked = !!v; return ctx.__el(id); };
  ctx.__body = fakeEl('body');
  ctx.__body.insertAdjacentHTML = (_pos, html) => {
    const id = (/id="([^"]+)"/.exec(html) || [])[1] || '';
    const cls = (/class="([^"]+)"/.exec(html) || [])[1] || '';
    const css = (/style="([^"]+)"/.exec(html) || [])[1] || '';
    sheets.push({ id, cls, css, html });
  };
  ctx.document = {
    body: ctx.__body,
    documentElement: fakeEl('html'),
    createElement: tag => fakeEl(tag),
    head: fakeEl('head'),
    getElementById: id => ctx.__el(id),
    querySelector: sel => {
      if (/name="notes"/.test(sel)) return ctx.__el('__notes');
      const only = /^#([A-Za-z0-9_]+)$/.exec(String(sel || ''));
      if (!only) return null;
      return sheets.some(sh => sh.id === only[1]) ? fakeEl('div') : null;   /* mounted sheets only, like a browser */
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeChild: () => {},
    execCommand: () => false,
    hidden: false
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

/* An order as the SQL writes it: breed lines, priced from the farm's menu. */
const order = (over = {}) => ({
  id: 'rsord_test1', link_id: 'rsolink_1', reseller_id: 'R-JO', reseller_name: 'Jo Dacara',
  status: 'pending', placed_at: new Date(Date.now() - 5 * 60000).toISOString(),
  need_by: '2026-09-14', note: 'pick up by 8 AM', source: 'reseller_link',
  lines: [{ breed_id: 'rsobreed_2', breed: 'Duroc', boar: 'Duroc', semen_batch_no: '', semen_id: '', qty: 3, rate: 450, amount: 1350 }],
  bottles: 3, total: 1350, removed: [],
  ...over
});
const link = (over = {}) => ({
  id: 'rsolink_1', token: '11111111-2222-3333-4444-555555555555', farm_id: 'FARM-TEST', farm_name: "RM's Hog Farm",
  reseller_id: 'R-JO', reseller_name: 'Jo Dacara', active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over
});

console.log('\n[FIX 189] reseller order menu · links · notifications\n');

/* ══ [1] the public page's own arithmetic — no stock anywhere ═════════════════ */
{
  const menu = [
    { item_key: 'rsobreed_1', breed: 'Largewhite', price: 400, priced: true, blurb: '' },
    { item_key: 'rsobreed_3', breed: 'Duroc Pietrain', price: 0, priced: false, blurb: '200+ million motile' }
  ];
  const P = parseOrderPage();
  eq('[1] 2 × 400 + 1 × 0 = 800.00', P.cartTotals({ rsobreed_1: 2, rsobreed_3: 1 }, menu).total, 800);
  eq('[1] bottles counted', P.cartTotals({ rsobreed_1: 2, rsobreed_3: 1 }, menu).bottles, 3);
  eq('[1] an unpriced line is noticed', P.cartTotals({ rsobreed_1: 2, rsobreed_3: 1 }, menu).unpriced, 1);
  ok('[1] peso shows centavos', P.money(1051.5) === '₱1,051.50', P.money(1051.5));
  ok('[1] token parsed from the link', P.parseToken('?k=11111111-2222-3333-4444-555555555555') === '11111111-2222-3333-4444-555555555555');
  ok('[1] junk in the query is refused', P.parseToken('?k=%27%20or%201%3D1--') === '');
  ok('[1] no token, no page', P.parseToken('') === '');

  const big = P.clampCart({ rsobreed_1: 5000 }, menu);
  eq('[1] a line is capped at the farm’s 999, not at stock', big.cart.rsobreed_1, 999);
  ok('[1] and the reseller is told about the cap', /capped at 999 bottles/.test(big.warnings.join(' ')), big.warnings.join(' | '));
  const gone = P.clampCart({ rsobreed_XX: 2, rsobreed_3: 4 }, menu);
  ok('[1] a retired breed leaves the cart with a plain reason', gone.cart.rsobreed_XX === undefined && gone.cart.rsobreed_3 === 4, JSON.stringify(gone.cart));
  ok('[1] and it says “this farm’s menu”', /no longer on this farm/.test(gone.warnings.join(' ')), gone.warnings.join(' | '));
  ok('[1] nothing in the page mentions bottles left', !/on_hand|left<\/span>/.test(read('order-page.js')));
}

/* ══ [2] the payload that leaves the reseller's phone ═════════════════════════ */
{
  const P = parseOrderPage();
  const body = P.rpcBody('tok-1', [{ k: 'rsobreed_2', qty: 4, rate: 450, amount: 1800, boar: 'Duroc' }], '  please hold until noon  ', '2026-09-14');
  ok('[2] only menu keys and counts are sent', JSON.stringify(body.p_lines) === '[{"k":"rsobreed_2","qty":4}]', JSON.stringify(body.p_lines));
  ok('[2] no price, rate, total or farm id in the body', !/rate|price|total|amount|farm_id|reseller_id/.test(JSON.stringify(body)), JSON.stringify(body));
  const long = P.rpcBody('t', [{ k: 'a', qty: 1 }], 'x'.repeat(400), '').p_note;
  eq('[2] note trimmed to the farm’s 240 char field', long.length, 240);
  ok('[2] a bogus pick-up date is dropped, not injected', P.rpcBody('t', [{ k: 'a', qty: 1 }], '', "2026'; drop").p_need_by === null);
  ok('[2] a real date passes through', P.rpcBody('t', [{ k: 'a', qty: 1 }], '', '2026-09-14').p_need_by === '2026-09-14');
  ok('[2] an unknown status word still renders', P.statusOf('weird').key === 'pending' && /Waiting/.test(P.statusOf('weird').label));
}

function parseOrderPage() {
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat, RegExp, Promise, Error, Set, Map, isNaN, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { search: '', href: 'https://preview.test/order.html' },
    document: { getElementById: () => null, querySelector: () => null }, window: {}
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('order-page.js'), ctx, { filename: 'order-page.js' });
  return ctx.ArsOrderPage;
}

/* ══ [3] the page in a fake browser: breeds, not bottles ══════════════════════ */
{
  const calls = [];
  const P = await bootOrderPage({
    search: '?k=11111111-2222-3333-4444-555555555555',
    ars_order_shop: [{ ok: true, farm_name: "RM's Hog Farm", reseller_name: 'Greg Biron' }],
    ars_order_catalog: [
      { item_key: 'rsobreed_1', breed: 'Largewhite', price: 400, priced: true, blurb: '' },
      { item_key: 'rsobreed_3', breed: 'Duroc Pietrain', price: 0, priced: false, blurb: '200+ million motile' }
    ],
    ars_order_status: [{ order_id: 'rsord_old', status: 'accepted', placed_at: '2026-09-01T00:00:00.000Z', bottles: 2, total: 800, note: '', decision_note: 'Pick up at the gate' }],
    ars_place_order: [{ ok: true, order_id: 'rsord_new', total: 800, bottles: 3, lines: [], removed: [] }],
    calls
  });
  const txt = id => String(P.__el(id).innerHTML || '') + String(P.__el(id).textContent || '');
  const list = txt('list');
  ok('[3] the farm and the reseller are named from the link', /RM's Hog Farm/.test(P.__html('farmName')) && /Greg Biron/.test(txt('shop')));
  ok('[3] the menu breeds are offered at the farm’s own price', /Largewhite/.test(list) && /₱400\.00 a bottle/.test(list));
  ok('[3] an unpriced breed is admitted, not shown as ₱0.00', /Price confirmed by the farm/.test(list) && !/₱0\.00 a bottle/.test(list), list.slice(list.indexOf('Duroc Pietrain'), list.indexOf('Duroc Pietrain') + 200));
  ok('[3] the menu note reaches them', /200\+ million motile/.test(list));
  ok('[3] NO stock claim anywhere on the page', !/left|in stock|only \d+ of/.test(list), (list.match(/.{0,60}left.{0,60}/) || [''])[0]);
  ok('[3] their own past orders show with the farm’s answer', /2 bottles/.test(txt('mine')) && /Pick up at the gate/.test(txt('mine')));
  P.instance.step('rsobreed_1', 1); P.instance.step('rsobreed_1', 1); P.instance.set('rsobreed_3', '1');
  ok('[3] the basket counts breeds, not batches', /3 bottles · 2 breeds/.test(txt('basket')), txt('basket'));
  ok('[3] an unpriced line keeps the total honest at ₱800', /₱800\.00/.test(txt('sum')), txt('sum'));
  ok('[3] and says the farm will confirm the amount', /no price on the menu yet/.test(txt('hint')), txt('hint'));
  P.instance.set('rsobreed_1', '9999');
  ok('[3] typing past the cap is capped, with a reason', /capped at 999 bottles/.test(txt('hint')), txt('hint'));
  await P.instance.submit();
  await tick();
  const sent = calls.find(c => /ars_place_order/.test(c.url));
  ok('[3] the order posts to the rpc endpoint with the publishable key only', /\/rest\/v1\/rpc\/ars_place_order$/.test(sent.url) && /^sb_publishable_/.test(sent.opts.headers.apikey) && !/service_role|secret/i.test(JSON.stringify(sent.opts.headers)), sent.url + ' ' + sent.opts.headers.apikey);
  const body = JSON.parse(sent.opts.body);
  const sentLines = body.p_lines.slice().sort((a, b) => a.k.localeCompare(b.k));
  ok('[3] quantity-only lines, priced by the farm', JSON.stringify(sentLines) === '[{"k":"rsobreed_1","qty":999},{"k":"rsobreed_3","qty":1}]', JSON.stringify(body.p_lines));
  ok('[3] the page never claims a price it invented', body.p_lines.every(l => Object.keys(l).join() === 'k,qty'), JSON.stringify(body.p_lines));
  ok('[3] the farm’s total is what comes back on screen', /Order sent/.test(txt('shop')) && /₱800\.00/.test(txt('shop')), txt('shop').slice(0, 200));
  ok('[3] and so is their own choice of boar', /which boar they collect/.test(txt('shop')));
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
    ARS_SUPABASE_CONFIG: { url: 'https://db.test', anonKey: 'sb_publishable_TESTKEY' }
  };
  ctx.__el = id => { if (!registry.has(id)) registry.set(id, fakeEl('div')); return registry.get(id); };
  ctx.__html = id => String(ctx.__el(id).textContent || '') + String(ctx.__el(id).innerHTML || '');
  const root = fakeEl('div');
  ctx.document = { getElementById: id => ctx.__el(id), querySelector: sel => ctx.__el(String(sel).replace('#', '')), addEventListener: () => {}, body: fakeEl('body'), documentElement: fakeEl('html'), createElement: t => fakeEl(t) };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('order-page.js'), ctx, { filename: 'order-page.js' });
  ctx.ArsOrderPage.init();
  await tick(); await tick();
  return { ctx, instance: ctx.ArsOrderPage, __el: ctx.__el, __html: ctx.__html };
}

/* ══ [4] link lifecycle + the menu it depends on ══════════════════════════════ */
{
  const db = seed();
  const ctx = bootApp(db);
  ctx.arsShowResellerOrderLink('R-JO');
  let sheet = ctx.sheet('resellerOrderLinkModal');
  ok('[4] a reseller with no link gets an offer, not a dead end', sheet && /Create their order link/.test(sheet.html));
  ok('[4] and the offer is inside the app’s own sheet shell', sheet.cls === 'due-modal-bg' && /z-index:9999999/.test(sheet.css), sheet.css);

  ctx.arsMakeOrderLink('R-JO');
  const made = db.semenResellerOrderLinks[0];
  ok('[4] a link exists now, active, with a random token', !!made && made.active === true && /^[0-9a-f-]{36}$/.test(made.token), JSON.stringify(made));
  ok('[4] it stamps updated_at so the sync head moves and every phone sees it', /^\d{4}-\d{2}-\d{2}T/.test(made.updated_at));
  sheet = ctx.sheet('resellerOrderLinkModal');
  const url = `https://preview.test/order.html?k=${made.token}`;
  ok('[4] the link shown is this origin + token, ready to copy', sheet.html.includes(url));
  ok('[4] copy / send / new / pause are all offered', /📋 Copy link/.test(sheet.html) && /💬 Send it/.test(sheet.html) && /🔄 New link/.test(sheet.html) && /⏸ Pause link/.test(sheet.html));
  ok('[4] the sheet states where the page’s list comes from', /🧬 3 choices? on the menu|Their page will offer 3 breeds/.test(sheet.html), (sheet.html.match(/🧬[^<]{0,180}/) || [''])[0]);
  ok('[4] and it admits the unpriced line instead of hiding it', /1 without a price/.test(sheet.html));

  ctx.arsPauseOrderLink('R-JO');
  ok('[4] pause closes the live link immediately', db.semenResellerOrderLinks.every(l => l.active === false));
}

/* ══ [5] the menu: seeded, editable, and the farm's to own ════════════════════ */
{
  const db = seed(false);
  const ctx = bootApp(db);
  ctx.openSemenResellerHub();
  ok('[5] the four breeds they named appear once, priced at nothing until the farm says so',
    db.semenOrderBreeds.map(b => b.name).join('|') === 'Largewhite|Duroc|Duroc Pietrain|Hamruc Pietrain', JSON.stringify(db.semenOrderBreeds.map(b => [b.name, b.price])));
  ok('[5] they are real records so the public page can read them', db.semenOrderBreeds.every(b => b.id && b.farm_id === 'FARM-TEST' && /^\d{4}-\d{2}-\d{2}T/.test(b.updated_at)));
  const openSaves = ctx.__saves;
  ctx.openSemenResellerHub();
  eq('[5] opening the hub only renders — it never writes', ctx.__saves, openSaves);
  db.semenResellerOrderLinks.push(link());
  const beforeLink = ctx.__saves;
  ctx.arsShowResellerOrderLink('R-JO');
  eq('[5] handing out a link does persist the menu, once', ctx.__saves, beforeLink + 1);
  ctx.arsShowResellerOrderLink('R-JO');
  eq('[5] and not again on the next look', ctx.__saves, beforeLink + 1);

  /* deleting everything stays deleted — no ghost re-seed */
  db.semenOrderBreeds = [];
  ctx.openSemenResellerHub();
  ok('[5] an emptied menu is respected, not re-seeded behind their back', db.semenOrderBreeds.length === 0, JSON.stringify(db.semenOrderBreeds));

  ctx.openResellerOrderMenu();
  let menu = ctx.sheet('resellerOrderMenuModal');
  ok('[5] the menu editor opens in the app shell with a footer', menu.cls === 'due-modal-bg' && /class="due-modal reseller-hub-wrap"/.test(menu.html) && /✓ Save menu/.test(menu.html));
  ok('[5] and says plainly that stock is not the gate', /deliberately not your cooler/.test(menu.html), (menu.html.match(/not your cooler[^<]{0,120}/) || [''])[0]);
  ctx.arsOrderMenuAdd();                                            /* one blank row */
  ctx.__setValue('omName_0', 'Petrain'); ctx.__setValue('omPrice_0', '500'); ctx.__setChecked('omOn_0', true);
  ctx.__setValue('omBlurb_0', 'fresh semen, 1 week old');
  ctx.saveResellerOrderMenu({ preventDefault() {} });
  ok('[5] a new breed is saved with its own price and note',
    db.semenOrderBreeds.some(b => b.name === 'Petrain' && +b.price === 500 && /1 week old/.test(b.blurb)), JSON.stringify(db.semenOrderBreeds.map(b => [b.name, b.price])));

  ctx.arsOrderMenuAdd();                                            /* a second row, same name */
  ctx.__setValue('omName_0', 'Petrain'); ctx.__setValue('omPrice_0', '500'); ctx.__setChecked('omOn_0', true);
  ctx.__setValue('omName_1', 'Petrain'); ctx.__setValue('omPrice_1', '500'); ctx.__setChecked('omOn_1', true);
  const saves = ctx.__saves;
  ctx.saveResellerOrderMenu({ preventDefault() {} });
  ok('[5] the same breed twice is refused, not silently merged', /listed twice/.test(ctx.lastToast()) && ctx.__saves === saves, ctx.lastToast());
  ok('[5] a refused save leaves the menu exactly as it was', db.semenOrderBreeds.length === 2 && /listed twice/.test(ctx.lastToast()), JSON.stringify(db.semenOrderBreeds.map(b => b.name)));
  ok('[5] the draft line is invisible to the count and the hint', ctx.arsResellerOrderMenuRows(true).length === 1, JSON.stringify(ctx.arsResellerOrderMenuRows(true).map(b => b.name)));
  ctx.arsOrderMenuCancel();
  ok('[5] closing without saving prunes the draft line instead of syncing it', db.semenOrderBreeds.length === 1 && db.semenOrderBreeds[0].name === 'Petrain', JSON.stringify(db.semenOrderBreeds.map(b => b.name)));

  ctx.__state.confirm = true;
  ctx.arsOrderMenuDelete(0);
  ok('[5] delete asks, then removes that row only', db.semenOrderBreeds.length === 0 && /Removed from the order menu/.test(ctx.lastToast()), JSON.stringify(db.semenOrderBreeds));
  ok('[5] and it promises a sent order keeps its recorded price', /keep their recorded breed and price/.test(String(ctx.__confirmArgs || '')), String(ctx.__confirmArgs || ''));

  ctx.openSemenResellerHub();
  const hub = ctx.sheet('semenResellerHub');
  ok('[5] the toolbar carries the menu and a permanent door to the inbox', /🧬 Order menu/.test(hub.html) && /onclick="window\.openResellerOrderInbox\(\)"/.test(hub.html));
}

/* ══ [6] the badge on Registered Resellers + the chip on the reseller's card ══ */
{
  const db = seed();
  const ctx = bootApp(db);
  db.semenResellerOrderLinks.push(link());
  ctx.openSemenResellerHub();
  ok('[6] no orders, no badge', !/new order/.test(ctx.sheet('semenResellerHub').html));

  db.semenResellerOrders.push(order());
  ctx.openSemenResellerHub();
  let hub = ctx.sheet('semenResellerHub').html;
  ok('[6] one unseen order → “🛒 1 new order” on the KPI box', /Registered Resellers <button[^>]*count-pill[^>]*>🛒 1 new order<\/button>/.test(hub), (hub.match(/Registered Resellers[\s\S]{0,240}/) || [''])[0]);
  ok('[6] the badge opens the inbox', /onclick="window\.openResellerOrderInbox\(\)"/.test(hub));
  ok('[6] the reseller’s own card says it too', /🛒 1 order new<\/button>/.test(hub) && /Balance: ₱0<\/b>/.test(hub), (hub.match(/Balance:[\s\S]{0,200}/) || [''])[0]);
  ok('[6] and that chip opens the inbox filtered to them', /openResellerOrderInbox\('R-JO'\)/.test(hub));

  db.semenResellerOrders.push(order({ id: 'rsord_two', reseller_id: 'R-AN', reseller_name: 'Greg Biron', link_id: 'rsolink_2' }));
  ctx.openSemenResellerHub();
  hub = ctx.sheet('semenResellerHub').html;
  ok('[6] plural counts the arrivals', /🛒 2 new orders/.test(hub));
  ok('[6] each card only counts its own', (hub.match(/🛒 1 order new/g) || []).length === 2, String((hub.match(/🛒 \d+ order[s]? (new|waiting)/g) || []).length));

  ctx.markAllResellerOrdersSeen();
  ctx.openSemenResellerHub();
  hub = ctx.sheet('semenResellerHub').html;
  ok('[6] seen clears the flashing badge…', !/new order/.test(hub));
  ok('[6] …but the queue is NOT cleared by looking at it', db.semenResellerOrders.every(o => o.status === 'pending'));
  ok('[6] and a quiet door stays open while orders are undecided', /🛒 2 waiting<\/button>/.test(hub) && /🛒 Orders \(2\)/.test(hub), (hub.match(/🛒 Orders[^<]*/g) || []).join(' + '));
}

/* ══ [7] accepting cannot over-promise: the menu price, the farm's boar ═══════ */
{
  const db = seed();
  const ctx = bootApp(db);
  const o = order();                                  /* Duroc × 3 at the menu's ₱450 */
  db.semenResellerOrders.push(o);
  const res = ctx.arsResellerOrderPickupLines(o);
  eq('[7] their count is honoured', res.lines[0].qty, 3);
  eq('[7] billed at the menu price the order recorded', res.lines[0].rate, 450);
  eq('[7] line amount follows', res.lines[0].amount, 1350);
  ok('[7] the batch is left BLANK — which boar is the farm’s call', res.lines[0].semen_batch_no === '' && res.lines[0].semen_id === '', JSON.stringify(res.lines[0]));
  ok('[7] and the ordered price is marked so a batch pick cannot overwrite it', res.lines[0].ordered_rate === 450 && res.lines[0].from_order === true);
  ok('[7] a breed that IS in stock raises no warning', res.advisory === '', res.advisory);

  db.semen.find(l => l.id === 'SEM-BD').available_bottles = 0;
  db.semen.find(l => l.id === 'SEM-BD').bottles = 0;
  const short = ctx.arsResellerOrderPickupLines(o);
  eq('[7] empty stock does NOT cut the request', short.lines[0].qty, 3);
  ok('[7] it only says so, so nobody promises bottles they cannot pull', /Duroc: none of this breed is in stock right now/.test(short.advisory), short.advisory);
}

/* ══ [8] the full chain: accept → prefilled form → pick a boar → save ════════ */
{
  const db = seed();
  db.semenResellerOrderLinks.push(link());
  db.semenResellerOrders.push(order());
  const ctx = bootApp(db);
  ctx.acceptResellerOrder('rsord_test1');
  const o = db.semenResellerOrders[0];
  ok('[8] the order is marked accepted with the lines agreed', o.status === 'accepted' && o.accepted_lines.length === 1);
  let sheet = ctx.sheet('resellerPickupModal').html;
  ok('[8] the sheet says which order it came from', /From <b>Jo Dacara<\/b>’s order link/.test(sheet), (sheet.match(/From <[\s\S]{0,120}/) || ['NO STRIP'])[0]);
  ok('[8] and that choosing the boar is still to do', /Choose which boar to collect/.test(sheet));
  ok('[8] a priced line raises no billing warning', !/no menu price/.test(sheet), (sheet.match(/no menu price[^<]*/) || [''])[0]);

  /* their menu starts unpriced, so the very first real order can be ₱0 — say so, never show ₱0.00 */
  const db2 = seed();
  db2.semenOrderBreeds = [breed(1, 'Hamruc Pietrain', 0)];
  db2.semenResellerOrders.push(order({ lines: [{ breed: 'Hamruc Pietrain', boar: 'Hamruc Pietrain', qty: 2, rate: 0 }], bottles: 2, total: 0 }));
  const ctx2 = bootApp(db2);
  ctx2.openResellerOrderInbox();
  const box = ctx2.sheet('resellerOrderInbox').html;
  ok('[8] an unpriced order reads “price to confirm”, not ₱0.00', /price to confirm/.test(box) && !/· ₱0\.00/.test(box), (box.match(/2 bottles[\s\S]{0,80}/) || [''])[0]);
  ctx2.acceptResellerOrder('rsord_test1');
  const sheet2 = ctx2.sheet('resellerPickupModal').html;
  ok('[8] and the pick-up warns that ₱0 will be billed unless they type a price', /no menu price — they will bill ₱0 unless you type a ₱\/bottle here/.test(sheet2), (sheet2.match(/no menu price[\s\S]{0,90}/) || [''])[0]);
  let linesHtml = String(ctx.__el('pickupLinesWrap').innerHTML || '');
  ok('[8] the qty box carries their count', /id="lineQty_0" value="3"/.test(linesHtml), (linesHtml.match(/id="lineQty_0"[^>]*/) || [''])[0]);
  ok('[8] the price box carries the menu price', /id="lineRate_0" value="450"/.test(linesHtml), (linesHtml.match(/id="lineRate_0"[^>]*/) || [''])[0]);
  ok('[8] no batch is pre-selected for them', /value="" selected|— Choose Available Semen —/.test(linesHtml));
  ctx.onPickupBatchSelect(0, 'SEM-LW');                       /* the farm picks a Largewhite lot instead */
  linesHtml = String(ctx.__el('pickupLinesWrap').innerHTML || '');
  ok('[8] picking a batch keeps the ordered ₱450, not the app default ₱350', /id="lineRate_0" value="450"/.test(linesHtml), (ctx.__el('lineRate_0') || {}).value + ' ' + JSON.stringify(ctx.__el('pickupLinesWrap').innerHTML).slice(0, 40));
  ok('[8] the note and wanted date came across too', /pick up by 8 AM/.test(String(ctx.__el('__notes').value)) && /2026-09-14T/.test(String(ctx.__el('resellerPickupTime').value)), String(ctx.__el('__notes').value));
  eq('[8] accepting wrote once', ctx.__saves, 1);
  await ctx.window.saveResellerPickup({ preventDefault() {}, target: fakeEl('form') });
  const tx = db.semenResellerTx[0];
  ok('[8] saving the form is what creates the pick-up', !!tx && tx.reseller_id === 'R-JO');
  eq('[8] billed 3 × ₱450', tx.total_amount, 1350);
  eq('[8] the lot the farm chose lost exactly 3 bottles', db.semen.find(l => l.id === 'SEM-LW').available_bottles, 7);
  ok('[8] the batch now records which boar was collected', tx.lines[0].semen_batch_no === 'B1LW', JSON.stringify(tx.lines[0]));
  ctx.openResellerPickupModal('R-AN');
  ok('[8] the next pick-up is a clean form, not somebody else’s order', !/order link/.test(ctx.sheet('resellerPickupModal').html));
  ctx.openSemenResellerHub();
  ok('[8] an accepted order no longer nags in the badge', !/new order/.test(ctx.sheet('semenResellerHub').html) && !/waiting<\/button>/.test(ctx.sheet('semenResellerHub').html));
}

/* ══ [9] the ledger cannot be broken by an accepted order ════════════════════ */
{
  /* (a) a breed line with no batch chosen cannot be saved at all */
  const db = seed();
  db.semenResellerOrders.push(order({ lines: [{ breed: 'Duroc', boar: 'Duroc', qty: 40, rate: 450 }], bottles: 40 }));
  const ctx = bootApp(db);
  ctx.acceptResellerOrder('rsord_test1');
  await ctx.window.saveResellerPickup({ preventDefault() {}, target: fakeEl('form') });
  ok('[9] saving without choosing a boar is refused, not guessed', !db.semenResellerTx.length && /could not be found/.test(ctx.lastToast()), ctx.lastToast());
  eq('[9] nothing written', db.semenResellerTx.length, 0);
  ok('[9] the order keeps its decision so the office can go back to it', db.semenResellerOrders[0].status === 'accepted');

  /* (b) and once a boar IS chosen, the existing over-stock guard still applies */
  const db2 = seed();
  db2.semenResellerOrders.push(order({ lines: [{ breed: 'Duroc', boar: 'Duroc', qty: 40, rate: 450 }], bottles: 40 }));
  const ctx2 = bootApp(db2);
  ctx2.acceptResellerOrder('rsord_test1');
  ctx2.onPickupBatchSelect(0, 'SEM-BD');                        /* 5 bottles on hand */
  await ctx2.window.saveResellerPickup({ preventDefault() {}, target: fakeEl('form') });
  ok('[9] an accepted order can never overdraw a batch', !db2.semenResellerTx.length && /Only 5 bottle\(s\) on hand/.test(ctx2.lastToast()), ctx2.lastToast());
  eq('[9] stock untouched', db2.semen.find(l => l.id === 'SEM-BD').available_bottles, 5);
  eq('[9] no invoice created', db2.semenResellerTx.length, 0);
}

/* ══ [10] refusal, decline, and the traps ═════════════════════════════════════ */
{
  const db = seed();
  db.semenResellerOrders.push(order({ lines: [{ breed: 'Duroc', boar: 'Duroc', qty: 0, rate: 450 }], bottles: 0, total: 0 }));
  const ctx = bootApp(db);
  const saves = ctx.__saves;
  ctx.acceptResellerOrder('rsord_test1');
  ok('[10] an order with nothing on it is refused with an instruction', /no lines left to fill/.test(ctx.lastToast()), ctx.lastToast());
  eq('[10] refused accept wrote nothing', ctx.__saves, saves);
  ok('[10] and the order stays pending so it is not lost', db.semenResellerOrders[0].status === 'pending');

  ctx.__state.prompt = null;
  ctx.declineResellerOrder('rsord_test1');
  ok('[10] cancelling a decline changes nothing', db.semenResellerOrders[0].status === 'pending' && /why this order was declined/.test(String(ctx.__promptArgs[0])));
  ctx.__state.prompt = 'cold chain broke, sorry';
  ctx.declineResellerOrder('rsord_test1');
  const o = db.semenResellerOrders[0];
  ok('[10] declining records the reason for the reseller’s page', o.status === 'declined' && o.decision_note === 'cold chain broke, sorry', JSON.stringify(o));
  ctx.openSemenResellerHub();
  ok('[10] a declined order leaves the badge and the queue', !/new order/.test(ctx.sheet('semenResellerHub').html) && /Handled recently/.test(ctx.sheet('resellerOrderInbox').html));
  ctx.acceptResellerOrder('rsord_test1');
  ok('[10] an already-decided order cannot be accepted by tapping twice', /already declined/.test(ctx.lastToast()) && o.status === 'declined');
  ctx.acceptResellerOrder('nope');
  ok('[10] a tap on a vanished order says so instead of crashing', /no longer here/.test(ctx.lastToast()));
}

/* ══ [11] the pop-up that interrupts, once per order ══════════════════════════ */
{
  const db = seed();
  const ctx = bootApp(db);
  ctx.arsResellerOrderNotifyTick();
  ok('[11] first run only learns the queue — today’s backlog does not shout', !ctx.sheet('resellerOrderAlert') && /ars-order-notified:FARM-TEST/.test([...ctx.__store.keys()].join(',')), [...ctx.__store.keys()].join(','));

  db.semenResellerOrders.push(order({ reseller_name: 'Greg Biron' }));
  ctx.arsResellerOrderNotifyTick();
  const alert = ctx.sheet('resellerOrderAlert');
  ok('[11] a new order pops a sheet on whatever screen they are on', !!alert && alert.cls === 'due-modal-bg' && /z-index:99999999/.test(alert.css), alert ? alert.css : 'none');
  ok('[11] it names the reseller, the bottles and the money', /Greg Biron/.test(alert.html) && /3 bottles/.test(alert.html) && /₱1,350/.test(alert.html), (alert.html.match(/<h2>[\s\S]{0,80}/) || [''])[0]);
  ok('[11] it shows the line and their note', /Duroc/.test(alert.html) && /pick up by 8 AM/.test(alert.html));
  ok('[11] and says plainly that nothing has moved yet', /Requests only — no bottle and no balance moved/.test(alert.html));
  ok('[11] Open orders / Later are both real handlers', /openResellerOrderInbox\(\)/.test(alert.html) && /closeResellerModal\('resellerOrderAlert'\)/.test(alert.html));
  ok('[11] a toast fires too, so a silent phone still says something', /Greg Biron/.test(ctx.lastToast()));

  const before = ctx.sheets.length;
  ctx.arsResellerOrderNotifyTick();
  ok('[11] the SAME order never nags twice', ctx.sheets.length === before, `${before} → ${ctx.sheets.length}`);

  db.semenResellerOrders.push(order({ id: 'rsord_second', reseller_name: 'Jo Dacara' }));
  ctx.openResellerOrderInbox();
  const n = ctx.sheets.length;
  ctx.arsResellerOrderNotifyTick();
  ok('[11] and it stays quiet while they are already reading the inbox', ctx.sheets.length === n);
  ok('[11] the mark is per farm, so a second farm still gets its own alerts', /ars-order-notified:FARM-TEST/.test([...ctx.__store.keys()].join(',')), [...ctx.__store.keys()].join(','));
}

/* ══ [12] the sheets exist in the app's real markup, not invented class names ═ */
{
  const db = seed();
  db.semenResellerOrderLinks.push(link());
  const ctx = bootApp(db);
  db.semenResellerOrders.push(order({
    removed: [{ requested: 5, breed: 'Some Retired Breed', why: 'is no longer on this farm’s order menu' }],
    /* Hamruc Pietrain is on the menu but has no bottles in the cooler: warn, never block */
    lines: [{ breed: 'Hamruc Pietrain', boar: 'Hamruc Pietrain', qty: 3, rate: 400 },
            { breed: 'Duroc', boar: 'Duroc', qty: 2, rate: 450 }]
  }));
  ctx.arsResellerOrderNotifyTick();                 /* pops before anything else is mounted */
  ctx.openResellerOrderMenu();
  ctx.openResellerOrderInbox();
  ctx.arsShowResellerOrderLink('R-JO');
  ctx.openResellerOrderLinkAdmin();
  const css = read('app.css');
  const HOOKS = new Set(['small', 'input', 'check']);
  const lint = (name, id, zindex) => {
    const sh = ctx.sheet(id);
    ok(`${name}: sheet was actually appended`, !!sh);
    if (!sh) return;
    ok(`${name}: layer is .due-modal-bg`, sh.cls === 'due-modal-bg', sh.cls);
    ok(`${name}: lifted at z-index ${zindex}`, new RegExp(`z-index:\\s*${zindex}`).test(sh.css), sh.css);
    ok(`${name}: panel uses the app’s own panel class`, /class="due-modal( reseller-hub-wrap)?"/.test(sh.html), sh.html.slice(0, 150));
    ok(`${name}: header uses .modal-top / .eyebrow / .close-reminder`, /class="modal-top"/.test(sh.html) && /class="eyebrow"/.test(sh.html) && /class="close-reminder"/.test(sh.html));
    ok(`${name}: footer uses .due-actions for full-width phone buttons`, /class="due-actions"/.test(sh.html));
    ok(`${name}: no class this app does not define`, (() => {
      const tokens = new Set();
      for (const m of sh.html.matchAll(/class="([^"$]*)"/g)) m[1].trim().split(/\s+/).forEach(t => { if (t) tokens.add(t); });
      const undef = [...tokens].filter(t => !HOOKS.has(t) && !css.includes('.' + t));
      if (undef.length) console.log(`        undefined: ${undef.join(', ')}`);
      return !undef.length;
    })());
  };
  lint('[12] order menu editor', 'resellerOrderMenuModal', '9999999');
  lint('[12] order inbox', 'resellerOrderInbox', '9999998');
  lint('[12] link sheet', 'resellerOrderLinkModal', '9999999');
  lint('[12] link admin', 'resellerOrderLinkAdmin', '9999997');
  lint('[12] new-order pop-up', 'resellerOrderAlert', '99999999');

  const inbox = ctx.sheet('resellerOrderInbox').html;
  ok('[12] the inbox names who ordered and how much', /Jo Dacara/.test(inbox) && /₱1,350/.test(inbox), (inbox.match(/₱[\d.,]+/g) || []).join(' '));
  ok('[12] it states that the farm picks the boar', /You choose which boar to collect/.test(inbox));
  ok('[12] a breed with nothing in stock is warned, not blocked', /none of this breed is in stock right now/.test(inbox) && /you can still accept it and collect later/.test(inbox), (inbox.match(/📦[^<]{0,120}/) || [''])[0]);
  ok('[12] a line the farm retired is reported', /Some Retired Breed/.test(inbox) && /Their page could not send/.test(inbox));
  ok('[12] all three decisions are wired to real handlers', /window\.acceptResellerOrder\('rsord_test1'\)/.test(inbox) && /window\.declineResellerOrder\('rsord_test1'\)/.test(inbox) && /window\.markResellerOrderSeen\('rsord_test1'\)/.test(inbox));
  ok('[12] the money in an order card is exact, not peso()-rounded', /₱1,350(?![.,]\d)/.test(inbox) && !/₱1,350\.00/.test(inbox));

  if (process.env.ARS_DUMP_SHEETS) ctx.sheets.forEach((sh, i) => fs.writeFileSync(`/tmp/order-${i}-${sh.id || 'anon'}.html`, sh.html));
}

/* ══ [13] the sync contract the feature leans on ═════════════════════════════ */
{
  const client = read('client.js'), app = read('app.js');
  ok('[13] orders are a registered entity type so they sync and back up', /semenResellerOrders:\s*'semen_reseller_order'/.test(client));
  ok('[13] links too', /semenResellerOrderLinks:\s*'semen_reseller_order_link'/.test(client));
  ok('[13] and the order menu, because the public page reads it from the cloud', /semenOrderBreeds:\s*'semen_order_breed'/.test(client));
  ok('[13] every bucket is initialised like all the others', ['semenResellerOrders', 'semenResellerOrderLinks', 'semenOrderBreeds'].every(k => new RegExp('Array\\.isArray\\(f\\.' + k + '\\)').test(app)));
  const db = seed();
  const ctx = bootApp(db);
  ctx.arsMakeOrderLink('R-JO');
  ctx.arsMakeOrderLink('R-AN');
  ctx.arsOrderMenuAdd();
  ctx.saveResellerOrderMenu({ preventDefault() {} });
  const rows = db.semenResellerOrderLinks.concat(db.semenResellerOrders, db.semenOrderBreeds);
  ok('[13] every row carries an id and updated_at — a payload without them would collide in the sync', rows.every(r => r.id && /^\d{4}-\d{2}-\d{2}T/.test(String(r.updated_at))), JSON.stringify(rows.map(r => [r.id, r.updated_at])));
  ok('[13] and the ids are namespaced, so a bucket key never collides', db.semenResellerOrderLinks.every(l => /^rsolink_/.test(l.id)) && db.semenOrderBreeds.every(b => /^rsobreed_/.test(b.id)));
}

/* ══ [14] what ships: no secrets, cache-busted, installable once ═════════════ */
{
  const page = read('order.html'), op = read('order-page.js'), sql = read('supabase/reseller_orders.sql');
  const sw = read('sw.js'), cfg = read('config.js'), build = read('qa/build-deploy-layout.sh');
  ok('[14] the page reads its config the app’s way, so no key is duplicated here', /supabase\/config\.js/.test(page) && /ARS_SUPABASE_CONFIG/.test(op));
  ok('[14] no service-role or secret key in the public files', !/service_role|eyJhbGciOi|secret/i.test(page + op));
  ok('[14] the public page is its own document and not cached as the app shell', !/ArsOrderPage/.test(read('index.html')) && /url\.pathname === '\/order\.html'/.test(sw));
  ok('[14] and the offline fallback cannot hand a reseller the login screen', /js\/order-page\.js'\)\s*return;/.test(sw));
  ok('[14] order.html is in the deploy layout', /order\.html/.test(build));
  ok('[14] the page is served no-cache and kept out of search engines', /\/order\.html\n  Cache-Control: no-cache/.test(read('_headers')) && /noindex/.test(read('_headers')));
  ok('[14] the build is bumped so phones drop the old shell', /arswinetech-pro-v232-reseller-sql-recreate/.test(sw) && /v232-reseller-sql-recreate/.test(cfg), sw.split('\n')[7] + ' | ' + cfg.split('\n')[2]);
  ok('[14] the page asks for breeds, not bottles', /Which breeds do you need\?/.test(page) && !/Choose your bottles/.test(page));
  ok('[14] every element the page looks up exists in the page', (() => {
    const ids = [...op.matchAll(/id\('([A-Za-z]+)'\)/g)].map(m => m[1]);
    const missing = [...new Set(ids)].filter(i => !new RegExp('id="' + i + '"').test(page));
    if (missing.length) console.log(`        looked up but absent: ${missing.join(', ')}`);
    return ids.length >= 10 && !missing.length;
  })(), 'see console');
  ok('[14] init does not scope its lookups to #main (the header lives outside it)', /ArsOrderPage\.init\(\)/.test(page) && !/getElementById\('main'\)\)/.test(page));
  ok('[14] the page styles itself, so a future app.css change cannot break a live link', (() => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(page)[1];
    const used = new Set();
    for (const m of page.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach(t => { if (t) used.add(t); });
    const undef = [...used].filter(c => !new RegExp('\\.' + c + '[\\s,{:.\\\\[]').test(style));
    if (undef.length) console.log(`        unstyled in the page: ${undef.join(', ')}`);
    return !undef.length;
  })());

  /* the SQL is the only authority, and it is where v230 broke */
  ok('[14] the SQL is paste-it-twice safe (every statement create-or-replace)', !/\ncreate function/.test(sql) && (sql.match(/create or replace function/g) || []).length === 4);
  ok('[14] a function whose RETURN SHAPE changed is dropped first, or Postgres answers 42P13', (() => {
    const names = ['ars_order_catalog', 'ars_order_shop', 'ars_place_order', 'ars_order_status'];
    return names.every(n => {
      const at = sql.indexOf(`create or replace function public.${n}(`);
      const before = sql.slice(0, at);
      return at > 0 && before.includes(`drop function if exists public.${n}(`);
    });
  })(), 'every create needs a matching drop above it');
  ok('[14] and the reason is written where they will read it', /42P13/.test(sql) && /cannot change return type/.test(sql));
  ok('[14] the drops touch only these functions — never a table, never a row', (sql.match(/^drop function if exists/gm) || []).length === 7 && !/^drop (table|schema|index)/im.test(sql), String((sql.match(/^drop \w+/gm) || []).length));
  ok('[14] every function body is closed with $$; (4 of them)', (sql.match(/^\$\$;/gm) || []).length === 4);
  ok('[14] index creation is guarded too', /create index if not exists/.test(sql) && !/\ncreate index [^i]/.test(sql));
  ok('[14] the four RPCs are security definer with a pinned search_path', (sql.match(/^ {2}security definer$/gm) || []).length === 4, String((sql.match(/^ {2}security definer$/gm) || []).length));
  ok('[14] the public gets execute on the four, and nothing else on the table', /revoke all on function/.test(sql) && /grant execute on function/.test(sql) && /to anon, authenticated, service_role/.test(sql));
  ok('[14] the loop variable is jsonb — `record` produced “operator does not exist: record ->> unknown”', /v_line\s+jsonb/.test(sql) && !/v_line\s+record/.test(sql), (sql.match(/v_line\s+\w+/) || [''])[0]);
  ok('[14] and the loop feeds it a jsonb element, not a record row', /for v_line in select jsonb_array_elements\(p_lines\) loop/.test(sql) && !/select \* from jsonb_array_elements/.test(sql));
  ok('[14] the catalogue is the farm’s menu, not the cooler', /ars_order_catalog[\s\S]*?entity_type = 'semen_order_breed'/.test(sql) && !/ars_order_catalog[\s\S]*?semen_inventory/.test(sql));
  {
    const at = sql.indexOf('create or replace function public.ars_place_order(');
    const body = sql.slice(at, sql.indexOf('$$;', at));
    ok('[14] placing an order touches no stock column at all', at > 0 && !/available_bottles|on_hand|bottles'\)|semen_inventory/.test(body), (body.match(/.{0,60}(on_hand|semen_inventory).{0,40}/) || ['clean'])[0]);
    ok('[14] and it does read the menu it is priced from', /entity_type = 'semen_order_breed'/.test(body));
  }
  ok('[14] the page cannot name a price: the function reads k and qty only', !/v_line->>'(rate|price|amount|total)/.test(sql));
  ok('[14] quantity is clamped to the farm’s 1..999 per line, and lines are capped', /least\(999, greatest\(1,/.test(sql) && /jsonb_array_length\(p_lines\) > 40/.test(sql));
  ok('[14] a burst from one link is throttled and the queue is capped', /interval '20 seconds'/.test(sql) && /v_pending >= 25/.test(sql));
  ok('[14] nothing in the install deletes or rewrites a live row', !/\bdrop table\b|\bdelete from\b|\btruncate\b/i.test(sql));
  ok('[14] orders, links and the menu ride existing tables — nothing to pay for', !/create table/i.test(sql) && /'semen_order_breed'/.test(sql));
  ok('[14] the SQL never mentions a secret either', !/service_role_key|eyJhbGciOi/.test(sql));
  ok('[14] the doc tells them to re-paste it, which is the only fix for a live link', /re-paste this file/.test(sql) || /v231/.test(read('qa/fix188-reseller-order-links.md')));
}

console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
