/* [REBUILD FIX 12][REBUILD FEATURE] Fattener & Grow-Finish Center.
   Opened from the dashboard "Fatteners" glance card (and a button on each batch
   hub). Three tabs:
     1. HERD   — fattening batches with their piglet details (roster/ear-notches),
                 growth metrics and market-readiness tracking.
     2. TRIALS — feed trial program: compare up to 3 feed brands / feed types on
                 the same batch; auto-computed ADG, FCR, ADFI, feed cost per kg
                 gain, and days-to-market. Trials stay open until the batch is
                 market ready, then can be marked completed.
     3. MARKET — market-selling calculator: individual piglet weights (auto
                 count & average), editable price brackets per weight range
                 (add as many as needed), automatic per-pig pricing and grand
                 total; quotes can be saved and reopened.
   Data lives on the farm object: f.feedTrials[] and f.marketQuotes[]. */
(function () {
  const MARKET_AGE = 150; /* days — typical grow-finish market age */
  const MARKET_W = 90;    /* kg   — typical live market weight */

  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsq = v => "'" + String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + "'";
  const num = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? null : +v;
  const kg = v => v === null ? '—' : (+v).toFixed(1) + ' kg';
  const gd = v => v === null ? '—' : Math.round(v * 1000) + ' g/day';
  const money = v => (typeof peso === 'function' ? peso(v) : '₱' + Math.round(v).toLocaleString('en-PH'));

  /* [REBUILD FIX 24] archived batches stay out of the active fattener herd,
     trial pickers and market selling — they are finished history. */
  const batches = () => (F().piglets || []).filter(b => !b.archived && herdHeads(b) > 0);
  /* look up in ALL records (incl. archived) so archived batches still open /
     restore; `batches()` alone is the filtered active-herd view (FIX 24). */
  const batch = id => (F().piglets || []).find(x => x.id === id);
  /* [REBUILD FIX 13] 'edited' ledger entries still count; only undone/deleted
     drop out — matches the batch hub and dashboard card. */
  const ledAct = () => (F().pigletLedger || []).filter(x => !['undone', 'deleted'].includes(x.status));
  const tsum = (bid, t) => ledAct().filter(x => x.batch_id === bid && x.type === t).reduce((a, x) => a + (+x.quantity || 0), 0);
  const resReleased = bid => (F().reservations || []).filter(r => (r.status === 'released' || !!r.released_at) && r.status !== 'cancelled').reduce((acc, r) => {
    if (Array.isArray(r.lines) && r.lines.length) {
      return acc + r.lines.filter(l => l.batch_id === bid).reduce((la, l) => la + (+l.quantity || 0), 0);
    }
    return acc + (r.batch_id === bid ? (+r.quantity || 0) : 0);
  }, 0);
  const aliveHeads = b => window.getPigletCounts ? window.getPigletCounts(b).alive : Math.max(0, (+b.males || 0) + (+b.females || 0) - tsum(b.id, 'mortality') - Math.max(tsum(b.id, 'sold'), resReleased(b.id)));
  /* [FIX FATTENER LIVE COUNTS] "Assigned fattener" must reflect the LIVING
     fattener pool, adjusted per gender for deaths and sales. The old math only
     subtracted reservations, so a batch with 10 assigned and 1 death still
     showed 10 (P4 Charlotte / P00-Aida in the reports). We use the
     authoritative piglet-ledger count engine — fattenerM/F = allocation minus
     attributable mortality/sales, minus drained unattributed deaths, capped by
     the living gender headcount (identical to the Batch Hub "Fattener" stat).
     Fallback mirrors that when the engine is unavailable. */
  const fattenerLivingFor = b => {
    if (window.getPigletCounts && typeof window.getPigletCounts === 'function') {
      try {
        const c = window.getPigletCounts(b);
        if (c && typeof c === 'object') {
          const m = Math.max(0, +((c.fattenerM ?? c.fattener) || 0)),
            f = Math.max(0, +((c.fattenerF ?? c.fattener) || 0));
          return { m, f, total: m + f };
        }
      } catch (_) { /* fall through to the ledger-based fallback */ }
    }
    const rows = ledAct().filter(x => x.batch_id === b.id);
    const q = (t, gender, src) => rows.filter(x => x.type === t && x.gender === gender && (!src || x.source === src)).reduce((a, x) => a + (+x.quantity || 0), 0);
    let m = Math.max(0, q('fattener', 'male') - q('mortality', 'male', 'fattener') - q('sold', 'male', 'fattener'));
    let f = Math.max(0, q('fattener', 'female') - q('mortality', 'female', 'fattener') - q('sold', 'female', 'fattener'));
    /* unattributed deaths drain the fattener pool first (fattener → breeder → farm) */
    let drain = Math.min(rows.filter(x => x.type === 'mortality' && x.gender !== 'male' && x.gender !== 'female').reduce((a, x) => a + (+x.quantity || 0), 0), m + f);
    const dm = Math.min(m, drain); m -= dm; drain -= dm;
    f = Math.max(0, f - drain);
    return { m, f, total: m + f };
  };
  window.fattenerLivingFor = fattenerLivingFor;
  /* assignedG/assigned/herdHeads now all report the LIVING fattener pool */
  const assignedG = (b, g) => fattenerLivingFor(b)[g === 'male' ? 'm' : 'f'];
  const assigned = b => fattenerLivingFor(b).total;
  const herdHeads = b => assigned(b);

  /* Heads counted as "fatteners" for a batch: LIVING piglets explicitly
     allocated to Fattener (deaths/sales already deducted — see above). */
  const lastWeight = b => num(b.release_weight) !== null ? { w: num(b.release_weight), src: 'release avg' }
    : num(b.weaning_weight) !== null ? { w: num(b.weaning_weight), src: 'weaning avg' }
    : num(b.birth_weight) !== null ? { w: num(b.birth_weight), src: 'birth avg' } : null;
  const marketReady = b => days(b.birth) >= MARKET_AGE || (num(b.release_weight) !== null && num(b.release_weight) >= MARKET_W);

  /* [REBUILD FIX 18] Batch health details + client report helpers.
     Age is expressed as months + days (client-facing). Medication history
     comes from the Medicine & Treatments movement ledger (F().med_movements):
     any treatment entry whose animal_ref targets this batch. */
  const todayISO = () => (typeof TODAY !== 'undefined' ? TODAY : new Date().toISOString().slice(0, 10));
  const ageMonths = iso => {
    if (!iso) return null;
    const a = new Date(iso + 'T00:00:00'), t = new Date(todayISO() + 'T00:00:00');
    if (isNaN(a.getTime()) || a > t) return null;
    let m = (t.getFullYear() - a.getFullYear()) * 12 + (t.getMonth() - a.getMonth()),
      d = t.getDate() - a.getDate();
    if (d < 0) { m--; d += new Date(t.getFullYear(), t.getMonth(), 0).getDate(); }
    m = Math.max(0, m);
    return { m, d, text: (m ? m + (m === 1 ? ' month' : ' months') : '') + (m && d ? ' ' : '') + (d || !m ? d + (d === 1 ? ' day' : ' days') : '') };
  };
  const batchMeds = bid => (F().med_movements || [])
    .filter(v => v.kind === 'treatment' && (v.animal_ref === 'batch:' + bid || String(v.animal_label || '').includes(bid)))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const yesNo = v => v ? '✓ done' : '✗ not yet';

  let cur = { tab: 'herd', batch: null };
  let market = null; /* {batchId, weights:[], brackets:[{min,max,rate}]} */

  /* ── Center shell ─────────────────────────────────────────────────── */
  function openFattenerCenter(batchId, tab) {
    cur = { tab: tab || 'herd', batch: batchId || null };
    if (cur.tab === 'market' || batchId) ensureMarket(cur.batch);
    document.getElementById('fattenerCenter')?.remove();
    document.body.insertAdjacentHTML('beforeend',
      `<div class="drill-bg" id="fattenerCenter"><div class="drill-panel fc-panel" id="fattenerPanel"></div></div>`);
    renderCenter();
    document.body.classList.add('app-modal-open');
  }
  function closeCenter() {
    document.getElementById('fattenerCenter')?.remove();
    if (!document.querySelector('.drill-bg')) document.body.classList.remove('app-modal-open');
  }
  function setTab(t, batchId) {
    cur = { tab: t, batch: batchId === undefined ? cur.batch : batchId };
    if (t === 'market') ensureMarket(cur.batch);
    renderCenter();
  }
  function renderCenter() {
    const el = document.getElementById('fattenerPanel');
    if (!el) return;
    const tabs = [['herd', '🐖 Herd & Batches'], ['trials', '🌾 Feed Trial Program'], ['market', '💰 Market Selling']]
      .map(t => `<button class="med-tab ${cur.tab === t[0] ? 'active' : ''}" onclick="fattenerSetTab('${t[0]}')">${t[1]}</button>`).join('');
    el.innerHTML = `<div class="drill-header"><div><div class="eyebrow">FATTENER &amp; GROW-FINISH CENTER</div><h2>Fatteners</h2><p>Track grower &amp; finisher pigs, compare feeds, and price them at market.</p></div><div><button class="close-reminder" onclick="fattenerCenterClose()">×</button></div></div><div class="fc-tabs">${tabs}</div>${cur.tab === 'herd' ? herdHTML() : cur.tab === 'trials' ? trialsHTML() : marketHTML()}`;
    if (cur.tab === 'market') { marketRecalc(); setTimeout(() => window.updateScaleWidgets && window.updateScaleWidgets(), 50); }
  }

  /* ── Tab 1 · Herd ─────────────────────────────────────────────────── */
  function herdHTML() {
    const bs = [...batches()].sort((a, b) => (herdHeads(b) - herdHeads(a)) || (days(b.birth) - days(a.birth)));
    const totalAssigned = bs.reduce((a, b) => a + assigned(b), 0),
      totalAM = bs.reduce((a, b) => a + assignedG(b, 'male'), 0),
      totalAF = bs.reduce((a, b) => a + assignedG(b, 'female'), 0),
      totalHerd = bs.reduce((a, b) => a + herdHeads(b), 0),
      trials = (F().feedTrials || []).length,
      ready = bs.filter(marketReady).length;
    const stat = (l, v, s) => `<div class="fc-stat"><small>${l}</small><b>${v}</b><span>${s}</span></div>`;
    const cards = bs.map(b => batchCardHTML(b)).join('') || '<div class="empty">No fattener batches assigned. Use the Batch Hub to allocate piglets to Fattener.</div>';
    return `<div class="fc-stat-grid">${stat('Fatteners now', totalHerd, totalAssigned ? totalAssigned + ' assigned (♂ ' + totalAM + ' · ♀ ' + totalAF + ')' : 'allocated in batch hubs')}${stat('Fattener batches', bs.length, 'batches in fattening')}${stat('Feed trials', trials, 'comparison programs')}${stat('Market ready', ready, ready ? 'sell window open' : 'none yet · target ' + MARKET_AGE + ' days / ' + MARKET_W + ' kg')}</div>` +
      `<div class="fc-batch-list">${cards}</div>`;
  }

  function batchCardHTML(b) {
    const age = days(b.birth),
      heads = herdHeads(b),
      asg = assigned(b),
      aliveN = aliveHeads(b),
      lw = lastWeight(b),
      perf = window.batchPerformance ? window.batchPerformance(b) : null,
      adg = perf ? perf.adg : null,
      rdy = marketReady(b),
      roster = Array.isArray(b.roster) ? b.roster : [],
      openBatch = cur.batch === b.id;
    /* Progress toward market weight (weight-based when a weight is recorded,
       else age-based). */
    let prog = null, pnote = '';
    if (lw) { prog = Math.min(100, Math.round(lw.w / MARKET_W * 100)); pnote = `${kg(lw.w)} of ${MARKET_W} kg target (${lw.src})`; }
    else if (b.birth) { prog = Math.min(100, Math.round(age / MARKET_AGE * 100)); pnote = `${age} of ${MARKET_AGE} days old`; }
    let eta = '';
    if (!rdy && lw && adg && adg > 0 && lw.w < MARKET_W) {
      const d = Math.ceil((MARKET_W - lw.w) / adg);
      eta = `~${d} days to ${MARKET_W} kg (est. ${fmtDate(isoOff(d))})`;
    } else if (!rdy && b.birth) {
      eta = `market age in ~${Math.max(0, MARKET_AGE - age)} days`;
    }
    const rosterRows = roster.map((r, i) => `<tr><td>${i + 1}</td><td>${r.sex === 'F' ? '♀ Female' : r.sex === 'M' ? '♂ Male' : '—'}</td><td>${esc(r.renn) || '—'}</td><td>${esc(r.lenn) || '—'}</td><td>${r.sex === 'F' && r.teats ? esc(r.teats) : '—'}</td></tr>`).join('');
    return `<div class="fc-batch ${rdy ? 'fc-ready' : ''}" id="fcb-${esc(b.id)}">
      <div class="fc-batch-head"><div><b>${esc(b.id)}</b> <span class="tag ${rdy ? '' : 'dark'}">${rdy ? '✓ MARKET READY' : age + ' days old'}</span>${heads ? `<span class="tag">${heads} fattening</span>` : '<span class="tag dark">no fatteners yet</span>'}</div>
      <small class="muted">${esc(b.dam_name || b.sow || '—')} → ${esc(b.sire_name || b.sire || '—')} · ${esc(b.breed || '—')}${b.birth ? ' · born ' + fmtDate(b.birth) : ''}</small></div>
      <div class="fc-batch-stats">
        <div><small>Alive</small><b>${aliveN}</b><small>born ${(+b.males || 0)}M · ${(+b.females || 0)}F</small></div>
        <div><small>Assigned fattener</small><b>${asg}</b><small>♂ ${assignedG(b, 'male')} · ♀ ${assignedG(b, 'female')}</small></div>
        <div><small>Avg weight</small><b>${lw ? kg(lw.w) : '—'}</b>${lw ? `<small>${lw.src}</small>` : ''}</div>
        <div><small>ADG</small><b>${adg !== null ? gd(adg) : '—'}</b><small>birth → latest</small></div>
        <div><small>Health</small><b style="font-size:13px">${esc(b.health_status || '—')}</b></div>
        <div><small>Vaccinated</small><b style="font-size:13px">${esc(b.vaccination_status || '—')}</b></div>
      </div>
      ${prog !== null ? `<div class="fc-prog"><div class="fc-prog-bar"><i style="width:${prog}%"></i></div><small>${pnote}${eta ? ' · ' + eta : rdy ? ' · ready to sell' : ''}</small></div>` : ''}
      <details class="fc-roster"${openBatch ? ' open' : ''}><summary>Piglet details in this batch (${roster.length || aliveN} head)</summary>
        ${roster.length ? `<div class="table-wrap"><table class="table fc-table"><thead><tr><th>#</th><th>Sex</th><th>RENN (litter)</th><th>LENN (pig)</th><th>Teats</th></tr></thead><tbody>${rosterRows}</tbody></table></div>`
        : `<p class="muted" style="margin:8px 0">No individual piglets registered yet. Open <b>⚖ Performance &amp; Ear Notches</b> on the batch hub to register each piglet (sex, ear notches, teats) — they will appear here.</p>`}
      </details>
      <div class="fc-batch-actions">
        <button class="btn" onclick="fattenerSetTab('trials',${jsq(b.id)})">🌾 Feed trial program</button>
        <button class="btn" onclick="fattenerSetTab('market',${jsq(b.id)})">💰 Market selling</button>
        <button class="btn ghost" onclick="openBatchLedger(${jsq(b.id)})">Batch hub</button>
        <button class="btn ghost" onclick="openBatchPerformance(${jsq(b.id)})">⚖ Performance</button>
      </div>
    </div>`;
  }

  /* ── Tab 2 · Feed trials ──────────────────────────────────────────── */
  const FEED_TYPES = ['Pre Starter', 'Starter', 'Grower', 'Finisher'];
  const groupMetrics = (t, g) => {
    const heads = num(g.heads), sw = num(g.startW), cw = num(g.curW);
    if (!heads || sw === null || cw === null) return null;
    const dspan = Math.max(1, days(t.started, t.as_of || TODAY)),
      gainH = cw - sw,
      totalGain = gainH * heads,
      adg = gainH / dspan,
      feed = num(g.feedKg),
      cost = num(g.costKg),
      adfi = feed !== null ? feed / heads / dspan : null,
      fcr = (feed !== null && totalGain > 0) ? feed / totalGain : null,
      costGain = (feed !== null && cost !== null && totalGain > 0) ? feed * cost / totalGain : null,
      toMkt = (cw < MARKET_W && adg > 0) ? Math.ceil((MARKET_W - cw) / adg) : 0;
    return { heads, sw, cw, dspan, gainH, totalGain, adg, adfi, fcr, costGain, toMkt, feed, cost };
  };

  function trialsHTML(filterBatch) {
    const list = (F().feedTrials || []).slice().reverse().filter(t => !filterBatch || t.batch_id === filterBatch);
    const head = `<div class="fc-toolbar"><div><b>Feed trial program</b><br><small class="muted">Compare up to 3 feed brands / feed types on one batch. ADG, FCR and cost per kg gain update automatically from your weigh-ins — keep the trial running until the batch is market ready.</small></div><button class="btn" onclick="openTrialModal()">+ New feed trial</button></div>`;
    if (cur.batch) {
      const others = `<button class="btn ghost" onclick="fattenerSetTab('trials',null)">Show all batches</button>`;
      return `<div class="fc-toolbar"><div><b>Feed trials · ${esc(cur.batch)}</b><br><small class="muted">Only trials for this batch are shown.</small></div><span style="display:flex;gap:8px">${others}<button class="btn" onclick="openTrialModal(${jsq(cur.batch)})">+ New feed trial</button></span></div>` +
        (list.length ? list.map(trialCardHTML).join('') : '<div class="empty">No feed trials for this batch yet — create one to start comparing feeds.</div>');
    }
    return head + (list.length ? list.map(trialCardHTML).join('') : '<div class="empty">No feed trials yet. Tap <b>+ New feed trial</b> to compare up to 3 feed brands on a batch.</div>');
  }

  function trialCardHTML(t) {
    const b = batch(t.batch_id),
      ms = t.groups.map(g => groupMetrics(t, g)),
      done = t.status === 'completed';
    /* best flags: highest ADG, lowest FCR, lowest cost/kg gain */
    const valid = ms.map((m, i) => ({ m, i })).filter(x => x.m && x.m.totalGain > 0),
      bestAdg = valid.length ? valid.reduce((a, x) => x.m.adg > a.m.adg ? x : a, valid[0]).i : -1,
      bestFcr = valid.filter(x => x.m.fcr !== null).length ? valid.filter(x => x.m.fcr !== null).reduce((a, x) => x.m.fcr < a.m.fcr ? x : a).i : -1,
      bestCost = valid.filter(x => x.m.costGain !== null).length ? valid.filter(x => x.m.costGain !== null).reduce((a, x) => x.m.costGain < a.m.costGain ? x : a).i : -1;
    const chip = (i, kind) => (kind === 'adg' && i === bestAdg) || (kind === 'fcr' && i === bestFcr) || (kind === 'cost' && i === bestCost) ? ' <span class="fc-best-chip">🏆 best</span>' : '';
    const cols = t.groups.map((g, i) => {
      const m = ms[i];
      const row = (l, v, k) => `<div class="fc-trow" title="${l}"><span>${l}${k ? chip(i, k) : ''}</span><b>${v}</b></div>`;
      /* [REBUILD FIX 15] When ADFI / FCR / cost-per-kg-gain show "—", tell the
         user exactly which inputs unlock them instead of staying silent. */
      const noFeed = num(g.feedKg) === null, noCost = num(g.costKg) === null;
      let hint = '';
      if (m && (noFeed || noCost)) {
        const need = (noFeed ? ['<b>Total feed consumed (kg)</b>'] : []).concat(noCost ? ['<b>Feed cost ₱/kg</b>'] : []);
        const unlock = (noFeed ? ['ADFI', 'FCR'] : []).concat((noFeed || noCost) && m.totalGain > 0 ? ['₱ per kg gain'] : []);
        hint = `<div class="fc-hint">💡 Add ${need.join(' and ')} via <b>✎ Update results</b> to show ${unlock.join(', ')}.</div>`;
      }
      return `<div class="fc-tcol ${bestFcr === i || bestAdg === i ? 'fc-tcol-best' : ''}">
        <div class="fc-tcol-head"><b>${esc(g.brand)}</b><span class="tag">${esc(g.type || 'Feed')}</span></div>
        ${m ? row('Heads on feed', m.heads)
           + row('Days on trial', m.dspan)
           + row('Start → current', kg(m.sw) + ' → ' + kg(m.cw))
           + row('Avg daily gain (ADG)', gd(m.adg), 'adg')
           + row('Total weight gain', m.totalGain.toFixed(1) + ' kg')
           + row('Daily feed / head (ADFI)', m.adfi === null ? '—' : m.adfi.toFixed(2) + ' kg')
           + row('Feed conversion (FCR)', m.fcr === null ? '—' : m.fcr.toFixed(2), 'fcr')
           + row('Feed cost / kg gain', m.costGain === null ? '—' : money(m.costGain), 'cost')
           + row('Est. to ' + MARKET_W + ' kg', m.toMkt === 0 ? 'at / over target ✓' : '~' + m.toMkt + ' days · ' + fmtDate(isoOff(m.toMkt)))
           + hint
        : '<div class="empty" style="padding:14px">Fill heads, start & current weight to compute ADG / FCR.</div>'}
      </div>`;
    }).join('');
    return `<div class="panel fc-trial">
      <div class="fc-trial-head"><div><b>${esc(t.name)}</b> <span class="tag ${done ? '' : 'warn'}">${done ? 'COMPLETED' : 'ONGOING'}</span>${b ? `<span class="tag dark">${esc(b.id)} · ${esc(b.dam_name || b.sow || '')}</span>` : `<span class="tag dark">${esc(t.batch_id)}</span>`}</div>
      <small class="muted">started ${fmtDate(t.started)}${t.as_of ? ' · last weigh-in ' + fmtDate(t.as_of) : ''}${done && t.completed ? ' · completed ' + fmtDate(t.completed) : ''} · ${t.groups.length} feed ${t.groups.length > 1 ? 'brands' : 'brand'} compared</small></div>
      <div class="fc-thead-actions">
        <button class="btn ghost" onclick="openTrialHealth(${jsq(t.id)})">🩺 Batch health details</button>
        <button class="btn ghost" onclick="openTrialReport(${jsq(t.id)})">📄 Client report (PDF)</button>
        <button class="btn ghost" onclick="openTrialModal(${jsq(t.id)})">✎ Update results</button>
        ${done ? `<button class="btn ghost" onclick="trialStatus(${jsq(t.id)},'ongoing')">↩ Reopen</button>` : `<button class="btn ghost" onclick="trialStatus(${jsq(t.id)},'completed')">✓ Mark completed</button>`}
        <button class="btn ghost danger-btn" onclick="deleteTrial(${jsq(t.id)})">Delete</button>
      </div></div>
      <div class="fc-tgrid" style="grid-template-columns:repeat(${t.groups.length},1fr)">${cols}</div>
    </div>`;
  }

  /* Trial create/update modal — up to 3 groups. */
  function openTrialModal(idOrBatch) {
    const trials = F().feedTrials || (F().feedTrials = []),
      edit = trials.find(t => t.id === idOrBatch) || null,
      preBatch = edit ? edit.batch_id : (batch(idOrBatch) ? idOrBatch : (cur.batch || (batches()[0] || {}).id || ''));
    const gs = [0, 1, 2].map(i => (edit && edit.groups[i]) || {});
    const opts = batches().map(b => `<option value="${esc(b.id)}"${b.id === preBatch ? ' selected' : ''}>${esc(b.id)} · ${esc(b.dam_name || b.sow || '')} (${aliveHeads(b)} alive)</option>`).join('');
    const groupBlock = i => {
      const g = gs[i], lw = preBatch && batch(preBatch) ? lastWeight(batch(preBatch)) : null;
      return `<div class="fc-gblock"><div class="fc-gblock-head"><b>Feed ${i + 1}</b>${i === 0 ? '<span class="tag">required</span>' : `<label class="fc-gon"><input type="checkbox" name="g${i}_on"${g.brand !== undefined ? ' checked' : ''}> compare</label>`}</div>
      <div class="field"><label>Feed brand / name</label><input name="g${i}_brand" value="${esc(g.brand ?? '')}" placeholder="e.g. B-MEG Integra" ${i === 0 ? 'required' : ''}></div>
      <div class="field"><label>Feed type</label><select name="g${i}_type">${FEED_TYPES.map(t => `<option${g.type === t ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="fc-g2"><div class="field"><label>Heads</label><input name="g${i}_heads" type="number" min="1" step="1" value="${g.heads ?? ''}" placeholder="10"></div>
      <div class="field"><label>Feed cost ₱/kg <small class="muted">· needed for ₱/kg gain</small></label><input name="g${i}_cost" type="number" min="0" step="0.01" value="${g.costKg ?? g.cost ?? ''}" placeholder="32.50"></div></div>
      <div class="fc-g2"><div class="field"><label>Avg start weight (kg)</label><input name="g${i}_startW" type="number" min="0" step="0.1" value="${g.startW ?? (i === 0 && lw ? lw.w : '')}"></div>
      <div class="field"><label>Avg current weight (kg)</label><input name="g${i}_curW" type="number" min="0" step="0.1" value="${g.curW ?? ''}"></div></div>
      <div class="field"><label>Total feed consumed so far (kg) <small class="muted">· needed for ADFI & FCR</small></label><input name="g${i}_feed" type="number" min="0" step="0.1" value="${g.feedKg ?? g.feed ?? ''}" placeholder="all heads, whole trial"></div></div>`;
    };
    document.getElementById('fatTrialModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="fatTrialModal"><form class="reminder-modal fc-trial-modal" onsubmit="saveTrial(event,${edit ? jsq(edit.id) : 'null'})">
      <div class="modal-top"><h2>${edit ? 'Update feed trial' : 'New feed trial'}</h2><button type="button" class="close-reminder" onclick="document.getElementById('fatTrialModal').remove()">×</button></div>
      <div class="reminder-fields">
        <div class="field"><label>Piglet batch</label><select name="batch_id">${opts}</select></div>
        <div class="field"><label>Trial name</label><input name="name" value="${esc(edit ? edit.name : 'Feed trial · ' + (typeof TODAY !== 'undefined' ? fmtDate(TODAY) : ''))}" required></div>
        <div class="field"><label>Trial start date</label><input name="started" type="date" value="${edit ? esc(edit.started) : typeof TODAY !== 'undefined' ? esc(TODAY) : ''}" required></div>
        <div class="field"><label>Latest weigh-in date</label><input name="as_of" type="date" value="${edit && edit.as_of ? esc(edit.as_of) : typeof TODAY !== 'undefined' ? esc(TODAY) : ''}" required></div>
        <div class="field full fc-groups">${groupBlock(0)}${groupBlock(1)}${groupBlock(2)}</div>
      </div>
      <div class="form-error" id="trialError"></div>
      <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('fatTrialModal').remove()">Cancel</button><button class="btn">${edit ? 'Save results' : 'Start trial'}</button></div>
    </form></div>`);
  }

  function saveTrial(e, editId) {
    e.preventDefault();
    const fd = new FormData(e.target), d = Object.fromEntries(fd), err = document.getElementById('trialError');
    const groups = [0, 1, 2]
      .filter(i => i === 0 || d['g' + i + '_on'] === 'on')
      .map(i => ({ brand: (d['g' + i + '_brand'] || '').trim(), type: d['g' + i + '_type'], heads: num(d['g' + i + '_heads']), startW: num(d['g' + i + '_startW']), curW: num(d['g' + i + '_curW']), feedKg: num(d['g' + i + '_feed']), costKg: num(d['g' + i + '_cost']) }))
      .filter(g => g.brand);
    if (!groups.length) { err.textContent = 'Give at least one feed brand to compare.'; err.classList.add('show'); return; }
    if (groups.some(g => g.heads !== null && g.heads < 1)) { err.textContent = 'Heads per feed must be at least 1.'; err.classList.add('show'); return; }
    if (d.as_of < d.started) { err.textContent = 'Weigh-in date cannot be before the trial start date.'; err.classList.add('show'); return; }
    const trials = F().feedTrials || (F().feedTrials = []);
    if (editId) {
      const t = trials.find(x => x.id === editId);
      Object.assign(t, { batch_id: d.batch_id, name: d.name.trim(), started: d.started, as_of: d.as_of, groups });
      toast('Feed trial updated');
    } else {
      trials.push({ id: 'ft-' + Date.now(), batch_id: d.batch_id, name: d.name.trim(), started: d.started, as_of: d.as_of, status: 'ongoing', completed: null, groups, created: new Date().toISOString() });
      toast('Feed trial started');
    }
    save();
    document.getElementById('fatTrialModal')?.remove();
    cur = { tab: 'trials', batch: null };
    renderCenter();
  }
  function trialStatus(id, status) {
    const t = (F().feedTrials || []).find(x => x.id === id);
    if (!t) return;
    t.status = status;
    t.completed = status === 'completed' ? TODAY : null;
    save(); renderCenter(); toast(status === 'completed' ? 'Trial completed' : 'Trial reopened');
  }
  function deleteTrial(id) {
    if (!confirm('Delete this feed trial? Its comparison data will be removed.')) return;
    F().feedTrials = (F().feedTrials || []).filter(x => x.id !== id);
    save(); renderCenter(); toast('Feed trial deleted');
  }

  /* ── Tab 3 · Market selling ───────────────────────────────────────── */
  function ensureMarket(batchId) {
    if (market && (!batchId || market.batchId === batchId)) return;
    const b = batch(batchId) || batches().slice().sort((x, y) => herdHeads(y) - herdHeads(x))[0];
    const heads = b ? Math.max(1, herdHeads(b) || aliveHeads(b)) : 1;
    market = {
      batchId: b ? b.id : '',
      weights: Array.from({ length: heads }, () => ''),
      brackets: [{ min: 80, max: 90, rate: 140 }, { min: 90, max: 100, rate: 150 }],
      expenses: [] /* [FIX 99] additional manual expenses */
    };
  }

  function marketHTML() {
    if (!market) ensureMarket(cur.batch);
    const b = batch(market.batchId);
    const opts = batches().map(x => `<option value="${esc(x.id)}"${x.id === market.batchId ? ' selected' : ''}>${esc(x.id)} · ${esc(x.dam_name || x.sow || '')} (${herdHeads(x) || aliveHeads(x)} head)</option>`).join('');
    const roster = b && Array.isArray(b.roster) ? b.roster : [];
    const wRows = market.weights.map((w, i) => {
      const r = roster[i];
      const tag = r ? `${r.sex === 'F' ? '♀' : r.sex === 'M' ? '♂' : ''} R${esc(r.renn) || '?'}-L${esc(r.lenn) || '?'}` : `Pig #${i + 1}`;
      return `<div class="fc-wrow" data-market-row="${i}"><span>${tag}</span><div class="notch-weight-cell" style="flex:1"><input data-w-i="${i}" type="number" min="0" step="0.1" inputmode="decimal" placeholder="kg" value="${esc(w)}" oninput="marketRecalc()"><button type="button" class="btn-row-scale" onclick="window.captureMarketPigWeight(${i})" title="Capture Live Scale Weight for ${tag}">⚖</button></div><button type="button" class="notch-del" title="Remove" onclick="marketDelPig(${i})">×</button></div>`;
    }).join('');
    const bRows = market.brackets.map((br, i) => `<div class="fc-brow" data-br-row>
        <input data-br="min" type="number" min="0" step="1" value="${esc(br.min)}" oninput="marketRecalc()" title="From kg">
        <span>to</span><input data-br="max" type="number" min="0" step="1" value="${esc(br.max)}" oninput="marketRecalc()" title="To kg">
        <span>kg =</span><input data-br="rate" type="number" min="0" step="0.5" value="${esc(br.rate)}" oninput="marketRecalc()" title="₱ per kg"><b>₱/kg</b>
        <button type="button" class="notch-del" title="Remove bracket" onclick="marketDelBracket(${i})">×</button>
      </div>`).join('');
    const quotes = (F().marketQuotes || []).slice().reverse().map(q => `<div class="summary-row"><span><b>${esc(q.batch_id)}</b> · ${q.heads} head · ${q.kg.toFixed(1)} kg<br><small>${fmtDate(String(q.created).slice(0, 10))} · ${q.brackets.length} bracket${q.brackets.length > 1 ? 's' : ''} · avg ${money(q.avgRate)}/kg</small></span><b>${money(q.amount)}</b><span><button class="btn ghost" onclick="marketOpenQuote(${jsq(q.id)})">Reopen</button> <button class="btn ghost delete-action" onclick="marketDelQuote(${jsq(q.id)})">Delete</button></span></div>`).join('');
    return `<div class="fc-split">
      <div>
        <div class="field"><label>Selling from batch</label><select onchange="marketSwitchBatch(this.value)">${opts}</select></div>
        <div class="fc-subhead"><b>Individual piglet weights</b><small class="muted">live Bluetooth scale or manual entry</small></div>
        <div id="marketScaleBar" class="notch-scale-bar disconnected"></div>
        <div id="fcWeights">${wRows || '<div class="empty" style="padding:14px">No pigs listed — add rows below.</div>'}</div>
        <button class="btn ghost" style="margin-top:8px" onclick="marketAddPig()">+ Add pig</button>
        <div class="fc-subhead" style="margin-top:18px"><b>Price brackets per weight</b><small class="muted">each pig is priced by the bracket its weight falls into</small></div>
        <div id="fcBrackets">${bRows}</div>
        <button class="btn ghost" style="margin-top:8px" onclick="marketAddBracket()">+ Add price bracket</button>
        <!-- [FIX 99] additional expenses input -->
        <div class="fc-subhead" style="margin-top:18px"><b>Additional expenses</b><small class="muted">hauling, labor, meds, pen costs…</small></div>
        <div id="fcExpenses">${(market.expenses || []).map((e, i) => `<div class="fc-wrow" data-exp-row style="display:flex;gap:6px;align-items:center;margin:6px 0"><input data-ex="label" placeholder="e.g. Hauling" value="${esc(e.label || '')}" style="flex:1"><input data-ex="amt" type="number" min="0" step="0.01" inputmode="decimal" placeholder="₱" value="${esc(e.amt ?? '')}" oninput="marketRecalc()" style="width:110px"><button type="button" class="notch-del" onclick="marketDelExpense(${i})">×</button></div>`).join('') || '<small class="muted">None yet — feed cost is computed automatically below.</small>'}</div>
        <button class="btn ghost" style="margin-top:8px" onclick="marketAddExpense()">+ Add expense</button>
      </div>
      <div>
        <div class="fc-subhead"><b>Automatic computation</b><small class="muted">updates as you type</small></div>
        <div id="marketResults"></div>
        <button class="btn" style="width:100%;margin-top:10px" onclick="marketSaveQuote()">Save this price computation</button>
        <div class="fc-subhead" style="margin-top:20px"><b>Saved computations</b></div>
        <div class="panel summary" style="max-height:270px;overflow:auto">${quotes || '<div class="empty">Nothing saved yet.</div>'}</div>
      </div>
    </div>`;
  }

  function marketReadDOM() {
    market.weights = [...document.querySelectorAll('#fcWeights [data-w-i]')].map(x => x.value);
    market.brackets = [...document.querySelectorAll('#fcBrackets [data-br-row]')].map(r => ({
      min: r.querySelector('[data-br="min"]').value, max: r.querySelector('[data-br="max"]').value, rate: r.querySelector('[data-br="rate"]').value
    }));
    market.expenses = [...document.querySelectorAll('#fcExpenses [data-exp-row]')].map(r => ({
      label: r.querySelector('[data-ex="label"]').value, amt: r.querySelector('[data-ex="amt"]').value
    }));
  }
  function marketMath() {
    const ws = market.weights.map(num).filter(v => v !== null && v > 0),
      heads = ws.length, kgSum = ws.reduce((a, x) => a + x, 0), avg = heads ? kgSum / heads : 0;
    const rows = market.brackets.map(br => {
      const lo = num(br.min), hi = num(br.max), rate = num(br.rate);
      const hit = ws.filter(w => lo !== null && hi !== null && w >= lo && w <= hi);
      const bkg = hit.reduce((a, x) => a + x, 0);
      return { lo, hi, rate, heads: hit.length, kg: bkg, amount: bkg * (rate || 0) };
    }).filter(r => r.heads > 0);
    const matched = rows.reduce((a, r) => a + r.heads, 0), amount = rows.reduce((a, r) => a + r.amount, 0);
    return { heads, kgSum, avg, rows, unmatched: heads - matched, amount, avgRate: kgSum ? amount / kgSum : 0 };
  }
  /* [REBUILD FIX 99] smart feed-cost estimate for the batch being priced:
     prefers the batch's feed trial (actual consumed kg × recorded ₱/kg), else
     an age-based stage intake curve priced with the farm's recorded Feed
     Inventory bag prices. Also returns ADG for the sell-timing estimator. */
  /* [REBUILD FIX 99/100] feed-cost estimate WITH per-stage bag breakdown.
     Prefers the farmer's RECORDED consumed bags per stage (Batch Details →
     "Update consumed bags"), falls back to the age-based intake curve for
     stages without records; prices come from the recorded Feed Inventory
     bag prices. Returns {stages:[{label,bags,bkg,prBag,cost,src}], ...}. */
  function marketFeedEstimate() {
    const b = batch(market.batchId);
    const born = b ? ((+b.males || 0) + (+b.females || 0)) : 0;
    const wsNow = market.weights.map(num).filter(v => v !== null && v > 0);
    const heads = born || wsNow.length;
    const plan = F().feedPlan || {};
    const bagKgOf = t => { const o = plan.bagKg || {}; const k = Object.keys(o).find(x => x.toLowerCase() === String(t).toLowerCase()); return (k && +o[k]) || (String(t).toLowerCase() === 'pre starter' ? 25 : 50); };
    const feedRows = F().feed || [];
    const rowFor = t => feedRows.find(x => String(x.type || '').toLowerCase() === String(t).toLowerCase());
    const priceKg = t => { const r = rowFor(t); return r && +r.price ? (+r.price) / bagKgOf(t) : null; };
    let pk = priceKg('Finisher'); if (pk === null) pk = priceKg('Grower'); if (pk === null) pk = priceKg('Starter');
    let adg = null;
    const trial = (F().feedTrials || []).filter(t => t.batch_id === market.batchId).slice(-1)[0];
    if (trial) {
      const gms0 = (trial.groups || []).map(g => groupMetrics(trial, g)).filter(x => x && (x.feed || 0) > 0);
      const gain0 = gms0.reduce((a, x) => a + x.totalGain, 0);
      if (gain0 > 0) adg = gms0.reduce((a, x) => a + x.gainH, 0) / Math.max(1, gms0.reduce((a, x) => a + x.dspan, 0));
    }
    const consRec = (((plan.batches || {})[market.batchId] || {}).consumed) || {};
    const hasRec = Object.values(consRec).some(v => (+v || 0) > 0);
    const age = b && b.birth ? Math.max(0, days(b.birth, TODAY)) : null;
    const SD = { preStarter: 28, starter: 28, grower: 35, finisher: 45 };
    const RATE = { preStarter: 0.35, starter: 0.9, grower: 1.8, finisher: 2.6 };
    const stages = [];
    let kg = 0, cost = 0;
    [['Pre Starter', 0, 28, 'preStarter'], ['Starter', 28, 56, 'starter'], ['Grower', 56, 91, 'grower'], ['Finisher', 91, 400, 'finisher']].forEach(([label, a, z, key]) => {
      const recBags = +consRec[key] || 0;
      let bags = 0, src = '';
      if (recBags > 0) { bags = recBags; src = 'recorded'; }
      else if (!hasRec && age !== null && heads > 0) {
        const dIn = Math.max(0, Math.min(age, z) - a);
        if (dIn > 0) {
          const kgPerDay = (plan.stageBags || {})[key] ? (plan.stageBags[key] / SD[key]) * bagKgOf(label) : RATE[key];
          bags = heads * kgPerDay * dIn / bagKgOf(label);
          src = 'est';
        }
      }
      if (bags <= 0) return;
      const bkg = bagKgOf(label);
      const r = rowFor(label);
      const prBag = r && +r.price ? +r.price : (pk ? pk * bkg : 0);
      kg += bags * bkg;
      cost += bags * prBag;
      stages.push({ label, bags, bkg, prBag, cost: bags * prBag, src });
    });
    let source = hasRec ? 'recorded consumed bags' : 'age-based estimate · your recorded bag prices';
    if (!stages.length && trial) {
      const gms = (trial.groups || []).map(g => groupMetrics(trial, g)).filter(x => x && (x.feed || 0) > 0);
      const fKg = gms.reduce((a, x) => a + x.feed, 0);
      const fCost = gms.reduce((a, x) => a + x.feed * (x.cost || 0), 0);
      if (fKg > 0) {
        kg = fKg; cost = fCost; source = 'feed trial (actual)';
        stages.push({ label: 'Feed trial actual', bags: null, bkg: null, prBag: null, cost: fCost, src: 'trial', kg: fKg });
      }
    }
    return { stages, kg: kg || null, cost: cost || null, adg: adg || 0.7, pricePerKg: pk, source, heads };
  }

  function marketResultsHTML() {
    const m = marketMath();
    const rows = m.rows.map(r => `<tr><td>${r.lo}–${r.hi} kg @ ${money(r.rate || 0)}/kg</td><td>${r.heads}</td><td>${r.kg.toFixed(1)} kg</td><td><b>${money(r.amount)}</b></td></tr>`).join('');
    return `<div class="panel summary fc-results">
      <div class="summary-row"><span>Pigs weighed</span><b>${m.heads}</b></div>
      <div class="summary-row"><span>Total live weight</span><b>${m.kgSum.toFixed(1)} kg</b></div>
      <div class="summary-row"><span>Average weight per pig</span><b>${m.avg.toFixed(1)} kg</b></div>
      <div class="table-wrap" style="margin-top:10px"><table class="table fc-table"><thead><tr><th>Bracket</th><th>Heads</th><th>Weight</th><th>Subtotal</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty" style="padding:14px">Enter weights to price the pigs.</td></tr>'}</tbody></table></div>
      ${m.unmatched > 0 ? `<div class="notice" style="margin-top:10px"><b>⚠ ${m.unmatched} pig${m.unmatched > 1 ? 's' : ''} outside all brackets</b> — add a price bracket that covers their weight.</div>` : ''}
      <div class="fc-total"><span>Estimated total price</span><b>${money(m.amount)}</b></div>
      <div class="summary-row"><span>Average price</span><b>${money(m.avgRate)}/kg</b></div>
      ${(() => {
        /* [FIX 99] income statement + sell-now-vs-next-month estimator */
        const est = marketFeedEstimate();
        const expTotal = (market.expenses || []).reduce((a, e) => a + (num(e.amt) || 0), 0);
        const feedCost = est.cost || 0;
        const totalCost = feedCost + expTotal;
        const net = m.amount - totalCost;
        const ws = market.weights.map(num).filter(v => v !== null && v > 0);
        const brs = market.brackets.map(b => ({ lo: num(b.min), hi: num(b.max), rate: num(b.rate) })).filter(b => b.lo !== null && b.hi !== null && b.rate !== null);
        const rateAt = w => { const hit = brs.find(b => w >= b.lo && w <= b.hi); if (hit) return hit.rate; const top = brs.slice().sort((a, b) => b.hi - a.hi)[0]; if (top && w > top.hi) return top.rate; const low = brs.slice().sort((a, b) => a.lo - b.lo)[0]; return low ? low.rate : 0; };
        const revNext = ws.reduce((a, w) => a + (w + est.adg * 30) * rateAt(w + est.adg * 30), 0);
        const feedNext = ws.length * 30 * 2.6 * (est.pricePerKg || 0);
        const profitNext = revNext - feedCost - feedNext - expTotal;
        const diff = profitNext - net;
        const d30 = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
        const avgNext = ws.length ? ws.reduce((a, w) => a + w + est.adg * 30, 0) / ws.length : 0;
        return `
      <div class="fc-subhead" style="margin-top:16px"><b>💹 Income computation</b><small class="muted">revenue − feed − expenses</small></div>
      <div class="summary-row"><span>Feed consumed (${est.kg ? Math.round(est.kg) + ' kg · ' : ''}${est.source || 'no data'})</span><b>−${money(feedCost)}</b></div>
      ${est.stages.length ? `<div class="table-wrap" style="margin:6px 0 10px"><table class="table fc-table"><thead><tr><th>Feed stage</th><th>Bags</th><th>₱/bag</th><th>Cost</th></tr></thead><tbody>${est.stages.map(s => `<tr><td>${esc(s.label)}${s.src === 'recorded' ? ' <span class="tag ok" style="font-size:9px">RECORDED</span>' : (s.src === 'trial' ? '' : ' <span class="tag" style="font-size:9px">EST</span>')}</td><td>${s.bags !== null ? s.bags.toFixed(1) + ' × ' + s.bkg + 'kg' : (s.kg ? Math.round(s.kg) + ' kg' : '—')}</td><td>${s.prBag ? money(s.prBag) : '—'}</td><td><b>${money(s.cost)}</b></td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="summary-row"><span>Additional expenses</span><b>−${money(expTotal)}</b></div>
      <div class="summary-row"><span>Total production cost</span><b>−${money(totalCost)}</b></div>
      <div class="fc-total" style="${net < 0 ? 'border-color:rgba(239,68,68,.5)' : ''}"><span>NET INCOME</span><b style="color:${net < 0 ? '#ff8b95' : '#64e5c0'}">${money(net)}</b></div>
      <div class="summary-row"><span>Net per head / margin</span><b>${m.heads ? money(net / m.heads) + ' / ' + (m.amount ? Math.round(net / m.amount * 100) : 0) + '%' : '—'}</b></div>
      ${ws.length ? `
      <div class="fc-subhead" style="margin-top:16px"><b>⏱ Sell now or next month?</b><small class="muted">ADG ${ (est.adg * 1000).toFixed(0) } g/d · projects +30 days</small></div>
      <div class="summary-row"><span>💰 Sell now (${m.heads} hd · ${m.avg.toFixed(0)} kg avg)</span><b style="color:${net < 0 ? '#ff8b95' : '#64e5c0'}">${money(net)}</b></div>
      <div class="summary-row"><span>⏳ Sell ${d30} (~${avgNext.toFixed(0)} kg avg)</span><b style="color:${profitNext < 0 ? '#ff8b95' : '#64e5c0'}">${money(profitNext)}</b></div>
      <small class="muted" style="display:block;margin-top:4px">Next-month view adds ~${money(feedNext)} feed for +${(avgNext - m.avg).toFixed(0)} kg/head at today's brackets.</small>
      <div class="notice" style="margin-top:8px;${diff > 0 ? 'border-color:rgba(13,184,174,.6)' : 'border-color:rgba(245,158,11,.6)'}"><b>${diff > 0 ? `⏳ CONSIDER WAITING — projected +${money(diff)} more in 30 days.` : `💰 SELL NOW — waiting 30 days projects ${money(diff)} vs today.`}</b></div>` : ''}`;
      })()}
    </div>`;
  }
  function marketRecalc() {
    marketReadDOM();
    const el = document.getElementById('marketResults');
    if (el) el.innerHTML = marketResultsHTML();
  }
  function marketStructural() {
    /* Callers sync DOM → state first; we only re-render from state here so a
       newly-added unsaved row is not discarded. */
    const panel = document.getElementById('fattenerPanel');
    if (!panel) return;
    const html = marketHTML();
    panel.querySelector('.fc-split').outerHTML = html;
    marketRecalc();
  }
  function marketSwitchBatch(id) { market = null; ensureMarket(id); cur.batch = id; marketStructural(); }
  function marketAddPig() { marketReadDOM(); market.weights.push(''); marketStructural(); }
  function marketDelPig(i) { marketReadDOM(); market.weights.splice(i, 1); marketStructural(); }
  function marketAddBracket() { marketReadDOM(); market.brackets.push({ min: '', max: '', rate: '' }); marketStructural(); const inputs = document.querySelectorAll('#fcBrackets [data-br="min"]'); inputs[inputs.length - 1]?.focus(); }
  function marketDelBracket(i) { marketReadDOM(); market.brackets.splice(i, 1); marketStructural(); }
  function marketAddExpense() { marketReadDOM(); (market.expenses = market.expenses || []).push({ label: '', amt: '' }); marketStructural(); }
  function marketDelExpense(i) { marketReadDOM(); market.expenses.splice(i, 1); marketStructural(); }
  window.marketAddExpense = marketAddExpense;
  window.marketDelExpense = marketDelExpense;
  function marketSaveQuote() {
    marketReadDOM();
    const m = marketMath();
    if (!m.heads) { toast('Enter at least one pig weight first.'); return; }
    if (!m.rows.length) { toast('No weight falls inside a price bracket — add matching brackets.'); return; }
    const quotes = F().marketQuotes || (F().marketQuotes = []);
    /* [FIX 99] persist expenses + income/timing snapshot with the quote */
    const est = marketFeedEstimate();
    const expTotal = (market.expenses || []).reduce((a, e) => a + (num(e.amt) || 0), 0);
    quotes.push({
      id: 'mq-' + Date.now(), batch_id: market.batchId, created: new Date().toISOString(),
      weights: market.weights.map(num).filter(v => v !== null),
      brackets: market.brackets.map(b => ({ min: num(b.min), max: num(b.max), rate: num(b.rate) })).filter(b => b.min !== null && b.max !== null),
      heads: m.heads, kg: m.kgSum, avgW: m.avg, amount: m.amount, avgRate: m.avgRate,
      expenses: (market.expenses || []).map(e => ({ label: e.label || 'Expense', amt: num(e.amt) || 0 })),
      feedCost: est.cost || 0, feedKg: est.kg, feedSource: est.source,
      netIncome: m.amount - (est.cost || 0) - expTotal
    });
    save(); renderCenter(); toast('Price computation saved');
  }
  function marketOpenQuote(id) {
    const q = (F().marketQuotes || []).find(x => x.id === id);
    if (!q) return;
    market = { batchId: q.batch_id, weights: q.weights.slice(), brackets: q.brackets.map(b => ({ ...b })), expenses: (q.expenses || []).map(e => ({ ...e })) };
    cur.batch = q.batch_id;
    renderCenter(); toast('Saved computation loaded');
  }
  function marketDelQuote(id) {
    if (!confirm('Delete this saved price computation?')) return;
    F().marketQuotes = (F().marketQuotes || []).filter(x => x.id !== id);
    save(); renderCenter(); toast('Saved computation deleted');
  }

  /* ── [REBUILD FIX 18] Batch health details modal ────────────────────
     Date of birth, age (months + days), vaccine status and the batch's
     medication history pulled from the Medicine & Treatments ledger. */
  function medRowsHTML(meds) {
    return meds.map(v => `<tr><td>${esc(fmtDate(String(v.date || '').slice(0, 10)) || v.date || '—')}</td><td><b>${esc(v.item_name || '—')}</b></td><td>${Math.abs(+v.delta || 0)} ${esc(v.unit || '')}</td><td>${v.dose_per_head != null ? esc(v.dose_per_head) + ' ' + esc(v.unit || '') : '—'}</td><td>${v.heads ?? '—'}</td><td>${esc(v.reason || '—')}</td><td>${esc(v.administered_by || '—')}</td></tr>`).join('');
  }

  function dateOffset(dStr, daysCount) {
    if (!dStr) return "";
    try {
      const d = new Date(dStr + (String(dStr).includes("T") ? "" : "T00:00:00"));
      d.setDate(d.getDate() + daysCount);
      return d.toISOString().slice(0, 10);
    } catch(e) { return ""; }
  }

  function healthSectionsHTML(t, forPrint) {
    const b = batch(t.batch_id || t.id || t.bid);
    if (!b) return `<div class="empty">Batch ${esc(t.batch_id || "record")} is no longer in the piglet records.</div>`;
    
    const age = ageMonths(b.birth), alive = aliveHeads(b), meds = batchMeds(b.id);
    const farm = F();
    const ageDays = b.birth ? Math.max(0, days(b.birth)) : 0;
    const ageDetailed = window.calcAgeDetailed ? window.calcAgeDetailed(b.birth) : { summary: (age ? age.text : ageDays + " days old"), formattedDob: fmtDate(b.birth) };

    // Get live counts from piglet ledger
    const c = (window.getPigletCounts ? window.getPigletCounts(b) : null) || {
      alive: alive,
      aliveM: +b.males || 0,
      aliveF: +b.females || 0,
      availableAll: alive,
      breeder: 0,
      fattener: 0,
      farm: 0,
      reserved: 0,
      mortality: 0
    };

    if (forPrint) {
      const f = (l, v) => `<div class="cert-field"><span>${l}</span><b>${v}</b></div>`;
      return {
        b, age, alive, meds,
        info: f("Batch", `${esc(b.id)} · ${esc(b.dam_name || b.sow || "—")} → ${esc(b.sire_name || b.sire || "—")}`) +
          f("Breed", esc(b.breed || "—")) +
          (b.semen || b.semen_batch_no ? f("Semen batch", esc(b.semen_batch_no || b.semen)) : "") +
          f("Date of birth", b.birth ? esc(fmtDate(b.birth)) : "—") +
          f("Age (months + days)", age ? esc(age.text) : "—") +
          f("Days old", b.birth ? days(b.birth) : "—") +
          ((b.weaning_date || b.weanedAt) ? f("Weaning date", esc(fmtDate(b.weaning_date || b.weanedAt))) : "") +
          f("Heads born", `${(+b.males || 0) + (+b.females || 0)} (♂ ${+b.males || 0} · ♀ ${+b.females || 0})`) +
          f("Heads alive", alive),
        vac: f("Vaccination status", esc(b.vaccination_status || "No record")) +
          f("Vaccines given", esc(b.vaccines_given || "No record")) +
          f("Health status", esc(b.health_status || "No record")) +
          f("Iron injection", yesNo(!!b.iron) + (b.iron && b.ironAt ? " · " + esc(fmtDate(b.ironAt)) : "")) +
          f("Castration", b.castration ? "Yes" + (b.castrAt ? " · " + esc(fmtDate(b.castrAt)) : "") : (b.castration_exempt === "breeder" ? "No — males kept as breeders" : "No")) +
          f("Weaning", yesNo(!!b.weaning || !!b.weaning_date || !!b.weanedAt))
      };
    }

    // 1. Care Alert Flags
    const ironAlert = ageDays >= 3 && !b.iron;
    const castrAlert = ageDays >= 3 && !b.castration && b.castration_exempt !== "breeder" && (+b.males > 0 || c.aliveM > 0);
    const weanAlert = ageDays >= 30 && !(b.weanedAt || b.weaning_date || b.weaning);
    const vaxAlert = !b.vaccination_status && !b.vaccines_given;

    // 2. Breeder Release Tracking (Min 3 Months / 90 Days)
    const breederTargetDate = b.birth ? dateOffset(b.birth, 90) : "";
    const breederDaysLeft = Math.max(0, 90 - ageDays);
    const breederProgress = Math.min(100, Math.round((ageDays / 90) * 100));
    const isBreederReady = ageDays >= 90;

    // 3. Fattener Market Window (150-175 Days, Optimal ~160 Days)
    const marketTargetDate = b.birth ? dateOffset(b.birth, 160) : "";
    const marketDaysLeft = Math.max(0, 160 - ageDays);
    const marketWeeksLeft = Math.ceil(marketDaysLeft / 7);
    const fattenerHeads = c.fattener > 0 ? c.fattener : Math.max(0, alive - c.breeder);
    const estMarketPricePerHead = 95 * 230; // 95 kg avg × ₱230/kg
    const estTotalRevenue = fattenerHeads * estMarketPricePerHead;

    let feedStage = "Pre-Starter / Creep";
    if (ageDays >= 30 && ageDays < 70) feedStage = "Starter Feed (Target ADG: ~450g/d)";
    else if (ageDays >= 70 && ageDays < 120) feedStage = "Grower Feed (Target ADG: ~680g/d)";
    else if (ageDays >= 120 && ageDays < 160) feedStage = "Finisher Feed (Target ADG: ~820g/d)";
    else if (ageDays >= 160) feedStage = "🏆 Market Finish Ready (85–105 kg)";

    // 4. Housing & Barn/Pen Location
    let housing = { barnName: "Unassigned Housing", penName: "—", zoneType: "General Pen", daysInPen: 0, hasHousing: false };
    (farm.barns || []).forEach(barn => {
      (barn.pens || []).forEach(pen => {
        const occ = String(pen.occupant_id || pen.batch_id || "").toLowerCase();
        if (occ && (occ === String(b.id).toLowerCase() || occ === String(b.name || "").toLowerCase())) {
          housing = {
            barnId: barn.id,
            barnName: barn.name,
            penId: pen.id,
            penName: pen.name || pen.id,
            zoneType: (pen.type === "crate" ? "Farrowing Crate" : (pen.type === "group_pen" ? (barn.type === "Nursery" ? "Nursery Pen" : "Grower/Finisher Pen") : "Housing Stall")),
            daysInPen: pen.occupied_since ? Math.max(0, days(pen.occupied_since)) : 0,
            hasHousing: true
          };
        }
      });
    });

    // 5. Reservations on this Batch
    const reservations = (farm.reservations || []).filter(r => 
      String(r.batch_id || "").toLowerCase() === String(b.id).toLowerCase() ||
      (Array.isArray(r.lines) && r.lines.some(l => String(l.batch_id || "").toLowerCase() === String(b.id).toLowerCase()))
    );

    // 6. Mortality Records on this Batch
    const mortalities = (farm.pigletLedger || []).filter(x => 
      x.batch_id === b.id && x.type === "mortality" && !["undone", "deleted"].includes(x.status)
    ).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

    const totalDeadHeads = mortalities.reduce((acc, m) => acc + (+m.quantity || 0), 0);
    const totalDeadLoss = mortalities.reduce((acc, m) => acc + (+m.total_loss || (+m.quantity * (+m.unit_price || 3500)) || 0), 0);

    const row = (l, v) => `<div class="fc-trow"><span>${l}</span><b>${v}</b></div>`;

    return `
      <!-- 1. Interactive Pulsing Alerts (Tap to Complete) -->
      ${(ironAlert || castrAlert || weanAlert || vaxAlert) ? `
        <div class="care-quick-strip" style="background:rgba(0,0,0,0.25);padding:10px 14px;border-radius:12px;border:1px solid var(--line);margin-bottom:14px">
          <small class="muted" style="display:block;margin-bottom:6px;font-weight:600">⚡ ACTION REQUIRED — Tap an alert to complete in 1 tap:</small>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${ironAlert ? `<button type="button" class="care-pulse-alert iron" onclick="openCareQuick('${escJS(b.id)}','iron')">💉 Need Iron Injection (Day ${ageDays})</button>` : ""}
            ${castrAlert ? `<button type="button" class="care-pulse-alert castr" onclick="openCareQuick('${escJS(b.id)}','castr')">✂ Need Castration (♂ ${c.aliveM} males)</button>` : ""}
            ${weanAlert ? `<button type="button" class="care-pulse-alert wean" onclick="openCareQuick('${escJS(b.id)}','wean')">🐖 Weaning Due (${ageDays}d old)</button>` : ""}
            ${vaxAlert ? `<button type="button" class="care-pulse-alert vacc" onclick="openCareQuick('${escJS(b.id)}','vacc')">🛡 Pending Vaccine Record</button>` : ""}
          </div>
        </div>
      ` : ""}

      <!-- 2. 4-Card Vital Metrics Grid -->
      <div class="boar-metric-grid">
        <div class="boar-stat-card">
          <small>🎂 Birthday &amp; Age</small>
          <b>${ageDetailed.summary}</b>
          <span>DOB: ${b.birth ? fmtDate(b.birth) : "—"} (${ageDays}d old)</span>
          <span style="display:block;margin-top:3px">🍼 Weaned: ${b.weanedAt || b.weaning_date ? fmtDate(b.weanedAt || b.weaning_date) : "not weaned yet"}</span> <!-- [FIX 140] -->
        </div>
        <div class="boar-stat-card">
          <small>🐖 Living Herd</small>
          <b>${c.alive} live head</b>
          <span>♂ ${c.aliveM} males · ♀ ${c.aliveF} females</span>
        </div>
        <div class="boar-stat-card" style="cursor:pointer" onclick="window.openMovementWizard && window.openMovementWizard('${esc(b.id)}','batch')" title="Tap to assign or change this batch's housing">
          <small>🏠 Current Housing</small>
          <b>${esc(housing.barnName)}</b>
          <span>${housing.zoneType}: <b>${esc(housing.penName)}</b></span>
          <!-- [REBUILD FIX 91] housing card is now actionable -->
          <span style="display:block;margin-top:5px;font-size:10px;color:var(--teal2);font-weight:800">${housing.hasHousing ? "🔁 Tap to move / re-assign pen" : "➕ Tap to assign housing"}</span>
        </div>
        <div class="boar-stat-card">
          <small>⚖️ Average Weight</small>
          <b>${b.release_weight ? (+b.release_weight).toFixed(2) + " kg" : (b.weaning_weight ? (+b.weaning_weight).toFixed(2) + " kg" : (b.birth_weight ? (+b.birth_weight).toFixed(2) + " kg" : "—"))}</b>
          <span>${b.release_weight ? "Release weight" : (b.weaning_weight ? "Weaning avg" : (b.birth_weight ? "Birth avg" : "Weigh on scale"))}</span>
        </div>
      </div>

      <!-- 3. Visual Milestone Progression Pipeline -->
      <div class="milestone-timeline">
        <div class="milestone-step done">
          <div class="milestone-dot">✓</div>
          <small>Day 0</small>
          <b>Farrowing</b>
        </div>
        <div class="milestone-step ${b.iron ? "done" : (ageDays >= 3 ? "active" : "")}">
          <div class="milestone-dot">${b.iron ? "✓" : "2"}</div>
          <small>Day 3</small>
          <b>Iron Inj.</b>
        </div>
        <div class="milestone-step ${b.castration || b.castration_exempt === "breeder" ? "done" : (ageDays >= 7 ? "active" : "")}">
          <div class="milestone-dot">${b.castration || b.castration_exempt === "breeder" ? "✓" : "3"}</div>
          <small>Day 7</small>
          <b>Castration</b>
        </div>
        <div class="milestone-step ${b.weaning || b.weaning_date || b.weanedAt ? "done" : (ageDays >= 30 ? "active" : "")}">
          <div class="milestone-dot">${b.weaning || b.weaning_date || b.weanedAt ? "done" : "4"}</div>
          <small>Day 30</small>
          <b>Weaning</b>
        </div>
        <div class="milestone-step ${isBreederReady ? "done" : (ageDays >= 60 ? "active" : "")}">
          <div class="milestone-dot">${isBreederReady ? "✓" : "5"}</div>
          <small>Day 90</small>
          <b>3-Mo Breeder</b>
        </div>
        <div class="milestone-step ${ageDays >= 160 ? "done" : ""}">
          <div class="milestone-dot">${ageDays >= 160 ? "✓" : "6"}</div>
          <small>Day 160</small>
          <b>Market Ready</b>
        </div>
      </div>

      <!-- Piglet Batches — Stage Planner (Inserted before Breeder Stock Release Readiness) -->
      ${window.renderBatchStagePlannerHTML ? window.renderBatchStagePlannerHTML(b) : ''}

      <!-- 4. Breeder Release Readiness (Minimum 3 Months / 90 Days from Birth) -->
      <div class="breeder-release-box">
        <div class="boar-sec-head">
          <h3>🌱 Breeder Stock Release Readiness <small class="muted">(Min. 3 Months from Birth)</small></h3>
          <span class="tag ${isBreederReady ? "" : "warn"}">${isBreederReady ? "🏆 READY FOR RELEASE" : breederDaysLeft + "d remaining"}</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill ${isBreederReady ? "gold" : ""}" style="width:${breederProgress}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:12px">
          <span>Target 3-Month Release Date: <b>${breederTargetDate ? fmtDate(breederTargetDate) : "—"}</b></span>
          <span>Assigned Breeders: <b>${c.breeder} head</b> (♂ ${c.breederM} · ♀ ${c.breederF})</span>
        </div>
        ${isBreederReady ? `
          <div style="margin-top:8px;padding:8px 12px;background:rgba(23,202,190,0.12);border-radius:8px;border:1px solid rgba(23,202,190,0.3);font-size:12.5px;color:var(--teal2)">
            ✨ <b>3-Month Maturity Reached:</b> These piglets have reached the 90-day biological minimum age for breeder selection, sales transfer, and reservation certificates!
          </div>
        ` : `
          <small class="muted" style="display:block;margin-top:6px">Piglets assigned as breeding stock require a minimum of 90 days from birth for reproductive conformation, vaccination completion, and health release.</small>
        `}
      </div>

      <!-- 5. Fattener Market Window & Best-to-Sell Predictor -->
      <div class="fattener-market-box">
        <div class="boar-sec-head">
          <h3>📈 Fattener Market Readiness &amp; Best-to-Sell Window</h3>
          <span class="tag">${c.fattener} Fatteners</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;margin-top:8px">
          <div>
            <small class="muted">Optimal Selling Window</small>
            <b style="display:block;font-size:14px;color:#60a5fa">${marketTargetDate ? fmtDate(marketTargetDate) : "—"} <small>(~${marketWeeksLeft} wks)</small></b>
          </div>
          <div>
            <small class="muted">Current Growth &amp; Feed Stage</small>
            <b style="display:block;font-size:13px;color:var(--ink)">${feedStage}</b>
          </div>
          <div>
            <small class="muted">Est. Market Value @ 95kg liveweight</small>
            <b style="display:block;font-size:14px;color:#34d399">${peso(estTotalRevenue)}</b>
          </div>
        </div>
        <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <small class="muted">Target finishing liveweight: <b>85 kg – 105 kg</b> at standard 150–175 day market window.</small>
          <button type="button" class="btn ghost small" onclick="document.getElementById('fcHealthModal').remove();window.openFattenerCenter && window.openFattenerCenter('${esc(b.id)}')">📈 Feed Trials &amp; Selling →</button>
        </div>
      </div>

      <!-- 6. Allocations & Headcount Breakdown -->
      <div class="boar-section">
        <div class="boar-sec-head">
          <h3>🐖 Live Headcount Allocations</h3>
          <button type="button" class="btn ghost small" onclick="document.getElementById('fcHealthModal').remove();window.openBatchLedger && window.openBatchLedger('${esc(b.id)}')">📊 Batch Hub →</button>
        </div>
        <div class="alloc-badge-grid">
          <span class="alloc-pill">Born: <b>${(+b.males || 0) + (+b.females || 0)}</b></span>
          <span class="alloc-pill">Total Alive: <b>${c.alive}</b> (♂${c.aliveM} · ♀${c.aliveF})</span>
          <span class="alloc-pill">Unassigned: <b>${c.availableAll}</b></span>
          <span class="alloc-pill breeder">Breeder: <b>${c.breeder}</b></span>
          <span class="alloc-pill fattener">Fattener: <b>${c.fattener}</b></span>
          <span class="alloc-pill farm">Farm Use: <b>${c.farm}</b></span>
          <span class="alloc-pill reserved">Reserved: <b>${c.reserved}</b></span>
          <span class="alloc-pill mortality">Mortality: <b>${c.mortality}</b></span>
        </div>
      </div>

      <!-- 7. Active Reservations (if any) -->
      ${reservations.length ? `
        <div class="boar-section">
          <div class="boar-sec-head">
            <h3>📜 Customer Reservations (${reservations.length})</h3>
            <button type="button" class="btn ghost small" onclick="document.getElementById('fcHealthModal').remove();window.viewBatchReservations && window.viewBatchReservations('${esc(b.id)}')">View All →</button>
          </div>
          <div class="boar-table-scroll">
            <table class="table fc-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Reserved Heads</th>
                  <th>Deposit Paid</th>
                  <th>Balance</th>
                  <th>Certificate</th>
                </tr>
              </thead>
              <tbody>
                ${reservations.map(r => `
                  <tr>
                    <td><b>${esc(r.customer_name || r.customer || "Customer")}</b></td>
                    <td>${r.quantity || (r.lines ? r.lines.reduce((a, l) => a + (+l.quantity || 0), 0) : 1)} head</td>
                    <td>${peso(r.paid ?? r.deposit ?? 0)}</td>
                    <td><b>${peso(r.balance || 0)}</b></td>
                    <td><button type="button" class="btn ghost mini" style="cursor:pointer;font-weight:700;color:var(--teal2)" onclick="window.openReservationDetails('${esc(r.id || r.no)}')">📜 Print Cert</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      ` : ""}

      <!-- 8. Mortality & Financial Loss Records -->
      <div class="boar-section">
        <div class="boar-sec-head">
          <h3>💀 Mortality &amp; Financial Loss Log (${totalDeadHeads} head)</h3>
          <button type="button" class="btn danger-btn small" onclick="document.getElementById('fcHealthModal').remove();window.openMortality && window.openMortality('${esc(b.id)}')">💀 Record Mortality</button>
        </div>
        ${mortalities.length ? `
          <div class="boar-table-scroll">
            <table class="table fc-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Dead</th>
                  <th>Sex</th>
                  <th>Cause / Reason</th>
                  <th>Unit Price</th>
                  <th>Loss Amount</th>
                </tr>
              </thead>
              <tbody>
                ${mortalities.map(m => `
                  <tr>
                    <td><small>${fmtDate(String(m.created_at || m.date || "").slice(0, 10))}</small></td>
                    <td><b>${m.quantity} head</b></td>
                    <td>${m.gender === "male" ? "♂ M" : (m.gender === "female" ? "♀ F" : "All")}</td>
                    <td><small>${esc(m.cause || m.notes || "Mortality")}</small></td>
                    <td>${peso(m.unit_price || 3500)}</td>
                    <td><b style="color:#ef4444">${peso(m.total_loss || (m.quantity * (m.unit_price || 3500)))}</b></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <div style="margin-top:8px;text-align:right;font-size:12.5px">
            <span>Total Logged Financial Loss: <b style="color:#ef4444;font-size:14px">${peso(totalDeadLoss)}</b></span>
          </div>
        ` : `
          <div class="empty" style="color:var(--teal2)">✔ Zero mortality recorded for this batch (100% herd viability).</div>
        `}
      </div>

      <!-- 9. Housing Facility & Movement Details -->
      <div class="housing-facility-box">
        <div class="boar-sec-head">
          <h3>🏠 Housing Facility &amp; Location</h3>
          <button type="button" class="btn ghost small" onclick="document.getElementById('fcHealthModal').remove();window.openMovementWizard && window.openMovementWizard('${esc(b.id)}', 'batch')">🚚 Transfer Pen / Move</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;margin-top:8px">
          <div>
            <small class="muted">Facility / Barn</small>
            <b style="display:block;font-size:14px">${esc(housing.barnName)}</b>
          </div>
          <div>
            <small class="muted">Pen / Crate / Stall</small>
            <b style="display:block;font-size:14px">${housing.zoneType}: ${esc(housing.penName)}</b>
          </div>
          <div>
            <small class="muted">Duration in Location</small>
            <b style="display:block;font-size:14px">${housing.daysInPen > 0 ? housing.daysInPen + " days" : "Recently assigned"}</b>
          </div>
        </div>
      </div>

      <!-- 10. Vaccines & Veterinary Medications -->
      <div class="fc-health-sec">
        <h4>💉 Vaccination Status</h4>
        ${b.vaccination_status ? row("Status", `<span class="tag ${/up to date/i.test(b.vaccination_status) ? "" : "warn"}">${esc(b.vaccination_status)}</span>`) : `<p class="muted fc-health-none">No vaccination status recorded yet — set it in <b>⚖ Performance &amp; Ear Notches</b>.</p>`}
        ${b.vaccines_given ? row("Vaccines given", esc(b.vaccines_given)) : ""}
        ${row("Health status", esc(b.health_status || "Healthy"))}
        ${row("Iron injection", yesNo(!!b.iron) + (b.iron && b.ironAt ? " · " + esc(fmtDate(b.ironAt)) : ""))}
        ${row("Castration", b.castration ? "Yes" + (b.castrAt ? " · " + esc(fmtDate(b.castrAt)) : "") : (b.castration_exempt === "breeder" ? "No — males kept as breeders" : "No"))}
        ${row("Weaning", yesNo(!!b.weaning || !!b.weaning_date || !!b.weanedAt))}
      </div>

      <div class="fc-health-sec">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
          <h4 style="margin:0">🩺 Medication History <small class="muted">· from Medicine &amp; Treatments</small></h4>
          <button type="button" class="btn small" style="background:#059669;color:#fff;font-weight:700" onclick="window.openBatchMedication && window.openBatchMedication('${esc(b.id)}')">＋ 💉 Add Treatment / Medication</button>
        </div>
        ${meds.length ? `
          <div class="table-wrap">
            <table class="table fc-table fc-med-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Medicine</th>
                  <th>Total used</th>
                  <th>Dose/head</th>
                  <th>Heads</th>
                  <th>Reason</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>${medRowsHTML(meds)}</tbody>
            </table>
          </div>
        ` : `
          <p class="muted fc-health-none">No medication records for this batch yet. Go to <b>Medicine &amp; Treatments</b>, tap <b>💉 Treat</b> and choose <b>Piglet batch · ${esc(b.id)}</b>.</p>
        `}
      </div>
    `;
  }

  /* Shared details modal — used by the feed-trial 🩺 button and by the
     clickable rows on the Piglet Batches drill-down. */
  function batchDetailsModal(opts) {
    document.getElementById('fcHealthModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="fcHealthModal"><div class="reminder-modal fc-health-modal">
      <div class="modal-top">
        <div>
          <div class="eyebrow" style="color:var(--teal2);font-weight:700">🐷 PIGLET BATCH HEALTH &amp; PERFORMANCE PROFILE</div>
          <h2>${opts.title}</h2>
          <p class="perf-sub">${opts.sub}</p>
        </div>
        <button type="button" class="close-reminder" onclick="document.getElementById('fcHealthModal').remove()">×</button>
      </div>
      ${opts.careRow || ''}
      ${healthSectionsHTML({ batch_id: opts.bid })}
      <div class="due-actions" style="margin-top:16px;flex-wrap:wrap;gap:8px;justify-content:space-between">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${opts.actions || ''}
        </div>
        <button type="button" class="btn" onclick="document.getElementById('fcHealthModal').remove()">Done</button>
      </div>
    </div></div>`);
  }

  function openTrialHealth(id) {
    const t = (F().feedTrials || []).find(x => x.id === id);
    if (!t) return;
    batchDetailsModal({
      title: '🩺 Batch health details',
      sub: `<b>${esc(t.name)}</b> · batch <b>${esc(t.batch_id)}</b>`,
      bid: t.batch_id,
      actions: `<button type="button" class="btn" onclick="document.getElementById('fcHealthModal').remove();window.openBatchPedigreeTree && window.openBatchPedigreeTree(decodeURIComponent('${encodeURIComponent(t.batch_id)}'))">🧬 View lineage tree</button>` +
        `<button type="button" class="btn ghost" onclick="document.getElementById('fcHealthModal').remove();openTrialReport('${esc(t.id)}')">📄 Open printable client report</button>`
    });
  }

  function openBatchDetails(bid) {
    const b = batch(bid);
    if (!b) { toast('Batch ' + bid + ' is no longer in the piglet records.'); return; }
    const _fost = b.foster || b.cross_fostered || (Array.isArray(b.foster_from) && b.foster_from.length > 0);
    
    batchDetailsModal({
      title: `🐷 Batch Details · ${esc(b.id)} ${_fost ? '<span class="foster-animated-badge">🍼 FOSTERED</span>' : ''}`,
      sub: `${b.nurse_sow ? `Nurse Sow: <b>${esc(b.nurse_sow)}</b> · ` : ''}Dam: <b>${esc(b.dam_name || b.sow || '—')}</b> → Sire: <b>${esc(b.sire_name || b.sire || '—')}</b> · ${esc(b.breed || '—')}` +
        (b.archived ? ` · <span class="archived-pill">🗄 ARCHIVED · ${esc(b.archivedAt || '')}</span>` : ''),
      bid,
      careRow: _fost && Array.isArray(b.foster_from) && b.foster_from.length ? `
        <div class="foster-batch-card" style="background:linear-gradient(135deg,rgba(236,72,153,0.15),rgba(168,85,247,0.12));border:1.5px solid rgba(236,72,153,0.5);border-radius:12px;padding:12px 14px;margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span class="foster-animated-badge">🍼 FOSTERED PIGLETS</span>
            <small class="muted">${b.nurse_sow ? 'Nurse Sow: <b>' + esc(b.nurse_sow) + '</b>' : 'Fostered in'}</small>
          </div>
          <div style="font-size:12.5px">
            ${b.foster_from.map(f => `<div>⇢ <b>${Math.max(0, (+f.males || 0) - (+f.returned_males || 0))}♂ + ${Math.max(0, (+f.females || 0) - (+f.returned_females || 0))}♀</b> fostered from <b>${esc(f.from)}</b> (Dam: ${esc(f.dam || '—')}${f.breed ? ' · ' + esc(f.breed) : ''})${(+f.returned_males || 0) + (+f.returned_females || 0) ? ` <small class="muted">· returned ${f.returned_males || 0}♂ + ${f.returned_females || 0}♀</small>` : ''}</div>`).join('')}
          </div>
        </div>
      ` : '',
      actions: `<button type="button" class="btn" onclick="document.getElementById('fcHealthModal').remove();window.openBatchPedigreeTree && window.openBatchPedigreeTree(decodeURIComponent('${encodeURIComponent(bid)}'))">🧬 View lineage tree</button>` +
        `<button type="button" class="btn" onclick="document.getElementById('fcHealthModal').remove();window.openBatchLedger && window.openBatchLedger('${esc(bid)}')">📊 Open batch hub</button>` +
        (_fost && window.openFosterReturnModal ? `<button type="button" class="btn" onclick="document.getElementById('fcHealthModal').remove();window.openFosterReturnModal('${esc(bid)}')">↩ Return fostered piglets</button>` : '') +
        `<button type="button" class="btn danger-btn" onclick="document.getElementById('fcHealthModal').remove();window.openMortality && window.openMortality('${esc(bid)}')">💀 Record Mortality</button>` +
        `<button type="button" class="btn ghost" onclick="document.getElementById('fcHealthModal').remove();window.openPigletEditor && window.openPigletEditor('${esc(bid)}')">✎ Edit details</button>` +
        `<button type="button" class="btn ghost ${b.archived ? '' : 'archive-btn'}" onclick="toggleBatchArchive('${esc(bid)}')">${b.archived ? '↩ Restore batch' : '🗄 Archive batch'}</button>`
    });
  }
  
  function openBatchMedication(batchId) {
    const b = batch(batchId);
    if (!b) return;
    const alive = aliveHeads ? aliveHeads(b) : ((+b.males || 0) + (+b.females || 0));
    if (window.openMedTreatment) {
      window.openMedTreatment('', 'batch', {
        ref: 'batch:' + b.id,
        label: 'Piglet batch · ' + b.id + (b.breed ? ' (' + b.breed + ')' : ''),
        heads: Math.max(1, alive)
      }, Math.max(1, alive));
    }
  }

  window.openBatchDetails = openBatchDetails;
  window.openBatchMedication = openBatchMedication;
  window.openTrialHealth = openTrialHealth;
  window.batchDetailsModal = batchDetailsModal;

  function openTrialReport(id) {
    const t = (F().feedTrials || []).find(x => x.id === id);
    if (!t) return;
    const farm = F(),
      farmLogo = document.querySelector('.sidebar .logo-img')?.src || '',
      appLogo = document.querySelector('.sidebar .logo-img')?.dataset.defaultSrc || farmLogo,
      done = t.status === 'completed',
      docNo = 'FTR-' + String(t.started || '').replace(/-/g, '') + '-' + String(t.id).replace(/\D/g, '').slice(-4),
      H = healthSectionsHTML(t, true),
      b = H && H.b,
      ms = t.groups.map(g => groupMetrics(t, g)),
      valid = ms.map((m, i) => ({ m, i })).filter(x => x.m && x.m.totalGain > 0),
      bestAdg = valid.length ? valid.reduce((a, x) => x.m.adg > a.m.adg ? x : a, valid[0]).i : -1,
      bestFcr = valid.filter(x => x.m.fcr !== null).length ? valid.filter(x => x.m.fcr !== null).reduce((a, x) => x.m.fcr < a.m.fcr ? x : a).i : -1,
      bestCost = valid.filter(x => x.m.costGain !== null).length ? valid.filter(x => x.m.costGain !== null).reduce((a, x) => x.m.costGain < a.m.costGain ? x : a).i : -1;
    const star = (i, k) => (k === 'adg' && i === bestAdg) || (k === 'fcr' && i === bestFcr) || (k === 'cost' && i === bestCost) ? ' <span class="fc-report-best">★ best</span>' : '';
    const metricRows = [
      ['Feed brand', (g) => `<b>${esc(g.brand)}</b>`],
      ['Feed type', (g) => esc(g.type || 'Feed')],
      ['Heads on feed', (g, m) => m ? m.heads : '—'],
      ['Days on trial', (g, m) => m ? m.dspan : '—'],
      ['Start weight', (g, m) => m ? kg(m.sw) : '—'],
      ['Current weight', (g, m) => m ? kg(m.cw) : '—'],
      ['Avg daily gain (ADG)', (g, m, i) => (m ? gd(m.adg) : '—') + star(i, 'adg')],
      ['Total weight gain', (g, m) => m ? m.totalGain.toFixed(1) + ' kg' : '—'],
      ['Daily feed / head (ADFI)', (g, m) => m && m.adfi !== null ? m.adfi.toFixed(2) + ' kg' : '—'],
      ['Feed conversion (FCR)', (g, m, i) => (m && m.fcr !== null ? m.fcr.toFixed(2) : '—') + star(i, 'fcr')],
      ['Feed cost / kg gain', (g, m, i) => (m && m.costGain !== null ? money(m.costGain) : '—') + star(i, 'cost')],
      ['Est. to ' + MARKET_W + ' kg', (g, m) => m ? (m.toMkt === 0 ? 'at / over target ✓' : '~' + m.toMkt + ' days · ' + fmtDate(isoOff(m.toMkt))) : '—']
    ].map(r => `<tr><td>${r[0]}</td>${t.groups.map((g, i) => `<td>${r[1](g, ms[i], i)}</td>`).join('')}</tr>`).join('');
    /* market readiness: highest current weight across feeds + best ADG */
    const msOk = ms.filter(Boolean),
      top = msOk.length ? msOk.reduce((a, m) => m.cw >= a.cw ? m : a) : null,
      bestRate = msOk.length ? Math.max(...msOk.map(m => m.adg)) : 0,
      ready = b ? marketReady(b) : false,
      eta = top && top.cw < MARKET_W && bestRate > 0 ? Math.ceil((MARKET_W - top.cw) / bestRate) : 0;
    const medTable = H && H.meds && H.meds.length
      ? `<table class="fc-report-table"><thead><tr><th>Date</th><th>Medicine</th><th>Total used</th><th>Dose / head</th><th>Heads</th><th>Reason</th><th>Administered by</th></tr></thead><tbody>${medRowsHTML(H.meds)}</tbody></table>`
      : '<p style="margin:6px 0;color:#5d7572">No medication records on file for this batch in Medicine &amp; Treatments.</p>';
    document.getElementById('fcReport')?.remove();
    setTimeout(() => window.updateScaleWidgets && window.updateScaleWidgets(), 50);
    document.body.insertAdjacentHTML('beforeend', `<div class="drill-bg" id="fcReport"><article class="certificate fc-report">
      <header class="cert-header">
        <div class="cert-logo"><img src="${farmLogo}" alt="${esc(farm.name)} logo"></div>
        <div class="cert-title"><small>ARSWINETECH PRO · FEED TRIAL &amp; BATCH HEALTH REPORT</small><h1>${esc(t.name)}</h1><h2>${esc(farm.name)}</h2><span class="cert-status ${done ? '' : 'fc-ongoing'}">${done ? 'completed' : 'ongoing'}</span></div>
        <div class="cert-actions no-print"><button class="btn" onclick="window.print()">Download PDF</button></div>
        <div class="cert-app-logo"><img src="${appLogo}" alt="ARSwineTech"><b>Breed. Feed. Predict.</b></div>
        <button class="close-reminder no-print" onclick="closeTrialReport()">×</button>
      </header>
      <main class="cert-grid">
        <div class="cert-col">
          <section class="cert-card"><h3>Batch Information</h3>${H && H.info ? H.info : `<div class="cert-field"><span>Batch</span><b>${esc(t.batch_id)} (not in records)</b></div>`}</section>
          <section class="cert-card"><h3>Health &amp; Vaccination</h3>${H && H.vac ? H.vac : '—'}</section>
        </div>
        <div class="cert-col">
          <section class="cert-card"><h3>Trial Overview</h3>
            <div class="cert-field"><span>Report no.</span><b>${docNo}</b></div>
            <div class="cert-field"><span>Trial started</span><b>${esc(fmtDate(t.started))}</b></div>
            <div class="cert-field"><span>Latest weigh-in</span><b>${t.as_of ? esc(fmtDate(t.as_of)) : '—'}</b></div>
            ${done && t.completed ? `<div class="cert-field"><span>Completed</span><b>${esc(fmtDate(t.completed))}</b></div>` : ''}
            <div class="cert-field"><span>Feeds compared</span><b>${t.groups.length}</b></div>
          </section>
          <section class="cert-card"><h3>Market Readiness</h3>
            <div class="cert-field"><span>Status</span><b>${ready ? '✓ MARKET READY' : 'Growing out'}</b></div>
            <div class="cert-field"><span>Latest avg weight</span><b>${top ? kg(top.cw) : '—'}</b></div>
            <div class="cert-field"><span>Market target</span><b>${MARKET_W} kg · ${MARKET_AGE} days old</b></div>
            <div class="cert-field"><span>Est. market date</span><b>${ready ? 'Ready now' : top ? (eta ? '~' + eta + ' days · ' + fmtDate(isoOff(eta)) : (b ? 'market age in ~' + Math.max(0, MARKET_AGE - days(b.birth)) + ' days' : '—')) : '—'}</b></div>
          </section>
        </div>
        <section class="cert-card cert-wide"><h3>Medication History</h3>${medTable}</section>
        <section class="cert-card cert-wide"><h3>Feed Trial Results — ${t.groups.length} feed${t.groups.length > 1 ? 's' : ''} compared</h3>
          <div class="fc-report-scroll"><table class="fc-report-table"><thead><tr><th>Metric</th>${t.groups.map((g, i) => `<th>${esc(g.brand)}${star(i, 'adg') || star(i, 'fcr') || star(i, 'cost') ? ' 🏆' : ''}</th>`).join('')}</tr></thead><tbody>${metricRows}</tbody></table></div>
        </section>
      </main>
      <footer class="cert-footer"><div>▣<span>Generated On<b>${new Date().toLocaleString()}</b></span></div><div>♙<span>Generated By<b>${esc(farm.name)}</b></span></div><div>◇<span>Document ID<b>${docNo}</b></span></div></footer>
      <div class="cert-end"><span>This document is system generated by ARSwineTech Pro</span><b>Thank you for trusting ${esc(farm.name)}!</b></div>
      <div class="cert-sign"><span>Client Signature</span><span>Farm Representative</span></div>
    </article></div>`);
    /* [REBUILD FIX 18] lets print CSS drop everything else from the page tree
       so the PDF starts on page 1 (see body.fc-report-open rules). */
    document.body.classList.add('fc-report-open');
  }
  function closeTrialReport() {
    document.getElementById('fcReport')?.remove();
    document.body.classList.remove('fc-report-open');
  }

  /* ── exports ──────────────────────────────────────────────────────── */
  window.openFattenerCenter = openFattenerCenter;
  window.fattenerCenterClose = closeCenter;
  window.fattenerSetTab = setTab;
  window.openTrialModal = openTrialModal;
  window.saveTrial = saveTrial;
  window.trialStatus = trialStatus;
  window.deleteTrial = deleteTrial;
  window.marketRecalc = marketRecalc;
  window.marketSwitchBatch = marketSwitchBatch;
  window.marketAddPig = marketAddPig;
  window.marketDelPig = marketDelPig;
  window.marketAddBracket = marketAddBracket;
  window.marketDelBracket = marketDelBracket;
  window.marketSaveQuote = marketSaveQuote;
  window.marketOpenQuote = marketOpenQuote;
  window.marketDelQuote = marketDelQuote;
  /* [REBUILD FIX 18] */
  window.openTrialHealth = openTrialHealth;
  window.openTrialReport = openTrialReport;
  window.closeTrialReport = closeTrialReport;
  /* [REBUILD FIX 19] */
  
  function openBatchMedication(batchId) {
    const b = batch(batchId);
    if (!b) return;
    const alive = aliveHeads ? aliveHeads(b) : ((+b.males || 0) + (+b.females || 0));
    if (window.openMedTreatment) {
      window.openMedTreatment('', 'batch', {
        ref: 'batch:' + b.id,
        label: 'Piglet batch · ' + b.id + (b.breed ? ' (' + b.breed + ')' : ''),
        heads: Math.max(1, alive)
      }, Math.max(1, alive));
    }
  }

  window.openBatchDetails = openBatchDetails;
  window.openBatchMedication = openBatchMedication;
})();
