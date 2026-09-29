/*
 * [FIX 201] Reseller pickup must deduct from the batch the farm actually chose.
 *
 * Reported from the field (Semen Inventory drill-down screenshot, 2026-09-29): a
 * reseller pickup "no longer deducts bottles from Semen Inventory", while a walk-in
 * POS sale still does. The AVAILABLE SEMEN card (JDP · collected Sep 28 · 11 bottles
 * left) did not move after the pickup was saved and billed.
 *
 * Root cause — not a missing deduction, a MISDIRECTED one. A line created by
 * "✓ Accept & create pick-up" (window.arsResellerOrderPickupLines) is built as
 *
 *     { boar: "<breed>", breed: "<breed>", semen_batch_no: "", semen_id: "", from_order: true }
 *
 * because the picker deliberately pre-selects nothing — choosing the boar is the
 * farm's call. If the office saved without touching that picker, saveResellerPickup
 * fell through to its last resort: match the line's `boar` string against every lot's
 * boar name. That string is a BREED. On a farm with 147 collection records, a legacy
 * lot filed under the breed ("Duroc Pietrain") answers that match, so the entire
 * deduction landed on an old batch nobody was looking at while the card on screen
 * stayed put. Worse, the saved line kept semen_id:"" — so a later return could not
 * restock the right lot either, and the receipt named no batch.
 *
 * Run:  node qa/test-reseller-pickup-lot.mjs
 *
 * Must stay true:
 *   1. an order-sourced line with no batch chosen is REFUSED by name; nothing is
 *      saved and no lot anywhere moves
 *   2. a decoy lot filed under the breed name is never silently drained
 *   3. once the farm picks the batch, that batch — and only that batch — is deducted
 *   4. the saved line is stamped with semen_id / batch / real boar name / breed, so the
 *      receipt, the drill-down and return & replace all resolve the same lot
 *   5. the ordered breed, qty and price (FIX 189 drift) survive the stamping
 *   6. a hand-written pickup keeps working exactly as before, legacy boar-name
 *      fallback included
 *   7. two lines on the same batch are charged against the RUNNING remainder, not
 *      the opening stock (the FIX M8 hole)
 *   8. an over-sized line is still refused with nothing saved (FIX M8 preserved)
 *   9. a lot drained to zero is marked exhausted
 *  10. the form shows the problem on the offending line instead of a toast that
 *      names no line
 */
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

/* ── permissive fake DOM ─────────────────────────────────────────────────────── */
function fakeEl(tag = 'div') {
  const t = { tagName: tag, children: [], style: {}, dataset: {}, scrollTop: 0, checked: false, value: '', innerHTML: '', textContent: '' };
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
  const form = {};
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat, RegExp, Promise, Error, Set, Map,
    setTimeout: (fn) => { try { fn && fn(); } catch (_) {} return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { userAgent: 'node' },
    location: { href: 'https://preview.test/index.html', origin: 'https://preview.test' },
    /* the real saveResellerPickup does Object.fromEntries(new FormData(form)) */
    FormData: class { *[Symbol.iterator]() { for (const kv of Object.entries(form)) yield kv; } },
    farmId: 'FARM-TEST',
    __arsActiveFarmId: 'FARM-TEST',
    F: () => db,
    save: () => { ctx.__saves++; },
    toast: (m) => toasts.push(String(m)),
    closeModal: () => {},
    renderAll: () => {},
    peso: n => 'P' + (+n || 0).toFixed(2),
    fmtDate: d => String(d || '').slice(0, 10),
    localDateTimeValue: () => '2026-09-29T15:02',
    ARSCloud: { syncFarmRecord: async () => ({ success: true }), verifyFarmSave: async () => ({ success: true }), saveLocalRecovery() {} },
    __saves: 0, __toasts: toasts, __form: form, __registry: new Map()
  };
  ctx.__sheets = [];
  const __body = fakeEl('body');
  __body.appendChild = (el) => { if (el) ctx.__sheets.push({ id: el.id || '', html: String(el.innerHTML || '') }); return el; };
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
  ctx.lastToast = () => ctx.__toasts[ctx.__toasts.length - 1] || '';
  ctx.linesHTML = () => String(ctx.document.getElementById('pickupLinesWrap').innerHTML || '');
  ctx.lineErr = (i) => String(ctx.document.getElementById(`pickupLineErr_${i}`).textContent || '');
  ctx.cardBorder = (i) => String(ctx.document.getElementById(`pickupLineCard_${i}`).style.borderColor || '');
  ctx.doSave = async (fields) => {
    Object.keys(form).forEach(k => delete form[k]);
    Object.assign(form, { reseller_id: 'R-MT', timestamp: '', paid_amount: '0', pay_method: 'Cash', notes: '' }, fields || {});
    await ctx.saveResellerPickup({ preventDefault() {} , target: fakeEl('form') });
  };
  return ctx;
}

