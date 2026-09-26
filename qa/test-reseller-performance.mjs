/*
 * [FIX 198] Reseller performance — "Top Resellers of the Month" + per-profile summary.
 *
 * Boots the REAL semen-sales.js in a VM (no browser, no build step) and asserts the
 * numbers the two new screens print. The whole feature is a claim about arithmetic —
 * "this reseller is the top performer, and here is why" — so the arithmetic is what
 * gets tested, not the pixels.
 *
 * Run:  node qa/test-reseller-performance.mjs
 *
 * Must stay true:
 *   1. the score model is exactly 100 points, and a reseller's score is the sum of the
 *      component points shown under it (the "why" panel can never disagree with the rank)
 *   2. periods are LOCAL calendar months (FIX 197): "This month" is the 1st → last day
 *      of the phone's month, never a UTC-shifted window
 *   3. a pickup counts in the month it was dispatched; a RETURN/REPLACEMENT counts in the
 *      month it was RECORDED (a September pickup returned in October is October's return)
 *   4. audit history is capped at 20 saves and legacy rows have none: the remainder is
 *      reconciled against the stored line state so totals always match the invoice
 *   5. voided pickups are excluded everywhere
 *   6. cash is counted on the date received (modal payments and money paid at dispatch)
 *   7. returned % and replaced % are of bottles dispatched, and replacement coverage is
 *      of bottles returned
 *   8. custom ranges work in both directions and clamp to whole days
 *   9. the hub really renders the board and every profile really renders the summary
 *      (a JS-only check would have missed a template that never got mounted)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = [path.join(ROOT, 'semen-sales.js'), path.join(ROOT, 'js', 'semen-sales.js')].find(p => fs.existsSync(p));
const CSS = [path.join(ROOT, 'app.css'), path.join(ROOT, 'css', 'app.css')].find(p => fs.existsSync(p));
if (!SRC) { console.error('semen-sales.js not found'); process.exit(1); }

let failures = 0, checks = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};
const eq = (name, got, want, tol = 0.005) => ok(name, Math.abs((+got || 0) - want) < tol, `got ${got}, want ${want}`);
const has = (name, hay, needle) => ok(name, String(hay || '').includes(needle), `missing ${JSON.stringify(needle)}`);

/* ── fake DOM: the same permissive shim the other reseller suites use ───────── */
function fakeEl(tag = 'div') {
  const t = { tagName: tag, children: [], style: {}, dataset: {}, scrollTop: 0, checked: false, value: '', textContent: '', hidden: false, attrs: {} };
  const noops = ['remove', 'appendChild', 'removeChild', 'append', 'prepend', 'addEventListener', 'removeEventListener',
    'focus', 'blur', 'scrollIntoView', 'click', 'select', 'submit'];
  return new Proxy(t, {
    get(o, k) {
      if (typeof k === 'symbol') return undefined;
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'querySelector') return () => null;
      if (k === 'querySelectorAll') return () => [];
      if (k === 'closest') return () => null;
      if (k === 'setAttribute') return (a, v) => { o.attrs[a] = String(v); };
      if (k === 'getAttribute') return a => (a in o.attrs ? o.attrs[a] : null);
      if (k === 'removeAttribute') return a => { delete o.attrs[a]; if (a === 'hidden') o.hidden = false; };
      if (k === 'hasAttribute') return a => a in o.attrs;
      if (k in o) return o[k];
      if (k === 'insertAdjacentHTML') return () => {};
      if (noops.includes(k)) return (...a) => (k === 'appendChild' ? a[0] : undefined);
      return undefined;
    },
    set(o, k, v) { o[k] = v; return true; }
  });
}

