/* ═══════════════════════════════════════════════════════════════════════════
   ARSwineTech Pro — Batch Production Cost Engine (js/batch-costing.js)
   [REBUILD FEATURE FIX 76]

   Computes the REAL production cost of a piglet batch from recorded farm data:
     1. FEED — walks the batch through the existing feed program
        (Pre Starter → Starter → Grower → Finisher) using:
          • manual "consumed bags" entries from the Feeding Guide when present,
          • otherwise the same age-derived stage walk the Feed Guide uses,
          • the farm's configured stageBags/stageDays/bagKg (F().feedPlan),
          • ACTUAL price-per-bag from Feed Inventory (feed rows), falling back
            to recorded feed delivery/order events, then Feed transactions.
        Mortality & sales reduce the headcount so cost isn't spread to ghosts.
     2. MEDICINE / VACCINES — values recorded batch treatments at the medicine
        inventory's unit cost; batch-matched Expense transactions count direct.
     3. SHARED FARM EXPENSES (electricity, water, labor, cleaning/disinfection,
        transport, rent/utilities…) — allocated per month by the batch's share
        of live heads at mid-month across all batches alive that month.
     4. COST PER HEAD = total ÷ saleable heads (live now; if the batch is fully
        sold out, ÷ heads actually sold/released). The reservation quantity is
        NEVER the denominator — reserving 2 of 20 piglets must not divide the
        whole batch cost by 2.

   Exposes window.ARSBatchCost: analyze(), panelHTML(), priceFeedback(),
   renderInto(), openBatchExpense(), liveHeadsNow().
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const farm = () => (typeof F === 'function' ? F() : null);
  const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const money = v => (typeof peso === 'function' ? peso(v) : '₱' + Math.round(num(v)).toLocaleString('en-PH'));
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const dayMs = 86400000;
  const daysSince = d => {
    if (!d) return null;
    const t = new Date(String(d).slice(0, 10) + 'T00:00:00');
    if (isNaN(t)) return null;
    return Math.max(0, Math.round((new Date(todayISO() + 'T00:00:00') - t) / dayMs));
  };
  const isoMonth = d => String(d).slice(0, 7);

  const STAGES = [['preStarter', 'Pre Starter'], ['starter', 'Starter'], ['grower', 'Grower'], ['finisher', 'Finisher']];
  const SHARED_RE = /electric|power|water|labor|labour|salary|salaries|wages|cleaning|disinfect|sanit|transport|trucking|hauling|fuel|rent|utilities|internet/i;

  const plan = () => Object.assign({
    stageBags: {}, stageDays: { preStarter: 28, starter: 28, grower: 35, finisher: 45 }, bagKg: {}
  }, (farm() || {}).feedPlan || {});

  const bagKg = (t, p) => {
    const o = (p && p.bagKg) || {};
    const key = Object.keys(o).find(k => k.toLowerCase() === String(t).toLowerCase());
    if (key && num(o[key])) return num(o[key]);
    return String(t).toLowerCase() === 'pre starter' ? 25 : 50;
  };

  const batchById = id => ((farm() || {}).piglets || []).find(x => x.id === id) || null;
  const birthOf = b => b.birth || b.birthDate || b.farrowing_date || b.birth_date || null;
  const ledAct = () => ((farm() || {}).pigletLedger || []).filter(x => !['undone', 'deleted', 'voided'].includes(String(x.status || '').toLowerCase()));
  const entryDate = x => String(x.date || x.created_at || '').slice(0, 10);

  function ledgerSums(bid) {
    const l = ledAct().filter(x => x.batch_id === bid);
    const sum = (type, gender) => l.filter(x => x.type === type && (!gender || x.gender === gender)).reduce((a, x) => a + num(x.quantity), 0);
    return { l, sum };
  }

  function releasedHeads(bid) {
    return ((farm() || {}).reservations || []).filter(r => (r.status === 'released' || r.released_at) && r.status !== 'cancelled').reduce((acc, r) => {
      if (Array.isArray(r.lines) && r.lines.length) return acc + r.lines.filter(l => l.batch_id === bid).reduce((a, l) => a + num(l.quantity), 0);
      return acc + (r.batch_id === bid ? num(r.quantity) : 0);
    }, 0);
  }

  function liveHeadsNow(b) {
    const born = num(b.males) + num(b.females);
    const { sum } = ledgerSums(b.id);
    const sold = sum('sold') + releasedHeads(b.id);
    return Math.max(0, Math.round(born - sum('mortality') - sold));
  }

  function headsAt(b, dateStr) {
    const birth = birthOf(b);
    if (!birth || String(dateStr) < String(birth)) return 0;
    const born = num(b.males) + num(b.females);
    const { l } = ledgerSums(b.id);
    const gone = l.filter(x => (x.type === 'mortality' || x.type === 'sold') && entryDate(x) && entryDate(x) <= dateStr).reduce((a, x) => a + num(x.quantity), 0);
    const rel = ((farm() || {}).reservations || []).filter(r => r.batch_id === b.id && r.status === 'released' && String(r.released_at || r.date || '').slice(0, 10) <= dateStr).reduce((a, r) => a + num(r.quantity), 0);
    return Math.max(0, Math.round(born - gone - rel));
  }

  /* ── feed price lookup: Feed Inventory row → production events → transactions ── */
  function pricePerBag(stageLabel) {
    const f = farm() || {};
    const row = (f.feed || []).find(x => String(x.type || '').toLowerCase() === stageLabel.toLowerCase());
    if (row && num(row.price)) return { price: num(row.price), src: 'Feed Inventory' };
    const evs = (f.productionEvents || []).filter(e => (e.event_type === 'feed_delivery' || e.event_type === 'feed_order') && String(e.feed_type || '').toLowerCase() === stageLabel.toLowerCase() && num(e.amount) && num(e.quantity));
    if (evs.length) {
      const e = evs[evs.length - 1];
      const kg = num(e.quantity);
      const perBag = kg > 0 ? num(e.amount) / (kg / bagKg(stageLabel, plan())) : 0;
      if (perBag > 0) return { price: perBag, src: 'feed event' };
    }
    const tx = (f.transactions || []).find(t => t.type === 'Expense' && String(t.category || '').toLowerCase() === 'feed' && String(t.description || '').toLowerCase().includes(stageLabel.toLowerCase()) && num(t.amount));
    if (tx) return { price: num(t.amount), src: 'transaction (verify)' };
    return { price: 0, src: null };
  }

  /* ── 1. feed consumption & cost ─────────────────────────────────────── */
  function deriveConsumedFromAge(ageDays, heads, p) {
    const out = {};
    let remaining = Math.max(0, num(ageDays));
    STAGES.forEach(([key]) => {
      const perHead = num((p.stageBags || {})[key]);
      const sd = Math.max(1, num((p.stageDays || {})[key], 28));
      const day = Math.max(0, Math.min(remaining, sd));
      out[key] = +(perHead * heads * (day / sd)).toFixed(2);
      remaining = Math.max(0, remaining - sd);
    });
    return out;
  }

  function feedCost(b) {
    const f = farm() || {};
    const p = plan();
    const warnings = [];
    const rows = [];
    const saved = ((p.batches || {})[b.id]) || {};
    const cons = saved.consumed || {};
    const hasManual = Boolean(saved.updated) || Object.values(cons).some(v => num(v) > 0);
    const age = daysSince(birthOf(b));
    const heads = Math.max(1, liveHeadsNow(b));
    const used = hasManual ? cons : (age === null ? {} : deriveConsumedFromAge(age, heads, p));
    if (!hasManual && age === null) warnings.push('No birth date on this batch — feed cost uses only manually recorded consumption.');
    if (!hasManual && age !== null) warnings.push('No manual "consumed bags" entries — consumption derived from batch age & your stage plan.');
    let totalBags = 0, totalKg = 0, totalCost = 0;
    STAGES.forEach(([key, label]) => {
      const bags = num(used[key]);
      if (bags <= 0) return;
      const pp = pricePerBag(label);
      const kg = bags * bagKg(label, p);
      const cost = bags * pp.price;
      if (!pp.price) warnings.push(`No recorded price for ${label} — add "Price Per Bag" in Feed Inventory.`);
      totalBags += bags; totalKg += kg; totalCost += cost;
      rows.push({ stage: label, bags: +bags.toFixed(2), kg: +kg.toFixed(0), pricePerBag: pp.price, cost, src: pp.src });
    });
    return { rows, totalBags: +totalBags.toFixed(2), totalKg: +totalKg.toFixed(0), totalCost, warnings, manual: hasManual };
  }

  /* ── 2. medicines / vaccines / direct batch expenses ────────────────── */
  function medsAndDirect(b) {
    const f = farm() || {};
    let medCost = 0;
    const medRows = [];
    (f.treatments || []).forEach(t => {
      const isBatch = t.category === 'batch' && String(t.animal_ref || '') === 'batch:' + b.id;
      const sowOrOther = false;
      if (!isBatch && sowOrOther) return;
      if (!isBatch) return;
      const med = (f.medicines || []).find(m => m.id === t.med_id || m.item_name === t.medicine_name || m.item_name === t.medicine);
      const unit = med ? num(med.unit_cost) : 0;
      const c = unit > 0 ? unit * num(t.dosage_ml) : 0;
      if (c > 0) { medCost += c; medRows.push({ label: `${t.medicine_name || t.medicine} · ${num(t.dosage_ml)} ml`, cost: c }); }
    });
    let direct = 0;
    const directRows = [];
    (f.transactions || []).forEach(t => {
      if (t.type !== 'Expense' || ['voided', 'deleted', 'undone'].includes(String(t.status || '').toLowerCase())) return;
      const desc = `${t.description || ''} ${t.category || ''}`.toLowerCase();
      if (desc.includes(b.id.toLowerCase()) || desc.includes(('batch ' + b.id).toLowerCase())) {
        direct += num(t.amount);
        directRows.push({ label: `${t.category || 'Expense'} · ${String(t.date || '').slice(0, 10)}`, cost: num(t.amount) });
      }
    });
    return { medCost, medRows, direct, directRows };
  }

  /* ── 3. shared farm expense allocation (headcount-days per month) ───── */
  function sharedAllocation(b) {
    const f = farm() || {};
    const birth = birthOf(b);
    const rowsByCat = {};
    const monthTotals = {};
    (f.transactions || []).forEach(t => {
      if (t.type !== 'Expense' || ['voided', 'deleted', 'undone'].includes(String(t.status || '').toLowerCase())) return;
      const cat = String(t.category || 'Other');
      if (!SHARED_RE.test(`${cat} ${t.description || ''}`)) return;
      const m = isoMonth(String(t.date || ''));
      if (!m) return;
      monthTotals[m] = (monthTotals[m] || 0) + num(t.amount);
      (rowsByCat[m] = rowsByCat[m] || {});
      rowsByCat[m][cat] = (rowsByCat[m][cat] || 0) + num(t.amount);
    });
    const months = Object.keys(monthTotals).sort();
    if (!months.length || !birth) return { total: 0, cats: {}, months: 0 };
    const batches = (f.piglets || []).filter(x => birthOf(x));
    const cats = {};
    let total = 0, activeMonths = 0;
    months.forEach(m => {
      const mid = m + '-15';
      if (mid < String(birth)) return;
      const mine = headsAt(b, mid);
      const all = batches.reduce((a, x) => a + headsAt(x, mid), 0);
      if (!mine || !all) return;
      const share = mine / all;
      activeMonths++;
      Object.entries(rowsByCat[m]).forEach(([cat, amt]) => {
        const part = amt * share;
        cats[cat] = (cats[cat] || 0) + part;
        total += part;
      });
    });
    return { total, cats, months: activeMonths };
  }

  /* ── the full analysis ──────────────────────────────────────────────── */
  function analyze(batchOrId) {
    const b = typeof batchOrId === 'string' ? batchById(batchOrId) : batchOrId;
    if (!b) return null;
    const feed = feedCost(b);
    const md = medsAndDirect(b);
    const shared = sharedAllocation(b);
    const live = liveHeadsNow(b);
    const sold = ledgerSums(b.id).sum('sold') + releasedHeads(b.id);
    const denom = live > 0 ? live : Math.max(1, sold);
    const totalCost = feed.totalCost + md.medCost + md.direct + shared.total;
    const costPerHead = denom ? totalCost / denom : 0;
    return {
      batchId: b.id,
      birth: birthOf(b),
      ageDays: daysSince(birthOf(b)),
      live, sold, denom,
      feed, meds: md, shared,
      totalCost, costPerHead,
      minPrice: costPerHead,
      margin15: costPerHead * 1.15,
      suggested: Math.ceil((costPerHead * 1.15) / 5) * 5,
      warnings: feed.warnings
    };
  }

  /* ── UI: batch cost analysis panel ──────────────────────────────────── */
  function panelHTML(batchId) {
    const a = analyze(batchId);
    if (!a) return '';
    const feedRows = a.feed.rows.map(r =>
      `<tr><td>${esc(r.stage)}</td><td>${r.bags} bags</td><td>${money(r.pricePerBag)}/bag${r.src && r.src !== 'Feed Inventory' ? ' *' : ''}</td><td><b>${money(r.cost)}</b></td></tr>`).join('') ||
      '<tr><td colspan="4" class="muted">No feed consumption recorded/derived yet.</td></tr>';
    const sharedRows = Object.entries(a.shared.cats).map(([c, v]) => `<tr><td>${esc(c)} (allocated)</td><td><b>${money(v)}</b></td></tr>`).join('');
    const medRows = a.meds.medRows.slice(0, 6).map(r => `<tr><td>${esc(r.label)}</td><td><b>${money(r.cost)}</b></td></tr>`).join('');
    const directRows = a.meds.directRows.slice(0, 6).map(r => `<tr><td>${esc(r.label)}</td><td><b>${money(r.cost)}</b></td></tr>`).join('');
    return `<div class="bc-panel">
      <div class="bc-head">
        <b style="color:var(--teal2)">📊 BATCH COST ANALYSIS — ${esc(a.batchId)}</b>
        <button type="button" class="btn ghost small" onclick="window.ARSBatchCost.openBatchExpense('${esc(a.batchId)}')">＋ Record batch expense</button>
      </div>
      <small class="muted">${a.birth ? `Born ${esc(a.birth)} · ${a.ageDays} days old · ` : ''}${a.live} live now · ${a.sold} sold/released · cost ÷ ${a.denom} saleable heads</small>
      <div class="table-wrap" style="margin-top:8px"><table class="table" style="font-size:12px">
        <thead><tr><th>Feed stage</th><th>Consumed</th><th>Bag price</th><th>Cost</th></tr></thead><tbody>${feedRows}</tbody></table></div>
      <div class="table-wrap"><table class="table" style="font-size:12px"><tbody>
        <tr><td>🌾 Total feed (${a.feed.totalKg} kg)</td><td><b>${money(a.feed.totalCost)}</b></td></tr>
        ${medRows || directRows ? `${medRows}<tr><td>💊 Medicines / vaccines total</td><td><b>${money(a.meds.medCost)}</b></td></tr>` : '<tr><td>💊 Medicines / vaccines</td><td><b>' + money(0) + '</b></td></tr>'}
        ${directRows ? `<tr><td>🧾 Direct batch expenses total</td><td><b>${money(a.meds.direct)}</b></td></tr>` : ''}
        ${sharedRows ? `${sharedRows}<tr><td>🏠 Shared farm costs allocated (${a.shared.months} mo)</td><td><b>${money(a.shared.total)}</b></td></tr>` : '<tr><td>🏠 Shared farm costs allocated</td><td><b>' + money(0) + '</b></td></tr>'}
        <tr style="background:rgba(13,184,174,.12)"><td><b>TOTAL BATCH COST</b></td><td><b style="color:var(--teal2)">${money(a.totalCost)}</b></td></tr>
      </tbody></table></div>
      <div class="bc-tags">
        <span class="tag" style="background:rgba(239,68,68,.15);color:#ff8b95;font-weight:800">Production cost: ${money(a.costPerHead)}/head</span>
        <span class="tag" style="background:rgba(245,158,11,.15);color:#f0b64b;font-weight:800">Minimum profitable: ${money(Math.ceil(a.minPrice))}/head</span>
        <span class="tag ok" style="font-weight:800">Suggested (15% margin): ${money(a.suggested)}/head</span>
      </div>
      ${a.warnings.map(w => `<small class="muted" style="display:block;margin-top:4px">⚠ ${esc(w)}</small>`).join('')}
      <small class="muted" style="display:block;margin-top:4px">* price not from Feed Inventory — update it there and this analysis refreshes automatically.</small>
    </div>`;
  }

  /* ── UI: live price feedback (profit protection) ────────────────────── */
  function priceFeedback(batchId, price, qty) {
    const a = analyze(batchId);
    if (!a || !a.costPerHead) return '';
    const p = num(price), q = Math.max(1, num(qty, 1));
    if (!p) return `<small class="muted">Enter a price to see margin vs production cost (${money(a.costPerHead)}/head).</small>`;
    if (p < a.costPerHead) {
      const lossHead = a.costPerHead - p, loss = lossHead * q;
      return `<div class="notice warn" style="border:1.5px solid #ef4444;background:rgba(239,68,68,.12);padding:10px 12px;border-radius:10px;margin-top:8px">
        <b style="color:#ff8b95">⚠️ BELOW PRODUCTION COST</b>
        <small style="display:block;margin-top:4px">Estimated cost: <b>${money(a.costPerHead)}/head</b> · Selling: <b>${money(p)}/head</b><br>Estimated loss: <b style="color:#ff8b95">${money(lossHead)}/head</b> ≈ <b style="color:#ff8b95">${money(loss)}</b> for ${q} head(s).<br>Suggested: <b>${money(a.suggested)}/head</b> (15% margin).</small></div>`;
    }
    const mHead = p - a.costPerHead, contrib = mHead * q;
    return `<div class="notice" style="border:1.5px solid #22c55e;background:rgba(34,197,94,.10);padding:10px 12px;border-radius:10px;margin-top:8px">
      <b style="color:#62df99">✅ ABOVE PRODUCTION COST</b>
      <small style="display:block;margin-top:4px">Production cost: <b>${money(a.costPerHead)}/head</b> · Selling: <b>${money(p)}/head</b><br>Estimated margin: <b style="color:#62df99">${money(mHead)}/head</b> · ${q} head(s) contribute ≈ <b style="color:#62df99">${money(contrib)}</b>.</small></div>`;
  }

  function renderInto(elId, batchId) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = batchId ? panelHTML(batchId) : '';
  }

  /* ── UI: quick batch-level expense recorder ─────────────────────────── */
  function openBatchExpense(batchId) {
    document.getElementById('batchExpenseModal')?.remove();
    const cats = ['Medicine', 'Vaccine', 'Vitamin', 'Semen / Breeding', 'Electricity', 'Water', 'Labor', 'Cleaning / Disinfection', 'Transportation', 'Other'];
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="batchExpenseModal" onclick="if(event.target===this)this.remove()">
      <form class="due-modal" style="max-width:460px;width:94%" onsubmit="window.ARSBatchCost.saveBatchExpense(event,'${esc(batchId)}')">
        <div class="modal-top"><div><div class="eyebrow">BATCH EXPENSE</div><h2>Record expense — ${esc(batchId)}</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('batchExpenseModal')?.remove()">×</button></div>
        <div class="field"><label>Category</label><select name="category">${cats.map(c => `<option>${c}</option>`).join('')}</select></div>
        <div class="field"><label>Amount (₱)</label><input name="amount" type="number" min="0" step="0.01" required placeholder="e.g. 2500"></div>
        <div class="field"><label>Date</label><input name="date" type="date" value="${todayISO()}"></div>
        <div class="field"><label>Note</label><input name="note" placeholder="e.g. CSF vaccine for this batch"></div>
        <small class="muted">Saved as an Expense transaction tagged "Batch ${esc(batchId)}" so the cost engine charges it to this batch. Farm-wide bills (electricity etc.) are better recorded normally in Financials — they get auto-allocated by headcount.</small>
        <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('batchExpenseModal')?.remove()">Cancel</button><button class="btn">Save expense</button></div>
      </form></div>`);
  }

  function saveBatchExpense(e, batchId) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const f = farm(); if (!f) return;
    (f.transactions = f.transactions || []).unshift({
      id: 'tx-batchexp-' + Date.now(),
      date: d.date || todayISO(),
      type: 'Expense',
      category: d.category || 'Other',
      description: `Batch ${batchId}: ${d.note || d.category}`,
      amount: num(d.amount), paid: num(d.amount),
      created_at: new Date().toISOString()
    });
    document.getElementById('batchExpenseModal')?.remove();
    if (typeof save === 'function') save();
    if (typeof renderAll === 'function') renderAll();
    if (typeof toast === 'function') toast(`✓ ${money(num(d.amount))} expense recorded for ${batchId}`);
    renderInto('batchCostPanel', batchId);
    renderInto('editBatchCostPanel', batchId);
  }

  window.ARSBatchCost = { analyze, panelHTML, priceFeedback, renderInto, openBatchExpense, saveBatchExpense, liveHeadsNow };
})();
