/*
 * [FIX 200] Reseller return & replace — UNLIMITED cycles.
 *
 * Reported from the field (two phone screenshots, 2026-09-27): a reseller picked up
 * 8 × Blake, returned 3, and was handed 1 × Biscuit + 2 × Blake from newer batches.
 * A week later two of those REPLACEMENT bottles came back unsold — and the form had
 * nothing to offer. "Return qty" only ever counted the original 8, and the replacement
 * rows carried a single "✕ Cancel", which says the swap never happened (it did) and puts
 * the bottles back in the batch (they are in the reseller's hands). The flow was capped
 * at exactly one return→replace cycle per dispatch line.
 *
 * Now every replacement bottle is itself returnable and replaceable, and the bottle
 * handed over for it can come back too, with no limit on the depth.
 *
 * Run:  node qa/test-reseller-return-cycles.mjs
 *
 * Must stay true:
 *   1. a replacement bottle can be returned, and the return credits the invoice at that
 *      replacement's own price — not the dispatch price
 *   2. the bottle handed over for it is a new row that records WHAT it replaces (cycle N+1)
 *   3. the chain has no depth limit — cycle 2, 3, 4 … all bill correctly
 *   4. saving twice changes nothing at any depth (idempotent, the FIX 187 rule)
 *   5. a replacement return can never exceed what was handed over — refused, not clamped
 *   6. "Cancel" is refused on a row that already came back or that a later cycle hangs
 *      off: cancel means "it never happened", which would be a lie and would double-count
 *      the stock
 *   7. restock / discard and the undo work per replacement row, exactly as they do for
 *      the dispatch line
 *   8. the insights engine counts the later cycles without re-basing the figures every
 *      earlier build already reported
 *   9. legacy records (a replacement with no return state) bill exactly as before
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
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat, RegExp, Promise, Error, Set, Map,
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
  ctx.__sheets = [];
  const __body = fakeEl('body');
  __body.appendChild = (el) => {
    if (el) ctx.__sheets.push({ id: el.id || '', cls: String(el.className || ''), html: String(el.innerHTML || '') });
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
  ctx.lastToast = () => ctx.__toasts[ctx.__toasts.length - 1] || '';
  ctx.__lastSheet = () => (ctx.__sheets[ctx.__sheets.length - 1] || {}).html || '';
  return ctx;
}

/* ── fixture: the pick-up in the screenshots ──────────────────────────────────── */
const lot = (id, batch, boar, breed, price, bottles) => ({
  id, semen_batch_no: batch, boar_name: boar, breed, price_per_dose: price,
  available_bottles: bottles, bottles, status: 'active'
});
function seed() {
  return {
    farm_id: 'FARM-TEST',
    semen: [
      lot('SEM-BLAKE-0908', 'B1L-20260908-001', 'Blake', 'Largewhite', 400, 20),
      lot('SEM-BISCUIT-0912', 'BDB-20260912-001', 'Biscuit', 'Duroc', 400, 10),
      lot('SEM-BLAKE-0912', 'B1L-20260912-001', 'Blake', 'Largewhite', 400, 10),
      lot('SEM-ZORRO-0912', 'ZDP-20260912-001', 'Zorro', 'Duroc Pietrain', 250, 10)
    ],
    semenResellers: [{ id: 'R-MT', name: 'Mang Tonyo', contact: '0917' }],
    semenResellerTx: [{
      id: 'RTX-MTSL31NL', tx_no: 'RTX-MTSL31NL', type: 'pickup', reseller_id: 'R-MT', reseller_name: 'Mang Tonyo',
      timestamp: '2026-09-08T11:09:00.000Z', date: '2026-09-08', sync_status: 'verified',
      total_amount: 3200, paid_amount: 0, discount_amount: 0, balance: 3200, status: 'active',
      lines: [
        { semen_id: 'SEM-BLAKE-0908', boar: 'Blake', breed: 'Largewhite', semen_batch_no: 'B1L-20260908-001', qty: 8, rate: 400, amount: 3200, returned_qty: 0, replaced_qty: 0, is_returned_replaced: false }
      ]
    }],
    semenResellerAdjustments: [],
    transactions: []
  };
}
const TX = 'RTX-MTSL31NL';
const lotOf = (db, id) => db.semen.find(s => s.id === id);
const onHand = s => Math.max(0, +((s && (s.available_bottles !== undefined ? s.available_bottles : s.bottles)) || 0));
const save = ctx => ctx.saveResellerReturnReplace({ preventDefault() {} }, TX);
const repsOf = (ctx, tx, i = 0) => ctx.arsResellerReturnMath.replacementsFor(tx.lines[i]);
const uidOf = (ctx, tx, boar) => (repsOf(ctx, tx).find(r => r.boar === boar) || {}).uid;