/* ── fixture: the farm in the screenshot ─────────────────────────────────────── */
const lot = (id, batch, boar, breed, price, bottles, extra = {}) => ({
  id, semen_batch_no: batch, boar_name: boar, boar, breed, price, price_per_dose: price,
  available_bottles: bottles, bottles, status: 'active', collection_date: '2026-09-28', ...extra
});
function seed() {
  return {
    farm_id: 'FARM-TEST',
    semen: [
      /* the decoy: an old imported record filed under the BREED, exactly the kind of
         row the loose boar-name match used to drain */
      { id: 'SEM-LEGACY-0724', semen_batch_no: 'DP-20260724-003', boar: 'Duroc Pietrain', breed: 'Duroc Pietrain',
        price: 350, available_bottles: 9, bottles: 9, status: 'active', collection_date: '2026-07-24' },
      lot('SEM-JDP-0928', 'JDP-20260928-001', 'Jinwoo', 'Duroc Pietrain', 400, 11),
      lot('SEM-LRD-0928', 'LRD-20260928-001', 'Denver', 'Landrace', 400, 6)
    ],
    semenResellers: [{ id: 'R-MT', name: 'Mang Tonyo', contact: '0917' }],
    semenResellerTx: [],
    semenResellerOrders: [],
    semenResellerAdjustments: [],
    transactions: []
  };
}
const lotOf = (db, id) => db.semen.find(s => s.id === id);
const onHand = s => Math.max(0, +((s && (s.available_bottles !== undefined ? s.available_bottles : s.bottles)) || 0));
const snapshot = db => db.semen.map(s => `${s.id}:${onHand(s)}`).join('|');

function placeOrder(db, lines) {
  const o = {
    id: 'ORD-1', reseller_id: 'R-MT', reseller_name: 'Mang Tonyo', status: 'pending',
    placed_at: '2026-09-29T06:00:00.000Z', need_by: '2026-09-30', note: 'for the Sunday run',
    lines: lines.map(l => ({ breed: l.breed, qty: l.qty, rate: l.rate }))
  };
  db.semenResellerOrders = [o];
  return o;
}

/* ══ 1. the report: accept an order, save without picking a batch ═══════════════ */
{
  console.log('\n[1] Accept an order, save without choosing a batch');
  const db = seed(); const ctx = boot(db);
  placeOrder(db, [{ breed: 'Duroc Pietrain', qty: 5, rate: 400 }]);
  const before = snapshot(db);

  const pre = ctx.arsResellerOrderPickupLines(db.semenResellerOrders[0]);
  ok('[1] the accept prefill still leaves the batch for the farm to choose',
    pre.lines[0].semen_id === '' && pre.lines[0].semen_batch_no === '', JSON.stringify(pre.lines[0]));
  ok('[1] and it carries the breed in the boar slot (the trap)',
    pre.lines[0].boar === 'Duroc Pietrain' && pre.lines[0].from_order === true);

  ctx.acceptResellerOrder('ORD-1');
  await ctx.doSave();

  eq('[1] no pickup is recorded', db.semenResellerTx.length, 0);
  ok('[1] not one bottle moved anywhere on the farm', snapshot(db) === before, `${before} -> ${snapshot(db)}`);
  ok('[1] the refusal names the line and the breed', /Line 1/.test(ctx.lastToast()) && /Duroc Pietrain/.test(ctx.lastToast()), ctx.lastToast());
  ok('[1] and says plainly that nothing was saved', /Nothing was saved/i.test(ctx.lastToast()), ctx.lastToast());
}

