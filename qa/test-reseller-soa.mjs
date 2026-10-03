/*
 * [FIX 203] Reseller "Print / PDF" must produce a professional Statement of Account,
 * with a selectable period — not six blank pages.
 *
 * Reported from the field (2026-10-03, two screenshots): the statement for Jo Dacara
 * (balance ₱4,650) was open; tapping "🖨 Print / PDF" handed Android's Save-as-PDF a
 * six-page document with nothing on any page.
 *
 * Root cause: the button called the bare window.print(). #resellerStatementModal is a
 * .drill-bg — position:fixed; inset:0 — and no @media print rule in the app ever claimed
 * it. Every other printable screen in this app (#reservationDetail, #pedigreeReport,
 * #fcReport, #vaxReport, #feedReport) has a block that takes the rest of the page out of
 * the print tree and un-fixes the overlay. The reseller statement had none, so the
 * browser laid out the hidden app shell behind it, paginated THAT into six sheets, and
 * clipped the fixed overlay away. On top of that, the thing being printed was a 300px
 * 58mm thermal receipt, which is not a document to hand a reseller on Letter paper.
 *
 * Now: a real A4 Statement of Account with a period picker, printed through a fresh
 * window carrying its own stylesheet — the same path printFeedReport already uses — so
 * the app shell cannot reach the paper at all.
 *
 * Run:  node qa/test-reseller-soa.mjs
 *
 * Must stay true:
 *   1. the broken window.print() is gone from the statement footer
 *   2. the document exists, with the parties, the period and a statement number
 *   3. the period picker offers All time, every month with activity, and a custom range
 *   4. "All time" reconciles EXACTLY with the balance the hub and the thermal slip show
 *   5. a month shows only that month, and opens with the balance brought forward
 *   6. the months chain: each closing balance is the next month's opening balance
 *   7. discounts are counted once — the dated log is a reference, not a second charge
 *   8. voided transactions never appear and never move the money
 *   9. an overpaid account carries a credit forward instead of silently clamping
 *  10. printing writes ONLY the certificate into a new window with its own A4 CSS
 *  11. Ctrl+P is covered too: the app shell leaves the print tree (the blank-page cause)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = [path.join(ROOT, 'semen-sales.js'), path.join(ROOT, 'js', 'semen-sales.js')].find(p => fs.existsSync(p));
const CSSF = [path.join(ROOT, 'app.css'), path.join(ROOT, 'css', 'app.css')].find(p => fs.existsSync(p));
if (!SRC) { console.error('semen-sales.js not found'); process.exit(1); }

let failures = 0, checks = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};
const eq = (name, got, want) => ok(name, Math.abs((+got || 0) - want) < 0.005, `got ${got}, want ${want}`);

const SOURCE = fs.readFileSync(SRC, 'utf8');
const CSS = fs.readFileSync(CSSF, 'utf8');

/* ── fake DOM ─────────────────────────────────────────────────────────────── */
function fakeEl(tag = 'div') {
  const t = { tagName: tag, children: [], style: {}, dataset: {}, scrollTop: 0, checked: false, value: '', innerHTML: '', outerHTML: '' };
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
  const bodyClasses = new Set();
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat, RegExp, Promise, Error, Set, Map, Symbol,
    setTimeout: (fn) => { try { fn && fn(); } catch (_) {} return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { userAgent: 'node' },
    location: { href: 'https://preview.test/index.html', origin: 'https://preview.test' },
    FormData: class { *[Symbol.iterator]() {} },
    farmId: 'FARM-TEST', __arsActiveFarmId: 'FARM-TEST',
    F: () => db,
    save: () => {}, toast: m => toasts.push(String(m)), closeModal: () => {}, renderAll: () => {},
    peso: n => '\u20b1' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    fmtDate: d => String(d || '').slice(0, 10),
    localDateTimeValue: () => '2026-10-03T12:34',
    ARSCloud: { syncFarmRecord: async () => ({ success: true }), verifyFarmSave: async () => ({ success: true }), saveLocalRecovery() {} },
    __toasts: toasts, __registry: new Map(), __windows: []
  };
  ctx.__sheets = [];
  /* a plain object, not the proxy: the proxy synthesises a throwaway classList
     on every read, which would swallow the soa-report-open flag under test */
  const __body = {
    tagName: 'body', style: {}, dataset: {}, scrollTop: 0, innerHTML: '',
    classList: { add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c), contains: c => bodyClasses.has(c), toggle() {} },
    appendChild: (el) => { if (el) ctx.__sheets.push({ id: el.id || '', html: String(el.innerHTML || '') }); return el; },
    removeChild() {}, addEventListener() {}, removeAttribute() {}, setAttribute() {},
    querySelector: () => null, querySelectorAll: () => []
  };
  ctx.document = {
    body: __body, documentElement: fakeEl('html'), createElement: t => fakeEl(t),
    getElementById: id => (ctx.__registry.has(id) ? ctx.__registry.get(id) : null),
    querySelector: sel => (ctx.__lastCert && /certificate/.test(sel) ? ctx.__lastCert : null),
    querySelectorAll: () => [], addEventListener: () => {}, removeChild: () => {}
  };
  /* capture the HTML the renderer inserts */
  __body.insertAdjacentHTML = (pos, html) => {
    ctx.__lastHTML = String(html);
    const m = /<article class="certificate[^]*<\/article>/.exec(ctx.__lastHTML);
    ctx.__lastCert = m ? { outerHTML: m[0] } : null;
    const reg = (id) => { if (!ctx.__registry.has(id)) ctx.__registry.set(id, fakeEl('div')); };
    reg('resellerSOA');
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.open = () => {
    const w = { written: '', document: { write(s) { w.written += s; }, close() {} }, focus() {}, print() { w.printed = true; } };
    ctx.__windows.push(w);
    return w;
  };
  ctx.__bodyClasses = bodyClasses;
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: 'semen-sales.js' });
  ctx.html = () => String(ctx.__lastHTML || '');
  return ctx;
}

