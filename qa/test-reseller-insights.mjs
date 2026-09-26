/*
 * [FIX 198] Reseller insights — "Top Resellers of the Month" + per-profile summary.
 *
 * Boots the REAL semen-sales.js in a VM (same harness as test-reseller-return.mjs) with
 * the clock pinned to 2026-09-26 14:00 Asia/Manila, and asserts the numbers both screens
 * print, the ranking and the reason given for it, the date periods, and the markup.
 *
 * Run:  node qa/test-reseller-insights.mjs
 *
 * Must stay true:
 *   1. net bottles sold = picked up − returned + replacements handed over
 *   2. voided pickups never count; a pickup belongs to its LOCAL day (not a UTC slice)
 *   3. collected is capped per pickup at its net due (an over-keyed payment ≠ >100 %)
 *   4. "this month" is month-to-date and compares with the same days of last month
 *   5. ranking: chosen metric → net sales → net bottles → lower return rate → name,
 *      and the "why" names the rule that actually decided a tie
 *   6. the leaderboard and a profile summary agree for the same reseller and dates
 *   7. every rtop-/rsum- class the templates emit is defined in app.css
 */
process.env.TZ = 'Asia/Manila';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = [path.join(ROOT, 'semen-sales.js'), path.join(ROOT, 'js', 'semen-sales.js')].find(p => fs.existsSync(p));
if (!SRC) { console.error('semen-sales.js not found'); process.exit(1); }

let failures = 0, checks = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};
const eq = (name, got, want) => ok(name, Math.abs((+got || 0) - want) < 0.005, `got ${got}, want ${want}`);

/* ── permissive fake DOM: enough for the modal and hub renderers to run ───────── */
function fakeEl(tag = 'div') {
  const t = { tagName: tag, children: [], style: {}, dataset: {}, scrollTop: 0, checked: false, value: '' };
  const noops = ['remove', 'appendChild', 'removeChild', 'append', 'prepend', 'insertAdjacentHTML', 'addEventListener',
    'removeEventListener', 'setAttribute', 'removeAttribute', 'focus', 'blur', 'scrollIntoView', 'click', 'select', 'submit'];
  return new Proxy(t, {
    get(o, k) {
      if (typeof k === 'symbol') return undefined;
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'querySelector') return () => null;
      if (k === 'querySelectorAll') return () => [];
      if (k === 'closest') return () => null;
      if (k in o) return o[k];
      if (noops.includes(k)) return (...a) => (k === 'appendChild' ? a[0] : undefined);
      return undefined;
    },
    set(o, k, v) { o[k] = v; return true; }
  });
}