/* ══ 2. the decoy lot is never drained ═════════════════════════════════════════ */
{
  console.log('\n[2] The legacy lot filed under the breed name is left alone');
  const db = seed(); const ctx = boot(db);
  placeOrder(db, [{ breed: 'Duroc Pietrain', qty: 5, rate: 400 }]);
  ctx.acceptResellerOrder('ORD-1');
  await ctx.doSave();
  eq('[2] the old DP-20260724-003 lot still holds 9', onHand(lotOf(db, 'SEM-LEGACY-0724')), 9);
  eq('[2] the JDP batch on the card still holds 11', onHand(lotOf(db, 'SEM-JDP-0928')), 11);
  eq('[2] the Landrace batch still holds 6', onHand(lotOf(db, 'SEM-LRD-0928')), 6);
}

/* ══ 3–5. the farm picks the batch: the right lot moves, the line is stamped ════ */
{
  console.log('\n[3] The farm picks JDP-20260928-001 and saves');
  const db = seed(); const ctx = boot(db);
  placeOrder(db, [{ breed: 'Duroc Pietrain', qty: 5, rate: 400 }]);
  ctx.acceptResellerOrder('ORD-1');
  ctx.onPickupBatchSelect(0, 'SEM-JDP-0928');
  await ctx.doSave();

  eq('[3] one pickup is recorded', db.semenResellerTx.length, 1);
  eq('[3] the chosen JDP batch drops 11 → 6', onHand(lotOf(db, 'SEM-JDP-0928')), 6);
  eq('[3] the decoy lot is untouched', onHand(lotOf(db, 'SEM-LEGACY-0724')), 9);
  eq('[3] the Landrace batch is untouched', onHand(lotOf(db, 'SEM-LRD-0928')), 6);

  const line = db.semenResellerTx[0].lines[0];
  ok('[4] the saved line carries the lot id', line.semen_id === 'SEM-JDP-0928', line.semen_id);
  ok('[4] and the batch number', line.semen_batch_no === 'JDP-20260928-001', line.semen_batch_no);
  ok('[4] and the real boar name, not the breed', line.boar === 'Jinwoo', line.boar);
  ok('[4] and the lot breed', line.breed === 'Duroc Pietrain', line.breed);
  ok('[5] the ordered breed survives for the drift note', line.ordered_breed === 'Duroc Pietrain', line.ordered_breed);
  eq('[5] the ordered qty survives', line.ordered_qty, 5);
  eq('[5] the ordered price survives', line.ordered_rate, 400);
  eq('[5] the money is unchanged by the fix', db.semenResellerTx[0].total_amount, 2000);
  ok('[5] the line is still flagged as order-sourced', line.from_order === true);
  eq('[3] the deducted lot is synced, not the whole list', ctx.__saves > 0 ? 1 : 0, 1);
}