/* ── fixture: Jo Dacara, rebuilt from the screenshot ──────────────────────────
   Aug: 1 dispatch 30,000, 20,000 handed over at dispatch.
   Sep: dispatches 26,300 + 30,000 (25,300 and 14,100 paid at dispatch); a 1,000 discount
        booked on the Sep 8 ticket; later payments 1,750 + 8,400 + 6,600.
   Oct: payment 4,500.
   paid_amount on each ticket = money at dispatch + every later allocation to it, which
   is the shape resellerPaymentHistory() reconstructs the dated payments from.
   TOTAL BILLED 86,300 · DISCOUNTS 1,000 · NET 85,300 · COLLECTED 80,650 → BAL 4,650 */
function seed() {
  return {
    farm_id: 'FARM-TEST',
    semen: [],
    semenResellers: [{ id: 'R-JO', name: 'Jo Dacara', contact: '0917 555 0101', address: 'Purok 3, Maramag, Bukidnon' }],
    semenResellerTx: [
      { id: 'RTX-AUG', type: 'pickup', reseller_id: 'R-JO', date: '2026-08-20', timestamp: '2026-08-20T02:00:00.000Z',
        total_amount: 30000, discount_amount: 0, paid_amount: 20000,
        lines: [{ boar: 'Blake', breed: 'Largewhite', semen_batch_no: 'B1L-20260818-001', qty: 75, rate: 400 }] },
      { id: 'RTX-SEP1', type: 'pickup', reseller_id: 'R-JO', date: '2026-09-08', timestamp: '2026-09-08T02:00:00.000Z',
        total_amount: 26300, discount_amount: 1000, paid_amount: 42050,
        lines: [{ boar: 'Jinwoo', breed: 'Duroc Pietrain', semen_batch_no: 'JDP-20260905-001', qty: 60, rate: 438.33 }] },
      { id: 'RTX-SEP2', type: 'pickup', reseller_id: 'R-JO', date: '2026-09-22', timestamp: '2026-09-22T02:00:00.000Z',
        total_amount: 30000, discount_amount: 0, paid_amount: 18600,
        lines: [{ boar: 'Denver', breed: 'Landrace', semen_batch_no: 'LRD-20260920-001', qty: 75, rate: 400 }] },
      { id: 'RTX-VOID', type: 'pickup', reseller_id: 'R-JO', date: '2026-09-25', timestamp: '2026-09-25T02:00:00.000Z',
        voided: true, void_reason: 'keyed twice', total_amount: 99999, discount_amount: 0, paid_amount: 99999,
        void_snapshot: { total_amount: 99999, paid_amount: 99999 }, lines: [{ boar: 'Ghost', qty: 250, rate: 400 }] }
    ],
    semenResellerAdjustments: [
      { id: 'ADJ-1', reseller_id: 'R-JO', type: 'discount_readjustment', date: '2026-09-08', timestamp: '2026-09-08T03:00:00.000Z', amount: 1000, reason: 'Loyalty discount.' }
    ],
    transactions: [
      { id: 'T1', reseller_id: 'R-JO', date: '2026-09-25', type: 'Income', amount: 1750, description: 'Reseller payment (Cash)', payment_allocations: [{ tx_id: 'RTX-SEP1', amount: 1750 }] },
      { id: 'T2', reseller_id: 'R-JO', date: '2026-09-26', type: 'Income', amount: 8400, description: 'Reseller payment (Cash)', payment_allocations: [{ tx_id: 'RTX-SEP1', amount: 8400 }] },
      { id: 'T3', reseller_id: 'R-JO', date: '2026-09-30', type: 'Income', amount: 6600, description: 'Reseller payment (Cash)', payment_allocations: [{ tx_id: 'RTX-SEP1', amount: 6600 }] },
      { id: 'T4', reseller_id: 'R-JO', date: '2026-10-03', type: 'Income', amount: 4500, description: 'Reseller payment (Cash)', payment_allocations: [{ tx_id: 'RTX-SEP2', amount: 4500 }] }
    ]
  };
}
const R = () => seed().semenResellers[0];