/* cycle 1 — the state both screenshots show: 3 of 8 back, swapped for 1 Biscuit + 2 Blake */
function cycleOne(ctx) {
  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRetQty(0, 3);
  ctx.rrReason(0, 'Unused / Unsold');
  ctx.rrAction(0, 'discard');
  ctx.rrAddRow('0'); ctx.rrPick('0', 0, 'SEM-BISCUIT-0912'); ctx.rrQty('0', 0, 1);
  ctx.rrAddRow('0'); ctx.rrPick('0', 1, 'SEM-BLAKE-0912'); ctx.rrQty('0', 1, 2);
  save(ctx);
}

console.log('\n[FIX 200] reseller return & replace — unlimited cycles\n');

/* ── [1] the cap that was reported: a replacement bottle coming back ──────────── */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  cycleOne(ctx);
  const l = tx.lines[0];
  eq('[1] cycle 1 bills 5 kept + 1 + 2 replaced = 3,200', l.amount, 3200);
  eq('[1] cycle 1 invoice unchanged at 3,200', tx.total_amount, 3200);
  const blakeRep = uidOf(ctx, tx, 'Blake');
  ok('[1] every replacement row has a stable id to chain against', !!blakeRep && !!uidOf(ctx, tx, 'Biscuit'), JSON.stringify(repsOf(ctx, tx).map(r => r.uid)));
  ok('[1] cycle-1 rows say they replace the dispatch line itself', repsOf(ctx, tx).every(r => r.replaces === '' && r.cycle === 1));

  /* a week later: 2 of the replacement Blake come back, unsold, restocked */
  ctx.openResellerReturnReplaceModal(TX);
  const key = `0:${blakeRep}`;
  ctx.rrRepRetQty(key, 2);
  ctx.rrRepReason(key, 'Unused / Unsold');
  ctx.rrRepAction(key, 'restock');
  ctx.rrAddRow(key); ctx.rrPick(key, 0, 'SEM-ZORRO-0912'); ctx.rrQty(key, 0, 2);
  save(ctx);

  const reps = repsOf(ctx, tx);
  const blake = reps.find(r => r.uid === blakeRep);
  const zorro = reps.find(r => r.boar === 'Zorro');
  eq('[2] the replacement itself is recorded as returned', blake.returned_qty, 2);
  ok('[2] with its own reason and action', blake.return_reason === 'Unused / Unsold' && blake.return_action === 'restock', JSON.stringify(blake));
  ok('[2] the new bottles point at the replacement they replace', zorro && zorro.replaces === blakeRep, JSON.stringify(zorro));
  eq('[2] and are stamped cycle 2', zorro.cycle, 2);
  /* 5 kept × 400 + Biscuit 1 × 400 + Blake (2−2) × 400 + Zorro 2 × 250 */
  eq('[2] the returned replacement stops being billed at ITS price', tx.lines[0].amount, 2900);
  eq('[2] invoice follows the line', tx.total_amount, 2900);
  eq('[2] balance follows the invoice', tx.balance, 2900);
  eq('[2] restocked replacement bottles go back into their own batch', onHand(lotOf(db, 'SEM-BLAKE-0912')), 10);
  eq('[2] the cycle-2 batch is deducted', onHand(lotOf(db, 'SEM-ZORRO-0912')), 8);
  eq('[2] the dispatch batch is untouched by a replacement return', onHand(lotOf(db, 'SEM-BLAKE-0908')), 20);
  eq('[2] header counts the replacement returns', tx.replacement_returned_count, 2);
  eq('[2] header records how deep the chain went', tx.return_cycles, 2);
  ok('[2] the note names the cycle', /cycle 2/.test(tx.replacement_notes), tx.replacement_notes);

  /* saving the same form again must not move a peso or a bottle */
  const before = JSON.stringify({ t: tx.total_amount, s: db.semen.map(onHand) });
  ctx.openResellerReturnReplaceModal(TX);
  save(ctx);
  ok('[3] re-saving an untouched form changes nothing', JSON.stringify({ t: tx.total_amount, s: db.semen.map(onHand) }) === before, `${before} → ${JSON.stringify({ t: tx.total_amount, s: db.semen.map(onHand) })}`);
  ok('[3] and says so instead of pretending', /Nothing to save/.test(ctx.lastToast()), ctx.lastToast());
}