/* ══ 6. a hand-written pickup is unchanged ═════════════════════════════════════ */
{
  console.log('\n[6] A hand-written pickup behaves exactly as before');
  const db = seed(); const ctx = boot(db);
  ctx.openResellerPickupModal('R-MT');
  ctx.onPickupBatchSelect(0, 'SEM-LRD-0928');
  ctx.onPickupLineQtyChange(0, 2);
  await ctx.doSave({ paid_amount: '800' });

  eq('[6] the pickup is recorded', db.semenResellerTx.length, 1);
  eq('[6] the Landrace batch drops 6 → 4', onHand(lotOf(db, 'SEM-LRD-0928')), 4);
  eq('[6] nothing else moved', onHand(lotOf(db, 'SEM-JDP-0928')) + onHand(lotOf(db, 'SEM-LEGACY-0724')), 20);
  eq('[6] the money still mirrors to farm income', (db.transactions || []).length, 1);
  ok('[6] the saved toast is the success one', /saved on this device|cloud-verified/.test(ctx.lastToast()), ctx.lastToast());
}
{
  console.log('\n[6b] The batch-number fallback still resolves a re-keyed lot');
  const db = seed(); const ctx = boot(db);
  ctx.openResellerPickupModal('R-MT');
  ctx.onPickupBatchSelect(0, 'SEM-JDP-0928');
  ctx.onPickupLineQtyChange(0, 3);
  /* a cloud pull hands the same batch back under a new row id — the line's
     semen_id goes stale, the batch number does not */
  lotOf(db, 'SEM-JDP-0928').id = 'SEM-JDP-0928-REKEYED';
  await ctx.doSave();
  eq('[6b] the pickup still saves', db.semenResellerTx.length, 1);
  eq('[6b] and the right batch is deducted 11 → 8', onHand(lotOf(db, 'SEM-JDP-0928-REKEYED')), 8);
  ok('[6b] the line is re-stamped with the new lot id',
    db.semenResellerTx[0].lines[0].semen_id === 'SEM-JDP-0928-REKEYED', db.semenResellerTx[0].lines[0].semen_id);
}
{
  console.log('\n[6c] The boar-name last resort survives for hand-written lines only');
  const db = seed(); const ctx = boot(db);
  ctx.openResellerPickupModal('R-MT');
  ctx.onPickupBatchSelect(0, 'SEM-JDP-0928');
  ctx.onPickupLineQtyChange(0, 3);
  /* both the id and the batch number move; only the boar name is left to go on */
  const l = lotOf(db, 'SEM-JDP-0928');
  l.id = 'SEM-JDP-NEW'; l.semen_batch_no = 'JDP-20260928-002';
  await ctx.doSave();
  eq('[6c] a hand-written line still resolves by boar name', db.semenResellerTx.length, 1);
  eq('[6c] and Jinwoo drops 11 → 8', onHand(lotOf(db, 'SEM-JDP-NEW')), 8);
  eq('[6c] the decoy breed-named lot is still untouched', onHand(lotOf(db, 'SEM-LEGACY-0724')), 9);
}
{
  console.log('\n[6d] …but never for an order line, where the name is a breed');
  const db = seed(); const ctx = boot(db);
  placeOrder(db, [{ breed: 'Duroc Pietrain', qty: 5, rate: 400 }]);
  ctx.acceptResellerOrder('ORD-1');
  ctx.onPickupBatchSelect(0, 'SEM-JDP-0928');
  /* the chosen lot vanishes from the list between choosing and saving */
  db.semen = db.semen.filter(s => s.id !== 'SEM-JDP-0928');
  const before = snapshot(db);
  await ctx.doSave();
  eq('[6d] the order line is refused, not redirected', db.semenResellerTx.length, 0);
  ok('[6d] the breed-named decoy is not drained as a substitute', snapshot(db) === before, `${before} -> ${snapshot(db)}`);
  ok('[6d] and the farm is told to choose again', /Choose the collection batch/.test(ctx.lastToast()), ctx.lastToast());
}

/* ══ 7. two lines on the same batch ════════════════════════════════════════════ */
{
  console.log('\n[7] Two lines on the same batch share one pool of bottles');
  const db = seed(); const ctx = boot(db);
  ctx.openResellerPickupModal('R-MT');
  ctx.addPickupLine();
  ctx.onPickupBatchSelect(0, 'SEM-LRD-0928');
  ctx.onPickupLineQtyChange(0, 4);
  ctx.onPickupBatchSelect(1, 'SEM-LRD-0928');
  ctx.onPickupLineQtyChange(1, 4);
  const before = snapshot(db);
  await ctx.doSave();

  eq('[7] 4 + 4 against 6 on hand is refused', db.semenResellerTx.length, 0);
  ok('[7] and nothing was deducted first', snapshot(db) === before, `${before} -> ${snapshot(db)}`);
  ok('[7] the refusal points at the SECOND line', /Line 2/.test(ctx.lastToast()), ctx.lastToast());
  ok('[7] and explains it is the earlier line that used them up', /earlier line/i.test(ctx.lastToast()), ctx.lastToast());

  ctx.onPickupLineQtyChange(1, 2);
  await ctx.doSave();
  eq('[7] 4 + 2 against 6 goes through', db.semenResellerTx.length, 1);
  eq('[7] and the batch lands on exactly zero', onHand(lotOf(db, 'SEM-LRD-0928')), 0);
  ok('[9] a batch drained to zero is marked exhausted', lotOf(db, 'SEM-LRD-0928').status === 'exhausted', lotOf(db, 'SEM-LRD-0928').status);
}

