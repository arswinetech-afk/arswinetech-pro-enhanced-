/*
 * [FIX 187] Reseller return & replace — money model, verified against the real code.
 *
 * Boots the REAL semen-sales.js in a VM (no browser, no build step) and drives the flow
 * through the same window.* handlers the modal's onclick attributes call, then asserts on
 * the pesos in the saved record. That matters here because the bug reported from
 * production was not a crash — it was a silently wrong balance (₱850 instead of ₱2,650)
 * on a live account, which no console error would ever have surfaced.
 *
 * Run:  node qa/test-reseller-return.mjs
 *
 * Must stay true:
 *   1. one returned line can be replaced by SEVERAL batches, each at its own price
 *      (2 × B1LW + 1 × Duroc for 3 returned B1LW → billed exactly what was handed over)
 *   2. saving twice changes nothing (the old save rebuilt every line from the numbers
 *      typed in that session and deleted replacement charges billed earlier)
 *   3. a return can never exceed what is still unreturned — refused, not clamped
 *   4. balance = total − discount − paid (the old save ignored the discount)
 *   5. cancelling a replacement row reverses the charge AND puts the bottles back
 *   6. a hand-corrected invoice total survives the next adjustment as an offset
 *   7. legacy records (one replacement in replaced_qty/replacement_rate) keep billing
 *      exactly as before and are upgraded in place when touched
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
  ctx.document = {
    body: fakeEl('body'),
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

/* ── fixture: the shape reported from production ────────────────────────────────
   Pickup RTX-1 for Jo Dacara: 3 × B1LW @₱400 (₱1,200) + a second line of ₱1,450
   = ₱2,650 billed, nothing paid. He returns the 3 B1LW and takes 2 × B1LW and
   1 × Duroc @₱400 instead — the invoice must still read ₱2,650. */
const lot = (id, batch, boar, breed, price, bottles) => ({
  id, semen_batch_no: batch, boar_name: boar, breed, price_per_dose: price,
  available_bottles: bottles, bottles, status: 'active'
});
function seed() {
  return {
    farm_id: 'FARM-TEST',
    semen: [
      lot('SEM-LW', 'B1LW', 'B1 Large White', 'LY', 400, 10),
      lot('SEM-BD', 'BDD', 'Duroc (BD)', 'Duroc', 400, 5)
    ],
    semenResellers: [{ id: 'R-JO', name: 'Jo Dacara', contact: '0917' }],
    semenResellerTx: [{
      id: 'RTX-1', tx_no: 'RTX-1', type: 'pickup', reseller_id: 'R-JO', reseller_name: 'Jo Dacara',
      timestamp: '2026-09-01T02:00:00.000Z', date: '2026-09-01', sync_status: 'verified',
      total_amount: 2650, paid_amount: 0, discount_amount: 0, balance: 2650, status: 'active',
      lines: [
        { semen_id: 'SEM-LW', boar: 'B1 Large White', breed: 'LY', semen_batch_no: 'B1LW', qty: 3, rate: 400, amount: 1200, returned_qty: 0, replaced_qty: 0, is_returned_replaced: false },
        { semen_id: 'SEM-BD', boar: 'Duroc (BD)', breed: 'Duroc', semen_batch_no: 'BDD', qty: 1, rate: 1450, amount: 1450, returned_qty: 0, replaced_qty: 0, is_returned_replaced: false }
      ]
    }],
    semenResellerAdjustments: [],
    transactions: []
  };
}
const lotOf = (db, id) => db.semen.find(s => s.id === id);
const editForm = (ctx, { total, paid = '0', reason = '', rebuild = false, notes = '' }) => {
  ctx.__setValue('etx_timestamp', '');
  ctx.__setValue('etx_total', String(total));
  ctx.__setValue('etx_paid', String(paid));
  ctx.__setValue('etx_notes', notes);
  ctx.__setValue('etx_reason', reason);
  ctx.__setChecked('etx_rebuild', rebuild);
};

console.log('\n[FIX 187] reseller return & replace\n');