/* ── [4] depth: cycle 3, then cycle 4 — no cap anywhere ───────────────────────── */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  cycleOne(ctx);
  const blakeRep = uidOf(ctx, tx, 'Blake');

  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRepRetQty(`0:${blakeRep}`, 2); ctx.rrRepAction(`0:${blakeRep}`, 'discard');
  ctx.rrAddRow(`0:${blakeRep}`); ctx.rrPick(`0:${blakeRep}`, 0, 'SEM-ZORRO-0912'); ctx.rrQty(`0:${blakeRep}`, 0, 2);
  save(ctx);
  const zorroUid = uidOf(ctx, tx, 'Zorro');

  /* cycle 3: the Zorro bottles come back too and are swapped for Biscuit */
  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRepRetQty(`0:${zorroUid}`, 2); ctx.rrRepAction(`0:${zorroUid}`, 'discard');
  ctx.rrAddRow(`0:${zorroUid}`); ctx.rrPick(`0:${zorroUid}`, 0, 'SEM-BISCUIT-0912'); ctx.rrQty(`0:${zorroUid}`, 0, 2);
  save(ctx);
  const cyc3 = repsOf(ctx, tx).find(r => r.cycle === 3);
  ok('[4] cycle 3 exists and points at the cycle-2 bottle', !!cyc3 && cyc3.replaces === zorroUid, JSON.stringify(repsOf(ctx, tx).map(r => `${r.boar}/${r.cycle}/${r.replaces}`)));
  /* 5×400 kept + Biscuit 1×400 + Blake 0 + Zorro 0 + Biscuit 2×400 */
  eq('[4] cycle 3 bills 5 kept + 1 + 2 = 3,200', tx.lines[0].amount, 3200);

  /* cycle 4: one of THOSE comes back, credited only */
  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRepRetQty(`0:${cyc3.uid}`, 1); ctx.rrRepAction(`0:${cyc3.uid}`, 'discard');
  save(ctx);
  eq('[4] a 4th-cycle return is a plain credit', tx.lines[0].amount, 2800);
  eq('[4] the invoice tracks it', tx.total_amount, 2800);
  const chain = repsOf(ctx, tx);
  eq('[4] four rows on the line, one per hand-over', chain.length, 4);
  ok('[4] no depth limit was hit', chain.some(r => r.cycle === 3) && chain.filter(r => r.returned_qty > 0).length === 3, JSON.stringify(chain.map(r => `${r.boar}/${r.cycle}/ret${r.returned_qty}`)));
  eq('[4] derived total agrees with the stored total', ctx.arsResellerReturnMath.derive(tx).drift, 0);
}

/* ── [5] a replacement return can never exceed what was handed over ───────────── */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  cycleOne(ctx);
  const blakeRep = uidOf(ctx, tx, 'Blake');
  const totalBefore = tx.total_amount;

  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRepRetQty(`0:${blakeRep}`, 5);              /* only 2 were handed over */
  save(ctx);
  eq('[5] an over-sized replacement return writes nothing', tx.total_amount, totalBefore);
  ok('[5] and says exactly what is wrong', /only 2 of the 2 handed over/.test(ctx.lastToast()), ctx.lastToast());
  eq('[5] the replacement is untouched', repsOf(ctx, tx).find(r => r.uid === blakeRep).returned_qty, 0);

  ctx.rrRepRetQty(`0:${blakeRep}`, 2);              /* fix it in the still-open form */
  save(ctx);
  eq('[5] the corrected number saves', repsOf(ctx, tx).find(r => r.uid === blakeRep).returned_qty, 2);
  eq('[5] and credits 2 × 400', tx.total_amount, totalBefore - 800);
}