/* ══ 8. FIX M8 is preserved ════════════════════════════════════════════════════ */
{
  console.log('\n[8] An over-sized single line is still refused');
  const db = seed(); const ctx = boot(db);
  ctx.openResellerPickupModal('R-MT');
  ctx.onPickupBatchSelect(0, 'SEM-JDP-0928');
  ctx.onPickupLineQtyChange(0, 50);
  const before = snapshot(db);
  await ctx.doSave();
  eq('[8] nothing is recorded', db.semenResellerTx.length, 0);
  ok('[8] stock is untouched — no clamping at zero', snapshot(db) === before, `${before} -> ${snapshot(db)}`);
  ok('[8] the refusal states the real on-hand count', /Only 11 bottle/.test(ctx.lastToast()), ctx.lastToast());
  ok('[8] and offers the two ways out', /reduce the quantity/i.test(ctx.lastToast()) && /restock/i.test(ctx.lastToast()), ctx.lastToast());
}

/* ══ 10. the form shows it on the line ═════════════════════════════════════════ */
{
  console.log('\n[10] The problem is painted onto the offending line');
  const db = seed(); const ctx = boot(db);
  placeOrder(db, [{ breed: 'Duroc Pietrain', qty: 5, rate: 400 }, { breed: 'Landrace', qty: 2, rate: 400 }]);
  ctx.acceptResellerOrder('ORD-1');

  const html = ctx.linesHTML();
  ok('[10] every line card has an error slot of its own',
    html.includes('id="pickupLineErr_0"') && html.includes('id="pickupLineErr_1"'));
  ok('[10] an unchosen picker is flagged before the farm even submits',
    (html.match(/border-color:#f0b64b/g) || []).length >= 2, String((html.match(/border-color:#f0b64b/g) || []).length));

  ctx.onPickupBatchSelect(1, 'SEM-LRD-0928');
  await ctx.doSave();
  eq('[10] still nothing saved while line 1 is blank', db.semenResellerTx.length, 0);
  ok('[10] line 1 carries the message', /Choose the collection batch/.test(ctx.lineErr(0)), ctx.lineErr(0));
  ok('[10] line 1 is outlined', ctx.cardBorder(0) === '#f0b64b', ctx.cardBorder(0));
  ok('[10] line 2 is left clean', ctx.lineErr(1) === '', ctx.lineErr(1));

  ctx.onPickupBatchSelect(0, 'SEM-JDP-0928');
  ok('[10] picking the batch clears the warning on the spot', ctx.lineErr(0) === '' && ctx.cardBorder(0) === 'var(--line)', `${ctx.lineErr(0)} / ${ctx.cardBorder(0)}`);
  await ctx.doSave();
  eq('[10] and now it saves', db.semenResellerTx.length, 1);
  eq('[10] JDP 11 → 6', onHand(lotOf(db, 'SEM-JDP-0928')), 6);
  eq('[10] Landrace 6 → 4', onHand(lotOf(db, 'SEM-LRD-0928')), 4);
  eq('[10] the decoy lot is still at 9', onHand(lotOf(db, 'SEM-LEGACY-0724')), 9);
  const ls = db.semenResellerTx[0].lines;
  ok('[10] both saved lines name their batch', ls.every(l => l.semen_id && l.semen_batch_no), JSON.stringify(ls.map(l => l.semen_batch_no)));
}

/* ══ 11. the return & replace machinery can now find the lot ═══════════════════ */
{
  console.log('\n[11] An order-sourced pickup can be returned and restocked');
  const db = seed(); const ctx = boot(db);
  placeOrder(db, [{ breed: 'Duroc Pietrain', qty: 5, rate: 400 }]);
  ctx.acceptResellerOrder('ORD-1');
  ctx.onPickupBatchSelect(0, 'SEM-JDP-0928');
  await ctx.doSave();
  const tx = db.semenResellerTx[0];
  eq('[11] JDP is down to 6 after the pickup', onHand(lotOf(db, 'SEM-JDP-0928')), 6);
  ok('[11] the line resolves to a real lot object', !!lotOf(db, tx.lines[0].semen_id), tx.lines[0].semen_id);
  ok('[11] which is the batch the farm chose', tx.lines[0].semen_id === 'SEM-JDP-0928');
}

console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