/* [0] the arithmetic the OLD build performed, kept here to prove the regression -- */
{
  const lines = [{ qty: 3, rate: 400 }, { qty: 1, rate: 1450 }];   // line 2 is not touched by this save
  const oldSave = (repQty, repRate) => lines.reduce((sum, l, i) => {
    const returned = i === 0 ? 3 : 0;                              // returned_qty accumulates…
    return sum + ((l.qty - returned) * l.rate + (i === 0 ? repQty * repRate : 0));   // …replaced_qty does not
  }, 0);
  const first = oldSave(2, 400);    // operator bills 2 × B1LW
  const second = oldSave(1, 400);   // then adds 1 × Duroc — the 2 × B1LW is gone
  eq('[0] old build: first save bills 2,250 of 2,650', first, 2250);
  eq('[0] old build: second save drops to 1,850', second, 1850);
  ok('[0] old build: ADDING a batch reduced the invoice', second < first, `${first} -> ${second}`);
  ok('[0] old build: a previously billed replacement vanished', Math.abs(first - second - 400) < 0.001, `lost ₱${first - second}`);
}

/* [1] multi-batch replacement in one save -------------------------------------- */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrRetQty(0, 3);
  ctx.rrReason(0, 'Unused / Unsold');
  ctx.rrAction(0, 'discard');
  ctx.rrAddRow(0); ctx.rrPick(0, 0, 'SEM-LW'); ctx.rrQty(0, 0, 2);
  ctx.rrAddRow(0); ctx.rrPick(0, 1, 'SEM-BD'); ctx.rrQty(0, 1, 1);
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');

  const l = tx.lines[0];
  eq('[1] returned qty recorded', l.returned_qty, 3);
  ok('[1] two replacement batches on one line', (l.replacements || []).length === 2, JSON.stringify(l.replacements));
  eq('[1] kept 0 + 2×400 + 1×400 = 1,200 on the line', l.amount, 1200);
  eq('[1] invoice still reads 2,650 — nothing lost', tx.total_amount, 2650);
  eq('[1] balance 2,650', tx.balance, 2650);
  eq('[1] B1LW stock deducted by 2', lotOf(db, 'SEM-LW').available_bottles, 8);
  eq('[1] Duroc stock deducted by 1', lotOf(db, 'SEM-BD').available_bottles, 4);
  eq('[1] header counts the returns (receipt / BLE slip)', tx.returned_count, 3);
  eq('[1] header counts the replacements', tx.replaced_count, 3);
  ok('[1] audit trail written', tx.return_audit.length === 1 && tx.return_audit[0].replacements === 3 && tx.return_audit[0].lines[0].amount_after === 1200, JSON.stringify(tx.return_audit));
  ok('[1] row re-marked for cloud verification', tx.sync_status === 'pending', tx.sync_status);
  ok('[1] each batch kept its own price in the notes', /2 × B1 Large White.*400/.test(tx.replacement_notes) && /1 × Duroc \(BD\).*400/.test(tx.replacement_notes), tx.replacement_notes);
  ok('[1] and the return reason is on the line', l.return_reason === 'Unused / Unsold', l.return_reason);
}

/* [2] idempotence ------------------------------------------------------------- */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrRetQty(0, 3);
  ctx.rrAddRow(0); ctx.rrPick(0, 0, 'SEM-LW'); ctx.rrQty(0, 0, 2);
  ctx.rrAddRow(0); ctx.rrPick(0, 1, 'SEM-BD'); ctx.rrQty(0, 1, 1);
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  const snap = () => `${tx.total_amount}|${tx.lines[0].amount}|${tx.lines[0].replacements.length}`;
  const afterFirst = snap();
  const savesAfterFirst = ctx.__saves;

  ctx.openResellerReturnReplaceModal('RTX-1');       // re-open, change nothing, save
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  ok('[2] an empty second save writes nothing', snap() === afterFirst, `${snap()} vs ${afterFirst}`);
  ok('[2] and says so instead of pretending to bill', /Nothing to save/.test(ctx.lastToast()), ctx.lastToast());
  eq('[2] no extra save call', ctx.__saves, savesAfterFirst);

  const before = tx.total_amount;
  for (let i = 0; i < 3; i++) ctx.arsResellerReturnMath.apply(tx);
  eq('[2] recomputing the same lines is a fixed point', tx.total_amount, before);
}

