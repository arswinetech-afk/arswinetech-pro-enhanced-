/* [REBUILD FEATURE] Feeding Guide Program (js/feeding-guide.js).
   Rendered at the top of the Feed Inventory page. Auto-counts the herd
   (sows excluding Culled, active registry boars, piglet batches), applies the
   farm's transition cycles, and projects the required bags per feed type for
   the next 30 days — then subtracts current stock to produce an order list.
     SOWS      Open / Heat / Reheat / Inseminated / Pregnant eat GESTATING feed;
               on day 110 after insemination a sow transitions to LACTATING
               feed (sows already lactating stay on it). kg/day/head per ration
               is set by the manager; transitions inside the 30-day window are
               split day-by-day.
     BOARS     manager picks one feed type + kg/head/day for all active boars.
     BATCHES   Pre Starter → Starter → Grower → Finisher. The manager defines
               how many bags per batch each stage should consume before the
               batch transitions, typical days per stage, and manually updates
               "bags already consumed" per batch — the 30-day projection walks
               each batch forward at that stage's planned rate.
   Configuration lives in F().feedPlan. */
(function () {
  const HORIZON = 30;        /* projection window, days */
  const TRANSITION_DAY = 110; /* gestating → lactating switch, days since AI */
  const STAGES = [['preStarter', 'Pre Starter'], ['starter', 'Starter'], ['grower', 'Grower'], ['finisher', 'Finisher']];
  /* [REBUILD FIX 35] stage-planner search: remembered across renderAll so the
     filter stays applied after a "consumed bags" save re-renders the page. */
  let lastQuery = '';

  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsq = v => "'" + String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + "'";
  const num = (v, d = null) => (v === null || v === undefined || v === '' || isNaN(+v)) ? d : +v;
  const bagKg = t => {
    const o = (F().feedPlan && F().feedPlan.bagKg) || {};
    const key = Object.keys(o).find(k => k.toLowerCase() === String(t).toLowerCase());
    if (key && num(o[key])) return num(o[key]);
    return String(t).toLowerCase() === 'pre starter' ? 25 : 50;
  };
  const stockOf = t => {
    const f = (F().feed || []).find(x => String(x.type).toLowerCase() === String(t).toLowerCase());
    return f ? +f.bags || 0 : 0;
  };
  const feedTypes = () => {
    const s = new Set((F().feed || []).map(x => x.type).concat(STAGES.map(x => x[1]), ['Gestating', 'Lactating']));
    return [...s];
  };

  /* [REBUILD FIX 17] stage plan is bags PER HEAD (multiplying by each batch's
     live headcount gives the batch's plan bags before transition). stageDays is
     unchanged. Legacy per-batch configs are reset to the per-head defaults once. */
  const defaults = () => ({
    configured: false, stageModel: 'perHead', sowGestKg: 2.5, sowLactKg: 3.0,
    boarFeedType: 'Gestating', boarKg: 2.0,
    stageBags: { preStarter: 0.8, starter: 1.2, grower: 2.0, finisher: 3.0 },
    stageDays: { preStarter: 28, starter: 28, grower: 35, finisher: 45 },
    bagKg: {}, batches: {}
  });
  const plan = () => {
    const p = (F().feedPlan || defaults());
    if (p.configured && p.stageModel !== 'perHead') {
      p.stageModel = 'perHead';
      p.stageBags = Object.assign({}, defaults().stageBags);
      F().feedPlan = p;
      save();
    }
    return p;
  };


  /* [FIX PREDICTOR CONSISTENCY] Age-derived stage progress.
     A batch with NO manual "consumed bags" entries used to start at Pre Starter
     no matter how old it really is, so grower/finisher demand was massively
     under-stated (the guide said "on Pre Starter" for 100-day-old pigs). When
     the manager has not entered consumption for a batch, derive it from the
     batch's real age and the configured stage durations instead. */
  function deriveConsumedFromAge(ageDays, heads, p) {
    const out = {};
    let remaining = Math.max(0, +(ageDays || 0));
    STAGES.forEach(([key]) => {
      const perHead = num((p.stageBags || {})[key], 0);
      const sd = Math.max(1, num((p.stageDays || {})[key], 28));
      const pb = perHead * heads;
      const day = Math.max(0, Math.min(remaining, sd));
      out[key] = +(pb * (sd > 0 ? day / sd : 0)).toFixed(2);
      remaining = Math.max(0, remaining - sd);
    });
    return out;
  }
  /* consumed source for a batch: manual entries when present, else age-derived */
  function batchConsumed(p, b, heads) {
    const saved = (p.batches || {})[b.id] || {};
    const cons = saved.consumed || {};
    const hasManual = Boolean(saved.updated) || Object.values(cons).some(v => (+v || 0) > 0);
    const age = b.birth ? days(b.birth) : null;
    if (hasManual) return { used: cons, ageDerived: false };
    if (age === null) return { used: cons, ageDerived: false };
    return { used: deriveConsumedFromAge(age, heads, p), ageDerived: true };
  }

  /* ── required-bags engine ─────────────────────────────────────────── */
  function computeFeedPlan(days_) {
    /* [REBUILD FIX 50] optional horizon (days) — the dashboard "feed runs short
       this week" chip reuses this exact engine with a 7-day window. */
    const HZ = Math.max(1, num(days_, HORIZON) || HORIZON);
    const p = plan(), req = {}; /* feedType -> bags (float) */
    const add = (t, bags) => { if (bags > 0) req[t] = (+req[t] || 0) + bags; };

    /* Sows — count active, split each sow's 30 days by her 110-day transition. */
    const act = (F().sows || []).filter(isActiveSow),
      rows = [];
    let gDays = 0, lDays = 0, lactNow = 0, gestNow = 0, trans = 0;
    act.forEach(s => {
      const st = status(s);
      let g = HZ, l = 0;
      const lactating = st === 'Lactating';
      if (lactating) { g = 0; l = HZ; }
      else if (s.insemination) {
        const d = days(s.insemination);
        if (d >= TRANSITION_DAY) { g = 0; l = HZ; }
        else if (HZ > TRANSITION_DAY - d) { g = TRANSITION_DAY - d; l = HZ - g; }
      }
      if (l > 0 && g > 0) trans++;
      if (g > 0) gestNow++; if (l > 0) lactNow++;
      gDays += g; lDays += l;
      rows.push({ name: s.name, id: s.id, st, g, l });
    });
    const gestKg = gDays * num(p.sowGestKg, 0), lactKg = lDays * num(p.sowLactKg, 0);
    add('Gestating', gestKg / bagKg('Gestating'));
    add('Lactating', lactKg / bagKg('Lactating'));
    const sowSec = {
      total: act.length, culled: (F().sows || []).length - act.length,
      gestNow, lactNow, trans, gDays, lDays, gestKg, lactKg,
      gestBags: gestKg / bagKg('Gestating'), lactBags: lactKg / bagKg('Lactating'),
      rows
    };

    /* Boars — active registry boars on one ration. */
    const boarsActive = (F().boars || []).filter(b => String(b.status || 'Active') === 'Active').length,
      boarKgTotal = boarsActive * num(p.boarKg, 0) * HZ,
      boarBags = boarKgTotal / bagKg(p.boarFeedType || 'Gestating');
    add(p.boarFeedType || 'Gestating', boarBags);
    const boarSec = { active: boarsActive, type: p.boarFeedType || 'Gestating', kg: boarKgTotal, bags: boarBags };

    /* Piglet batches — walk each stage's plan at planBags/stageDays per day.
       [REBUILD FIX 24] archived batches are excluded from the feed plan —
       they no longer count in the order projection. */
    const batchSec = [];
    (F().piglets || []).filter(b => !b.archived).forEach(b => {
      /* [FIX M1] live headcount from the authoritative ledger engine
         (sold/released heads are no longer fed in the plan). */
      const heads = window.liveHeadsFor ? Math.max(0, window.liveHeadsFor(b)) : Math.max(0, (+b.males || 0) + (+b.females || 0) -
        (F().pigletLedger || []).filter(x => x.batch_id === b.id && x.type === 'mortality' && !['undone', 'deleted'].includes(x.status)).reduce((a, x) => a + (+x.quantity || 0), 0)),
        _cons = batchConsumed(p, b, heads),
        cons = _cons.used,
        ageDerived = _cons.ageDerived,
        stageData = STAGES.map(([key, label]) => {
          /* plan bags for THIS batch = alive heads × the per-head stage plan */
          const perHead = num((p.stageBags || {})[key], 0),
            pb = +(perHead * heads).toFixed(2),
            sd = Math.max(1, num((p.stageDays || {})[key], 30)),
            used = Math.max(0, num(cons[key], 0)), rem = Math.max(0, pb - used);
          return { key, label, pb, perHead, sd, used, rem, rate: sd > 0 ? pb / sd : 0 };
        });
      let curIdx = stageData.findIndex(x => x.rem > 0);
      const sb = {};
      if (curIdx !== -1 && num(p.stageBags && p.stageBags[stageData[curIdx].key], 0) > 0) {
        let dLeft = HZ;
        for (let i = curIdx; i < stageData.length && dLeft > 0.0001; i++) {
          const s = stageData[i];
          if (s.pb <= 0) continue;
          const budget = i === curIdx ? s.rem : s.pb;
          const use = Math.min(budget, s.rate * dLeft);
          if (use > 0) { sb[s.key] = (sb[s.key] || 0) + use; add(s.label, use); dLeft -= use / (s.rate || Infinity); }
        }
      }
      const curStage = curIdx === -1 ? null : stageData[curIdx];
      batchSec.push({
        id: b.id, dam: b.dam_name || b.sow || '—', heads, age: b.birth ? days(b.birth) : null,
        stage: curStage ? curStage.label : null, stages: stageData,
        req: sb, done: curIdx === -1, ageDerived: Boolean(ageDerived)
      });
    });

    /* Order analysis vs current stock. */
    const types = {};
    Object.keys(req).forEach(t => {
      const stock = stockOf(t);
      types[t] = { req: req[t], stock, order: Math.max(0, Math.ceil(req[t] - stock)), kg: bagKg(t) };
    });
    /* Also list stocked types with zero requirement so the table is complete. */
    (F().feed || []).forEach(f => { if (!types[f.type]) types[f.type] = { req: 0, stock: +f.bags || 0, order: 0, kg: bagKg(f.type) }; });
    const totalOrder = Object.values(types).reduce((a, x) => a + x.order, 0),
      totalReq = Object.values(types).reduce((a, x) => a + x.req, 0);
    return { req: types, sowSec, boarSec, batchSec, totalOrder, totalReq };
  }

  /* ── panel on the Feed Inventory page ─────────────────────────────── */
  /* [REBUILD FIX 30] per-batch feed chip for the live piglet batch rows
     (piglets page + drill-down): current stage + the next-30-day need,
     computed with the very same stage math as the feeding plan. */
  function batchFeedChip(b) {
    const p = plan();
    if (!p.configured || !b || b.archived) return null;
    /* [FIX M1] live headcount from the authoritative ledger engine (sold/released heads are no longer fed in the plan). */
      const heads = window.liveHeadsFor ? Math.max(0, window.liveHeadsFor(b)) : Math.max(0, (+b.males || 0) + (+b.females || 0) -
        (F().pigletLedger || []).filter(x => x.batch_id === b.id && x.type === 'mortality' && !['undone', 'deleted'].includes(x.status)).reduce((a, x) => a + (+x.quantity || 0), 0));
    if (heads <= 0) return null;
    const _cc = batchConsumed(p, b, heads),
      cons = _cc.used,
      stageData = STAGES.map(([key, label]) => {
        const perHead = num((p.stageBags || {})[key], 0),
          pb = +(perHead * heads).toFixed(2),
          sd = Math.max(1, num((p.stageDays || {})[key], 30)),
          used = Math.max(0, num(cons[key], 0)), rem = Math.max(0, pb - used);
        return { key, label, pb, sd, rem, rate: sd > 0 ? pb / sd : 0 };
      }),
      curIdx = stageData.findIndex(x => x.rem > 0);
    if (curIdx === -1) return { stage: null, chips: '', complete: true };
    const need = {};
    let dLeft = HORIZON;
    for (let i = curIdx; i < stageData.length && dLeft > 0.0001; i++) {
      const s = stageData[i];
      if (s.pb <= 0) continue;
      const budget = i === curIdx ? s.rem : s.pb,
        use = Math.min(budget, s.rate * dLeft);
      if (use > 0) {
        need[s.label] = (need[s.label] || 0) + use;
        dLeft -= use / (s.rate || Infinity);
      }
    }
    const chips = curIdx !== -1 && num(p.stageBags && p.stageBags[stageData[curIdx].key], 0) > 0
      ? Object.entries(need).map(([l, v]) => `${l}: ${v.toFixed(1)} bags`).join(' · ')
      : '';
    return { stage: stageData[curIdx].label, chips, complete: false }
  }
  window.batchFeedChip = batchFeedChip;

  function feedGuidePanel() {
    if (!F()) return '';
    const p = plan();
    if (!p.configured) {
      return `<div class="panel fg-panel"><div class="fg-head"><div><div class="eyebrow">🌾 FEEDING GUIDE PROGRAM</div><h2>Plan the next ${HORIZON} days of feed</h2><p class="muted">Counts your active sows, boars and piglet batches, applies the ${TRANSITION_DAY}-day sow transition and per-batch feed stages, then tells you exactly how many bags of each feed to order.</p></div><button class="btn" onclick="openFeedPlanConfig()">⚙ Set up feeding guide</button></div></div>`;
    }
    const c = computeFeedPlan(), s = c.sowSec;
    const typeRows = Object.keys(c.req).sort((a, b) => c.req[b].req - c.req[a].req).map(t => {
      const r = c.req[t];
      return `<tr><td><b>${esc(t)}</b><br><small class="muted">${r.kg} kg/bag</small></td><td>${r.req ? r.req.toFixed(1) : '0'}</td><td>${r.stock}</td><td><b class="${r.order ? 'fg-need' : 'fg-ok'}">${r.order ? 'Order ' + r.order : '✓ covered'}</b></td></tr>`;
    }).join('');
    const sowList = s.rows.map(r => `<div class="summary-row"><span><b>${esc(r.name)}</b> <small class="muted">${esc(r.st)}</small><br><small class="muted">${r.g > 0 && r.l > 0 ? 'switches to lactating feed in ' + r.g + ' days' : r.l ? 'lactating feed' : 'gestating feed'}</small></span><b style="font-size:12px">${r.g ? r.g + 'd gest' : ''}${r.g && r.l ? ' + ' : ''}${r.l ? r.l + 'd lact' : ''}</b></div>`).join('');
    /* [REBUILD FIX 35] search filter: pre-apply lastQuery at render so the
       filtered list survives the re-render triggered by every save. */
    const sq = String(lastQuery || '').trim().toLowerCase();
    let shownN = 0;
    const batchRows = c.batchSec.map(x => {
      const hay = (x.id + ' ' + (x.dam || '')).toLowerCase(),
        showBatch = !sq || hay.includes(sq);
      if (showBatch) shownN++;
      const consInputs = STAGES.map(([key, label]) => {
        const sd = x.stages.find(z => z.key === key);
        return `<div class="fg-cons"><small>${label}</small><span><input data-fgc="${key}" type="number" min="0" step="0.5" value="${sd.used}" inputmode="decimal"><b>/ ${sd.pb}</b></span><small class="fg-perhead" title="Plan = ${sd.perHead} bags/head × ${x.heads} heads">${sd.perHead}/hd</small></div>`;
      }).join('');
      const chips = STAGES.filter(([k]) => x.req[k] > 0).map(([k, label]) => `<span class="tag">${label}: ${x.req[k].toFixed(1)} bags</span>`).join('');
      const prog = STAGES.map(([k, label]) => { const sd = x.stages.find(z => z.key === k); return sd.rem <= 0 && sd.pb > 0 ? label : null; }).filter(Boolean);
      return `<div class="fg-batch" data-search="${esc(hay)}"${showBatch ? '' : ' style="display:none"'}><div class="fg-batch-top"><div><b>${esc(x.id)}</b> <span class="muted">${esc(x.dam)} · ${x.heads} head${x.age !== null ? ' · ' + x.age + ' days' : ''}</span></div>${x.done ? '<span class="tag">PLAN COMPLETE · MARKET READY</span>' : `<span class="tag ${x.stage ? 'warn' : 'dark'}">${x.stage ? 'on ' + x.stage : '—'}</span>`}</div>
        ${chips ? `<div class="fg-chips">next ${HORIZON}d: ${chips}</div>` : `<div class="muted" style="font-size:12px;margin:6px 0">Nothing required in the next ${HORIZON} days at the current stage progress.</div>`}
        ${prog.length ? `<small class="muted">finished: ${prog.join(', ')}</small>` : ''}
        <div class="fg-cons-grid">${consInputs}</div>
        <button class="btn ghost" onclick="saveBatchConsumption(${jsq(x.id)},this)">💾 Update consumed bags</button></div>`;
    }).join('') || '<div class="empty">No piglet batches on record.</div>';
    return `<div class="panel fg-panel">
      <div class="fg-head"><div><div class="eyebrow">🌾 FEEDING GUIDE PROGRAM</div><h2>${HORIZON}-day requirement: ${c.totalReq.toFixed(1)} bags · order ${c.totalOrder}</h2><p class="muted">${s.total} active sows${s.culled ? ' (' + s.culled + ' culled excluded)' : ''} · ${c.boarSec.active} active boars · ${c.batchSec.length} batches</p></div><button class="btn ghost" onclick="openFeedPlanConfig()">⚙ Guide settings</button></div>
      <div class="table-wrap"><table class="table fg-table"><thead><tr><th>Feed type</th><th>Needed (${HORIZON}d)</th><th>On hand</th><th>To order</th></tr></thead><tbody>${typeRows}</tbody></table></div>
      <details class="fg-sec" open><summary>🐷 Sows — gestating & lactating rations</summary>
        <p class="muted">Open / in-heat / reheat / gestating sows eat <b>Gestating feed</b>; a sow switches to <b>Lactating feed</b> on day ${TRANSITION_DAY} after insemination. ${s.trans ? `<b>${s.trans}</b> sow${s.trans > 1 ? 's' : ''} switch inside this window — their ${HORIZON} days are split between both rations.` : 'No sow switches ration inside this window.'}</p>
        <div class="fg-two"><div class="fg-mini"><small>GESTATING FEED</small><b>${s.gestBags.toFixed(1)} bags</b><span>${s.gestKg.toFixed(0)} kg · ${s.gestNow} sow${s.gestNow === 1 ? '' : 's'} · ${num(p.sowGestKg)} kg/head/day for ${s.gDays} sow-days</span></div><div class="fg-mini"><small>LACTATING FEED</small><b>${s.lactBags.toFixed(1)} bags</b><span>${s.lactKg.toFixed(0)} kg · ${s.lactNow} sow${s.lactNow === 1 ? '' : 's'} · ${num(p.sowLactKg)} kg/head/day for ${s.lDays} sow-days</span></div></div>
        ${sowList}
      </details>
      <details class="fg-sec" open><summary>♂ Boars — single ration</summary>
        ${c.boarSec.active ? `<p class="muted">${c.boarSec.active} active boar${c.boarSec.active > 1 ? 's' : ''} × ${num(p.boarKg)} kg/head/day × ${HORIZON} days on <b>${esc(c.boarSec.type)}</b>.</p><div class="fg-two"><div class="fg-mini"><small>${esc(c.boarSec.type).toUpperCase()} (BOARS)</small><b>${c.boarSec.bags.toFixed(1)} bags</b><span>${c.boarSec.kg.toFixed(0)} kg over ${HORIZON} days</span></div></div>` : '<p class="muted">No active boars in the registry — register boars on the Boar Semen page to plan their ration.</p>'}
      </details>
      <details class="fg-sec" open id="fgStagePlanner"><summary>🐖 Piglet batches — stage planner <small class="muted">(update consumed bags manually)</small></summary>
        <p class="muted">Each batch eats <b>Pre Starter → Starter → Grower → Finisher</b>. The guide projects the next ${HORIZON} days from the plan (${num((p.stageBags || {}).preStarter)}/${num((p.stageBags || {}).starter)}/${num((p.stageBags || {}).grower)}/${num((p.stageBags || {}).finisher)} bags <b>per head</b> per stage, scaled to each batch's live headcount) and your manual "consumed" updates.</p>
        <input id="fgSearch" class="fg-search" type="search" inputmode="search" autocomplete="off"
          placeholder="🔍 Search batch or dam to update…" value="${esc(lastQuery || '')}" oninput="filterStagePlanner(this.value)">
        <small class="muted fg-matchnote"${sq && c.batchSec.length ? '' : ' style="display:none"'}>${sq && c.batchSec.length ? ('Showing ' + shownN + ' of ' + c.batchSec.length + ' batches') : ''}</small>
        <div class="empty fg-nomatch"${sq && c.batchSec.length && !shownN ? '' : ' style="display:none"'}>No batch matches "${esc(sq)}".</div>
        ${batchRows}
      </details>
    </div>`;
  }

  /* ── configuration modal ──────────────────────────────────────────── */
  function openFeedPlanConfig() {
    const p = plan(), types = feedTypes();
    const tOpts = sel => types.map(t => `<option value="${esc(t)}"${t === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');
    const bagRows = types.map(t => `<div class="fg-bagrow"><span>${esc(t)}</span><input data-bagkg="${esc(t)}" type="number" min="1" step="1" value="${bagKg(t)}" inputmode="numeric"><b>kg/bag</b></div>`).join('');
    document.getElementById('feedPlanModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="feedPlanModal"><form class="reminder-modal fg-modal" onsubmit="saveFeedPlanConfig(event)">
      <div class="modal-top"><h2>🌾 Feeding guide settings</h2><button type="button" class="close-reminder" onclick="document.getElementById('feedPlanModal').remove()">×</button></div>
      <div class="reminder-fields">
        <div class="field full"><label class="fg-lab">🐷 Sows (counted automatically, culled excluded)</label>
          <div class="fc-g2"><div class="field"><label>Gestating ration — kg/head/day</label><input name="sowGestKg" type="number" min="0" step="0.1" value="${num(p.sowGestKg)}"></div>
          <div class="field"><label>Lactating ration — kg/head/day</label><input name="sowLactKg" type="number" min="0" step="0.1" value="${num(p.sowLactKg)}"></div></div>
          <small class="muted">Gestating/open sows eat gestating feed; each sow switches to the lactating ration on day ${TRANSITION_DAY} after insemination.</small></div>
        <div class="field full"><label class="fg-lab">♂ Boars</label>
          <div class="fc-g2"><div class="field"><label>Feed type</label><select name="boarFeedType">${tOpts(p.boarFeedType)}</select></div>
          <div class="field"><label>kg/head/day</label><input name="boarKg" type="number" min="0" step="0.1" value="${num(p.boarKg)}"></div></div></div>
        <div class="field full"><label class="fg-lab">🐖 Piglet batch stages — bags ONE PIGLET (head) eats before the batch moves to the next feed (and typical days per stage)</label>
          ${STAGES.map(([key, label]) => `<div class="fg-stage-row"><b>${label}</b>
            <span><input name="sb_${key}" type="number" min="0" step="0.05" value="${num((p.stageBags || {})[key])}"><small>bags/head</small></span>
            <span><input name="sd_${key}" type="number" min="1" step="1" value="${num((p.stageDays || {})[key])}"><small>days/stage</small></span></div>`).join('')}
          <small class="muted">The system multiplies this by each batch's live headcount: 0.8 bags/head × 10 heads = 8 bags of Pre Starter, then the batch moves to Starter. You update "bags already consumed" per batch — the guide projects the next ${HORIZON} days from there.</small></div>
        <div class="field full"><label class="fg-lab">⚖ Bag weights (kg per bag)</label>${bagRows}</div>
      </div>
      <div class="form-error" id="feedPlanError"></div>
      <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('feedPlanModal').remove()">Cancel</button><button class="btn">Save feeding guide</button></div>
    </form></div>`);
  }
  async function saveFeedPlanConfig(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target)), err = document.getElementById('feedPlanError');
    const bad = ['sowGestKg', 'sowLactKg', 'boarKg'].some(k => num(d[k], -1) < 0);
    if (bad) { err.textContent = 'Daily rations must be 0 or more.'; err.classList.add('show'); return; }
    const p = Object.assign(defaults(), F().feedPlan || {}, { configured: true, stageModel: 'perHead' });
    p.sowGestKg = num(d.sowGestKg, p.sowGestKg);
    p.sowLactKg = num(d.sowLactKg, p.sowLactKg);
    p.boarFeedType = d.boarFeedType || p.boarFeedType;
    p.boarKg = num(d.boarKg, p.boarKg);
    p.stageBags = {}; p.stageDays = {};
    STAGES.forEach(([key]) => { p.stageBags[key] = Math.max(0, num(d['sb_' + key], 0)); p.stageDays[key] = Math.max(1, num(d['sd_' + key], 30)); });
    p.bagKg = {};
    document.querySelectorAll('#feedPlanModal [data-bagkg]').forEach(inp => { const t = inp.getAttribute('data-bagkg'); if (num(inp.value)) p.bagKg[t] = num(inp.value); });
    F().feedPlan = p;
    save();
    document.getElementById('feedPlanModal')?.remove();
    renderAll();
    const sync = await verifyFeedPlanSave('feeding guide settings');
    toast(sync && sync.success
      ? (sync.pending ? 'Feeding guide cloud-verified; other changes are still pending.' : 'Feeding guide saved and cloud-verified')
      : `✓ Feeding guide saved locally; cloud verification pending — ${sync?.reason || 'retry safely when the cloud is available.'}`);
  }

  async function verifyFeedPlanSave(label) {
    const farmIdForSave = window.__arsActiveFarmId || window.farmId;
    const sync = window.ARSCloud?.verifyFarmSave
      ? await ARSCloud.verifyFarmSave(farmIdForSave, label)
      : { success: false, reason: 'Cloud verification is unavailable.' };
    if (sync && sync.success) {
      if (sync.pending) {
        window.updateSyncIndicator?.('pending', 'Pending changes', 'The feed-plan update was cloud-verified; other local changes remain pending review.');
      } else {
        window.updateSyncIndicator?.('synced', 'Synced', 'The feed-plan update was verified with the cloud.');
      }
    } else {
      const reason = String(sync?.reason || '');
      const conflict = Boolean(sync?.conflicts?.length) || /remote changes detected|conflict|farm context changed/i.test(reason);
      window.ARSCloud?.saveLocalRecovery?.(farmIdForSave, F(), `${label} pending cloud verification`);
      window.updateSyncIndicator?.(conflict ? 'error' : 'pending', conflict ? 'Review needed' : 'Feed-plan pending', reason || 'The local feed-plan value is safely retained until cloud verification completes.');
    }
    return sync;
  }

  /* ── manual consumption updates per batch ─────────────────────────── */
  async function saveBatchConsumption(batchId, btn) {
    const p = Object.assign(defaults(), F().feedPlan || {}, { configured: true }),
      cell = btn && btn.closest ? btn.closest('.fg-batch') : null;
    if (!cell) {
      toast('The batch consumption form is no longer available. Reopen the feed planner and try again.');
      return;
    }
    const consumed = {};
    cell.querySelectorAll('[data-fgc]').forEach(inp => { consumed[inp.getAttribute('data-fgc')] = Math.max(0, num(inp.value, 0)); });

    /* [REBUILD FIX 135] MODEL A — AUTO-DEDUCT INVENTORY FROM CONSUMPTION DELTAS.
       Only the four piglet stages (Pre Starter/Starter/Grower/Finisher) move
       stock; Gestating/Lactating stay manual. The delta (new − old) per stage
       is applied once to the Feed Inventory row and appended to an append-only
       movement ledger stored INSIDE feedPlan (so it syncs with the same
       verified path). The P&L deliberately stays purchase/delivery-expensed —
       batch costing, KPIs and suggested prices already read these same
       consumed values, so production cost and pricing update automatically
       with zero double-counting. Existing consumed values are the baseline:
       nothing retroactive is ever deducted. */
    const f = F();
    const prevCons = ((p.batches || {})[batchId] || {}).consumed || {};
    p.batches = p.batches || {};
    p.batches[batchId] = { consumed, updated: new Date().toISOString() };
    p.movements = Array.isArray(p.movements) ? p.movements : [];
    const fmId = () => 'fm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const shortages = [];
    const moved = [];
    STAGES.forEach(([key, label]) => {
      const before = Math.max(0, num(prevCons[key], 0));
      const after = Math.max(0, num(consumed[key], 0));
      const delta = after - before;
      if (!delta) return;
      const row = (f.feed || []).find(x => String(x.type || '').toLowerCase() === label.toLowerCase());
      if (!row) { moved.push(label + ' (no inventory row)'); return; }
      const price = +row.price || 0;
      row.bags = Math.round(((+row.bags || 0) - delta) * 100) / 100;
      row.feed_revision = Date.now();
      row.updated_at = new Date().toISOString();
      p.movements.unshift({ id: fmId(), ts: new Date().toISOString(), batch_id: batchId, stage: label, delta: -delta, bags_after: row.bags, price, value: Math.round(Math.abs(delta) * price), kind: 'consumption' });
      moved.push(label + ' ' + (delta > 0 ? '−' : '+') + Math.abs(delta));
      if (row.bags < 0) shortages.push({ row, label, need: -row.bags, price });
    });
    /* Negative-stock guard: offer to log the missing delivery (adds stock AND
       books the purchase expense, exactly like a normal delivery). */
    shortages.forEach(sh => {
      const add = Math.ceil(sh.need);
      if (confirm('⚠ ' + sh.label + ' stock is now NEGATIVE (' + sh.row.bags + ' bags) after this consumption update.\n\nThis usually means a delivery was never recorded.\n\nRecord an unrecorded delivery of ' + add + ' bag(s) at ₱' + sh.price.toLocaleString() + '/bag now? (adds stock and books the Feed purchase expense)')) {
        sh.row.bags = Math.round((sh.row.bags + add) * 100) / 100;
        sh.row.feed_revision = Date.now();
        (f.transactions = f.transactions || []).unshift({ id: 'tx-' + Date.now().toString(36) + '-unrec', date: new Date().toISOString().slice(0, 10), type: 'Expense', category: 'Feed', description: 'Feed delivery (unrecorded; logged via ' + batchId + ' consumption) — ' + sh.label + ' +' + add + ' bag(s)', amount: Math.round(add * sh.price), paid: Math.round(add * sh.price), created_at: new Date().toISOString() });
        p.movements.unshift({ id: fmId(), ts: new Date().toISOString(), batch_id: batchId, stage: sh.label, delta: add, bags_after: sh.row.bags, price: sh.price, value: Math.round(add * sh.price), kind: 'delivery_unrecorded' });
      } else {
        toast('⚠ ' + sh.label + ' stock is negative (' + sh.row.bags + ' bags). Reconcile later with a physical count or record the missing delivery.');
      }
    });
    F().feedPlan = p;
    if (moved.length) toast('✓ Consumption saved · inventory auto-updated: ' + moved.join(', '));

    /* Consumption is farm operating data, not merely a visual setting. Save it
       locally first, then await the same remote preflight used by reservations,
       heat records and semen stock. A failed verification leaves the local value
       and recovery snapshot intact; a later cloud pull cannot silently replace
       it while it is still dirty. */
    save();
    renderAll();
    const sync = await verifyFeedPlanSave(`feed consumption ${batchId}`);
    if (sync && sync.success) {
      toast(sync.pending
        ? `${batchId} consumption cloud-verified; other changes are still pending.`
        : `${batchId} consumption updated and cloud-verified`);
    } else {
      toast(`✓ ${batchId} consumption saved locally; cloud verification pending — ${sync?.reason || 'retry safely when the cloud is available.'}`);
    }
  }

  /* [REBUILD FIX 34] Dashboard "Piglet batches — stage planner" card entry
     point: open the Feed page, unfold the stage-planner section and scroll it
     into view with a short highlight so the manager can update consumed bags. */
  function openFeedStagePlanner() {
    go('feed');
    setTimeout(() => {
      /* Farms that never configured the guide see the one-time setup panel
         instead of the planner — land them there so the card always works. */
      const sec = document.getElementById('fgStagePlanner') || document.querySelector('#feed .fg-panel');
      if (!sec) return;
      sec.open = true;
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      sec.classList.add('fg-flash');
      setTimeout(() => sec.classList.remove('fg-flash'), 1800);
    }, 120);
  }

  
  function renderBatchStagePlannerHTML(b) {
    if (!b || b.archived) return '';
    const p = plan();
    /* [FIX M1] live headcount from the authoritative ledger engine (sold/released heads are no longer fed in the plan). */
      const heads = window.liveHeadsFor ? Math.max(0, window.liveHeadsFor(b)) : Math.max(0, (+b.males || 0) + (+b.females || 0) -
        (F().pigletLedger || []).filter(x => x.batch_id === b.id && x.type === 'mortality' && !['undone', 'deleted'].includes(x.status)).reduce((a, x) => a + (+x.quantity || 0), 0));
    if (heads <= 0) return '';

    const _cc2 = batchConsumed(p, b, heads),
      cons = _cc2.used;
    const stageData = STAGES.map(([key, label]) => {
      const perHead = num((p.stageBags || {})[key], key === 'preStarter' ? 0.8 : (key === 'starter' ? 1.0 : (key === 'grower' ? 2.5 : 0)));
      const pb = +(perHead * heads).toFixed(1);
      const sd = Math.max(1, num((p.stageDays || {})[key], 30));
      const used = Math.max(0, num(cons[key], 0));
      const rem = Math.max(0, pb - used);
      return { key, label, pb, perHead, sd, used, rem, rate: sd > 0 ? pb / sd : 0 };
    });

    let curIdx = stageData.findIndex(x => x.rem > 0);
    const curStage = curIdx === -1 ? null : stageData[curIdx];

    const need = {};
    let dLeft = HORIZON;
    if (curIdx !== -1) {
      for (let i = curIdx; i < stageData.length && dLeft > 0.0001; i++) {
        const s = stageData[i];
        if (s.pb <= 0) continue;
        const budget = i === curIdx ? s.rem : s.pb;
        const use = Math.min(budget, s.rate * dLeft);
        if (use > 0) {
          need[s.label] = (need[s.label] || 0) + use;
          dLeft -= use / (s.rate || Infinity);
        }
      }
    }

    const nextChips = Object.entries(need).map(([l, v]) => `${l}: ${v.toFixed(1)} bags`).join(' · ');
    const finishedStages = stageData.filter(s => s.rem <= 0 && s.pb > 0).map(s => s.label);
    const ageDays = b.birth ? days(b.birth) : null;

    const consInputs = stageData.map(sd => `
      <div class="fg-cons">
        <small>${esc(sd.label)}</small>
        <span>
          <input data-fgc="${sd.key}" type="number" min="0" step="0.5" value="${sd.used}" inputmode="decimal">
          <b>/ ${sd.pb}</b>
        </span>
        <small class="fg-perhead" title="Plan = ${sd.perHead} bags/head × ${heads} heads">${sd.perHead}/HD</small>
      </div>
    `).join('');

    return `
      <!-- Piglet Batches — Stage Planner -->
      <div class="fg-batch fg-stage-card" style="margin-top:14px">
        <div class="fg-batch-top">
          <div>
            <b>${esc(b.id)}</b>
            <span class="muted">${esc(b.dam_name || b.sow || '—')} · ${heads} head${ageDays !== null ? ' · ' + ageDays + ' days' : ''}</span>
          </div>
          ${curIdx === -1 ? '<span class="tag" style="background:#059669;color:#fff">PLAN COMPLETE · MARKET READY</span>' : `<span class="tag ${curStage ? 'warn' : 'dark'}">${curStage ? 'on ' + curStage.label : '—'}</span>`}
        </div>

        <div style="font-size:12.5px;margin:6px 0">
          <span>next 30d: ${nextChips ? `<span class="tag" style="background:rgba(23,202,190,0.15);color:var(--teal2);font-weight:700">${nextChips}</span>` : '<span class="muted">Stage requirement covered</span>'}</span>
        </div>

        ${finishedStages.length ? `
          <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">
            finished: ${finishedStages.join(', ')}
          </div>
        ` : ''}

        <div class="fg-cons-grid">${consInputs}</div>
        <button type="button" class="btn ghost" onclick="saveBatchConsumption('${esc(b.id)}', this)">💾 Update consumed bags</button>
      </div>
    `;
  }
  window.renderBatchStagePlannerHTML = renderBatchStagePlannerHTML;

  window.feedGuidePanel = feedGuidePanel;
  window.computeFeedPlan = computeFeedPlan;
  window.openFeedPlanConfig = openFeedPlanConfig;
  window.saveFeedPlanConfig = saveFeedPlanConfig;
  window.saveBatchConsumption = saveBatchConsumption;
  /* [REBUILD FIX 35] live search inside the stage planner: filters the batch
     cards by batch id or dam name as the manager types (matches the render-time
     pre-filter above, so both paths agree). */
  function filterStagePlanner(qv) {
    lastQuery = qv;
    const q = String(qv || '').trim().toLowerCase(),
      sec = document.getElementById('fgStagePlanner');
    if (!sec) return;
    const cards = sec.querySelectorAll('.fg-batch');
    let shown = 0;
    cards.forEach(card => {
      const hay = card.getAttribute('data-search') || card.textContent.toLowerCase(),
        show = !q || hay.includes(q);
      card.style.display = show ? '' : 'none';
      if (show) shown++;
    });
    const note = sec.querySelector('.fg-matchnote');
    if (note) {
      if (q && cards.length) { note.style.display = ''; note.textContent = 'Showing ' + shown + ' of ' + cards.length + ' batches'; }
      else note.style.display = 'none';
    }
    const nm = sec.querySelector('.fg-nomatch');
    if (nm) { nm.style.display = (q && cards.length && !shown) ? '' : 'none'; nm.textContent = 'No batch matches "' + q + '".'; }
  }

  window.filterStagePlanner = filterStagePlanner;
  window.openFeedStagePlanner = openFeedStagePlanner;

  /* [REBUILD FIX 135] Feed Movement Ledger UI — audit trail of every
     auto-deduction, correction and unrecorded-delivery entry. */
  window.feedMovementsBtn = () => `<button type="button" class="btn ghost" onclick="window.openFeedMovementsModal()" title="Audit trail of consumption auto-deductions">📒 Movements</button>`;
  window.openFeedMovementsModal = function () {
    const p = F().feedPlan || {};
    const movs = (p.movements || []).slice(0, 150);
    document.getElementById('feedMovementsModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="feedMovementsModal"><div class="due-modal" style="text-align:left;max-width:640px"><div class="modal-top"><div><div class="eyebrow">📒 FEED MOVEMENT LEDGER</div><h2>Inventory auto-deduct audit trail</h2><small class="muted">Consumption deltas &amp; unrecorded deliveries — newest first</small></div><button class="close-reminder" onclick="document.getElementById('feedMovementsModal').remove()">×</button></div>` +
      (movs.length ? `<div class="table-wrap"><table class="table" style="font-size:12px"><thead><tr><th>When</th><th>Batch</th><th>Stage</th><th>Bags</th><th>Value</th><th>Kind</th></tr></thead><tbody>` +
      movs.map(m => `<tr><td>${esc(new Date(m.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</td><td>${esc(m.batch_id || '')}</td><td>${esc(m.stage || '')}</td><td><b>${m.delta > 0 ? '+' : ''}${m.delta}</b> <small class="muted">(${m.bags_after} left)</small></td><td>${typeof peso === 'function' ? peso(m.value || 0) : '₱' + (m.value || 0)}</td><td><small class="muted">${esc(String(m.kind || '').replace(/_/g, ' '))}</small></td></tr>`).join('') +
      `</tbody></table></div>` : `<div class="empty" style="padding:22px">No movements yet — update a batch's consumed bags and the ledger starts here.</div>`) +
      `<p class="muted" style="font-size:11px;margin-top:10px">Model A accounting: inventory auto-deducts on consumption deltas; the P&amp;L stays purchase/delivery-expensed, so nothing is ever double-counted. Only Pre Starter / Starter / Grower / Finisher move stock.</p></div></div>`);
  };
})();