function boot(db) {
  const toasts = [], sheets = [], registry = new Map();
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, isFinite, isNaN, parseInt, parseFloat, RegExp, Promise, Error, Set, Map, Intl,
    peso: x => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(+x || 0),
    fmtDate: d => String(d || '').slice(0, 10),
    localDateTimeValue: () => new Date().toISOString().slice(0, 16),
    setTimeout: (fn) => { try { fn && fn(); } catch (_) {} return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { userAgent: 'node' },
    location: { href: 'https://preview.test/index.html', origin: 'https://preview.test' },
    matchMedia: () => ({ matches: false }),
    FormData: class { constructor() { this.entries = () => []; } },
    farmId: 'FARM-TEST', __arsActiveFarmId: 'FARM-TEST',
    F: () => db,
    save: () => { ctx.__saves++; },
    toast: m => toasts.push(String(m)),
    closeModal: () => {}, renderAll: () => {},
    confirm: () => true,
    ARSCloud: { syncFarmRecord: async () => ({ success: true }), verifyFarmSave: async () => ({ success: true }), saveLocalRecovery() {} },
    __saves: 0, __toasts: toasts, __sheets: sheets
  };
  ctx.__el = id => { if (!registry.has(id)) registry.set(id, fakeEl('div')); return registry.get(id); };
  ctx.__body = fakeEl('body');
  ctx.__body.insertAdjacentHTML = (_pos, html) => {
    sheets.push({ id: (/id="([^"]+)"/.exec(html) || [])[1] || '', html });
  };
  ctx.document = {
    body: ctx.__body,
    documentElement: fakeEl('html'),
    createElement: tag => fakeEl(tag),
    head: fakeEl('head'),
    getElementById: id => ctx.__el(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeChild: () => {},
    hidden: false
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: 'semen-sales.js' });
  ctx.sheet = id => [...sheets].reverse().find(s => s.id === id);
  ctx.lastToast = () => toasts[toasts.length - 1] || '';
  return ctx;
}

/* ── dates: built from LOCAL month arithmetic, exactly like the feature ─────── */
const pad = n => String(n).padStart(2, '0');
const D = (monthOffset, day, hour = 9) => new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, day, hour, 30, 0);
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = d => d.toISOString();

/* ── fixture ────────────────────────────────────────────────────────────────
   R-JO  Jo Dacara   · 10 btl this month (₱4,000, unpaid) + 6 btl LAST month, of
                       which 2 came back and were replaced THIS month; ₱3,000 paid
                       this month through the payment modal.
   R-AN  Greg Biron  · 14 btl this month (₱6,300) paid in full at dispatch, no
                       returns — plus a VOIDED 100-bottle monster that must vanish.
   R-AX  Ana Reyes   · legacy row: 5 btl last month, 1 returned this month with NO
                       audit trail at all (older build) — dated by return_adjusted_at.
   R-TR  Tino Cruz   · trimmed audit: stored state says 3 returned, the surviving
                       audit only explains 1 — the remaining 2 must still be counted.
   ─────────────────────────────────────────────────────────────────────────── */