/* [3] an over-sized return is refused, never clamped -------------------------- */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];

  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrRetQty(0, 9);                                 // more than the 3 dispatched
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[3] nothing returned on a refused save', tx.lines[0].returned_qty, 0);
  eq('[3] invoice untouched', tx.total_amount, 2650);
  eq('[3] stock untouched', lotOf(db, 'SEM-LW').available_bottles, 10);
  ok('[3] refused out loud with the real limit', /you asked to return 9 bottle\(s\)/.test(ctx.lastToast()) && /only 3 of the 3 dispatched is still unreturned/.test(ctx.lastToast()) && /Nothing was saved/.test(ctx.lastToast()), ctx.lastToast());

  ctx.rrRetQty(0, 2);                                 // fix it in the still-open form
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[3] accepted once it fits', tx.lines[0].returned_qty, 2);
  eq('[3] line bills the 1 kept bottle', tx.lines[0].amount, 400);
  eq('[3] invoice credited exactly 2 bottles', tx.total_amount, 1850);

  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrRetQty(0, 2);                                 // only 1 is still returnable
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[3] a later over-return cannot overwrite the first', tx.lines[0].returned_qty, 2);
  ok('[3] telling them only 1 is left', /only 1 of the 3 dispatched is still unreturned/.test(ctx.lastToast()), ctx.lastToast());

  ctx.rrRetQty(0, 1);
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[3] the allowed 1 is then applied', tx.lines[0].returned_qty, 3);
  eq('[3] nothing kept on a fully returned line', ctx.arsResellerReturnMath.amountForLine(tx.lines[0]), 0);
  eq('[3] invoice = the other line only', tx.total_amount, 1450);
  eq('[3] discard did not restock', lotOf(db, 'SEM-LW').available_bottles, 10);

  ctx.openResellerReturnReplaceModal('RTX-1');        // restock path, on the second line
  ctx.rrRetQty(1, 1); ctx.rrAction(1, 'restock');
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[3] restock put the bottle back in its batch', lotOf(db, 'SEM-BD').available_bottles, 6);
  ok('[3] and wrote that into the notes', /restocked into BDD/.test(tx.replacement_notes), tx.replacement_notes);
}

/* [4] cancelling a replacement row reverses money and stock ------------------- */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrRetQty(0, 3);
  ctx.rrAddRow(0); ctx.rrPick(0, 0, 'SEM-LW'); ctx.rrQty(0, 0, 2);
  ctx.rrAddRow(0); ctx.rrPick(0, 1, 'SEM-BD'); ctx.rrQty(0, 1, 1);
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[4] before cancel: line 1,200', tx.lines[0].amount, 1200);

  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrRemoveExisting(0, 0);                         // cancel the 2 × B1LW row
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[4] cancelled row no longer bills', tx.lines[0].amount, 400);
  eq('[4] invoice moved by exactly the cancelled 800', tx.total_amount, 1850);
  eq('[4] bottles went back to their batch', lotOf(db, 'SEM-LW').available_bottles, 10);
  ok('[4] the cancellation is in the notes', /cancelled 2 × B1 Large White/.test(tx.replacement_notes), tx.replacement_notes);
  ok('[4] and in the audit list', tx.return_audit.length === 2 && tx.return_audit[1].cancelled === 2, JSON.stringify(tx.return_audit[1]));

  /* the ↩︎ Undo button only reverts an UNSAVED cancellation; once saved, putting a batch
     back means adding it again — which is what the next save does, while cancelling the
     Duroc row: the two moves in one adjustment. */
  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrAddRow(0); ctx.rrPick(0, 0, 'SEM-LW'); ctx.rrQty(0, 0, 2);
  ctx.rrRemoveExisting(0, 0);
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[4] re-adding bills it again', tx.lines[0].amount, 800);
  eq('[4] with one row cancelled and one added', tx.lines[0].replacements.length, 1);
  eq('[4] Duroc bottle went back', lotOf(db, 'SEM-BD').available_bottles, 5);
  eq('[4] re-adding after a cancel is stock-neutral', lotOf(db, 'SEM-LW').available_bottles, 8);
  ok('[4] both moves are in the audit entry', tx.return_audit.slice(-1)[0].cancelled === 1 && tx.return_audit.slice(-1)[0].replacements === 2, JSON.stringify(tx.return_audit.slice(-1)[0]));
  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrRemoveExisting(0, 0);
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[4] cancelling the last row leaves a pure credit', tx.lines[0].amount, 0);
  eq('[4] and the invoice shows only the other line', tx.total_amount, 1450);
}