function boot(db) {
  const toasts = [];
  const ctx = {
    console, Date: FixedDate, Math, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat, RegExp, Promise, Error, Set, Map,
    setTimeout: (fn) => { try { fn && fn(); } catch (_) {} return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { userAgent: 'node' },
    location: { href: 'https://preview.test/index.html', origin: 'https://preview.test' },
    FormData: class { constructor() { this.entries = () => []; } },
    farmId: 'FARM-TEST',
    __arsActiveFarmId: 'FARM-TEST',
    F: () => db,
    save: () => { ctx.__saves++; },
    toast: (m) => toasts.push(String(m)),
    closeModal: () => {},
    renderAll: () => {},
    peso: n => 'P' + (+n || 0).toFixed(2),
    fmtDate: d => String(d || '').slice(0, 10),
    ARSCloud: { syncFarmRecord: async () => ({ success: true }), verifyFarmSave: async () => ({ success: true }), saveLocalRecovery() {} },
    __saves: 0, __toasts: toasts, __registry: new Map()
  };
  ctx.__sheets = [];          /* every element appended to <body>: the modal shells, for [13] */
  const __body = fakeEl('body');
  __body.appendChild = (el) => {
    if (el) ctx.__sheets.push({ id: el.id || '', cls: String(el.className || ''), css: String((el.style && el.style.cssText) || ''), html: String(el.innerHTML || '') });
    return el;
  };
  ctx.document = {
    body: __body,
    documentElement: fakeEl('html'),
    createElement: (tag) => fakeEl(tag),
    getElementById: (id) => {
      if (!ctx.__registry.has(id)) ctx.__registry.set(id, fakeEl('div'));
      return ctx.__registry.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeChild: () => {}
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: 'semen-sales.js' });
  ctx.__setValue = (id, v) => { const el = ctx.__registry.get(id) || fakeEl('div'); ctx.__registry.set(id, el); el.value = v; return el; };
  ctx.__setChecked = (id, v) => { const el = ctx.__registry.get(id) || fakeEl('div'); ctx.__registry.set(id, el); el.checked = !!v; return el; };
  ctx.lastToast = () => ctx.__toasts[ctx.__toasts.length - 1] || '';
  return ctx;
}

/* ── fixture ─────────────────────────────────────────────────────────────────── */
const FIXED = new Date('2026-09-26T14:00:00+08:00').getTime();
class FixedDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
}
const ln = (breed, qty, rate, extra = {}) => ({ boar: breed + ' boar', breed, semen_batch_no: breed.slice(0, 3).toUpperCase() + '-1', qty, rate, amount: qty * rate, returned_qty: 0, replaced_qty: 0, ...extra });
const tx = (id, rid, rname, when, lines, money, extra = {}) => ({
  id, reseller_id: rid, reseller_name: rname, type: 'pickup',
  timestamp: when.includes('T') ? when : undefined, date: when.includes('T') ? when.slice(0, 10) : when,
  lines, total_amount: money.total, paid_amount: money.paid || 0, discount_amount: money.disc || 0, ...extra
});
function seed() {
  return {
    farm_id: 'FARM-TEST', semen: [], transactions: [], semenResellerAdjustments: [],
    semenResellers: [
      { id: 'R-JO', name: 'Jo Dacara', contact: '000' },
      { id: 'R-GB', name: 'Greg Biron', contact: '0918' },
      { id: 'R-RS', name: 'Randy Sedeno', contact: '0951' },
      { id: 'R-AN', name: "Ana O'Neil", contact: '0999' }
    ],
    semenResellerTx: [
      /* Jo — Sep: 10 LW (2 returned "Unused", 1 Duroc replacement) + 5 Duroc; overpaid by ₱500 */
      tx('J1', 'R-JO', 'Jo Dacara', '2026-09-03T09:00:00+08:00', [
        ln('Large White', 10, 400, { returned_qty: 2, return_reason: 'Unused', replacements: [{ boar: 'Duroc boar', breed: 'Duroc', batch_no: 'DUR-1', qty: 1, rate: 450 }] }),
        ln('Duroc', 5, 450)
      ], { total: 5900, paid: 6400 }),
      tx('J2', 'R-JO', 'Jo Dacara', '2026-09-20T10:00:00+08:00', [ln('Pietrain', 6, 300)], { total: 1800, paid: 0, disc: 100 }),
      tx('J3', 'R-JO', 'Jo Dacara', '2026-09-21T10:00:00+08:00', [ln('Duroc', 50, 400)], { total: 20000, paid: 0 }, { voided: true }),
      /* 00:30 Sep 1 in Manila, but the UTC slice says Aug 31 — must count in SEPTEMBER */
      tx('J5', 'R-JO', 'Jo Dacara', '2026-08-31T16:30:00.000Z', [ln('Large White', 3, 400)], { total: 1200, paid: 1200 }),
      /* 23:59 Aug 31 in Manila — AUGUST */
      tx('J4', 'R-JO', 'Jo Dacara', '2026-08-31T15:59:00.000Z', [ln('Large White', 4, 400)], { total: 1600, paid: 1600 }),
      tx('J6', 'R-JO', 'Jo Dacara', '2026-08-10T10:00:00+08:00', [ln('Large White', 12, 400)], { total: 4800, paid: 4800 }),
      /* Greg — 20 bottles, fully paid */
      tx('G1', 'R-GB', 'Greg Biron', '2026-09-10T10:00:00+08:00', [ln('Large White', 20, 250)], { total: 5000, paid: 5000 }),
      /* Randy — 23 bottles: TIES Jo on net bottles, wins on net sales (₱9,200 vs ₱8,800) */
      tx('R1', 'R-RS', 'Randy Sedeno', '2026-09-15', [ln('Duroc', 23, 400)], { total: 9200, paid: 2000 }),
      /* Ana — August only: idle in September */
      tx('A1', 'R-AN', "Ana O'Neil", '2026-08-12', [ln('Duroc', 2, 400)], { total: 800, paid: 800 })
    ]
  };
}
const db = seed();
const ctx = boot(db);
const I = ctx.arsResellerInsights;
const jo = db.semenResellers[0], greg = db.semenResellers[1], randy = db.semenResellers[2];
const html = [];
ctx.document.body.insertAdjacentHTML = (_, h) => html.push(h);
const txt = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/* ── [1] the counting engine ─────────────────────────────────────────────────── */
ok('[1] the insights API is exposed', !!I && typeof I.periodStats === 'function');
eq('[1] local day: 00:30 Sep 1 Manila is Sep 1, not the UTC Aug 31', 0, I.txDay(db.semenResellerTx[3]) === '2026-09-01' ? 0 : 1);
eq('[1] local day: 23:59 Aug 31 Manila stays Aug 31', 0, I.txDay(db.semenResellerTx[4]) === '2026-08-31' ? 0 : 1);
const js = I.periodStats(db, jo, '2026-09-01', '2026-09-30');
eq('[1] Jo Sep pickups (voided J3 excluded)', js.pickups, 3);
eq('[1] Jo Sep picked up = 10 + 5 + 6 + 3', js.picked, 24);
eq('[1] Jo Sep returned', js.returned, 2);
eq('[1] Jo Sep replaced', js.replaced, 1);
eq('[1] Jo Sep net sold = 24 − 2 + 1', js.net, 23);
eq('[1] return rate = 2 / 24', js.returnRate, 100 * 2 / 24);
eq('[1] replacement rate = 1 / 24', js.replaceRate, 100 / 24);
eq('[1] swapped (returned and replaced)', js.swapped, 1);
eq('[1] credited (returned, not replaced)', js.credited, 1);
eq('[1] billed', js.billed, 8900);
eq('[1] discounts', js.discounts, 100);
eq('[1] net sales = billed − discounts', js.netSales, 8800);
eq('[1] collected is capped at net due on the overpaid J1 (5,900 not 6,400)', js.collected, 7100);
eq('[1] still open on these pickups', js.outstanding, 1700);
ok('[1] collection rate never exceeds 100 %', js.collectRate <= 100.0001, String(js.collectRate));
eq('[1] breed mix: Large White net = 8 kept + 3', js.breeds['Large White'].net, 11);
eq('[1] breed mix: Duroc net = 5 + 1 replacement', js.breeds['Duroc'].net, 6);
eq('[1] return reasons tallied', js.reasons['Unused'], 2);
const ja = I.periodStats(db, jo, '2026-08-01', '2026-08-31');
eq('[1] Jo August = 12 + 4 (the 00:30 Sep 1 pickup is not here)', ja.picked, 16);
const acct = (() => { const t = db.semenResellerTx.filter(x => x.reseller_id === 'R-JO' && !x.voided); return t.reduce((a, x) => a + Math.max(0, x.total_amount - x.discount_amount - x.paid_amount), 0); })();
eq('[1] the engine reads records only — balances untouched', acct, 1700);