function fixture() {
  return {
    id: 'FARM-TEST', name: "RM's Hog Farm",
    semen: [], semenSales: [], reservations: [],
    semenResellers: [
      { id: 'R-JO', name: 'Jo Dacara', contact: '0917' },
      { id: 'R-AN', name: 'Greg Biron', contact: '0918' },
      { id: 'R-AX', name: 'Ana Reyes', contact: '0919' },
      { id: 'R-TR', name: 'Tino Cruz', contact: '0920' }
    ],
    semenResellerTx: [
      {
        id: 'RTX-A1', reseller_id: 'R-JO', reseller_name: 'Jo Dacara',
        date: key(D(0, 3)), timestamp: stamp(D(0, 3)), total_amount: 4000, paid_amount: 0, discount_amount: 0,
        lines: [{ boar: 'B1 Large White', breed: 'Largewhite', semen_batch_no: 'B1LW', qty: 10, rate: 400, amount: 4000, returned_qty: 0, replacements: [] }]
      },
      {
        id: 'RTX-A2', reseller_id: 'R-JO', reseller_name: 'Jo Dacara',
        date: key(D(-1, 12)), timestamp: stamp(D(-1, 12)), total_amount: 2400, paid_amount: 0, discount_amount: 0,
        return_adjusted_at: stamp(D(0, 8)), adjusted_at: stamp(D(0, 8)),
        return_audit: [{ at: stamp(D(0, 8)), returns: 2, replacements: 2, cancelled: 0, undone: 0, lines: [] }],
        lines: [{
          boar: 'B1 Large White', breed: 'Largewhite', semen_batch_no: 'B1LW', qty: 6, rate: 400, amount: 2400,
          returned_qty: 2, return_reason: 'Unused / Unsold',
          replacements: [{ semen_id: 'SEM-LW', boar: 'B1 Large White', breed: 'Largewhite', batch_no: 'B1LW', qty: 2, rate: 400, at: stamp(D(0, 8)) }]
        }]
      },
      {
        id: 'RTX-B1', reseller_id: 'R-AN', reseller_name: 'Greg Biron',
        date: key(D(0, 5)), timestamp: stamp(D(0, 5)), total_amount: 6300, paid_amount: 6300, discount_amount: 0,
        lines: [{ boar: 'Duroc (BD)', breed: 'Duroc', semen_batch_no: 'BDD', qty: 14, rate: 450, amount: 6300, returned_qty: 0, replacements: [] }]
      },
      {
        id: 'RTX-B9', reseller_id: 'R-AN', reseller_name: 'Greg Biron', voided: true, void_reason: 'keyed twice',
        date: key(D(0, 6)), timestamp: stamp(D(0, 6)), total_amount: 45000, paid_amount: 45000, discount_amount: 0,
        lines: [{ boar: 'Duroc (BD)', breed: 'Duroc', semen_batch_no: 'BDD', qty: 100, rate: 450, amount: 45000, returned_qty: 0, replacements: [] }]
      },
      {
        id: 'RTX-C1', reseller_id: 'R-AX', reseller_name: 'Ana Reyes',
        date: key(D(-1, 20)), timestamp: stamp(D(-1, 20)), total_amount: 2000, paid_amount: 2000, discount_amount: 0,
        return_adjusted_at: stamp(D(0, 2)),
        /* legacy shape: one replacement in the flat fields, no replacements[] and no audit */
        lines: [{
          boar: 'B1 Large White', breed: 'Largewhite', semen_batch_no: 'B1LW', qty: 5, rate: 400, amount: 2000,
          returned_qty: 1, replaced_qty: 1, replacement_rate: 400, replacement_boar: 'B1 Large White', return_reason: 'Damaged'
        }]
      },
      {
        id: 'RTX-D1', reseller_id: 'R-TR', reseller_name: 'Tino Cruz',
        date: key(D(0, 4)), timestamp: stamp(D(0, 4)), total_amount: 3200, paid_amount: 0, discount_amount: 0,
        return_adjusted_at: stamp(D(0, 11)),
        return_audit: [{ at: stamp(D(0, 11)), returns: 1, replacements: 0, cancelled: 0, undone: 0, lines: [] }],
        lines: [{ boar: 'Hamruc', breed: 'Hamruc', semen_batch_no: 'HM1', qty: 8, rate: 400, amount: 2000, returned_qty: 3, replacements: [] }]
      }
    ],
    semenResellerAdjustments: [],
    semenResellerOrders: [], semenResellerOrderLinks: [], semenOrderBreeds: [],
    transactions: [
      {
        id: 'INC-1', type: 'Income', reseller_id: 'R-JO', amount: 3000,
        description: 'Reseller payment (Cash) — Jo Dacara', date: key(D(0, 9)), payment_allocations: []
      },
      {
        id: 'INC-0', type: 'Income', reseller_id: 'R-JO', amount: 999,
        description: 'Reseller payment (Cash) — Jo Dacara', date: key(D(-1, 15)), payment_allocations: []
      }
    ],
    deleted_ids: []
  };
}

console.log('\n[FIX 198] Reseller performance — scoring, periods and rendering\n');

const ctx = boot(fixture());

/* ── 1. score model ─────────────────────────────────────────────────────────── */
const board = ctx.arsResellerLeaderboard({ key: 'this' });
eq('[1] score model is exactly 100 points', board.model.reduce((a, m) => a + m.weight, 0), 100);
ok('[1] five weighted metrics', board.model.length === 5, `got ${board.model.length}`);
board.rows.forEach(r => {
  eq(`[1] ${r.reseller.name}: score = sum of the points shown`, r.score, +r.components.reduce((a, c) => a + c.points, 0).toFixed(2));
  ok(`[1] ${r.reseller.name}: every component within its weight`, r.components.every(c => c.points <= c.weight + 0.0001 && c.points >= 0));
});

/* ── 2/3. periods and event dating ──────────────────────────────────────────── */
const jo = ctx.arsResellerPeriodStats('R-JO', { key: 'this' });
const joLast = ctx.arsResellerPeriodStats('R-JO', { key: 'last' });
eq('[2] this month: bottles dispatched', jo.dispatched, 10);
eq('[2] last month: bottles dispatched', joLast.dispatched, 6);
eq('[3] the September pickup returned in October is THIS month\'s return', jo.returned, 2);
eq('[3] …and last month shows no return for it', joLast.returned, 0);
eq('[3] replacements ride the same date', jo.replaced, 2);
eq('[7] returned % is of bottles dispatched', jo.returnRate, 0.2);
eq('[7] replaced % is of bottles dispatched', jo.replaceRate, 0.2);
eq('[7] replacement coverage is of bottles returned', jo.replaceCoverage, 1);
eq('[3] net bottles sold = dispatched − returned + replaced', jo.netBottles, 10);
eq('[2] window starts on the 1st', new Date(jo.range.from + 'T00:00').getDate(), 1);
ok('[2] window ends on the last day of the month',
  new Date(new Date(jo.range.to + 'T00:00').getTime() + 86400000).getDate() === 1, `to=${jo.range.to}`);