/* ── [6] "Cancel" cannot un-happen a swap that came back or was replaced again ── */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  cycleOne(ctx);
  const blakeRep = uidOf(ctx, tx, 'Blake');
  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRepRetQty(`0:${blakeRep}`, 2); ctx.rrRepAction(`0:${blakeRep}`, 'discard');
  ctx.rrAddRow(`0:${blakeRep}`); ctx.rrPick(`0:${blakeRep}`, 0, 'SEM-ZORRO-0912'); ctx.rrQty(`0:${blakeRep}`, 0, 2);
  save(ctx);

  const idxOf = uid => repsOf(ctx, tx).findIndex(r => r.uid === uid);
  const totalBefore = tx.total_amount, stockBefore = db.semen.map(onHand);
  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRemoveExisting(0, idxOf(blakeRep));
  ok('[6] cancelling a replacement that came back is refused on the spot', /recorded as returned/.test(ctx.lastToast()), ctx.lastToast());
  save(ctx);
  eq('[6] nothing was cancelled', tx.total_amount, totalBefore);
  ok('[6] and no stock moved', JSON.stringify(db.semen.map(onHand)) === JSON.stringify(stockBefore));

  /* the cycle-2 row has no children and has not come back, so it CAN be cancelled */
  const zorroUid = uidOf(ctx, tx, 'Zorro');
  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRemoveExisting(0, idxOf(zorroUid));
  save(ctx);
  ok('[6] a clean later-cycle row can still be cancelled', !repsOf(ctx, tx).some(r => r.boar === 'Zorro'), JSON.stringify(repsOf(ctx, tx).map(r => r.boar)));
  eq('[6] its charge comes off', tx.total_amount, totalBefore - 500);
  eq('[6] and its bottles go back to their batch', onHand(lotOf(db, 'SEM-ZORRO-0912')), 10);
}

/* ── [7] undo a mis-keyed replacement return ──────────────────────────────────── */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  cycleOne(ctx);
  const blakeRep = uidOf(ctx, tx, 'Blake');
  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRepRetQty(`0:${blakeRep}`, 2); ctx.rrRepAction(`0:${blakeRep}`, 'restock');
  save(ctx);
  eq('[7] 2 restocked into the replacement batch', onHand(lotOf(db, 'SEM-BLAKE-0912')), 10);
  eq('[7] credited off the invoice', tx.total_amount, 2400);

  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRepUndo(`0:${blakeRep}`);
  save(ctx);
  eq('[7] the undo puts the replacement back on the invoice', tx.total_amount, 3200);
  eq('[7] and takes the restocked bottles out of the batch again', onHand(lotOf(db, 'SEM-BLAKE-0912')), 8);
  const back = repsOf(ctx, tx).find(r => r.uid === blakeRep);
  ok('[7] the row is clean again', back.returned_qty === 0 && back.return_reason === '' && back.returned_restocked === 0, JSON.stringify(back));
  ok('[7] the toast counts the undo', /replacement return\(s\) undone/.test(ctx.lastToast()), ctx.lastToast());
}

/* ── [8] the insights engine sees the later cycles ────────────────────────────── */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  cycleOne(ctx);
  const I = ctx.arsResellerInsights;
  const before = I.statsFromTxs([tx]);
  eq('[8] cycle 1: picked 8', before.picked, 8);
  eq('[8] cycle 1: returned 3', before.returned, 3);
  eq('[8] cycle 1: replaced 3', before.replaced, 3);
  eq('[8] cycle 1: net = 8 − 3 + 3', before.net, 8);
  eq('[8] cycle 1: no replacement came back yet', before.repReturned, 0);

  const blakeRep = uidOf(ctx, tx, 'Blake');
  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRepRetQty(`0:${blakeRep}`, 2); ctx.rrRepReason(`0:${blakeRep}`, 'Damaged'); ctx.rrRepAction(`0:${blakeRep}`, 'discard');
  ctx.rrAddRow(`0:${blakeRep}`); ctx.rrPick(`0:${blakeRep}`, 0, 'SEM-ZORRO-0912'); ctx.rrQty(`0:${blakeRep}`, 0, 2);
  save(ctx);
  const after = I.statsFromTxs([tx]);
  eq('[8] the dispatch return rate is NOT re-based by a later cycle', after.returned, 3);
  eq('[8] replacement bottles that came back are counted apart', after.repReturned, 2);
  eq('[8] bottles handed over in all = 8 + 5', after.handed, 13);
  eq('[8] bottles that came back in all = 3 + 2', after.backTotal, 5);
  eq('[8] net sold = 8 − 3 + 5 − 2', after.net, 8);
  ok('[8] the later-cycle reason is counted', after.reasons.Damaged === 2, JSON.stringify(after.reasons));
  eq('[8] replaced value is what the replacements still bill', after.replacedValue, 400 + 0 + 500);
  const board = I.leaderboard(db, '2026-09', 'bottles');
  ok('[8] the leaderboard says it in words', I.whyLines(board, board.rows[0]).some(x => /2 of the 5 replacement bottle\(s\) came back too/.test(x.t)), JSON.stringify(I.whyLines(board, board.rows[0]).map(x => x.t)));
}