/* [5] discount and payments are respected ------------------------------------ */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  tx.discount_amount = 150; tx.paid_amount = 500; tx.balance = 2000;
  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrRetQty(0, 3);
  ctx.rrAddRow(0); ctx.rrPick(0, 0, 'SEM-LW'); ctx.rrQty(0, 0, 2); ctx.rrRate(0, 0, 450);  // re-priced batch
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[5] replacement billed at its own (edited) price', tx.lines[0].amount, 900);
  eq('[5] invoice = 900 + 1,450', tx.total_amount, 2350);
  eq('[5] balance = total − discount − paid', tx.balance, 1700);
  ok('[5] status reflects payment, not the adjustment', tx.status === 'partially_paid', tx.status);
  eq('[5] discount still counted for the account', db.semenResellerTx.reduce((a, t) => a + Math.min(t.total_amount, t.discount_amount), 0), 150);
}

/* [6] stock limits: refused, not silently trimmed ----------------------------- */
{
  const db = seed();
  db.semen[0].available_bottles = 1; db.semen[0].bottles = 1;
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrRetQty(0, 3);
  ctx.rrAddRow(0); ctx.rrPick(0, 0, 'SEM-LW'); ctx.rrQty(0, 0, 4);   // only 1 on hand
  ctx.rrAddRow(0); ctx.rrPick(0, 1, 'SEM-GONE');                      // batch no longer exists
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  const refused = ctx.lastToast();
  ok('[6] both reasons in one toast', /only 1 bottle\(s\) available for this save, 4 asked for/.test(refused) && /no longer in semen inventory/.test(refused) && /Nothing was saved/.test(refused), refused);
  eq('[6] so nothing was returned either', tx.lines[0].returned_qty, 0);
  eq('[6] and the invoice is unchanged', tx.total_amount, 2650);
  eq('[6] stock never moves on a refused save', lotOf(db, 'SEM-LW').available_bottles, 1);

  ctx.rrQty(0, 0, 1); ctx.rrDelRow(0, 1);            // correct both rows in the same form
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[6] corrected rows save fine', tx.lines[0].returned_qty, 3);
  eq('[6] billed for what was handed over', tx.lines[0].amount, 400);
  eq('[6] invoice moved by the 3 returned minus the 1 replaced', tx.total_amount, 1850);
  eq('[6] and stock is deducted once', lotOf(db, 'SEM-LW').available_bottles, 0);
  ok('[6] exhausted batch flagged', lotOf(db, 'SEM-LW').status === 'exhausted', lotOf(db, 'SEM-LW').status);
}

/* [7] legacy single-replacement records --------------------------------------- */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  tx.lines[0].returned_qty = 3;
  tx.lines[0].replaced_qty = 1;
  tx.lines[0].replacement_boar = 'Duroc (BD)';
  tx.lines[0].replacement_rate = 400;
  tx.lines[0].replacement_batch_no = 'BDD';
  tx.lines[0].amount = 400;
  tx.total_amount = 850;

  const d0 = ctx.arsResellerReturnMath.derive(tx);
  eq('[7] legacy line reads as one replacement row', d0.derived, 1850);   // 400 + 1,450
  ok('[7] drift is reported, nothing rewritten yet', d0.stored === 850 && d0.drift === 1000, JSON.stringify(d0));
  eq('[7] legacy mirror money for the hub', ctx.arsResellerReturnMath.amountForLine(tx.lines[0]), 400);

  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrAddRow(0); ctx.rrPick(0, 0, 'SEM-LW'); ctx.rrQty(0, 0, 2);        // re-add the lost batch
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[7] repair lands on the right money', tx.total_amount, 2650);
  eq('[7] and the right balance', tx.balance, 2650);
  ok('[7] legacy fields upgraded to an array of 2', Array.isArray(tx.lines[0].replacements) && tx.lines[0].replacements.length === 2, JSON.stringify(tx.lines[0].replacements));
  eq('[7] hub mirror: total replaced bottles', tx.lines[0].replaced_qty, 3);
  eq('[7] hub mirror: blended rate stays honest', tx.lines[0].replacement_rate, 400);
  ok('[7] hub mirror: multi-batch label', /\+1 more/.test(tx.lines[0].replacement_boar), tx.lines[0].replacement_boar);
  ok('[7] adjusted flag kept for the row tag', tx.lines[0].is_returned_replaced === true);
  eq('[7] the old row is still billed, not doubled', tx.lines[0].replacement_amount, 1200);
}