/* ── [2] periods ─────────────────────────────────────────────────────────────── */
const pThis = I.period('this', null, null, '2026-09-26');
ok('[2] this month = Sep 1 → today', pThis.from === '2026-09-01' && pThis.to === '2026-09-26', JSON.stringify(pThis));
ok('[2] compared with the same days of August', pThis.prevFrom === '2026-08-01' && pThis.prevTo === '2026-08-26', JSON.stringify(pThis));
const pMar = I.period('this', null, null, '2026-03-31');
ok('[2] Mar 31 compares with Feb 1–28 (clamped, no Mar 3 spill)', pMar.prevFrom === '2026-02-01' && pMar.prevTo === '2026-02-28', JSON.stringify(pMar));
const pLast = I.period('last', null, null, '2026-01-15');
ok('[2] last month across a year boundary = Dec 2025', pLast.from === '2025-12-01' && pLast.to === '2025-12-31' && pLast.prevFrom === '2025-11-01' && pLast.prevTo === '2025-11-30', JSON.stringify(pLast));
const pCus = I.period('custom', '2026-09-20', '2026-09-01', '2026-09-26');
ok('[2] custom range with the dates typed backwards is swapped', pCus.from === '2026-09-01' && pCus.to === '2026-09-20', JSON.stringify(pCus));
ok('[2] custom compares with the 20 days right before', pCus.prevFrom === '2026-08-12' && pCus.prevTo === '2026-08-31', JSON.stringify(pCus));
ok('[2] labels are human', pLast.label === 'December 2025' && /Sep 1 – 26, 2026/.test(pThis.label), pLast.label + ' | ' + pThis.label);