/* ── [9] legacy records still bill exactly as they did ────────────────────────── */
{
  const db = seed();
  /* a record written before this build: one replacement, no return state, no uid */
  db.semenResellerTx[0].lines[0] = {
    semen_id: 'SEM-BLAKE-0908', boar: 'Blake', breed: 'Largewhite', semen_batch_no: 'B1L-20260908-001',
    qty: 8, rate: 400, amount: 2400, returned_qty: 3, return_reason: 'Unused / Unsold', return_action: 'discard',
    replaced_qty: 1, replacement_rate: 400, replacement_boar: 'Biscuit', replacement_batch_no: 'BDB-20260912-001',
    is_returned_replaced: true
  };
  db.semenResellerTx[0].total_amount = 2400;
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  eq('[9] a legacy line still bills 5 × 400 + 1 × 400', ctx.arsResellerReturnMath.amountForLine(tx.lines[0]), 2400);
  const legacy = ctx.arsResellerReturnMath.replacementsFor(tx.lines[0])[0];
  ok('[9] it is read as a returnable replacement row', legacy.qty === 1 && legacy.returned_qty === 0 && legacy.cycle === 1, JSON.stringify(legacy));
  ok('[9] and gets an id so it can be chained from', !!legacy.uid, JSON.stringify(legacy));

  /* and the reseller brings that legacy replacement back */
  ctx.openResellerReturnReplaceModal(TX);
  ctx.rrRepRetQty(`0:${legacy.uid}`, 1); ctx.rrRepAction(`0:${legacy.uid}`, 'discard');
  ctx.rrAddRow(`0:${legacy.uid}`); ctx.rrPick(`0:${legacy.uid}`, 0, 'SEM-ZORRO-0912'); ctx.rrQty(`0:${legacy.uid}`, 0, 1);
  save(ctx);
  eq('[9] a legacy replacement can be returned and replaced', tx.lines[0].amount, 2000 + 0 + 250);
  ok('[9] the id was persisted, not re-derived', (tx.lines[0].replacements || []).every(r => !!r.uid), JSON.stringify(tx.lines[0].replacements));
  ok('[9] the cycle-2 row points at the upgraded legacy row', (tx.lines[0].replacements || []).some(r => r.cycle === 2 && r.replaces === legacy.uid), JSON.stringify(tx.lines[0].replacements));
}

/* ── [10] the form actually offers it (the screenshot's dead end) ─────────────── */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  cycleOne(ctx);
  ctx.openResellerReturnReplaceModal(TX);
  const html = ctx.__lastSheet();
  const blakeRep = uidOf(ctx, tx, 'Blake');
  ok('[10] each stored replacement is its own card', (html.match(/class="rr-rep adj-card"/g) || []).length === 2, String((html.match(/rr-rep adj-card/g) || []).length));
  ok('[10] with a Return / replace control of its own', html.includes(`window.rrRepToggle('0:${blakeRep}')`), 'no rrRepToggle for the Blake replacement');
  ok('[10] the old dead end — a lone Cancel — is gone', /rrRepToggle/.test(html) && /↩︎ Return \/ replace/.test(html));
  ctx.rrRepToggle(`0:${blakeRep}`);
  const open = ctx.__lastSheet();
  ok('[10] opening it offers qty, reason, action and a new batch', open.includes(`window.rrRepRetQty('0:${blakeRep}'`) && open.includes(`window.rrRepReason('0:${blakeRep}'`) && open.includes(`window.rrRepAction('0:${blakeRep}'`) && open.includes(`window.rrAddRow('0:${blakeRep}')`));
  ok('[10] and names the cycle it is about to start', /Replace these again \(cycle 2\)/.test(open), 'cycle label missing');
  ok('[10] it states what is still returnable', /2 still returnable/.test(open), 'returnable hint missing');
  ok('[10] the sheet is still the app\'s real modal layer', (ctx.__sheets[ctx.__sheets.length - 1] || {}).cls !== 'modal-overlay');
}

console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
