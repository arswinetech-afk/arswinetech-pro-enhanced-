/* [REBUILD] Batch performance records — farm manager inputs the required litter /
   growth data once per piglet batch, and this module computes the standard swine
   production metrics (pre-weaning ADG, post-weaning ADG, overall ADG, age at
   release, total weight gain, mortality rate) plus the per-piglet ear-notch
   registry (RENN = right ear / litter number, LENN = left ear / pig number —
   Universal Ear Notching System). Results feed the Reservation Summary
   certificate (reservation-certificate.js) and the batch hub strip
   (piglet-ledger.js). */
(function() {
  const DAY_MS = 86400000;
  const batch = id => (F().piglets || []).find(x => x.id === id);
  const num = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? null : +v;
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function dayDiff(from, to) {
    if (!from || !to) return null;
    const s = String(from).slice(0, 10), t = String(to).slice(0, 10);
    const a = new Date(s + 'T00:00:00'), b = new Date(t + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / DAY_MS);
  }

  /* Manual ledger mortality entries (Record Mortality) — 'undone'/'deleted'
     transactions are excluded. Pre-weaning deaths recorded by the weaning flow
     or the performance form are kept on the batch object separately. */
  function ledgerMortality(b) {
    return (F().pigletLedger || [])
      .filter(x => x.batch_id === b.id && x.type === 'mortality' && !['undone', 'deleted'].includes(x.status))
      .reduce((a, x) => a + (+x.quantity || 0), 0);
  }

  /* [FIX M1] ADG/performance context uses the same living-headcount as the
     dashboard & ledger (sold/released excluded), not born − mortality. */
  const aliveHeadcount = b => window.liveHeadsFor ? Math.max(0, window.liveHeadsFor(b)) : Math.max(0, (+b.males || 0) + (+b.females || 0) - ledgerMortality(b));

  /* Compute the full metric set for a batch. Pass the reservation `r` when
     rendering a certificate so measured release data (weight/date) of that
     release takes priority over the batch-level averages. */
  function batchPerformance(b, r = null) {
    if (!b) return null;
    const birth = b.birth || null,
      wean = b.weaning_date || b.weanedAt || null,
      release = r && r.released_at ? String(r.released_at).slice(0, 10) : (b.release_date || null),
      birthW = num(b.birth_weight),
      weanW = num(b.weaning_weight),
      relW = r && num(r.weight) !== null ? num(r.weight) : num(b.release_weight),
      ledgerMort = ledgerMortality(b),
      prewean = num(b.prewean_deaths) || 0,
      mort = ledgerMort + prewean;
    let litter = num(b.litter_size_born_alive);
    if (litter === null) litter = num(b.total_born) || ((+b.males || 0) + (+b.females || 0) + mort) || null;

    const weanAge = dayDiff(birth, wean),
      relAge = dayDiff(birth, release),
      postSpan = dayDiff(wean, release),
      preweanAdg = (birthW !== null && weanW !== null && weanAge > 0) ? (weanW - birthW) / weanAge : null,
      postweanAdg = (weanW !== null && relW !== null && postSpan > 0) ? (relW - weanW) / postSpan : null,
      adg = (birthW !== null && relW !== null && relAge > 0) ? (relW - birthW) / relAge : null,
      gain = (birthW !== null && relW !== null) ? relW - birthW : null,
      mortRate = litter > 0 ? (mort / litter) * 100 : null;

    const g = v => v === null ? '—' : Math.round(v * 1000) + ' g/day';
    const kg = v => v === null ? '—' : v.toFixed(2) + ' kg';
    const fd = d => d ? (typeof fmtDate === 'function' ? fmtDate(d) : d) : '';
    /* Only real inputs (or recorded mortalities / statuses) count — the inferred
       litter fallback alone must not make every legacy batch show a metrics card. */
    const hasAny = [birthW, weanW, relW, num(b.litter_size_born_alive)].some(v => v !== null) || mort > 0 || b.health_status || b.vaccination_status;

    return {
      birth, wean, release, birthW, weanW, relW, litter, mort, mortRate,
      weanAge, relAge, postSpan, preweanAdg, postweanAdg, adg, gain, hasAny,
      cells: [
        ['Litter Size Born Alive', litter !== null ? litter : '—', litter !== null ? 'piglets' : ''],
        ['Birth Weight (Avg)', kg(birthW), 'per piglet'],
        ['Weaning Weight (Avg)', kg(weanW), wean && weanAge !== null ? `weaned at ${weanAge} days` : ''],
        ['Release Weight', kg(relW), release ? 'released ' + fd(release) : (r ? 'reservation weight' : '')],
        ['Total Weight Gain', kg(gain), 'birth → release'],
        ['Age at Release', relAge !== null ? relAge + ' days' : '—', relAge !== null ? (relAge / 7).toFixed(1) + ' weeks old' : ''],
        ['Average Daily Gain (ADG)', g(adg), 'birth → release'],
        ['Pre-Weaning ADG', g(preweanAdg), weanAge !== null ? weanAge + '-day lactation' : ''],
        ['Post-Weaning ADG', g(postweanAdg), postSpan !== null && postSpan > 0 ? postSpan + '-day growing period' : ''],
        ['Mortality Rate', mortRate === null ? '—' : mortRate.toFixed(1) + '%', `${mort} of ${litter ?? '—'} born alive`],
        ['Health Status', b.health_status || 'Not recorded', b.health_status ? '' : 'set in performance record'],
        ['Vaccination Status', b.vaccination_status || 'Not recorded', b.vaccines_given || (b.vaccination_status ? '' : 'set in performance record')]
      ]
    };
  }

  /* ── Ear-notch registry editor ─────────────────────────────────────── */
  const litterNo = b => (String(b.id).match(/\d+/) || [''])[0];

  function notchRow(i, sex = '', renn = '', lenn = '', rn = '', teats = '', weight = '', weights = null) {
    const teatOn = sex === 'F';
    /* [REBUILD FIX 32] manual per-piglet weight column — the kg typed here is
       averaged on save (after asking what the weighing is for) and also kept
       on the registry row per stage (birth / weaning / release). */
    const wHist = weights && Object.keys(weights).length
      ? 'Recorded: ' + Object.entries(weights).map(([k, v]) => `${k} ${v} kg`).join(' · ')
      : 'Individual kg — on save the app asks what this weighing is for and fills the average automatically';
    return `<tr data-notch-row class="notch-row"><td class="notch-no">${i}</td>` +
      `<td><select name="notch_sex" onchange="let t=this.closest('tr').querySelector('[name=notch_teats]');t.disabled=this.value!=='F';if(this.value!=='F')t.value=''"><option value="">—</option><option value="M"${sex === 'M' ? ' selected' : ''}>♂ Male</option><option value="F"${sex === 'F' ? ' selected' : ''}>♀ Female</option></select></td>` +
      `<td><input name="notch_renn" inputmode="numeric" autocomplete="off" placeholder="${esc(rn) || 'litter no.'}" value="${esc(renn)}"></td>` +
      `<td><input name="notch_lenn" inputmode="numeric" autocomplete="off" placeholder="${i}" value="${esc(lenn)}"></td>` +
      `<td><input name="notch_teats" type="number" min="0" max="30" inputmode="numeric" autocomplete="off" placeholder="♀ only" title="Number of teats (female piglets only)" value="${teatOn && teats !== '' ? esc(teats) : ''}"${teatOn ? '' : ' disabled'}></td>` +
      `<td><div class="notch-weight-cell"><input name="notch_weight" class="notch-kg" type="number" min="0" step="0.01" inputmode="decimal" autocomplete="off" placeholder="kg" title="${esc(wHist)}" data-w0="${weight === '' || weight === null ? '' : esc(weight)}" data-weights='${esc(JSON.stringify(weights || {}))}' value="${weight === '' || weight === null ? '' : esc(weight)}"><button type="button" class="btn-row-scale" onclick="window.captureRowWeight(this)" title="Capture Live Scale Weight for this Piglet">⚖</button></div></td>` +
      `<td><button type="button" class="notch-del" title="Remove row" onclick="this.closest('tr').remove();renumberNotchRows()">×</button></td></tr>`;
  }

  function notchRowsHTML(b) {
    const roster = Array.isArray(b.roster) ? b.roster : [],
      rn = litterNo(b);
    if (roster.length) return roster.map((x, i) => notchRow(i + 1, x.sex, x.renn, x.lenn, rn, x.teats ?? '', x.weight ?? '', x.weights || null)).join('');
    return generatedRows(b);
  }

  function generatedRows(b) {
    const n = aliveHeadcount(b), rn = litterNo(b);
    return Array.from({ length: n }, (_, i) => notchRow(i + 1, '', rn, String(i + 1), rn)).join('');
  }

  function renumberNotchRows() {
    document.querySelectorAll('#batchPerfModal tr[data-notch-row] .notch-no')
      .forEach((td, i) => td.textContent = i + 1);
  }

  function genNotchRows(id) {
    const b = batch(id), body = document.getElementById('notchRows');
    if (!b || !body) return;
    if (body.querySelector('tr[data-notch-row]') && !confirm(`Replace the current rows with ${aliveHeadcount(b)} auto-generated rows (RENN ${litterNo(b)}, LENN 1…${aliveHeadcount(b)})?`)) return;
    body.innerHTML = generatedRows(b) || '<tr class="notch-empty"><td colspan="7">No live piglets in this batch — add rows manually if needed.</td></tr>';
  }

  function addNotchRow() {
    const body = document.getElementById('notchRows');
    if (!body) return;
    body.querySelector('.notch-empty')?.remove();
    const b = batch(document.querySelector('#batchPerfModal [name="batch_id"]')?.value),
      rn = b ? litterNo(b) : '';
    body.insertAdjacentHTML('beforeend', notchRow(body.querySelectorAll('tr[data-notch-row]').length + 1, '', rn, '', rn));
  }

  /* ── Performance record form ───────────────────────────────────────── */
  function openBatchPerformance(id) {
    const b = batch(id);
    if (!b) return;
    const p = batchPerformance(b),
      wean = b.weaning_date || b.weanedAt || '',
      preview = p.hasAny ?
        `<div class="perf-preview"><b>Computed metrics (from saved data)</b><div class="perf-preview-grid">${[0, 9, 7, 8, 6, 3].map(i =>
          `<div><small>${p.cells[i][0]}</small><b>${p.cells[i][1]}</b></div>`).join('')}</div><small class="perf-preview-note">These update automatically after saving.</small></div>` :
        `<div class="perf-preview"><b>Computed metrics</b><p class="perf-preview-note">Fill in the record below — ADG, weight gain, age at release and mortality rate are computed automatically and printed on every reservation certificate for this batch.</p></div>`;
    setTimeout(() => window.updateScaleWidgets && window.updateScaleWidgets(), 50);
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="batchPerfModal"><form class="reminder-modal perf-modal" onsubmit="saveBatchPerformance(event)"><div class="modal-top"><h2>⚖ Batch Performance Record</h2><button type="button" class="close-reminder" onclick="document.getElementById('batchPerfModal').remove()">×</button></div><p class="perf-sub"><b>${esc(b.id)}</b> · ${esc(b.dam_name || b.sow || '—')} → ${esc(b.sire_name || b.sire || '—')} · Born ${esc(b.birth || '—')}</p><input type="hidden" name="batch_id" value="${esc(b.id)}">${preview}<div id="bleScaleWidget"></div><div class="reminder-fields"><div class="field"><label>Litter Size Born Alive</label><input name="litter_size_born_alive" type="number" min="0" value="${num(b.litter_size_born_alive) ?? p.litter ?? ''}"></div><div class="field"><label>Pre-Weaning Deaths</label><input name="prewean_deaths" type="number" min="0" value="${num(b.prewean_deaths) ?? 0}"><small class="field-hint">Deaths before weaning · post-weaning deaths use “Record Mortality”</small></div><div class="field"><div class="field-head-split"><label>Birth Weight — avg kg / piglet</label><button type="button" class="btn-scale-fill" onclick="window.captureWeightIntoField('birth_weight')">⚖️ Capture Scale</button></div><input name="birth_weight" type="number" min="0" step="0.01" placeholder="e.g. 1.40" value="${num(b.birth_weight) ?? ''}"></div><div class="field"><label>Weaning Date</label><input name="weaning_date" type="date" value="${esc(wean)}"></div><div class="field"><div class="field-head-split"><label>Weaning Weight — avg kg / piglet</label><button type="button" class="btn-scale-fill" onclick="window.captureWeightIntoField('weaning_weight')">⚖️ Capture Scale</button></div><input name="weaning_weight" type="number" min="0" step="0.01" placeholder="e.g. 8.40" value="${num(b.weaning_weight) ?? ''}"></div><div class="field"><label>Release Date (actual or target)</label><input name="release_date" type="date" value="${esc(b.release_date || '')}"></div><div class="field"><div class="field-head-split"><label>Release Weight — avg kg / piglet</label><button type="button" class="btn-scale-fill" onclick="window.captureWeightIntoField('release_weight')">⚖️ Capture Scale</button></div><input name="release_weight" type="number" min="0" step="0.01" placeholder="e.g. 24.00" value="${num(b.release_weight) ?? ''}"></div><div class="field"><label>Health Status</label><select name="health_status">${['', 'Healthy', 'Under Observation', 'Under Treatment', 'Recovered'].map(v => `<option value="${v}"${(b.health_status || '') === v ? ' selected' : ''}>${v || 'Select…'}</option>`).join('')}</select></div><div class="field"><label>Vaccination Status</label><select name="vaccination_status">${['', 'Up to date', 'In progress', 'Not started'].map(v => `<option value="${v}"${(b.vaccination_status || '') === v ? ' selected' : ''}>${v || 'Select…'}</option>`).join('')}</select></div><div class="field full"><label>Vaccines Given (name · date)</label><input name="vaccines_given" placeholder="e.g. Hog Cholera 2026-06-20 · Mycoplasma 2026-07-01" value="${esc(b.vaccines_given || '')}"></div><div class="field full"><label>Performance Notes</label><textarea name="perf_notes" placeholder="Optional health, medication or conditioning notes">${esc(b.perf_notes || '')}</textarea></div><div class="field full"><label>Ear Notch Registry <small class="field-hint">RENN = right ear (litter number) · LENN = left ear (pig number) · Teats = female piglets only, auto-enables when Sex = ♀ · <b>Weight kg</b> = per-piglet weigh-in — on Save the app asks what it is for (Birth / Weaning / Release) and fills that average automatically</small></label><div id="notchScaleBar" class="notch-scale-bar disconnected"></div><div class="notch-wrap"><table class="notch-table"><thead><tr><th>#</th><th>Sex</th><th>RENN (Right Ear)</th><th>LENN (Left Ear)</th><th>Teats ♀</th><th>Weight kg (Live ⚖)</th><th></th></tr></thead><tbody id="notchRows">${notchRowsHTML(b) || '<tr class="notch-empty"><td colspan="7">No piglets recorded in this batch yet.</td></tr>'}</tbody></table></div><div class="notch-actions"><button type="button" class="btn ghost" onclick="genNotchRows('${escJS(b.id)}')">↻ Auto-generate from headcount</button><button type="button" class="btn ghost" onclick="addNotchRow()">+ Add piglet row</button></div></div></div><div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('batchPerfModal').remove()">Cancel</button><button class="btn">Save performance record</button></div></form></div>`);
    renumberNotchRows();
  }

  /* ═════════ [REBUILD FIX 32] per-piglet weigh-in → metric averages ═════════
     The registry gained a "Weight kg" column for manual individual piglet
     weights. On Save, any weight that is NEW or CHANGED since the form opened
     (diffed against data-w0) triggers a chooser asking what the weighing is
     for — Birth / Weaning / Release. The chosen average is written to the
     matching "avg kg / piglet" metric field (the system-wide source of truth:
     ADG, weight gain, age at release, reservation certificates, batch hub),
     and each weight is also archived on its registry row under that stage. */
  const W_STAGES = { birth: 'Birth Weight', weaning: 'Weaning Weight', release: 'Release Weight' };
  const W_FIELD = { birth: 'birth_weight', weaning: 'weaning_weight', release: 'release_weight' };

  function typedWeights(form) { /* new or changed kg entries since the form opened */
    return [...form.querySelectorAll('tr[data-notch-row]')].map((tr, ri) => {
      const inp = tr.querySelector('[name="notch_weight"]');
      if (!inp) return null;
      const v = num(inp.value);
      if (v === null || v <= 0 || String(inp.value.trim()) === String(inp.dataset.w0 ?? '')) return null;
      return { ri, kg: v };
    }).filter(Boolean);
  }

  function buildRoster(form, stage = null, typed = []) {
    const byRow = new Map(typed.map(t => [t.ri, t.kg]));
    return [...form.querySelectorAll('tr[data-notch-row]')].map((tr, ri) => {
      const sex = tr.querySelector('[name="notch_sex"]')?.value || '',
        teats = num(tr.querySelector('[name="notch_teats"]')?.value),
        wIn = tr.querySelector('[name="notch_weight"]');
      let weights = {};
      try { weights = JSON.parse(wIn?.dataset.weights || '{}') || {}; } catch (e2) { weights = {}; }
      if (stage && byRow.has(ri)) weights[stage] = byRow.get(ri); /* FIX 32: archive under the confirmed stage */
      const wv = wIn ? num(wIn.value) : null;
      const row = {
        sex,
        renn: (tr.querySelector('[name="notch_renn"]')?.value || '').trim(),
        lenn: (tr.querySelector('[name="notch_lenn"]')?.value || '').trim(),
        teats: sex === 'F' && teats !== null ? teats : '',
        weight: wv !== null && wv > 0 ? wv : ''
      };
      if (Object.keys(weights).length) row.weights = weights;
      return row;
    }).filter(x => x.sex || x.renn || x.lenn || x.weight !== '');
  }

  function openWeightStagePrompt(form, d, typed) {
    const b = batch(d.batch_id);
    if (!b) return;
    const total = Math.round(typed.reduce((a, t) => a + t.kg, 0) * 100) / 100,
      avg = Math.round(total / typed.length * 100) / 100;
    const weanSet = !!(d.weaning_date || b.weaning_date || b.weanedAt || b.weaning),
      relSet = !!(d.release_date || b.release_date),
      sug = relSet ? 'release' : (weanSet ? 'weaning' : 'birth'), /* sensible default from the batch's lifecycle */
      cur = s => { const v = num(b[W_FIELD[s]]); return v !== null ? `currently ${v} kg` : 'not set yet'; };
    document.getElementById('weightStagePrompt')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="weightStagePrompt"><div class="reminder-modal perf-modal weight-stage-modal">
      <div class="modal-top"><div><div class="eyebrow">PER-PIGLET WEIGH-IN</div><h2>⚖ What are these weights for?</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('weightStagePrompt').remove()">×</button></div>
      <p class="perf-sub">${typed.length} piglet weight(s) · total <b>${total} kg</b> · average <b>${avg} kg</b></p>
      <p class="muted wstage-note">Each weight is kept on its own registry row (hover the kg field later to see the recorded stages). The <b>average</b> is written to the metric you pick below, so ADG, weight gain, age at release and every reservation certificate for this batch use the individual measurements — not a guess.</p>
      ${Object.keys(W_STAGES).map(s => `<label class="wstage-opt"><input type="radio" name="wstage" value="${s}"${s === sug ? ' checked' : ''}><span><b>${W_STAGES[s]}</b> — avg kg / piglet<small>${cur(s)}${num(d[W_FIELD[s]]) !== null && num(d[W_FIELD[s]]) !== avg ? ` · the form also has ${num(d[W_FIELD[s]])} kg — the piglet average (${avg} kg) replaces it` : ''}</small></span></label>`).join('')}
      <div class="due-actions" style="margin-top:14px"><button type="button" class="btn ghost" onclick="document.getElementById('weightStagePrompt').remove()">Back to the record</button><button type="button" class="btn" onclick="confirmWeightStage()">✔ Save as this weight</button></div>
    </div></div>`);
    window.__perfWeigh = { form, d, typed, avg }; /* hand-off across the IIFE boundary for the confirm button */
  }

  function confirmWeightStage() {
    const ctx = window.__perfWeigh;
    if (!ctx) return;
    const stage = document.querySelector('#weightStagePrompt [name="wstage"]:checked')?.value || 'birth',
      b = batch(ctx.d.batch_id);
    document.getElementById('weightStagePrompt')?.remove();
    window.__perfWeigh = null;
    if (!b) return;
    finishPerfSave(b, ctx.d, ctx.form, { stage, avg: ctx.avg, typed: ctx.typed });
  }

  function saveBatchPerformance(e) {
    e.preventDefault();
    const form = e.target,
      d = Object.fromEntries(new FormData(form)),
      b = batch(d.batch_id);
    if (!b) return;
    const typed = typedWeights(form);
    if (typed.length) { openWeightStagePrompt(form, d, typed); return; } /* FIX 32: ask what the weights are for first */
    finishPerfSave(b, d, form, null);
  }

  function finishPerfSave(b, d, form, weigh = null) {
    b.litter_size_born_alive = num(d.litter_size_born_alive);
    b.prewean_deaths = num(d.prewean_deaths) || 0;
    b.birth_weight = num(d.birth_weight);
    if (d.weaning_date) {
      b.weaning_date = d.weaning_date;
      b.weanedAt = d.weaning_date;
      b.weaning = true;
    }
    b.weaning_weight = num(d.weaning_weight);
    b.release_date = d.release_date || null;
    b.release_weight = num(d.release_weight);
    b.health_status = d.health_status || '';
    b.vaccination_status = d.vaccination_status || '';
    b.vaccines_given = d.vaccines_given || '';
    b.perf_notes = d.perf_notes || '';
    b.roster = buildRoster(form, weigh && weigh.stage, weigh ? weigh.typed : []); /* FIX 32 */
    if (weigh) b[W_FIELD[weigh.stage]] = weigh.avg; /* FIX 32: the average of the individual piglet weights becomes the metric */
    save();
    document.getElementById('batchPerfModal')?.remove();
    document.getElementById('batchHub')?.remove();
    if (window.openBatchLedger) openBatchLedger(b.id);
    if (typeof renderAll === 'function') renderAll();
    toast(`Performance record saved for ${b.id}` + (weigh ? ` · ${W_STAGES[weigh.stage]} avg ${weigh.avg} kg from ${weigh.typed.length} piglet(s)` : '')); /* FIX 32 */
  }

  window.batchPerformance = batchPerformance;
  window.openBatchPerformance = openBatchPerformance;
  window.saveBatchPerformance = saveBatchPerformance;
  window.confirmWeightStage = confirmWeightStage; /* FIX 32 */
  window.genNotchRows = genNotchRows;
  window.addNotchRow = addNotchRow;
  window.renumberNotchRows = renumberNotchRows;
})();

window.captureRowWeight = function(btn) {
  const row = btn.closest('tr');
  const input = row ? row.querySelector('input[name="notch_weight"]') : null;
  const scale = window.getScaleState ? window.getScaleState() : null;
  if (!scale || scale.liveWeight === null) {
    if (window.toast) window.toast('Connect scale or enter weight manually.');
    return;
  }
  if (input) {
    input.value = scale.liveWeight.toFixed(2);
    row.classList.add('auto-weighed-success');
    setTimeout(() => row.classList.remove('auto-weighed-success'), 800);
    if (window.toast) window.toast('✓ Captured ' + scale.liveWeight.toFixed(2) + ' kg for Piglet #' + (row.querySelector('.notch-no')?.textContent || ''));
  }
};