/* [8] a hand-corrected total survives the next adjustment -------------------- */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  tx.lines[0].returned_qty = 3; tx.lines[0].amount = 400;
  tx.lines[0].replaced_qty = 1; tx.lines[0].replacement_rate = 400; tx.lines[0].replacement_boar = 'Duroc (BD)';
  tx.lines[0].replacement_batch_no = 'BDD';
  tx.total_amount = 850;
  editForm(ctx, { total: 2650, reason: 'Restored 2 × B1LW @400 dropped by the old return form' });
  ctx.openEditResellerTxModal('RTX-1');
  ctx.saveEditResellerTx({ preventDefault() {} }, 'RTX-1');
  eq('[8] correction applied', tx.total_amount, 2650);
  ok('[8] marked hand-set, with its reason', tx.total_manual === true && /old return form/.test(tx.manual_correction.reason), JSON.stringify(tx.manual_correction));
  ok('[8] the edit is on the audit list', tx.edit_history.length === 1 && tx.edit_history[0].total_before === 850, JSON.stringify(tx.edit_history));

  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrRetQty(1, 1);                                   // later: return the other line too
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[8] lines moved by −1,450', ctx.arsResellerReturnMath.derive(tx).derived, 400);
  eq('[8] hand total preserved as an offset', tx.total_amount, 1200);
  eq('[8] balance follows the corrected invoice', tx.balance, 1200);
  ok('[8] and it says the hand correction was kept', /hand correction kept/.test(ctx.lastToast()), ctx.lastToast());

  /* a record nobody hand-corrected must NOT keep an offset: derived, full stop */
  const db2 = seed(); const ctx2 = boot(db2); const tx2 = db2.semenResellerTx[0];
  tx2.total_amount = 999999;                            // nonsense total, no manual flag
  ctx2.openResellerReturnReplaceModal('RTX-1');
  ctx2.rrRetQty(0, 1);
  ctx2.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[8] without a manual flag the invoice is always re-derived', tx2.total_amount, ctx2.arsResellerReturnMath.derive(tx2).derived);
}

/* [9] the edit form refuses an unexplained total ----------------------------- */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  editForm(ctx, { total: 3000, reason: '' });
  ctx.saveEditResellerTx({ preventDefault() {} }, 'RTX-1');
  eq('[9] refused: the total contradicts the lines', tx.total_amount, 2650);
  ok('[9] with an explanation', /write the reason first/.test(ctx.lastToast()), ctx.lastToast());

  editForm(ctx, { total: 2650, reason: '', rebuild: true });
  ctx.saveEditResellerTx({ preventDefault() {} }, 'RTX-1');
  eq('[9] rebuild with a matching total is accepted', tx.total_amount, 2650);
  ok('[9] and is not flagged manual', tx.total_manual === false, String(tx.total_manual));
  ctx.__setValue('etx_timestamp', '2026-09-05T08:30'); ctx.__setValue('etx_total', '2650'); ctx.__setValue('etx_reason', 'dated wrong');
  ctx.saveEditResellerTx({ preventDefault() {} }, 'RTX-1');
  ok('[9] a timestamp edit keeps tx.date in step', tx.date === '2026-09-05' && String(tx.timestamp).startsWith('2026-09-05'), `${tx.date} / ${tx.timestamp}`);
}

/* [10] voided pickups stay read-only ----------------------------------------- */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  tx.voided = true; tx.void_snapshot = { total_amount: tx.total_amount, paid_amount: 0 };
  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrRetQty(0, 3);
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[10] voided invoice untouched', tx.total_amount, 2650);
  eq('[10] stock untouched', lotOf(db, 'SEM-LW').available_bottles, 10);
  ok('[10] refused with a reason', /Voided/.test(ctx.lastToast()), ctx.lastToast());
}