/* ── 4. audit reconciliation ────────────────────────────────────────────────── */
const tino = ctx.arsResellerPeriodStats('R-TR', { key: 'this' });
eq('[4] trimmed audit: the unexplained remainder is still counted', tino.returned, 3);
const ana = ctx.arsResellerPeriodStats('R-AX', { key: 'this' });
eq('[4] legacy row with no audit: return dated by return_adjusted_at', ana.returned, 1);
eq('[4] legacy single replacement is read from the flat fields', ana.replaced, 1);
eq('[4] …and its pickup still belongs to last month', ana.dispatched, 0);
eq('[4] last month holds that pickup', ctx.arsResellerPeriodStats('R-AX', { key: 'last' }).dispatched, 5);
eq('[4] a return with no bottles dispatched in the window cannot fake a rate', ana.returnRate, 0);

/* ── 5. voided ──────────────────────────────────────────────────────────────── */
const greg = ctx.arsResellerPeriodStats('R-AN', { key: 'this' });
eq('[5] voided pickup excluded from bottles', greg.dispatched, 14);
eq('[5] voided pickup excluded from money', greg.netBilled, 6300);

/* ── 6. cash on the date received ───────────────────────────────────────────── */
eq('[6] modal payment counted in the month it was received', jo.collected, 3000);
eq('[6] last month keeps its own payment', joLast.collected, 999);
eq('[6] money paid at dispatch counts too', greg.collected, 6300);
eq('[6] collection rate = collected ÷ net billed', jo.collectionRate, 0.75);

/* ── ranking ────────────────────────────────────────────────────────────────── */
ok('[1] top performer is the full-marks reseller', board.rows[0].reseller.id === 'R-AN', `got ${board.rows[0].reseller.id}`);
eq('[1] leader scores the maximum', board.rows[0].score, 100);
eq('[1] runner-up score is reproducible', board.rows.find(r => r.reseller.id === 'R-JO').score, 66.07);
ok('[1] ranks are dense and ordered', board.rows.every((r, i) => r.rank === i + 1 && (i === 0 || board.rows[i - 1].score >= r.score)));
ok('[1] only resellers with activity are ranked', board.rows.length === 4);

const reasons = ctx.arsResellerTopReasons({ key: 'this' });
ok('[1] the board explains itself', reasons.length >= 4, `got ${reasons.length} reasons`);
has('[1] the explanation cites zero returns', reasons.join(' '), 'Zero returns');
has('[1] the explanation cites the collection rate', reasons.join(' '), 'collected in the period');
has('[1] the explanation names the deciding metric', reasons.join(' '), 'Final margin');

/* a month with no activity at all must not crash or invent a champion */
const quiet = ctx.arsResellerLeaderboard({ key: 'custom', from: '2019-01-01', to: '2019-01-31' });
ok('[1] an empty month ranks nobody', quiet.rows.length === 0);
ok('[1] an empty month explains nothing', ctx.arsResellerTopReasons({ key: 'custom', from: '2019-01-01', to: '2019-01-31' }).length === 0);

/* ── 8. custom ranges ───────────────────────────────────────────────────────── */
const oneDay = ctx.arsResellerPeriodStats('R-JO', { key: 'custom', from: key(D(0, 3)), to: key(D(0, 3)) });
eq('[8] single-day range sees only that day', oneDay.dispatched, 10);
eq('[8] single-day range excludes the later return', oneDay.returned, 0);
const reversed = ctx.arsResellerPeriodStats('R-JO', { key: 'custom', from: key(D(0, 20)), to: key(D(0, 1)) });
eq('[8] a back-to-front range is swapped, not dropped', reversed.dispatched, 10);
eq('[8] …and still catches the return inside it', reversed.returned, 2);
const spanRange = ctx.arsResellerRangeFor({ key: 'custom', from: key(D(0, 1)), to: key(D(0, 10)) });
ok('[8] custom label shows both ends', /→/.test(spanRange.label), spanRange.label);
const prev = ctx.arsResellerRangeFor({ key: 'custom', from: key(D(0, 11)), to: key(D(0, 20)) });
ok('[8] custom range keeps its own days', prev.from === key(D(0, 11)) && prev.to === key(D(0, 20)));