/* ══ 1. the broken button is gone ═════════════════════════════════════════════ */
{
  console.log('\n[1] The bare window.print() is gone from the statement');
  const footer = SOURCE.slice(SOURCE.indexOf('id="resellerStatementModal"'), SOURCE.indexOf('id="resellerStatementModal"') + 9000);
  ok('[1] the Print / PDF button no longer calls window.print()',
    !/onclick="window\.print\(\)">🖨 Print \/ PDF/.test(footer));
  ok('[1] it opens the Statement of Account instead', /openResellerSOA\('\$\{r\.id\}'\)">🖨 Print \/ PDF/.test(footer));
  ok('[1] the fix is explained where the next reader will look', /FIX 203/.test(footer));
}

/* ══ 2. the document ══════════════════════════════════════════════════════════ */
{
  console.log('\n[2] The document exists and names both parties');
  const db = seed(); const ctx = boot(db);
  ctx.openResellerSOA('R-JO');
  const h = ctx.html();
  ok('[2] a Statement of Account is rendered', /id="resellerSOA"/.test(h) && /<h1>Statement of Account<\/h1>/.test(h));
  ok('[2] it is a certificate, the app’s printable document shape', /<article class="certificate soa-cert">/.test(h));
  ok('[2] the farm is the issuer', /<h2>FARM-TEST<\/h2>|<h2>[^<]*<\/h2>/.test(h));
  ok('[2] the reseller is billed by name', /Jo Dacara/.test(h));
  ok('[2] with their address on file', /Purok 3, Maramag, Bukidnon/.test(h));
  ok('[2] and their contact', /0917 555 0101/.test(h));
  ok('[2] it carries a statement number', /Statement no\./.test(h) && /SOA-/.test(h));
  ok('[2] it states the period covered', /Period covered/.test(h));
  ok('[2] it states the currency', /Philippine Peso \(PHP\)/.test(h));
  ok('[2] it has a conforme line for the reseller', /Received \/ Conforme \(Jo Dacara\)/.test(h));
  ok('[2] the 58mm thermal slip is NOT what gets printed', !/sale-receipt/.test(h));
  ok('[2] the body is tagged so print isolation can key off it', ctx.__bodyClasses.has('soa-report-open'));
}

/* ══ 3. the period picker ═════════════════════════════════════════════════════ */
{
  console.log('\n[3] The period picker offers all time, each active month and a range');
  const db = seed(); const ctx = boot(db);
  ctx.openResellerSOA('R-JO');
  const h = ctx.html();
  ok('[3] All time is offered and selected by default', /<option value="all" selected>/.test(h));
  ok('[3] August 2026 is offered', /<option value="2026-08"[^>]*>August 2026</.test(h), h.match(/<option[^>]*>[^<]*<\/option>/g)?.join(' | '));
  ok('[3] September 2026 is offered', /<option value="2026-09"[^>]*>September 2026</.test(h));
  ok('[3] October 2026 is offered', /<option value="2026-10"[^>]*>October 2026</.test(h));
  ok('[3] a custom date range is offered', /<option value="custom"[^>]*>Custom date range/.test(h));
  ok('[3] months are newest first', h.indexOf('2026-10') < h.indexOf('2026-09') && h.indexOf('2026-09') < h.indexOf('2026-08'));
  ok('[3] a month with no activity is not offered', !/2026-07/.test(h) && !/2026-11/.test(h));
  ok('[3] changing the period re-renders', typeof ctx.resellerSOASetPeriod === 'function');

  ctx.resellerSOASetPeriod('2026-09');
  const sep = ctx.html();
  ok('[3] the chosen month becomes the selected option', /<option value="2026-09" selected>/.test(sep));
  ok('[3] and the header names it', /Period covered<\/span><b>September 2026<\/b>/.test(sep), (sep.match(/Period covered[^<]*<\/span><b>[^<]*/) || [])[0]);

  ctx.resellerSOASetPeriod('custom');
  const cus = ctx.html();
  ok('[3] custom mode exposes From and To date inputs',
    /resellerSOASetRange\('from'/.test(cus) && /resellerSOASetRange\('to'/.test(cus));
  ctx.resellerSOASetRange('from', '2026-09-01');
  ctx.resellerSOASetRange('to', '2026-09-30');
  ok('[3] a custom range is honoured', /Sep|2026-09-01/.test(ctx.html()));
}

/* ══ 4. all time reconciles with the rest of the app ══════════════════════════ */
{
  console.log('\n[4] "All time" matches the hub and the thermal slip exactly');
  const db = seed(); const ctx = boot(db);
  const d = ctx.resellerSOAData(db, R(), '', '');
  eq('[4] TOTAL BILLED is 86,300', d.grossCharges, 86300);
  eq('[4] DISCOUNTS is 1,000', d.discounts, 1000);
  eq('[4] NET AMOUNT DUE is 85,300', d.netCharges, 85300);
  eq('[4] TOTAL COLLECTED is 80,650', d.collected, 80650);
  eq('[4] OUTSTANDING BALANCE is 4,650 — the figure on the screenshot', d.closing, 4650);
  eq('[4] all time opens at zero', d.opening, 0);
  eq('[4] the bottles reconcile too', d.bottles, 210);

  /* the authority the rest of the app already uses */
  const totals = ctx.resellerAccountTotals ? ctx.resellerAccountTotals(db, R()) : null;
  if (totals) {
    eq('[4] billed agrees with resellerAccountTotals', d.grossCharges, totals.billed);
    eq('[4] discounts agree with resellerAccountTotals', d.discounts, totals.discounts);
    eq('[4] collected agrees with resellerAccountTotals', d.collected, totals.paid);
    eq('[4] the balance agrees with resellerAccountTotals', d.closing, totals.balance);
  }
}

/* ══ 5–6. months are real, and they chain ════════════════════════════════════ */
{
  console.log('\n[5] A month shows only that month, opening with the balance brought forward');
  const db = seed(); const ctx = boot(db);

  const aug = ctx.resellerSOAData(db, R(), '2026-08-01', '2026-08-31');
  eq('[5] August opens at zero (nothing before it)', aug.opening, 0);
  eq('[5] August charges 30,000', aug.grossCharges, 30000);
  eq('[5] August collects 20,000', aug.collected, 20000);
  eq('[5] August closes at 10,000', aug.closing, 10000);
  ok('[5] August lists exactly one dispatch', aug.charges.length === 1 && aug.charges[0].id === 'RTX-AUG');
  ok('[5] and no September payments leak in', aug.payments.every(p => p.date < '2026-09-01'));

  const sep = ctx.resellerSOAData(db, R(), '2026-09-01', '2026-09-30');
  eq('[6] September opens with August’s closing 10,000', sep.opening, aug.closing);
  eq('[5] September charges 56,300', sep.grossCharges, 56300);
  eq('[5] September discounts 1,000', sep.discounts, 1000);
  eq('[5] September collects 56,150', sep.collected, 56150);
  eq('[5] September closes at 9,150', sep.closing, 9150);
  ok('[5] September lists two dispatches', sep.charges.length === 2, JSON.stringify(sep.charges.map(c => c.id)));

  const oct = ctx.resellerSOAData(db, R(), '2026-10-01', '2026-10-31');
  eq('[6] October opens with September’s closing 9,150', oct.opening, sep.closing);
  eq('[5] October charges nothing', oct.grossCharges, 0);
  eq('[5] October collects 4,500', oct.collected, 4500);
  eq('[6] October closes at 4,650 — the live balance', oct.closing, 4650);

  const all = ctx.resellerSOAData(db, R(), '', '');
  eq('[6] the months sum to the all-time charges',
    aug.grossCharges + sep.grossCharges + oct.grossCharges, all.grossCharges);
  eq('[6] and to the all-time collections',
    aug.collected + sep.collected + oct.collected, all.collected);
  eq('[6] and the last month closes where all-time closes', oct.closing, all.closing);

  ctx.openResellerSOA('R-JO', '2026-10');
  const h = ctx.html();
  ok('[5] a month with no dispatch says so plainly', /No bottles were dispatched in this period/.test(h));
  ok('[5] and still shows the balance brought forward', /Previous balance brought forward/.test(h));
}

/* ══ 7. discounts counted once ════════════════════════════════════════════════ */
{
  console.log('\n[7] The discount is charged once and logged once');
  const db = seed(); const ctx = boot(db);
  const sep = ctx.resellerSOAData(db, R(), '2026-09-01', '2026-09-30');
  eq('[7] one 1,000 discount in the totals', sep.discounts, 1000);
  ok('[7] the dated log lists it', sep.adjustments.length === 1 && Math.abs(sep.adjustments[0].amount - 1000) < 0.005);
  eq('[7] net charges are gross minus exactly one discount', sep.netCharges, sep.grossCharges - 1000);
  ctx.openResellerSOA('R-JO', '2026-09');
  ok('[7] and the page says the log is not a second charge',
    /not charged twice/.test(ctx.html()), 'missing the double-count disclaimer');
}

/* ══ 8. voided transactions ═══════════════════════════════════════════════════ */
{
  console.log('\n[8] A voided dispatch is invisible and weightless');
  const db = seed(); const ctx = boot(db);
  const all = ctx.resellerSOAData(db, R(), '', '');
  ok('[8] the voided ticket is not listed', !all.charges.some(c => c.id === 'RTX-VOID'), JSON.stringify(all.charges.map(c => c.id)));
  eq('[8] its 99,999 never reaches the charges', all.grossCharges, 86300);
  eq('[8] nor its 99,999 payment', all.collected, 80650);
  ctx.openResellerSOA('R-JO');
  ok('[8] and it never appears on the paper', !/RTX-VOID|Ghost/.test(ctx.html()));
}

/* ══ 9. an overpaid account ═══════════════════════════════════════════════════ */
{
  console.log('\n[9] An advance payment carries forward as a credit');
  const db = seed();
  db.transactions.push({ id: 'T5', reseller_id: 'R-JO', date: '2026-10-05', type: 'Income', amount: 6000, description: 'Reseller payment (Gcash)', payment_allocations: [] });
  const ctx = boot(db);
  const oct = ctx.resellerSOAData(db, R(), '2026-10-01', '2026-10-31');
  eq('[9] October now collects 10,500', oct.collected, 10500);
  eq('[9] the account is 1,350 in credit', oct.credit, 1350);
  eq('[9] so nothing is due', oct.closing, 0);

  const nov = ctx.resellerSOAData(db, R(), '2026-11-01', '2026-11-30');
  eq('[9] November opens with that credit, not with zero', nov.opening, -1350);
  ok('[9] and names it as a credit, not a debt', nov.openingIsCredit === true);
  ctx.openResellerSOA('R-JO', '2026-11');
  ok('[9] the paper says so', /Advance \/ credit brought forward/.test(ctx.html()));
  ok('[9] and the total line reads as credit, not balance due', /CREDIT IN FAVOUR OF RESELLER/.test(ctx.html()));
}

/* ══ 10. printing ═════════════════════════════════════════════════════════════ */
{
  console.log('\n[10] Printing writes only the document into its own window');
  const db = seed(); const ctx = boot(db);
  ctx.openResellerSOA('R-JO', '2026-09');
  ctx.printResellerSOA();
  ok('[10] a print window is opened', ctx.__windows.length === 1);
  const w = ctx.__windows[0] || { written: '' };
  ok('[10] it carries an A4 page rule', /@page\{size:A4/.test(w.written));
  ok('[10] it contains the certificate', /<article class="certificate/.test(w.written));
  ok('[10] it contains the statement heading', /Statement of Account/.test(w.written));
  ok('[10] the app shell is NOT written into it', !/drill-bg|soa-toolbar|bottom-nav|sidebar/.test(w.written));
  ok('[10] on-screen-only controls are suppressed', /\.no-print\{display:none!important\}/.test(w.written));
  ok('[10] and it actually prints', w.printed === true);
  ok('[10] the window title names the reseller and the period', /Jo Dacara/.test(w.written) && /September 2026/.test(w.written));

  const ctx2 = boot(seed());
  ctx2.open = () => null;                      // pop-up blocked
  ctx2.openResellerSOA('R-JO');
  ctx2.printResellerSOA();
  ok('[10] a blocked pop-up is explained, not silent', /allow pop-ups/i.test(ctx2.__toasts.join(' ')), ctx2.__toasts.join(' | '));
}

/* ══ 11. Ctrl+P is covered — the actual blank-page cause ═════════════════════ */
{
  console.log('\n[11] The system print dialog no longer paginates the app shell');
  ok('[11] everything but the document leaves the print tree',
    /body\.soa-report-open:has\(>#resellerSOA\)>\*:not\(#resellerSOA\)\{display:none!important\}/.test(CSS));
  ok('[11] the fixed overlay is un-fixed for paper',
    /body\.soa-report-open #resellerSOA\{[^}]*position:static!important/.test(CSS));
  ok('[11] the document subtree stays visible',
    /body\.soa-report-open #resellerSOA,body\.soa-report-open #resellerSOA \*\{visibility:visible!important\}/.test(CSS));
  ok('[11] screen-only controls are hidden on paper',
    /body\.soa-report-open #resellerSOA \.no-print\{display:none!important\}/.test(CSS));
  ok('[11] cards and table rows are kept off page breaks',
    /body\.soa-report-open #resellerSOA \.cert-card\{break-inside:avoid\}/.test(CSS));
  ok('[11] the document has a phone layout as well as paper',
    /@media\(max-width:700px\)\{#resellerSOA\{/.test(CSS));
  ok('[11] closing the document clears the print flag', /classList\.remove\('soa-report-open'\)/.test(SOURCE));
}

console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