/* [11] repairing the live record the old build broke -------------------------- */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  /* what production holds today: return applied, one replacement row left, and a total
     the lines do not support */
  tx.lines[0].returned_qty = 3;
  tx.lines[0].replaced_qty = 1; tx.lines[0].replacement_boar = 'Duroc (BD)';
  tx.lines[0].replacement_rate = 400; tx.lines[0].replacement_batch_no = 'BDD';
  tx.lines[0].amount = 400;
  tx.total_amount = 850; tx.balance = 850; tx.status = 'returned_replaced';

  editForm(ctx, { total: 2650, reason: '2 × B1LW @400 replacement dropped by the old return form' });
  ctx.saveEditResellerTx({ preventDefault() {} }, 'RTX-1');
  eq('[11] balance restored to 2,650', tx.balance, 2650);
  eq('[11] total restored to 2,650', tx.total_amount, 2650);
  ok('[11] remembered as a hand correction, not as the lines', tx.total_manual === true && Math.abs(tx.total_derived - 1850) < 0.001, JSON.stringify({ m: tx.total_manual, d: tx.total_derived }));
  ok('[11] payment status is a payment status again', tx.status === 'active', tx.status);
  eq('[11] hub account math sees it', +(((db.semenResellerTx.reduce((a, t) => a + t.total_amount, 0)) - db.semenResellerTx.reduce((a, t) => a + t.paid_amount, 0))).toFixed(2), 2650);

  /* and rebuilding the lines on a hand-corrected record repairs the breakdown without
     silently throwing the peso decision away */
  ctx.openResellerReturnReplaceModal('RTX-1');
  ctx.rrAddRow(0); ctx.rrPick(0, 0, 'SEM-LW'); ctx.rrQty(0, 0, 2);   // re-add the lost charge
  ctx.saveResellerReturnReplace({ preventDefault() {} }, 'RTX-1');
  eq('[11] the lost charge is now on the line', ctx.arsResellerReturnMath.derive(tx).derived, 2650);
  eq('[11] the hand offset is kept and shown, not hidden', tx.total_amount, 3450);
  ok('[11] toast quantifies the kept offset', /hand correction kept \(\+₱800\.00 over the lines\)/.test(ctx.lastToast()), ctx.lastToast());

  editForm(ctx, { total: 2650, rebuild: true });
  ctx.saveEditResellerTx({ preventDefault() {} }, 'RTX-1');
  eq('[11] saving the line total drops the correction', tx.total_amount, 2650);
  ok('[11] and clears the manual flag', tx.total_manual === false, String(tx.total_manual));
  eq('[11] final balance is the number the operator wanted', tx.balance, 2650);
}

/* [12] rebuild fixes a drifted line on a record nobody hand-corrected --------- */
{
  const db = seed();
  const ctx = boot(db);
  const tx = db.semenResellerTx[0];
  tx.lines[0].returned_qty = 1;
  tx.lines[0].replacements = [{ semen_id: 'SEM-LW', boar: 'B1 Large White', batch_no: 'B1LW', qty: 2, rate: 400 }];
  tx.lines[0].amount = 400;             // stale: 2 kept ×₱400 + 2 replacing ×₱400 = 1,600
  tx.total_amount = 1850;
  editForm(ctx, { total: 3050, reason: '', rebuild: true });
  ctx.saveEditResellerTx({ preventDefault() {} }, 'RTX-1');
  eq('[12] line rebuilt from its stored rows', tx.lines[0].amount, 1600);
  eq('[12] invoice matches its lines', tx.total_amount, 3050);
  ok('[12] no reason needed when the total equals the rebuilt lines', tx.total_manual === false, String(tx.total_manual));
  eq('[12] mirrors refreshed for hub and receipt', tx.lines[0].replaced_qty, 2);
  eq('[12] balance recomputed', tx.balance, 3050);
  ok('[12] and the drift is no longer hidden', ctx.arsResellerReturnMath.derive(tx).drift === 0, JSON.stringify(ctx.arsResellerReturnMath.derive(tx)));
}

console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