/* ── [3] the leaderboard and its reasons ─────────────────────────────────────── */
const bB = I.leaderboard(db, '2026-09', 'bottles');
ok('[3] by bottles: Randy, Jo, Greg', bB.rows.map(x => x.r.id).join(',') === 'R-RS,R-JO,R-GB', bB.rows.map(x => x.r.id + ':' + x.value).join(','));
eq('[3] Ana (August only) is counted as idle', bB.idle, 1);
ok('[3] the Randy/Jo tie on 23 bottles was decided by net sales', bB.rows[0].decidedBy && bB.rows[0].decidedBy.id === 'sales', JSON.stringify(bB.rows[0].decidedBy));
eq('[3] group net bottles', bB.all.net, 66);
eq('[3] group picked up', bB.all.picked, 67);
const why1 = I.whyLines(bB, bB.rows[0]).map(x => txt(x.t));
ok('[3] #1 why: share of the month', why1.some(l => /23 net bottles sold — 34\.8% of all resellers’ 66 in September 2026/.test(l)), why1[0]);
ok('[3] #1 why: names the tie and the rule that broke it', why1.some(l => /Tied with #2 Jo Dacara on net bottles sold; placed first on net sales/.test(l)), why1[1]);
ok('[3] #1 why: return rate vs the group', why1.some(l => /Return rate 0% \(0 of 23 bottles\) vs 3% across all resellers — no bottles came back/.test(l)), why1.join(' | '));
ok('[3] #1 why: collection', why1.some(l => /Collected 21\.7% of the P9200\.00 billed on this month’s pickups · P7200\.00 still open/.test(l)), why1.join(' | '));
const why3 = I.whyLines(bB, bB.rows[2]).map(x => txt(x.t));
ok('[3] #3 why: the gap to the place above', why3.some(l => /3 behind #2 Jo Dacara/.test(l)), why3[1]);
const whyJo = I.whyLines(bB, bB.rows[1]).map(x => txt(x.t));
ok('[3] #2 why: level with #1, placed below on net sales', whyJo.some(l => /Level with #1 Randy Sedeno on net bottles sold; placed below on net sales/.test(l)), whyJo[1]);
ok('[3] #2 why: swaps vs credits', whyJo.some(l => /1 of 2 returned bottle\(s\) were swapped for replacements; 1 credited back/.test(l)), whyJo.join(' | '));
const bS = I.leaderboard(db, '2026-09', 'sales');
ok('[3] by net sales: Randy 9,200 · Jo 8,800 · Greg 5,000', bS.rows.map(x => x.r.id + ':' + x.value).join(',') === 'R-RS:9200,R-JO:8800,R-GB:5000', bS.rows.map(x => x.r.id + ':' + x.value).join(','));
const bC = I.leaderboard(db, '2026-09', 'collected');
ok('[3] by collected: Jo 7,100 · Greg 5,000 · Randy 2,000', bC.rows.map(x => x.r.id + ':' + x.value).join(',') === 'R-JO:7100,R-GB:5000,R-RS:2000', bC.rows.map(x => x.r.id + ':' + x.value).join(','));
const whyC = I.whyLines(bC, bC.rows[0]).map(x => txt(x.t));
ok('[3] a clear lead is stated as a gap', whyC.some(l => /Leads #2 Greg Biron by P2100\.00/.test(l)), whyC[1]);
const joRow = bB.rows.find(x => x.r.id === 'R-JO');
ok('[3] leaderboard and profile engine agree for Jo in September', joRow.s.net === js.net && joRow.s.netSales === js.netSales && joRow.s.collected === js.collected);
const bAug = I.leaderboard(db, '2026-08', 'bottles');
ok('[3] August board: Jo 16, Ana 2', bAug.rows.map(x => x.r.id + ':' + x.value).join(',') === 'R-JO:16,R-AN:2', bAug.rows.map(x => x.r.id + ':' + x.value).join(','));

/* ── [4] the hub renders the board ───────────────────────────────────────────── */
ctx.openSemenResellerHub();
const hub = html.join('');
ok('[4] the hub shows the board', /Top Resellers of the Month/.test(hub));
ok('[4] it sits above the search bar', hub.indexOf('Top Resellers of the Month') < hub.indexOf('Search reseller name'));
const podium = (hub.match(/class="rtop-col rtop-p(\d)[^"]*"[^>]*data-rid="([^"]+)"/g) || []).map(s => s.replace(/.*rtop-p(\d).*data-rid="([^"]+)".*/, '$1:$2'));
ok('[4] podium order is 2nd · 1st · 3rd', podium.join(',') === '2:R-JO,1:R-RS,3:R-GB', podium.join(','));
ok('[4] opens on the current month (September)', /<option value="2026-09" selected>September 2026<\/option>/.test(hub));
ok('[4] the #1 reason panel is open by default', /Why #1/.test(hub) && /Randy Sedeno/.test(txt(hub.split('rtopWhy')[1] || '')));
ok('[4] count-up carries the final value in the HTML', /data-countup="23" data-fmt="int">23</.test(hub));
ok('[4] no data-neo call site in JS — the podium takes the app-wide lift like every key (FIX 190 rule)', !/data-neo/.test(fs.readFileSync(SRC, 'utf8')));
ok('[4] a name with an apostrophe is escaped in attributes', !/'Ana O'Neil'/.test(hub));
ok('[4] the method is printed under the board', /Ranked by net bottles sold on pickups dated Sep 1 – 30, 2026 \(voided excluded\)/.test(txt(hub)), (txt(hub).match(/Ranked by[^.]*\./) || [''])[0]);

/* switching metric / month re-renders only the board */
ctx.arsTopResellersMetric('collected');
const board2 = ctx.document.getElementById('resellerTopBoard').innerHTML;
ok('[4] metric switch re-ranks (Jo is #1 by collected)', /Why #1[\s\S]*Jo Dacara/.test(board2) && /rtop-tab is-on"[^>]*>Collected/.test(board2));
ctx.arsTopResellersMonth('2026-08');
const board3 = ctx.document.getElementById('resellerTopBoard').innerHTML;
ok('[4] month switch shows August', /<option value="2026-08" selected>/.test(board3) && /August 2026/.test(board3));
ctx.arsTopResellersMetric('bottles'); ctx.arsTopResellersMonth('2026-09');
ctx.arsTopResellersPick('R-GB');
ok('[4] tapping a reseller swaps the reason panel to them', /Why #3/.test(ctx.document.getElementById('rtopWhy').innerHTML) && /Greg Biron/.test(ctx.document.getElementById('rtopWhy').innerHTML));

/* ── [5] the profile summary ─────────────────────────────────────────────────── */
const card = hub.slice(hub.indexOf('id="resSum_R-JO"'));
const sumJo = card.slice(0, card.indexOf('reseller-tx-list'));
ok('[5] every profile carries a summary', /id="resSum_R-JO"/.test(hub) && /id="resSum_R-GB"/.test(hub));
ok('[5] opens on this month, month-to-date', /Sep 1 – 26, 2026 · month to date/.test(txt(sumJo)), txt(sumJo).slice(0, 120));
ok('[5] three period choices', /This month/.test(sumJo) && /Last month/.test(sumJo) && /Custom/.test(sumJo));
const T = txt(sumJo);
ok('[5] picked up 24 over 3 pickups', /Bottles picked up 24 3 pickup\(s\) · avg 8/.test(T), T.slice(0, 260));
ok('[5] net sold 23', /Net bottles sold 23 picked − returned \+ replaced/.test(T));
ok('[5] returned 8.3% (2 of 24)', /Returned 8\.3% 2 of 24 bottles/.test(T));
ok('[5] replaced 4.2% (1 bottle)', /Replaced 4\.2% 1 bottle\(s\) handed over/.test(T));
ok('[5] compared with Aug 1–26 (12 bottles → ▲ 12)', /▲ 12/.test(T) && /vs Aug 1 – 26, 2026/.test(T), T.slice(0, 400));
ok('[5] kept / replaced / credited split', /Kept 22 \(91\.7%\)/.test(T) && /Returned → replaced 1 \(4\.2%\)/.test(T) && /Returned → credited 1 \(4\.2%\)/.test(T));
ok('[5] money: net sales, collected (capped), still open', /Net sales P8800\.00 after P100\.00 discount/.test(T) && /Collected P7100\.00 80\.7% of net sales/.test(T) && /Still open P1700\.00/.test(T), T);
ok('[5] breed mix and return reasons', /Large White/.test(T) && /Unused 2/.test(T));
ctx.arsResellerSummaryPeriod('R-JO', 'last');
const last = txt(ctx.document.getElementById('resSum_R-JO').innerHTML);
ok('[5] Last month = August 2026 with 16 bottles', /August 2026/.test(last) && /Bottles picked up 16/.test(last), last.slice(0, 200));
ok('[5] August had no returns', /No returns in this period/.test(last));
ctx.arsResellerSummaryCustomOpen('R-JO');
ok('[5] Custom opens the date pickers', /id="rsFrom_R-JO"/.test(ctx.document.getElementById('resSum_R-JO').innerHTML));
ctx.__setValue('rsFrom_R-JO', '2026-09-19'); ctx.__setValue('rsTo_R-JO', '2026-09-01');
ctx.arsResellerSummaryCustom('R-JO');
const cus = txt(ctx.document.getElementById('resSum_R-JO').innerHTML);
ok('[5] custom Sep 1–19 (typed backwards) = J1 + J5 = 18 bottles', /Sep 1 – 19, 2026/.test(cus) && /Bottles picked up 18/.test(cus), cus.slice(0, 200));
ctx.__setValue('rsFrom_R-JO', ''); const before = ctx.__toasts.length;
ctx.arsResellerSummaryCustom('R-JO');
ok('[5] a missing date is refused with a message', ctx.__toasts.length === before + 1 && /Pick both/.test(ctx.lastToast()));
ctx.arsResellerSummaryPeriod('R-AN', 'this');
ok('[5] an idle month says so, and points at the comparison', /No pickups for Ana O'Neil in this period\. Aug 1 – 26, 2026 had 2 bottle\(s\) over 1 pickup\(s\)/.test(txt(ctx.document.getElementById('resSum_R-AN').innerHTML)), txt(ctx.document.getElementById('resSum_R-AN').innerHTML));

/* ── [6] every class the templates emit exists in app.css ─────────────────────── */
const css = fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8');
const emitted = [hub, board2, board3, ctx.document.getElementById('resSum_R-JO').innerHTML, ctx.document.getElementById('resSum_R-AN').innerHTML].join(' ');
const tokens = new Set();
(emitted.match(/class="([^"]+)"/g) || []).forEach(c => c.slice(7, -1).split(/\s+/).forEach(t => { if (/^(rtop|rsum)/.test(t)) tokens.add(t); }));
const missing = [...tokens].filter(t => !new RegExp('\\.' + t.replace(/[-]/g, '\\-') + '(?![\\w-])').test(css));
ok('[6] every rtop-/rsum- class is styled in app.css', missing.length === 0, missing.join(', '));
ok('[6] every animation respects reduced motion', /prefers-reduced-motion:reduce\)\{\.rtop \*,\.rtop:before,\.rsum \*\{animation:none!important/.test(css));
ok('[6] light theme overrides exist', /\.light-theme \.rtop\{/.test(css) && /\.light-theme \.rsum\{/.test(css));

console.log(`\n${failures ? "FAILED" : "OK"} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
