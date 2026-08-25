/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 20] js/piglet-care.js — "Iron & Castration" quick care.

   Replaces the dashboard "Piglets need iron" counter with an "Iron &
   castration" card that counts batches aged 3–25 days (the iron / castration
   window) still missing either care step. Tapping the card opens a care
   panel listing those batches with their treatment status, plus two quick
   record forms:
     • 💉 Iron Treatment  — medicine auto-suggested as "Jectran" (editable),
       heads auto-fetched from the batch, saves to Medicine & Treatments as a
       treatment movement tagged "Iron Treatment" and marks the batch iron ✓.
     • ✂ Castration       — asks for the 2-medicine combination and how many
       heads (auto-filled with the batch's active MALE piglets), saves both
       medicines to Medicine & Treatments as movements tagged "Castration"
       and marks the batch castration ✓.
   All records land in the Recent treatments list and in the batch's
   medication history (FIX 18/19 views) automatically.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsq = v => "'" + String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + "'";
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const round2 = n => Math.round(n * 100) / 100;
  const today = () => (typeof TODAY !== 'undefined' ? TODAY : new Date().toISOString().slice(0, 10));
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const CARE_MIN = 3, CARE_MAX = 25; /* days of age — the iron / castration window */

  /* ── batch helpers (ledger-aware, same rules as the rest of the app) ── */
  const ledAct = () => (F().pigletLedger || []).filter(x => !['undone', 'deleted'].includes(x.status));
  const lsum = (bid, t, g) => ledAct().filter(x => x.batch_id === bid && x.type === t && (!g || x.gender === g)).reduce((a, x) => a + (+x.quantity || 0), 0);
  const aliveHeads = b => Math.max(0, (+b.males || 0) + (+b.females || 0) - lsum(b.id, 'mortality') - lsum(b.id, 'sold'));
  const aliveMales = b => Math.max(0, (+b.males || 0) - lsum(b.id, 'mortality', 'male') - lsum(b.id, 'sold', 'male'));
  const ageOf = b => (b.birth ? days(b.birth) : NaN);
  /* [REBUILD FIX 24] archived batches are out of the iron / castration window */
  const careEligible = () => (F().piglets || []).filter(b => { if (b.archived) return false; const d = ageOf(b); return d >= CARE_MIN && d <= CARE_MAX && aliveHeads(b) > 0; })
    .sort((a, b) => ageOf(a) - ageOf(b));
  /* [REBUILD FIX 31] males confirmed as breeders are exempt from castration care */
  const castrDue = b => !b.castration && b.castration_exempt !== 'breeder';
  const needsCare = b => !b.iron || castrDue(b);
  const dueList = () => careEligible().filter(needsCare);
  const dueCount = () => dueList().length;
  window.pigletCareDue = dueCount;

  /* ── medicine ledger helpers ── */
  const meds = () => (F().medicines = Array.isArray(F().medicines) ? F().medicines : []);
  const moves = () => (F().med_movements = Array.isArray(F().med_movements) ? F().med_movements : []);
  const findMedByName = n => meds().find(m => String(m.item_name || '').trim().toLowerCase() === String(n || '').trim().toLowerCase());
  function logMove(m, kind, delta, note, extra = {}) {
    moves().unshift(Object.assign({
      id: newId('mv-'), med_id: m ? m.id : '', item_name: m ? m.item_name : '', kind,
      delta: round2(delta), qty_after: m ? round2(+m.stock_quantity || 0) : 0,
      unit: m ? m.unit : 'ml', date: today(), at: new Date().toISOString(), note: note || ''
    }, extra));
  }
  /* Find-or-create so the treatment links a real inventory item the farm can
     restock / reuse later (created with 0 stock — no phantom inventory). */
  function ensureMed(name, unit, type) {
    let m = findMedByName(name);
    if (!m) {
      m = { id: newId('med-'), item_name: String(name).trim(), brand_name: '', active_ingredient: '', med_type: type || 'Other', form: '', unit: unit || 'ml', stock_quantity: 0, minimum_stock_threshold: 0, unit_cost: null, expiry_date: '', supplier: '', notes: 'Auto-added from Iron & castration quick care', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      meds().push(m);
      logMove(m, 'initial', 0, 'Registered from Iron & castration quick care');
    }
    return m;
  }

  let cur = { tab: 'iron', batch: null };

  /* ── care panel ── */
  function chip(done) { return done ? '<span class="tag">✓ done</span>' : '<span class="tag warn">✗ due</span>'; }

  function batchListHTML() {
    const list = careEligible();
    if (!list.length) return `<div class="empty">No piglet batches are in the ${CARE_MIN}–${CARE_MAX}-day window right now. Iron & castration care applies to piglets aged ${CARE_MIN} up to ${CARE_MAX} days.</div>`;
    return list.map(b => `<button type="button" class="summary-row care-batch-row" onclick="pigletCarePick(${jsq(b.id)})">
      <span><b>${esc(b.id)}</b> <small class="muted">${esc(b.dam_name || b.sow || '—')} → ${esc(b.sire_name || b.sire || '—')}</small><br>
      <small class="muted">${ageOf(b)} days old · ${aliveHeads(b)} heads (♂ ${aliveMales(b)})</small></span>
      <span class="care-chips">💉 ${chip(!!b.iron)} ✂ ${(!b.castration && b.castration_exempt === 'breeder') ? '<span class="tag">🐗 breeder</span>' : chip(!!b.castration)}</span>
    </button>`).join('');
  }

  function batchOptions(sel) {
    return careEligible().map(b => `<option value="${esc(b.id)}"${b.id === sel ? ' selected' : ''}${needsCare(b) ? '' : ''}>${esc(b.id)} · ${ageOf(b)} d · ${aliveHeads(b)} heads${needsCare(b) ? '' : ' (care done)'}</option>`).join('');
  }

  function openPigletCare(batchId, tab) {
    if (batchId !== undefined) cur.batch = batchId;
    if (tab) cur.tab = tab;
    const list = careEligible();
    if (!cur.batch || !list.some(b => b.id === cur.batch)) cur.batch = (dueList()[0] || list[0] || {}).id || null;
    const b = list.find(x => x.id === cur.batch);
    const ironForm = `<div class="reminder-fields">
        <div class="field"><label>Piglet batch *</label><select name="batch_id" onchange="pigletCarePick(this.value)">${batchOptions(cur.batch)}</select></div>
        <div class="field"><label>Medicine * <small class="muted">· auto-suggested — change anytime</small></label><input name="medicine" list="careMedList" value="Jectran" required></div>
        <div class="field"><label>Dose per head (ml) *</label><input name="dose" type="number" min="0.1" step="0.1" value="1" required></div>
        <div class="field"><label>Heads treated *</label><input name="heads" type="number" min="1" step="1" value="${b ? aliveHeads(b) : 1}" required></div>
        <div class="field"><label>Date *</label><input name="date" type="date" value="${today()}" required></div>
        <div class="field"><label>Given by</label><input name="by" placeholder="e.g. Mang Tomas"></div>
      </div>
      <div class="form-error" id="careIronErr"></div>
      <div class="due-actions" style="margin-top:12px"><button class="btn">💉 Save Iron Treatment</button></div>
      <small class="muted care-note">Saved to Medicine &amp; Treatments → Recent treatments, tagged <b>“Iron Treatment”</b>, and marks this batch's iron ✓.</small>`;
    const castForm = `<div class="reminder-fields">
        <div class="field"><label>Piglet batch *</label><select name="batch_id" onchange="pigletCarePick(this.value)">${batchOptions(cur.batch)}</select></div>
        <div class="field"><label>Combination medicine 1 *</label><input name="med1" list="careMedList" placeholder="e.g. Lidocaine" required></div>
        <div class="field"><label>Combination medicine 2 *</label><input name="med2" list="careMedList" placeholder="e.g. Amoxicillin LA" required></div>
        <div class="field"><label>Heads castrated * <small class="muted">· active male piglets in the batch</small></label><input name="heads" type="number" min="1" step="1" value="${b ? Math.max(1, aliveMales(b)) : 1}" required></div>
        <div class="field"><label>Date *</label><input name="date" type="date" value="${today()}" required></div>
        <div class="field"><label>Done by</label><input name="by" placeholder="e.g. Doc Ana"></div>
      </div>
      <div class="form-error" id="careCastErr"></div>
      <div class="due-actions" style="margin-top:12px"><button class="btn">✂ Save Castration</button></div>
      <small class="muted care-note">Both medicines are saved to Medicine &amp; Treatments → Recent treatments, tagged <b>“Castration”</b>, and the batch is marked castration ✓.</small>`;
    document.getElementById('pigletCareModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="pigletCareModal"><div class="reminder-modal fc-health-modal care-modal">
      <div class="modal-top"><h2>🐖 Iron &amp; Castration</h2><button type="button" class="close-reminder" onclick="document.getElementById('pigletCareModal').remove()">×</button></div>
      <p class="perf-sub">Piglet batches aged <b>${CARE_MIN}–${CARE_MAX} days</b> · treatment status &amp; quick recording</p>
      <div class="care-batch-list">${batchListHTML()}</div>
      ${list.length ? `
      <div class="fc-tabs" style="margin-top:14px">
        <button type="button" class="med-tab ${cur.tab === 'iron' ? 'active' : ''}" onclick="pigletCareTab('iron')">💉 Iron Treatment</button>
        <button type="button" class="med-tab ${cur.tab === 'castration' ? 'active' : ''}" onclick="pigletCareTab('castration')">✂ Castration</button>
      </div>
      <datalist id="careMedList">${meds().map(m => `<option value="${esc(m.item_name)}">`).join('')}</datalist>
      ${cur.tab === 'iron'
        ? `<form onsubmit="saveIronCare(event)">${ironForm}</form>`
        : `<form onsubmit="saveCastrationCare(event)">${castForm}</form>`}` : ''}
      <div class="due-actions" style="margin-top:14px"><button type="button" class="btn ghost" onclick="document.getElementById('pigletCareModal').remove()">Close</button></div>
    </div></div>`);
  }

  function pigletCareTab(tab) { openPigletCare(undefined, tab); }
  function pigletCarePick(bid) { cur.batch = bid; openPigletCare(); }

  function fail(id, msg) { const e = document.getElementById(id); if (e) { e.textContent = msg; e.classList.add('show'); } }

  /* ── 💉 Iron — Jectran default, tagged "Iron Treatment" ── */
  function saveIronCare(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const b = (F().piglets || []).find(x => x.id === d.batch_id);
    const name = String(d.medicine || '').trim() || 'Jectran',
      heads = num(d.heads), dose = num(d.dose);
    if (!b) { fail('careIronErr', 'Choose a piglet batch.'); return; }
    if (!heads || heads < 1 || dose === null || dose <= 0) { fail('careIronErr', 'Enter a valid dose per head and number of heads.'); return; }
    const total = round2(dose * heads),
      m = ensureMed(name, 'ml', 'Vitamin & Mineral'),
      stock = +m.stock_quantity || 0, take = Math.min(stock, total);
    m.stock_quantity = round2(stock - take); m.updated_at = new Date().toISOString();
    logMove(m, 'treatment', -total, '', {
      animal_type: 'Piglet batch', animal_ref: 'batch:' + b.id,
      animal_label: `Piglet batch: ${b.id} · ${heads} heads`,
      heads, dose_per_head: dose, date: d.date || today(),
      reason: 'Iron supplementation', administered_by: String(d.by || '').trim(),
      tag: 'Iron Treatment'
    });
    b.iron = true;
    save();
    if (typeof renderAll === 'function') renderAll();
    openPigletCare(b.id, 'iron');
    toast(`✔ ${name} ${total} ${m.unit} → ${b.id} · tagged “Iron Treatment”`);
    if (take < total) setTimeout(() => toast(`ℹ ${name} inventory stock was ${round2(stock)} ${m.unit} — restock in Medicine & Treatments to keep stock in sync`), 350);
  }

  /* ── ✂ Castration — 2-medicine combo, heads = active males ── */
  function saveCastrationCare(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const b = (F().piglets || []).find(x => x.id === d.batch_id);
    const n1 = String(d.med1 || '').trim(), n2 = String(d.med2 || '').trim(), heads = num(d.heads);
    if (!b) { fail('careCastErr', 'Choose a piglet batch.'); return; }
    if (!n1 || !n2) { fail('careCastErr', 'Enter both combination medicines.'); return; }
    if (n1.toLowerCase() === n2.toLowerCase()) { fail('careCastErr', 'The two combination medicines must be different.'); return; }
    if (!heads || heads < 1) { fail('careCastErr', 'Enter how many male piglets were castrated.'); return; }
    const combo = `${n1} + ${n2}`, by = String(d.by || '').trim();
    [n1, n2].forEach(n => {
      const m = ensureMed(n, 'dose', 'Other'), stock = +m.stock_quantity || 0, take = Math.min(stock, heads);
      m.stock_quantity = round2(stock - take); m.updated_at = new Date().toISOString();
      logMove(m, 'treatment', -heads, '', {
        animal_type: 'Piglet batch', animal_ref: 'batch:' + b.id,
        animal_label: `Piglet batch: ${b.id} · ${heads} ♂ heads`,
        heads, dose_per_head: 1, date: d.date || today(),
        reason: `Castration · combination: ${combo}`, administered_by: by,
        tag: 'Castration'
      });
    });
    b.castration = true;
    delete b.castration_exempt; /* [REBUILD FIX 31] recording the treatment cancels any breeder exemption */
    save();
    if (typeof renderAll === 'function') renderAll();
    openPigletCare(b.id, 'castration');
    toast(`✔ Castration recorded for ${b.id} · ${combo} → ${heads} heads · tagged “Castration”`);
  }

  Object.assign(window, { openPigletCare, pigletCareTab, pigletCarePick, saveIronCare, saveCastrationCare });
})();