/* ── 9. the screens actually mount ──────────────────────────────────────────── */
ctx.openSemenResellerHub();
const hub = ctx.sheet('semenResellerHub');
ok('[9] the reseller hub rendered', !!hub);
has('[9] the board is on the reseller page', hub.html, 'TOP RESELLERS OF THE MONTH');
has('[9] the board carries the podium', hub.html, 'rlb-podium');
has('[9] the board offers this month / last month', hub.html, "arsResellerLeaderboardPeriod('last')");
has('[9] the board shows the winner\'s reasoning', hub.html, 'is on top');
has('[9] the scoring formula is disclosed', hub.html, 'Score = 30% bottles delivered');
has('[9] bars are animated from the data', hub.html, 'data-perf-bar');
has('[9] scores count up', hub.html, 'data-count-to');
has('[9] every profile carries the summary', hub.html, 'PERFORMANCE SUMMARY');
has('[9] the summary offers this month', hub.html, "arsResellerSummaryPeriod('R-JO','this')");
has('[9] the summary offers last month', hub.html, "arsResellerSummaryPeriod('R-JO','last')");
has('[9] the summary offers a custom range', hub.html, "arsResellerSummaryPeriod('R-JO','custom')");
has('[9] the summary applies custom dates', hub.html, "arsResellerSummaryCustom('R-JO')");
has('[9] the summary prints bottles sold', hub.html, 'Bottles sold (net)');
has('[9] the summary prints the returned share', hub.html, '>Returned<');
has('[9] the summary prints the replaced share', hub.html, '>Replaced<');
ok('[9] one summary per registered reseller', (hub.html.match(/PERFORMANCE SUMMARY/g) || []).length === 4,
  `got ${(hub.html.match(/PERFORMANCE SUMMARY/g) || []).length}`);
ok('[9] the voided pickup never reaches the board', !/45,?000/.test(hub.html));
/* the board's own markup must use this app's real modal/card classes */
has('[9] board mounted inside the hub modal', hub.html, 'due-modal reseller-hub-wrap');

/* period switches are wired and idempotent */
ctx.arsResellerSummaryPeriod('R-JO', 'last');
ctx.arsResellerSummaryPeriod('R-JO', 'custom');
ctx.arsResellerLeaderboardPeriod('last');
ctx.arsResellerBoardToggle('R-JO');
ctx.arsResellerBoardFocus('R-JO');
ok('[9] switching periods never throws', true);
const lastBoard = ctx.arsResellerLeaderboard({ key: 'last' });
ok('[9] last month ranks last month\'s sellers', lastBoard.rows.some(r => r.reseller.id === 'R-AX'));

/* ── 11. a window with no denominator must not print a fake percentage ─────── */
ctx.__el('rpsFrom_R-JO').value = key(D(0, 8));
ctx.__el('rpsTo_R-JO').value = key(D(0, 8));
ctx.arsResellerSummaryCustom('R-JO');
ctx.openSemenResellerHub();
const oneDayHtml = ctx.sheet('semenResellerHub').html;
const joBlock = oneDayHtml.slice(oneDayHtml.indexOf('rpsBox_R-JO'), oneDayHtml.indexOf('rpsBox_R-AN') > 0 ? oneDayHtml.indexOf('rpsBox_R-AN') : undefined);
has('[11] the custom day the return landed on is the window', joBlock, '1 day window');
has('[11] returns with nothing dispatched are shown as bottles, not as a rate', joBlock, '2 btl');
ok('[11] no invented 0.0% denominator', !/>0\.0%<\/b>/.test(joBlock), 'a percentage was printed without a denominator');
has('[11] and it says why', joBlock, 'returned against pickups dated outside this window');
ctx.arsResellerSummaryPeriod('R-JO', 'this');

/* ── styling ships with it ──────────────────────────────────────────────────── */
if (CSS) {
  const css = fs.readFileSync(CSS, 'utf8');
  has('[10] board styles shipped', css, '.rlb-podium');
  has('[10] summary styles shipped', css, '.rps-grid');
  has('[10] light theme covered', css, '.light-theme .rlb-wrap');
  has('[10] phone layout covered', css, '.rlb-row-main{grid-template-columns:32px');
  ok('[10] motion can be switched off', /prefers-reduced-motion[^}]*\}[\s\S]*rlb-pod/.test(css) || css.includes('.rlb-pod,.rlb-row,.rlb-why-list li,.rps-spark i{animation:none!important'));
}

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
