/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 145] WORK ORDER CENTER — staff task pipeline with Bluetooth
   POS printing. Replaces the dashboard hero slot with a live WO counter so
   every shift starts with "what must be done", and each work order can be
   printed as a small 58mm thermal copy via the existing BLE ESC/POS engine.

   Data model (stored on the farm record, synced like other arrays):
     f.workOrders[] = { id, title, details, priority: critical|high|medium|low,
       status: open|in_progress|pending_review|blocked|closed,
       assignee, location, due (ISO), created_at, closed_at }
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const F0 = () => (typeof F === 'function' && F()) ? F() : {};
  const wos = f => Array.isArray(f.workOrders) ? f.workOrders : (f.workOrders = []);
  const PRI = { critical: ['CRITICAL', '#ff5c68'], high: ['HIGH', '#fb923c'], medium: ['MEDIUM', '#f0b64b'], low: ['LOW', '#94a3b8'] };
  const ST = { open: 'OPEN', in_progress: 'IN PROGRESS', pending_review: 'PENDING REVIEW', blocked: 'BLOCKED', closed: 'CLOSED' };
  const now = () => Date.now();
  const H24 = 24 * 3600 * 1000;
  const fmtDue = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  function woStats(f) {
    const list = wos(f), t = now();
    const openWos = list.filter(w => w.status !== 'closed');
    const criticalOverdue = openWos.filter(w => w.priority === 'critical' || (w.due && new Date(w.due).getTime() < t));
    const by = st => list.filter(w => w.status === st).length;
    const byPri = p => openWos.filter(w => w.priority === p).length;
    const urgent = openWos.filter(w => w.due && new Date(w.due).getTime() <= t + H24)
      .sort((a, b) => String(a.due).localeCompare(String(b.due)));
    return {
      open: openWos.length, criticalOverdue: criticalOverdue.length,
      inProgress: by('in_progress'), pending: by('pending_review'), blocked: by('blocked'),
      closed7: list.filter(w => w.status === 'closed' && w.closed_at && now() - new Date(w.closed_at).getTime() <= 7 * H24).length,
      pri: { critical: byPri('critical'), high: byPri('high'), medium: byPri('medium'), low: byPri('low') },
      urgent
    };
  }

  /* ── dashboard hero card ─────────────────────────────────────────────── */
  window.arsWODashboard = function (f) {
    const s = woStats(f);
    const chip = (p) => `<span class="wo-pri" style="border-color:${PRI[p][1]}55;background:${PRI[p][1]}18;color:${PRI[p][1]}">${PRI[p][0]} (${s.pri[p]})</span>`;
    return `<div class="panel wo-dash">
      <div class="wo-head"><h2>WORK ORDER DASHBOARD</h2><div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="openWOForm()">＋ Create New W.O.</button>
        <button class="btn ghost" onclick="openWOList()">📋 Full W.O. list →</button>
        <button class="btn ghost" onclick="openPerfCenter()">🏆 Staff Performance</button>
      </div></div>
      <div class="wo-grid">
        <div class="wo-box"><small>TOTAL OPEN WOs</small><b class="${s.open ? 'wo-warn' : ''}">${s.open}</b></div>
        <div class="wo-box"><small>CRITICAL / OVERDUE</small><b class="${s.criticalOverdue ? 'wo-bad' : ''}">${s.criticalOverdue}</b></div>
        <div class="wo-box"><small>IN PROGRESS</small><b>${s.inProgress}</b></div>
        <div class="wo-box"><small>PENDING REVIEW</small><b>${s.pending}</b></div>
        <div class="wo-box"><small>BLOCKED</small><b class="${s.blocked ? 'wo-bad' : ''}">${s.blocked}</b></div>
        <div class="wo-box"><small>CLOSED · 7 DAYS</small><b class="wo-ok">${s.closed7}</b></div>
      </div>
      <div class="wo-pris">${chip('critical')}${chip('high')}${chip('medium')}${chip('low')}</div>
      <div class="wo-urgent">
        <small>URGENT TASKS (next 24h / overdue)</small>
        ${s.urgent.length ? s.urgent.slice(0, 3).map((w, i) => {
          const late = w.due && new Date(w.due).getTime() < now();
          return `<div class="wo-urgent-row" onclick="openWOList()" style="cursor:pointer"><span>${i + 1}. ${esc(w.title)}</span><b class="${late ? 'wo-bad' : 'wo-warn'}">${late ? 'OVERDUE' : 'due ' + fmtDue(w.due)}</b></div>`;
        }).join('') : '<div class="wo-urgent-row"><span>No urgent work orders — enjoy the calm, do the rounds.</span><b class="wo-ok">✓</b></div>'}
      </div>
    </div>`;
  };

  /* ── full list modal ─────────────────────────────────────────────────── */
  window.openWOList = async function () {
    const f = F0();
    /* [FIX 160] merge work orders from the cloud so all devices share them */
    try {
      const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null);
      if (fid && window.ARSCloud && ARSCloud.listWorkOrders) {
        const rows = await ARSCloud.listWorkOrders(fid);
        (rows || []).forEach(rw => {
          const p = rw && rw.payload; if (!p || !p.id) return;
          const i = wos(f).findIndex(x => x.id === p.id);
          if (i >= 0) wos(f)[i] = p; else wos(f).push(p);
        });
      }
    } catch (e) {}
    const list = wos(f).slice().sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || String(a.due || '9999').localeCompare(String(b.due || '9999')));
    const act = list.filter(x => !(x.status === 'closed' && x.closed_at && (now() - new Date(x.closed_at).getTime() > 7 * 864e5)));
    const hist = list.filter(x => (x.status === 'closed' && x.closed_at && (now() - new Date(x.closed_at).getTime() > 7 * 864e5)));
    document.getElementById('woListModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="woListModal" onclick="if(event.target===this)this.remove()" style="z-index:999999!important">
      <div class="reminder-modal" style="max-width:720px;width:96%;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#f0b64b;letter-spacing:.12em;font-weight:800">📋 WORK ORDER CENTER</div><h2>All work orders</h2><small class="muted">Open first, sorted by due date · tap status to move through the pipeline</small></div><button class="close-reminder" onclick="document.getElementById('woListModal').remove()">×</button></div>
        <div style="display:flex;gap:8px;margin:4px 0 12px;flex-wrap:wrap"><button class="btn" onclick="openWOForm()">＋ Create New W.O.</button><button class="btn ghost" onclick="openPerfCenter()">🏆 Staff Performance</button><button class="btn ghost" onclick="openWoTemplates()">🔁 Daily Templates</button></div>
        <div style="margin:0 0 8px"><input id="woSearch" class="search" style="width:100%" placeholder="🔍 Search staff / task / WO id…" oninput="window.woFilterList(this.value)"></div>
        <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px">${[...new Set(wos(f).map(x => (x.assignee || '').trim()).filter(Boolean))].map(n => `<button type="button" class="wo-pri" style="white-space:nowrap;border-color:rgba(145,207,202,.3);background:rgba(145,207,202,.08);color:#c9f5ef" onclick="document.getElementById('woSearch').value='${esc(n).replace(/'/g, "\'")}';window.woFilterList('${esc(n).replace(/'/g, "\'")}')">👤 ${esc(n)}</button>`).join('')}</div>
        ${act.length ? act.map(w => {
          const late = w.status !== 'closed' && w.due && new Date(w.due).getTime() < now();
          const exp = woExpanded.has(w.id);
          return `<div class="wo-row">
            <div class="wo-row-top"><span class="wo-pri" style="border-color:${PRI[w.priority][1]}55;background:${PRI[w.priority][1]}18;color:${PRI[w.priority][1]}">${PRI[w.priority][0]}</span>${w.template_id ? '<span class="wo-pri" style="border-color:#ffd98a55;background:#ffd98a18;color:#ffd98a">🔁 daily</span>' : ''}<b>${esc(w.title)}</b><small class="muted">${esc(w.id)}</small></div>
            <div class="wo-row-meta"><span>👤 ${esc(w.assignee || 'Unassigned')}</span><span>📍 ${esc(w.location || '—')}</span><span class="${late ? 'wo-bad' : ''}">🗓 ${fmtDue(w.due)}</span><span>Status: <b>${ST[w.status]}</b></span></div>
            <button type="button" class="btn ghost small" style="margin:6px 0 0" onclick="woExpand('${w.id}')">${exp ? '▴ Collapse' : '▾ Expand'}</button>
            <div class="wo-body" style="${exp ? '' : 'display:none'}">
            ${w.details ? (() => { const ls = String(w.details).split(/\n+/).map(s => s.trim()).filter(Boolean); const dn = w.done_lines || []; return `<div style="margin:6px 0 0"><small class="muted" style="font-size:10px">${dn.length}/${ls.length} done · tap boxes as you finish each item</small>${ls.map((l, i) => `<label style="display:flex;gap:8px;align-items:flex-start;padding:3px 0;font-size:12px;color:${dn.includes(i) ? '#7fbf9f' : '#c9d9d7'};${dn.includes(i) ? 'text-decoration:line-through;opacity:.8' : ''}"><input type="checkbox" ${dn.includes(i) ? 'checked' : ''} onchange="woToggleLine('${w.id}',${i},this.checked)" style="width:auto;margin-top:2px"> ${esc(l)}</label>`).join('')}</div>`; })() : ''}
            <div class="wo-actions">
              ${w.status === 'open' ? `<button class="btn ghost small" onclick="woSetStatus('${w.id}','in_progress')">▶ Start</button>` : ''}
              ${['in_progress', 'pending_review', 'closed'].includes(w.status) ? `<button class="btn ghost small" onclick="woReview('${w.id}')" title="End-of-shift check: tick what was done correctly">🔍 Review</button>` : ''}
              ${w.status === 'in_progress' ? `<button class="btn ghost small" onclick="woSetStatus('${w.id}','pending_review')">📋 To review</button>` : ''}
              ${w.status !== 'blocked' && w.status !== 'closed' ? `<button class="btn ghost small" onclick="woSetStatus('${w.id}','blocked')">⛔ Block</button>` : ''}
              ${w.status === 'blocked' ? `<button class="btn ghost small" onclick="woSetStatus('${w.id}','in_progress')">▶ Unblock</button>` : ''}
              ${w.status !== 'closed' ? `<button class="btn small" onclick="woSetStatus('${w.id}','closed')">✔ Close</button>` : `<button class="btn ghost small" onclick="woSetStatus('${w.id}','open')">↩ Reopen</button>`}
              ${w.status === 'closed' && !w.verified ? `<button class="btn ghost small" onclick="woVerify('${w.id}')" title="Owner confirms the job was done right">🛡 Verify</button>` : w.verified ? `<span class="wo-pri" style="border-color:#57d48d55;background:#57d48d18;color:#57d48d">🛡 VERIFIED</span>` : ''}
              <button class="btn ghost small" onclick="btPrintWorkOrder('${w.id}')">🖨 Print BLE</button>
              <button class="btn ghost small" onclick="openWOForm('${w.id}')">✎ Edit</button>
              <button class="btn ghost small delete-action" onclick="woDelete('${w.id}')">🗑</button>
            </div>
            </div>
          </div>`;
        }).join('') : (list.length ? '<small class="muted" style="display:block;padding:6px 0">All current tasks are in the closed history below.</small>' : '<div class="empty" style="padding:20px">No work orders yet — create the first one for your team.</div>')}
        ${hist.length ? `<button type="button" class="btn ghost small" style="margin:12px 0 6px" onclick="const el=document.getElementById('woHistoryWrap');el.style.display=el.style.display==='none'?'':'none';this.textContent=el.style.display==='none'?'📚 Show closed history (${hist.length})':'📚 Hide closed history'">📚 Show closed history (${hist.length})</button><div id="woHistoryWrap" style="display:none">${hist.map(hh => `<div class="wo-row"><div class="wo-row-top"><span class="wo-pri" style="border-color:#57d48d55;background:#57d48d18;color:#57d48d">✔ CLOSED</span><b>${esc(hh.title)}</b><small class="muted">${esc(hh.id)}</small></div><div class="wo-row-meta"><span>👤 ${esc(hh.assignee || '—')}</span><span>🗓 ${fmtDue(hh.due)}</span><span>🏅 ${woPtsFmt(woPoints(hh).total)} pts</span></div></div>`).join('')}</div>` : ''}
      </div></div>`);
  };

  /* ── create / edit form ──────────────────────────────────────────────── */
  window.openWOForm = function (editId) {
    const f = F0();
    const w = editId ? wos(f).find(x => x.id === editId) : null;
    document.getElementById('woFormModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="woFormModal" style="z-index:9999999!important">
      <form class="reminder-modal" style="max-width:560px;width:96%;text-align:left" onsubmit="saveWOForm(event, ${editId ? `'${editId}'` : 'null'})">
        <div class="modal-top"><div><div class="eyebrow" style="color:#f0b64b;letter-spacing:.12em;font-weight:800">🛠 WORK ORDER</div><h2>${w ? 'Edit work order' : 'New work order'}</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('woFormModal').remove()">×</button></div>
        <div class="reminder-fields">
          <div class="field full"><label>Task title *</label><input name="title" required value="${esc(w?.title || '')}" placeholder="e.g. Repair feed auger — Barn 3"></div>
          <div class="field"><label>Priority</label><select name="priority" onchange="window.woCalcPts && window.woCalcPts()">${Object.keys(PRI).map(p => `<option value="${p}" ${w?.priority === p ? 'selected' : ''}>${PRI[p][0]}</option>`).join('')}</select></div>
          <div class="field"><label>Difficulty / effort tier</label><select name="difficulty" onchange="window.woCalcPts && window.woCalcPts()">${Object.entries(WO_TIER).map(([k, v]) => `<option value="${k}" ${w?.difficulty === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)} (${v} pt${v > 1 ? 's' : ''})</option>`).join('')}</select></div>
          <div class="field"><label>Base points</label><b id="woPtsPrev" style="font-size:18px;color:#ffd98a">1</b><small class="muted" style="display:block">effort + priority bonus · multipliers apply on close</small></div>
          <div class="field"><label>Due date &amp; time</label><input name="due" type="datetime-local" value="${w?.due ? toLocalInput(w.due) : ''}"></div>
          <div class="field"><label>Repeat</label><select name="repeat"><option value="none">One-time</option><option value="daily" ${w?.template_id ? 'selected' : ''}>🔁 Daily (auto-created every morning)</option></select></div>
          <div class="field"><label>Daily due time</label><input type="time" name="due_time" value="${esc(w?.due_time || '18:00')}"></div>
          <div class="field full" style="position:relative"><label>Assignee (auto-suggests from Staff Roster)</label>
            <input name="assignee_txt" value="${esc(w?.assignee || '')}" placeholder="Type staff name…" autocomplete="off" oninput="window.woSuggest(this.value)" onfocus="window.woSuggest(this.value)">
            <div id="woSuggestBox" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:5;background:#0d2126;border:1px solid var(--line);border-radius:10px;max-height:190px;overflow:auto;box-shadow:0 10px 24px rgba(0,0,0,.45)"></div>
          </div>
          <div class="field"><small class="muted" style="cursor:pointer;text-decoration:underline" onclick="openStaffRoster('new')">＋ Manage roster &amp; shifts</small></div>
          <div class="field"><label>Location</label><input name="location" value="${esc(w?.location || '')}" placeholder="Barn / pen / area"></div>
          <div class="field full"><label>Details / instructions <small class="muted">(one per line — each line prints as a [ ] checkbox the staff ticks when done)</small></label><textarea name="details">${esc(w?.details || '')}</textarea></div>
          <div class="field full"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="print_bt" ${w ? '' : 'checked'} style="width:auto"> 🖨 Print a small copy via Bluetooth POS (for the staff on duty)</label></div>
        </div>
        <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('woFormModal').remove()">Cancel</button><button class="btn">💾 Save work order</button></div>
      </form></div>`);
  };

  window.saveWOForm = function (ev, editId) {
    ev.preventDefault();
    const f = F0(), d = new FormData(ev.target);
    const assigneeVal = String(d.get('assignee_txt') || '').trim();
    const list = wos(f);
    const w = editId ? list.find(x => x.id === editId) : null;
    const dueVal = d.get('due') ? new Date(d.get('due')).toISOString() : '';
    if (w) {
      Object.assign(w, { title: d.get('title'), priority: d.get('priority'), difficulty: d.get('difficulty') || 'routine', assignee: assigneeVal, location: d.get('location'), details: d.get('details'), due: dueVal });
    } else {
      list.unshift({ id: 'WO-' + Date.now().toString(36).toUpperCase(), title: d.get('title'), priority: d.get('priority'), assignee: assigneeVal, location: d.get('location'), details: d.get('details'), due: dueVal, difficulty: d.get('difficulty') || 'routine', status: 'open', created_at: new Date().toISOString() });
    }
    const saved = w || list[0];
    /* [FIX 166] daily tasks become templates: a FRESH instance is auto-created
       every morning — never reopen yesterday's closed WO. */
    if (d.get('repeat') === 'daily') {
      const tpls = Array.isArray(f.woTemplates) ? f.woTemplates : (f.woTemplates = []);
      const tpl = (saved.template_id ? tpls.find(t => t.id === saved.template_id) : null) || tpls.find(t => t.active && normName(t.title) === normName(saved.title) && normName(t.assignee || '') === normName(saved.assignee || '')); /* dedupe: no twin templates */
      const rec = { id: saved.template_id || 'TPL-' + Date.now().toString(36).toUpperCase(), title: saved.title, details: saved.details, priority: saved.priority, difficulty: saved.difficulty || 'routine', assignee: saved.assignee, location: saved.location, due_time: d.get('due_time') || '18:00', active: true, last_gen: '' };
      if (tpl) Object.assign(tpl, rec); else tpls.push(rec);
      saved.template_id = rec.id;
      try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, [Object.assign({ _et: 'wo_template' }, rec)]).catch(() => {}); } catch (e) {}
    }
    if (typeof save === 'function') save();
    arsWOSync([saved]);
    document.getElementById('woFormModal')?.remove();
    if (typeof renderAll === 'function') renderAll();
    toast('✔ Work order saved.');
    if (d.get('print_bt')) window.btPrintWorkOrder(saved.id);
    window.openWOList && window.openWOList();
  };

  window.woSetStatus = function (id, status) {
    const f = F0(), w = wos(f).find(x => x.id === id);
    if (!w) return;
    if (w.status === 'closed' && status !== 'closed') w.was_reopened = true; /* quality signal */
    w.status = status;
    if (status === 'closed') {
      w.closed_at = new Date().toISOString();
      w.on_time = !(w.due && new Date(w.closed_at).getTime() > new Date(w.due).getTime());
    } else w.closed_at = null;
    if (typeof save === 'function') save();
    arsWOSync([w]);
    if (typeof renderAll === 'function') renderAll();
    window.openWOList();
    toast(status === 'closed' ? '✔ Work order closed — good job.' : 'Status: ' + ST[status]);
  };

  window.woDelete = function (id) {
    const f = F0();
    if (!confirm('Delete this work order permanently?')) return;
    f.workOrders = f.workOrders.filter(x => x.id !== id);
    if (typeof save === 'function') save();
    try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.deleteCommerceRow) ARSCloud.deleteCommerceRow(fid, 'work_order', id).catch(() => {}); } catch (e) {}
    if (typeof renderAll === 'function') renderAll();
    window.openWOList();
  };

  /* ── 58mm thermal print (32 cols) via the shared BLE engine ─────────── */
  window.btPrintWorkOrder = function (id) {
    const f = F0(), w = wos(f).find(x => x.id === id);
    if (!w) return;
    if (!window.btPrintTextLines) { toast('⚠ Bluetooth printing unavailable.'); return; }
    const W = 32, sep = '-'.repeat(W);
    const clean = t => String(t).replace(/·/g, '-').replace(/[₱×↩]/g, m => ({ '₱': 'P', '×': 'x', '↩': '<-' }[m])).replace(/[^\x20-\x7E]/g, '');
    const wrap = t => { let out = [], cur = ''; String(t).split(/\s+/).forEach(x => { if ((cur + ' ' + x).trim().length > W) { if (cur.trim()) out.push(cur.trim()); cur = x; } else cur = cur ? cur + ' ' + x : x; }); if (cur.trim()) out.push(cur.trim()); return out; };
    const L = [];
    const add = (t, o = {}) => L.push({ t: clean(t), c: !!o.c, b: !!o.b });
    add(f.name || 'Farm Operations', { c: 1, b: 1 });
    add('WORK ORDER', { c: 1 });
    add(w.id, { c: 1 });
    add(sep);
    add(`Priority: ${PRI[w.priority][0]}`, { b: w.priority === 'critical' });
    add(`Status: ${ST[w.status]}`);
    add(`Assignee: ${w.assignee || 'Unassigned'}`);
    add(`Location: ${w.location || '-'}`);
    add(`Due: ${w.due ? new Date(w.due).toLocaleString([]) : 'ASAP'}`, { b: true });
    add(sep);
    add('TASK:', { b: 1 });
    wrap(w.title).forEach(t => add(t));
    if (w.details) {
      /* [FIX 146] every instruction line prints as a [ ] checkbox so the
         staff on duty can tick items off on the paper copy. */
      add('');
      add('INSTRUCTIONS - check when done:', { b: 1 });
      /* [FIX 148] continuation lines are indented 4, so they must wrap at
         W-4 or the 32-col printer hard-wraps mid-word (the "ma / y" tears). */
      const wrapAt = (t, w) => { let out = [], cur = ''; String(t).split(/\s+/).forEach(x => { if (x.length > w) { if (cur.trim()) out.push(cur.trim()); cur = ''; for (let i2 = 0; i2 < x.length; i2 += w) out.push(x.slice(i2, i2 + w)); return; } if ((cur + ' ' + x).trim().length > w) { if (cur.trim()) out.push(cur.trim()); cur = x; } else cur = cur ? cur + ' ' + x : x; }); if (cur.trim()) out.push(cur.trim()); return out; };
      String(w.details).split(/\n+/).map(s => s.trim()).filter(Boolean).forEach(line => {
        wrapAt(line, W - 4).forEach((t, i) => add(i === 0 ? '[ ] ' + t : '    ' + t));
      });
    }
    add(sep);
    add('Started: ______  Done: ______');
    add('Signature: ________________');
    add('');
    add(`Printed ${new Date().toLocaleString([])}`, { c: 1 });
    add('System: ' + (window.ARS_RELEASE || 'ARSwineTech Pro'), { c: 1 });
    window.btPrintTextLines(L, 'Work order ' + w.id);
  };


  /* ═══ [REBUILD FIX 156/157] STAFF PERFORMANCE CENTER ═══════════════════════
   Anti-gaming model (Asana Workload + Linear points + GitHub heatmap):
   points = (effort tier + priority bonus) × quality multipliers.
   20 easy tasks (20 pts) loses to 5 expert-criticals (35 pts). Quality comes
   from owner verification, on-time close, and no reopens.                 */
  const WO_TIER = { routine: 1, skilled: 2, heavy: 3, expert: 5 };
  window.WO_TIER = WO_TIER;

  /* [FIX 162] STAFF ROSTER — a person exists ONCE with their shift(s);
     work orders link to them, so 2 shifts or 10 extra tasks never duplicate
     a person in the Performance Center. */
  const SHIFT_ICON = { day: '☀️', night: '🌙', split: '🌓', flex: '🕑' };
  const staffRoster = f => Array.isArray(f.staff) ? f.staff : (f.staff = []);
  window.staffRoster = staffRoster;
  function staffSync(f) {
    try {
      const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null);
      if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, staffRoster(f).map(r => Object.assign({ _et: 'staff_rec' }, r))).catch(() => {});
    } catch (e) {}
  }
  const baseName = s => String(s || '').replace(/\s*\(.*$/, '').trim();
  const normName = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  function resolveStaff(f, name) {
    const n = normName(name);
    if (!n) return null;
    const r = staffRoster(f);
    return r.find(x => normName(x.name) === n)
      || r.find(x => normName(baseName(name)) === normName(x.name))
      || r.find(x => (x.aliases || []).some(a => normName(a) === n))
      || r.find(x => n.startsWith(normName(x.name) + ' ('))
      || r.find(x => normName(x.name).length >= 4 && n.includes(normName(x.name)))
      || null;
  }
  window.resolveStaff = resolveStaff;

  window.woImportRoster = function () {
    const f = F0();
    const names = [...new Set(wos(f).map(x => baseName(x.assignee)).filter(Boolean))];
    let added = 0;
    names.forEach(nm => { if (!staffRoster(f).some(r => r.name === nm)) { staffRoster(f).push({ id: 'STF-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(), name: nm, shift: 'flex', hours: '', active: true }); added++; } });
    if (typeof save === 'function') save();
    staffSync(f);
    toast('👥 ' + added + ' staff imported from work orders. Edit their shifts now.');
    window.openStaffRoster();
  };

  window.deleteStaffRec = function (id) {
    const f = F0(); const r = staffRoster(f).find(x => x.id === id);
    if (!r) return;
    if (!confirm('Remove ' + r.name + ' from the roster?\nTheir existing work orders keep the name and will still group together in Performance.')) return;
    f.staff = staffRoster(f).filter(x => x.id !== id);
    if (typeof save === 'function') save();
    staffSync(f);
    try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.deleteCommerceRow) ARSCloud.deleteCommerceRow(fid, 'staff_rec', id).catch(() => {}); } catch (e) {}
    toast('🗑 Removed from roster.');
    window.openStaffRoster();
  };

  window.woDedupeRoster = function () {
    const f = F0(); const seen = new Map(); const removeIds = [];
    staffRoster(f).forEach(r => {
      const k = normName(r.name);
      if (seen.has(k)) {
        const keep = seen.get(k);
        keep.aliases = [...new Set([...(keep.aliases || []), r.name, ...(r.aliases || [])])];
        if (!keep.hours && r.hours) keep.hours = r.hours;
        if (r.shift && (!keep.shift || keep.shift === 'flex')) keep.shift = r.shift;
        removeIds.push(r.id);
      } else seen.set(k, r);
    });
    if (removeIds.length) f.staff = staffRoster(f).filter(x => !removeIds.includes(x.id));
    let n = 0;
    wos(f).forEach(wd => { const r = resolveStaff(f, wd.assignee); if (r && wd.assignee !== r.name) { wd.assignee = r.name; n++; } });
    if (typeof save === 'function') save();
    staffSync(f); arsWOSync(wos(f));
    removeIds.forEach(id => { try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.deleteCommerceRow) ARSCloud.deleteCommerceRow(fid, 'staff_rec', id).catch(() => {}); } catch (e) {} });
    toast('🧹 Roster deduped · ' + n + ' WOs re-linked to canonical names.');
    window.openStaffRoster();
  };

  window.woMergeToRoster = function () {
    const f = F0(); let n = 0;
    wos(f).forEach(wd => { const r = resolveStaff(f, wd.assignee); if (r && wd.assignee !== r.name) { wd.assignee = r.name; n++; } });
    if (typeof save === 'function') save();
    arsWOSync(wos(f));
    toast('🔀 ' + n + ' work orders re-linked to single staff profiles (duplicates merged).');
    window.openStaffRoster();
  };

  window.saveStaffRec = function (ev, editId) {
    ev.preventDefault();
    const f = F0(); const d = new FormData(ev.target);
    const name = String(d.get('name') || '').trim();
    if (!name) { toast('⚠ Name required.'); return; }
    const rec = editId ? staffRoster(f).find(x => x.id === editId) : null;
    if (rec) {
      const oldName = rec.name;
      Object.assign(rec, { name, shift: d.get('shift'), hours: String(d.get('hours') || '').trim(), active: d.get('active') === 'on' });
      if (oldName !== name) {
        rec.aliases = [...new Set([...(rec.aliases || []), oldName])];
        let n = 0;
        wos(f).forEach(wd => { if (normName(wd.assignee) === normName(oldName) || normName(baseName(wd.assignee)) === normName(oldName)) { wd.assignee = name; n++; } });
        arsWOSync(wos(f));
        toast('🔁 ' + n + ' work orders re-linked to ' + name + '.');
      }
    }
    else staffRoster(f).push({ id: 'STF-' + Date.now().toString(36).toUpperCase(), name, shift: d.get('shift'), hours: String(d.get('hours') || '').trim(), active: true });
    if (typeof save === 'function') save();
    staffSync(f);
    document.getElementById('staffRecModal')?.remove();
    toast('✔ Staff saved.');
    window.openStaffRoster();
  };

  window.openStaffRoster = async function (editId) {
    const f = F0();
    try {
      const fid0 = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null);
      if (fid0 && window.ARSCloud && ARSCloud.listCommerceRows) {
        const rr = await ARSCloud.listCommerceRows(fid0);
        (rr || []).forEach(rw => { const p = rw.payload; if (!p || !p.id) return; if (rw.entity_type === 'staff_rec') { const i = staffRoster(f).findIndex(x => x.id === p.id); if (i >= 0) staffRoster(f)[i] = p; else staffRoster(f).push(p); } else if (rw.entity_type === 'att_rec') { f.attendance = Array.isArray(f.attendance) ? f.attendance : []; const i = f.attendance.findIndex(x => x.id === p.id); if (i >= 0) f.attendance[i] = p; else f.attendance.push(p); } });
      }
    } catch (e) {}

    const edit = editId ? staffRoster(f).find(x => x.id === editId) : null;
    document.getElementById('staffRecModal')?.remove();
    if (editId === 'new' || (!editId && false)) editId = null;
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="staffRecModal" style="z-index:99999999!important" onclick="if(event.target===this)this.remove()">
      <div class="reminder-modal" style="max-width:640px;width:96%;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#ffd98a;letter-spacing:.12em;font-weight:800">👥 STAFF ROSTER & SHIFTS</div><h2>One profile per person</h2><small class="muted">Shifts live here — WOs link to people, never duplicate them.</small></div><button class="close-reminder" onclick="document.getElementById('staffRecModal').remove()">×</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn small" onclick="document.getElementById('staffFormWrap').style.display='';window.__staffEdit=null;document.getElementById('staffFormWrap').querySelector('form').reset();">＋ Add staff</button>
          <button class="btn ghost small" onclick="woImportRoster()">⤓ Import names from WOs</button>
          <button class="btn ghost small" onclick="woMergeToRoster()">🔀 Merge duplicate WOs</button>
          <button class="btn ghost small" onclick="woDedupeRoster()">🧹 Dedupe roster (RICHARD = Richard)</button>
        </div>
        ${staffRoster(f).map(r => `<div class="wo-row"><div class="wo-row-top"><b>${esc(r.name)}</b><span class="wo-pri" style="border-color:#57d48d55;background:#57d48d18;color:#57d48d">${SHIFT_ICON[r.shift] || '🕑'} ${r.shift || 'flex'}</span>${r.hours ? `<small class="muted">${esc(r.hours)}</small>` : ''}</div>
          <div class="wo-row-meta"><span>${wos(f).filter(x => resolveStaff(f, x.assignee)?.id === r.id).length} WOs linked</span></div>
          <div class="wo-actions"><button class="btn ghost small" onclick="openStaffRoster('${r.id}')">✎ Edit</button><button class="btn ghost small delete-action" onclick="deleteStaffRec('${r.id}')">🗑 Delete</button></div></div>`).join('') || '<div class="empty" style="padding:16px">No staff yet — add or import.</div>'}
        <div id="staffFormWrap" style="display:${edit ? '' : 'none'};margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
          <form onsubmit="saveStaffRec(event, ${edit ? `'${edit.id}'` : 'null'})">
            <div class="reminder-fields">
              <div class="field full"><label>Full name *</label><input name="name" required value="${esc(edit?.name || '')}" placeholder="e.g. John Lloyd"></div>
              <div class="field"><label>Shift type</label><select name="shift"><option value="day" ${edit?.shift === 'day' ? 'selected' : ''}>☀️ Day shift</option><option value="night" ${edit?.shift === 'night' ? 'selected' : ''}>🌙 Night shift</option><option value="split" ${edit?.shift === 'split' ? 'selected' : ''}>🌓 Split / broken schedule</option><option value="flex" ${(!edit || edit.shift === 'flex') ? 'selected' : ''}>🕑 Flexible</option></select></div>
              <div class="field"><label>Shift hours (free text)</label><input name="hours" value="${esc(edit?.hours || '')}" placeholder="e.g. 6am-6pm · also 9pm-2am"></div>
              <div class="field full"><label style="display:flex;gap:8px"><input type="checkbox" name="active" ${(!edit || edit.active !== false) ? 'checked' : ''} style="width:auto"> Active</label></div>
            </div>
            <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('staffFormWrap').style.display='none'">Cancel</button><button class="btn">💾 Save staff</button></div>
          </form>
        </div>
      </div></div>`);
  };

  const woPtsFmt = v => String(Math.round((+v || 0) * 10) / 10);
  const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  window.woPtsFmt = woPtsFmt;
  const woExpanded = new Set();
  window.woExpand = function (id) { if (woExpanded.has(id)) woExpanded.delete(id); else woExpanded.add(id); window.openWOList(); };

  /* [FIX 166] RECURRING DAILY TASKS — templates spawn a fresh WO each morning. */
  const localTodayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  window.arsGenRecurring = function () {
    const f = F0();
    const tpls = Array.isArray(f.woTemplates) ? f.woTemplates : [];
    const today = localTodayStr();
    let created = 0;
    tpls.filter(t => t.active && t.last_gen !== today).forEach(t => {
      const due = new Date(today + 'T' + (t.due_time || '18:00')).toISOString();
      const wo = { id: 'WO-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase(), title: t.title, details: t.details, priority: t.priority, difficulty: t.difficulty || 'routine', assignee: t.assignee, location: t.location, due, status: 'open', created_at: new Date().toISOString(), template_id: t.id };
      wos(f).unshift(wo);
      t.last_gen = today;
      created++;
      arsWOSync([wo]);
    });
    if (created) {
      if (typeof save === 'function') save();
      try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, tpls.map(t => Object.assign({ _et: 'wo_template' }, t))).catch(() => {}); } catch (e) {}
      if (window.toast) toast('🔁 ' + created + ' daily task' + (created > 1 ? 's' : '') + ' generated for today.');
    }
  };

  window.openWoTemplates = function () {
    const f = F0();
    const tpls = Array.isArray(f.woTemplates) ? f.woTemplates : [];
    document.getElementById('woTplModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="woTplModal" style="z-index:9999999!important" onclick="if(event.target===this)this.remove()">
      <div class="reminder-modal" style="max-width:600px;width:96%;text-text-align:left;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#ffd98a;letter-spacing:.12em;font-weight:800">🔁 DAILY TASK TEMPLATES</div><h2>Repeats every morning automatically</h2><small class="muted">Each day gets a FRESH work order — closed history stays clean for performance.</small></div><button class="close-reminder" onclick="document.getElementById('woTplModal').remove()">×</button></div>
        ${tpls.map(t => `<div class="wo-row"><div class="wo-row-top"><b>${esc(t.title)}</b><span class="wo-pri" style="border-color:${t.active ? '#57d48d55' : '#94a3b855'};background:${t.active ? '#57d48d18' : 'rgba(148,163,184,.1)'};color:${t.active ? '#57d48d' : '#94a3b8'}">${t.active ? 'ACTIVE' : 'PAUSED'}</span></div>
          <div class="wo-row-meta"><span>👤 ${esc(t.assignee || '—')}</span><span>⏰ due ${esc(t.due_time || '18:00')}</span><span>${esc((WO_TIER[t.difficulty] || 1))} pts base</span></div>
          <div class="wo-actions"><button class="btn ghost small" onclick="woTplEdit('${t.id}')">✎ Edit / Reassign</button><button class="btn ghost small" onclick="woTplToggle('${t.id}')">${t.active ? '⏸ Pause' : '▶ Resume'}</button><button class="btn ghost small" onclick="woTplGenNow('${t.id}')">⚡ Today</button><button class="btn ghost small delete-action" onclick="woTplDelete('${t.id}')">🗑</button></div></div>`).join('') || '<div class="empty" style="padding:16px">No templates yet — create a WO and choose 🔁 Daily.</div>'}
        ${tpls.length ? `<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px"><small class="muted">🔀 Weekly/monthly reshuffle: move ALL active templates from one staff to another (past work orders keep their original assignee — history & incentives stay accurate).</small><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><select id="rsFrom" class="select" style="max-width:160px">${[...new Set(tpls.map(t => t.assignee || '').filter(Boolean))].map(n => `<option>${esc(n)}</option>`).join('')}</select><span class="muted">→</span><select id="rsTo" class="select" style="max-width:160px">${staffRoster(f).map(r => `<option>${esc(r.name)}</option>`).join('')}</select><button class="btn ghost small" onclick="woTplBulkReassign()">🔀 Reassign all</button><button class="btn ghost small" onclick="woTplDedupe()">🧹 Dedupe templates</button></div></div>` : ''}
      </div></div>`);
  };

  window.woTplToggle = function (id) {
    const f = F0(); const t = (f.woTemplates || []).find(x => x.id === id); if (!t) return;
    t.active = !t.active;
    if (typeof save === 'function') save();
    try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, [Object.assign({ _et: 'wo_template' }, t)]).catch(() => {}); } catch (e) {}
    window.openWoTemplates();
  };
  window.woTplGenNow = function (id) {
    const f = F0(); const t = (f.woTemplates || []).find(x => x.id === id); if (!t) return;
    t.last_gen = ''; window.arsGenRecurring();
    window.openWoTemplates();
  };
  window.woTplEdit = function (id) {
    const f = F0(); const t = (f.woTemplates || []).find(x => x.id === id); if (!t) return;
    document.getElementById('woTplEditModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="woTplEditModal" style="z-index:99999999!important" onclick="if(event.target===this)this.remove()">
      <form class="reminder-modal" style="max-width:520px;width:96%;text-align:left" onsubmit="woTplEditSave(event,'${t.id}')">
        <div class="modal-top"><div><div class="eyebrow" style="color:#ffd98a;letter-spacing:.12em;font-weight:800">✎ EDIT DAILY TEMPLATE</div><h2>${esc(t.title)}</h2><small class="muted">Changes apply to FUTURE daily instances only — history stays accurate.</small></div><button type="button" class="close-reminder" onclick="document.getElementById('woTplEditModal').remove()">×</button></div>
        <div class="reminder-fields">
          <div class="field full"><label>Task title</label><input name="title" required value="${esc(t.title)}"></div>
          <div class="field full"><label>Assignee (reshuffle here)</label><select name="assignee">${staffRoster(f).map(r => `<option ${r.name === t.assignee ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}<option value="">Unassigned</option></select></div>
          <div class="field"><label>Priority</label><select name="priority">${Object.keys(PRI).map(p => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${PRI[p][0]}</option>`).join('')}</select></div>
          <div class="field"><label>Difficulty</label><select name="difficulty">${Object.entries(WO_TIER).map(([k, v]) => `<option value="${k}" ${t.difficulty === k ? 'selected' : ''}>${k} (${v})</option>`).join('')}</select></div>
          <div class="field"><label>Daily due time</label><input type="time" name="due_time" value="${esc(t.due_time || '18:00')}"></div>
          <div class="field"><label>Status</label><select name="active"><option value="1" ${t.active ? 'selected' : ''}>Active</option><option value="0" ${!t.active ? 'selected' : ''}>Paused</option></select></div>
        </div>
        <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('woTplEditModal').remove()">Cancel</button><button class="btn">💾 Save changes</button></div>
      </form></div>`);
  };

  window.woTplEditSave = function (ev, id) {
    ev.preventDefault();
    const f = F0(); const t = (f.woTemplates || []).find(x => x.id === id); if (!t) return;
    const d = new FormData(ev.target);
    Object.assign(t, { title: d.get('title'), assignee: d.get('assignee'), priority: d.get('priority'), difficulty: d.get('difficulty'), due_time: d.get('due_time'), active: d.get('active') === '1' });
    if (typeof save === 'function') save();
    try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, [Object.assign({ _et: 'wo_template' }, t)]).catch(() => {}); } catch (e) {}
    document.getElementById('woTplEditModal')?.remove();
    toast('✔ Template updated — future daily tasks go to ' + (t.assignee || 'Unassigned') + '.');
    window.openWoTemplates();
  };

  window.woTplBulkReassign = function () {
    const f = F0();
    const from = document.getElementById('rsFrom')?.value;
    const to = document.getElementById('rsTo')?.value;
    if (!from || !to || from === to) { toast('⚠ Pick two different staff.'); return; }
    if (!confirm('Move ALL active daily templates from ' + from + ' to ' + to + '?\nPast work orders and points stay with ' + from + '.')) return;
    let n = 0;
    (f.woTemplates || []).forEach(t => { if (t.active && t.assignee === from) { t.assignee = to; n++; } });
    if (typeof save === 'function') save();
    try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, (f.woTemplates || []).map(t => Object.assign({ _et: 'wo_template' }, t))).catch(() => {}); } catch (e) {}
    toast('🔀 ' + n + ' templates reassigned to ' + to + '.');
    window.openWoTemplates();
  };

  window.woTplDedupe = function () {
    const f = F0(); const seen = new Map(); const kill = [];
    (f.woTemplates || []).forEach(t => {
      const k = normName(t.title) + '|' + normName(t.assignee || '');
      if (seen.has(k)) kill.push(t.id); else seen.set(k, t);
    });
    if (!kill.length) { toast('✔ No duplicate templates found.'); return; }
    f.woTemplates = (f.woTemplates || []).filter(t => !kill.includes(t.id));
    if (typeof save === 'function') save();
    kill.forEach(id => { try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.deleteCommerceRow) ARSCloud.deleteCommerceRow(fid, 'wo_template', id).catch(() => {}); } catch (e) {} });
    toast('🧹 Removed ' + kill.length + ' duplicate template(s). Existing WOs untouched.');
    window.openWoTemplates();
  };

  /* [FIX 168] ATTENDANCE LEDGER — late / early-in / early-out / day-off flags
     that feed performance & incentives with transparent point effects. */
  const ATT_STATUS = {
    ontime: ['On time', 0], late: ['Late', -0.5], early_in: ['Early-in', 0.25],
    early_out_done: ['Early-out · work DONE', 0], early_out_notdone: ['Early-out · work NOT done', -1],
    day_off: ['Day off', 0], cancelled_day_off: ['Cancelled day-off (worked)', 1]
  };
  window.ATT_STATUS = ATT_STATUS;

  window.openAttendance = function () {
    const f = F0();
    const today = localTodayStr();
    const date = window.__attDate || today;
    const recs = (f.attendance || []).filter(a => a.date === date);
    document.getElementById('attModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="attModal" style="z-index:99999999!important" onclick="if(event.target===this)this.remove()">
      <div class="reminder-modal" style="max-width:600px;width:96%;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#ffd98a;letter-spacing:.12em;font-weight:800">🕐 ATTENDANCE LEDGER</div><h2>Daily time discipline</h2><small class="muted">Late −0.5 · Early-in +0.25 · Early-out w/o work −1 · Cancelled day-off +1 · Day-off neutral (keeps streak)</small></div><button class="close-reminder" onclick="document.getElementById('attModal').remove()">×</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
          <input type="date" value="${date}" onchange="window.__attDate=this.value;openAttendance()">
        </div>
        ${recs.map(a => `<div class="wo-row"><div class="wo-row-top"><b>${esc(a.staff)}</b><span class="wo-pri" style="border-color:#ffd98a55;background:#ffd98a18;color:#ffd98a">${ATT_STATUS[a.status] ? ATT_STATUS[a.status][0] : a.status}</span></div>
          ${a.note ? `<small class="muted">${esc(a.note)}</small>` : ''}
          <div class="wo-actions"><button class="btn ghost small" onclick="attEdit('${esc(a.id)}')">✎ Edit</button><button class="btn ghost small delete-action" onclick="attDelete('${esc(a.id)}')">🗑</button></div></div>`).join('') || '<small class="muted">No attendance records for this date.</small>'}
        <form onsubmit="attSave(event)" style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
          <div class="reminder-fields">
            <div class="field full"><label>Staff</label><select name="staff">${staffRoster(f).map(r => `<option>${esc(r.name)}</option>`).join('')}</select></div>
            <div class="field full"><label>Status</label><select name="status">${Object.entries(ATT_STATUS).map(([k, v]) => `<option value="${k}">${v[0]} (${v[1] > 0 ? '+' : ''}${v[1]} pts)</option>`).join('')}</select></div>
            <div class="field full"><label>Note (optional)</label><input name="note" placeholder="e.g. 30 min late — traffic"></div>
          </div>
          <div class="due-actions"><button class="btn">💾 Save attendance</button></div>
        </form>
      </div></div>`);
  };

  window.attSave = function (ev) {
    ev.preventDefault();
    const f = F0(); const d = new FormData(ev.target);
    const date = window.__attDate || localTodayStr();
    const staff = String(d.get('staff') || '').trim();
    const id = 'ATT-' + normName(staff).replace(/[^a-z0-9]/g, '') + '-' + date;
    f.attendance = Array.isArray(f.attendance) ? f.attendance : [];
    const i = f.attendance.findIndex(a => a.id === id);
    const rec = { id, staff, date, status: d.get('status'), note: String(d.get('note') || '').trim() };
    if (i >= 0) f.attendance[i] = rec; else f.attendance.push(rec);
    if (typeof save === 'function') save();
    try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, [Object.assign({ _et: 'att_rec' }, rec)]).catch(() => {}); } catch (e) {}
    toast('🕐 Attendance saved: ' + staff + ' · ' + ATT_STATUS[rec.status][0]);
    window.openAttendance();
  };
  window.attEdit = function (id) {
    const f = F0(); const a = (f.attendance || []).find(x => x.id === id); if (!a) return;
    window.__attDate = a.date; window.openAttendance();
    setTimeout(() => { const m = document.getElementById('attModal'); if (!m) return; m.querySelector('[name=staff]').value = a.staff; m.querySelector('[name=status]').value = a.status; m.querySelector('[name=note]').value = a.note || ''; }, 50);
  };
  window.attDelete = function (id) {
    const f = F0();
    if (!confirm('Delete this attendance record?')) return;
    f.attendance = (f.attendance || []).filter(x => x.id !== id);
    if (typeof save === 'function') save();
    try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.deleteCommerceRow) ARSCloud.deleteCommerceRow(fid, 'att_rec', id).catch(() => {}); } catch (e) {}
    window.openAttendance();
  };

  window.woTplDelete = function (id) {
    const f = F0();
    if (!confirm('Delete this daily template? Existing work orders are kept.')) return;
    f.woTemplates = (f.woTemplates || []).filter(x => x.id !== id);
    if (typeof save === 'function') save();
    try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.deleteCommerceRow) ARSCloud.deleteCommerceRow(fid, 'wo_template', id).catch(() => {}); } catch (e) {}
    window.openWoTemplates();
  };

  /* [FIX 167] INCENTIVE / BUNOS CALCULATOR — subdivide a monthly budget
     intelligently & explainably: share = equal% + performance% weighted by
     points (60) + on-time (20) + verified (20). Every peso is justified by
     data the owner can show & explain. */
  function incStreak(s) {
    if (!s.dayQ) return 0;
    const today = new Date(); let streak = 0;
    for (let i = 0; i < 60; i++) {
      const d = new Date(today.getTime() - i * 864e5);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const q = s.dayQ[key];
      if (q && q.c > 0 && q.ok === q.c) streak++;
      else if ((i === 0 || i === 1) && !q) continue;
      else break;
    }
    return streak;
  }

  window.openIncentiveModal = function () {
    const f = F0();
    const st = window.__inc || (window.__inc = { budget: 20000, eq: 20, month: localTodayStr().slice(0, 7) });
    const months = [...new Set(wos(f).map(x => String(x.closed_at || '').slice(0, 7)).filter(m => m.length === 7))].sort().reverse();
    if (!months.includes(st.month)) months.unshift(st.month);
    const rows = staffPerf(f, 3650, st.month).filter(r => r.closed > 0 || r.pts > 0);
    const N = rows.length || 1;
    const scored = rows.map(r => {
      const onT = r.closed ? r.onTime / r.closed : 0;
      const ver = r.closed ? r.verified / r.closed : 0;
      const raw = r.pts * 0.6 + onT * 100 * 0.2 + ver * 100 * 0.2;
      return Object.assign({ onT, ver, raw, streak: incStreak(r) }, r);
    });
    const sumRaw = scored.reduce((a, r) => a + r.raw, 0) || 1;
    const eq = Math.max(0, Math.min(100, +st.eq || 0)) / 100;
    scored.forEach(r => { r.share = eq * (1 / N) + (1 - eq) * (r.raw / sumRaw); r.peso = Math.floor((+st.budget || 0) * r.share); });
    scored.sort((a, b) => b.peso - a.peso);
    const allocated = scored.reduce((a, r) => a + r.peso, 0);
    document.getElementById('incModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="incModal" style="z-index:9999999!important" onclick="if(event.target===this)this.remove()">
      <div class="reminder-modal" style="max-width:720px;width:96%;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#ffd98a;letter-spacing:.12em;font-weight:800">💰 INCENTIVE / BUNOS CALCULATOR</div><h2>Performance-based budget split</h2><small class="muted">share = ${Math.round(eq * 100)}% equal + ${100 - Math.round(eq * 100)}% performance (points 60 · on-time 20 · verified 20)</small></div><button class="close-reminder" onclick="document.getElementById('incModal').remove()">×</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <label class="muted" style="font-size:11px">Budget ₱ <input id="incBudget" type="number" value="${st.budget}" style="width:110px" onchange="window.__inc.budget=+this.value;openIncentiveModal()"></label>
          <label class="muted" style="font-size:11px">Month <select class="select" style="max-width:150px" onchange="window.__inc.month=this.value;openIncentiveModal()">${months.map(m => `<option ${m === st.month ? 'selected' : ''} value="${m}">${m}</option>`).join('')}</select></label>
          <label class="muted" style="font-size:11px">Equal split % <input id="incEq" type="number" min="0" max="100" value="${Math.round(eq * 100)}" style="width:70px" onchange="window.__inc.eq=+this.value;openIncentiveModal()"></label>
        </div>
        ${scored.map((r, i) => `<div class="wo-row">
          <div class="wo-row-top"><b>#${i + 1} ${esc(r.name)}</b><span class="wo-pri" style="border-color:#ffd98a55;background:#ffd98a18;color:#ffd98a">₱${r.peso.toLocaleString('en-PH')}</span><small class="muted">${(r.share * 100).toFixed(1)}% share</small></div>
          <div class="wo-row-meta"><span>🏅 ${woPtsFmt(r.pts)} pts</span><span>⏱ ${Math.round(r.onT * 100)}% on-time</span><span>🛡 ${Math.round(r.ver * 100)}% verified</span><span>📅 ${r.streak}d streak</span><span>✔ ${r.closed} closed</span></div>
          <div class="wo-actions"><button class="btn ghost small" onclick="printIncSlip('${esc(r.name).replace(/'/g, "\\'")}')">🖨 Slip</button></div>
        </div>`).join('') || '<div class="empty" style="padding:16px">No closed work orders in this month yet.</div>'}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><span class="muted" style="font-size:11px;align-self:center">Allocated ₱${allocated.toLocaleString('en-PH')} of ₱${(+st.budget || 0).toLocaleString('en-PH')} · unallocated ₱${((+st.budget || 0) - allocated).toLocaleString('en-PH')}</span><button class="btn ghost small" onclick="printIncReport()">🖨 Print full incentive report</button></div>
      </div></div>`);
  };

  window.printIncSlip = function (name) {
    const f = F0(); const st = window.__inc || { budget: 20000, eq: 20, month: localTodayStr().slice(0, 7) };
    const rows = staffPerf(f, 3650, st.month).filter(r => r.closed > 0 || r.pts > 0);
    const N = rows.length || 1; const eq = Math.max(0, Math.min(100, +st.eq || 0)) / 100;
    const scored = rows.map(r => { const onT = r.closed ? r.onTime / r.closed : 0, ver = r.closed ? r.verified / r.closed : 0; const raw = r.pts * 0.6 + onT * 100 * 0.2 + ver * 100 * 0.2; return Object.assign({ onT, ver, raw, streak: incStreak(r) }, r); });
    const sumRaw = scored.reduce((a, r) => a + r.raw, 0) || 1;
    scored.forEach(r => { r.share = eq * (1 / N) + (1 - eq) * (r.raw / sumRaw); r.peso = Math.floor((+st.budget || 0) * r.share); });
    const r = scored.find(x => x.name === name); if (!r) return;
    if (!window.btPrintTextLines) { toast('⚠ Bluetooth printing unavailable.'); return; }
    const W = 32, sep = '-'.repeat(W);
    const clean = t => String(t).replace(/[·₱×↩]/g, m => ({ '·': '-', '₱': 'P', '×': 'x', '↩': '<-' }[m])).replace(/[^\x20-\x7E]/g, '');
    const ctr = t => { t = clean(t); return t.length >= W ? t : ' '.repeat(Math.max(0, (W - t.length) >> 1)) + t; };
    const L = [];
    L.push({ t: ctr(f.name || 'Farm'), c: 1 });
    L.push({ t: ctr('INCENTIVE / BUNOS ' + st.month), c: 1 });
    L.push({ t: sep });
    L.push({ t: clean('Staff: ' + r.name), b: 1 });
    L.push({ t: clean('AMOUNT: P' + r.peso.toLocaleString('en-PH')), b: 1 });
    L.push({ t: sep });
    L.push({ t: 'JUSTIFIED BY:' });
    L.push({ t: clean(' Points: ' + woPtsFmt(r.pts)) });
    L.push({ t: clean(' On-time: ' + Math.round(r.onT * 100) + '%  Verified: ' + Math.round(r.ver * 100) + '%') });
    if (r.att) L.push({ t: clean(' Attendance: late ' + r.att.late + ' · early-in ' + r.att.earlyIn + ' · early-out(no work) ' + r.att.eon + ' · day-off ' + r.att.off + ' · cancel-off ' + r.att.coff) });
    L.push({ t: clean(' Closed WOs: ' + r.closed + '  Streak: ' + r.streak + 'd') });
    L.push({ t: clean(' Share: ' + (r.share * 100).toFixed(1) + '% of P' + (+st.budget).toLocaleString('en-PH')) });
    L.push({ t: sep });
    L.push({ t: ctr('Salamat sa iyong sipag!'), c: 1 });
    window.btPrintTextLines(L, 'Incentive slip');
  };

  window.printIncReport = function () {
    const f = F0(); const st = window.__inc || { budget: 20000, eq: 20, month: localTodayStr().slice(0, 7) };
    const rows = staffPerf(f, 3650, st.month).filter(r => r.closed > 0 || r.pts > 0);
    const N = rows.length || 1; const eq = Math.max(0, Math.min(100, +st.eq || 0)) / 100;
    const scored = rows.map(r => { const onT = r.closed ? r.onTime / r.closed : 0, ver = r.closed ? r.verified / r.closed : 0; const raw = r.pts * 0.6 + onT * 100 * 0.2 + ver * 100 * 0.2; return Object.assign({ onT, ver, raw }, r); });
    const sumRaw = scored.reduce((a, r) => a + r.raw, 0) || 1;
    scored.forEach(r => { r.share = eq * (1 / N) + (1 - eq) * (r.raw / sumRaw); r.peso = Math.floor((+st.budget || 0) * r.share); });
    scored.sort((a, b) => b.peso - a.peso);
    if (!window.btPrintTextLines) { toast('⚠ Bluetooth printing unavailable.'); return; }
    const W = 32, sep = '-'.repeat(W);
    const clean = t => String(t).replace(/[·₱×]/g, m => ({ '·': '-', '₱': 'P', '×': 'x', '↩': '<-' }[m])).replace(/[^\x20-\x7E]/g, '');
    const ctr = t => { t = clean(t); return t.length >= W ? t : ' '.repeat(Math.max(0, (W - t.length) >> 1)) + t; };
    const L = [];
    L.push({ t: ctr(f.name || 'Farm'), c: 1 });
    L.push({ t: ctr('INCENTIVE REPORT ' + st.month), c: 1 });
    L.push({ t: clean('Budget P' + (+st.budget).toLocaleString('en-PH') + ' / ' + N + ' staff'), b: 1 });
    L.push({ t: sep });
    scored.forEach(r => { L.push({ t: clean(r.name), b: 1 }); L.push({ t: clean('  pts ' + woPtsFmt(r.pts) + ' onT ' + Math.round(r.onT * 100) + '% ver ' + Math.round(r.ver * 100) + '%') });
      if (r.att) L.push({ t: clean('  att: L' + r.att.late + ' EI' + r.att.earlyIn + ' EO' + r.att.eon + ' off' + r.att.off) }); L.push({ t: clean('  share ' + (r.share * 100).toFixed(1) + '%  =  P' + r.peso.toLocaleString('en-PH')), b: 1 }); });
    L.push({ t: sep });
    L.push({ t: clean('TOTAL: P' + scored.reduce((a, r) => a + r.peso, 0).toLocaleString('en-PH')) });
    L.push({ t: ctr('Formula: equal%+perf% (60/20/20)'), c: 1 });
    window.btPrintTextLines(L, 'Incentive report');
  };

  /* [FIX 164] live assignee autosuggest from the Staff Roster */
  window.woSuggest = function (v) {
    const box = document.getElementById('woSuggestBox');
    if (!box) return;
    const f = F0();
    const names = [...new Set([...staffRoster(f).map(r => r.name), ...wos(f).map(x => baseName(x.assignee)).filter(Boolean)])];
    const t = String(v || '').toLowerCase().trim();
    const list = t ? names.filter(n => n.toLowerCase().includes(t)) : names;
    if (!list.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    const pick = n => { const inp = document.querySelector('#woFormModal [name=assignee_txt]'); if (inp) inp.value = n; box.style.display = 'none'; };
    window.__woPick = pick;
    box.innerHTML = list.slice(0, 8).map((n, i) => `<button type="button" data-i="${i}" style="display:block;width:100%;text-align:left;padding:10px 12px;background:none;border:none;border-bottom:1px solid var(--line);color:#d7e6e4;font-size:13px">${esc(n)}</button>`).join('');
    [...box.children].forEach((btn, i) => { btn.onpointerdown = e => { e.preventDefault(); pick(list[i]); }; });
  };

  window.woCalcPts = function () {
    const m = document.getElementById('woFormModal');
    if (!m) return;
    const d = m.querySelector('[name="difficulty"]')?.value || 'routine';
    const p = m.querySelector('[name="priority"]')?.value || 'medium';
    const el = document.getElementById('woPtsPrev');
    if (el) el.textContent = String((WO_TIER[d] || 1) + (p === 'critical' ? 2 : p === 'high' ? 1 : 0));
  };

  function woPoints(wd) {
    const base = (WO_TIER[wd.difficulty] || 1) + (wd.priority === 'critical' ? 2 : wd.priority === 'high' ? 1 : 0);
    if (wd.status !== 'closed') return { base, total: 0, mult: 0, flags: ['open'] };
    let mult = 1; const flags = [];
    if (wd.verified) flags.push('verified'); else { mult *= 0.8; flags.push('unverified'); }
    if (wd.review && wd.review.total > 0) {
      const q = Math.max(0.5, wd.review.done / wd.review.total);
      mult *= q;
      if (q < 1) flags.push('review ' + Math.round(q * 100) + '%');
    } else {
      const tl = String(wd.details || '').split(/\n+/).map(s => s.trim()).filter(Boolean).length;
      if (tl > 0) {
        const dn = (wd.done_lines || []).filter(i => i < tl).length;
        const q = Math.max(0.5, dn / tl);
        mult *= q;
        if (q < 1) flags.push('checklist ' + Math.round(q * 100) + '%');
      }
    }
    if (wd.on_time === false) { mult *= 0.6; flags.push('late'); } else flags.push('on-time');
    if (wd.was_reopened) { mult *= 0.5; flags.push('reopened'); }
    return { base, mult, total: Math.round(base * mult * 10) / 10, flags };
  }
  window.woPoints = woPoints;

  function staffPerf(f, days, monthKey) {
    const cut = Date.now() - (days || 30) * 864e5;
    const map = {};
    wos(f).forEach(wd => {
      const r0 = resolveStaff(f, wd.assignee);
      const who = r0 ? r0.name : ((wd.assignee || 'Unassigned').trim() || 'Unassigned');
      const s = map[who] || (map[who] = { name: who, shift: r0 ? r0.shift : '', hours: r0 ? r0.hours : '', pts: 0, closed: 0, onTime: 0, late: 0, reopened: 0, verified: 0, heavy: 0, openPts: 0, perDay: {} });
      const p = woPoints(wd);
      if (wd.status !== 'closed') { s.openPts += p.base; return; }
      if (wd.closed_at && new Date(wd.closed_at).getTime() < cut) return;
      if (monthKey && String(wd.closed_at || '').slice(0, 7) !== monthKey) return;
      s.pts += p.total; s.closed += 1;
      if (wd.on_time !== false) s.onTime += 1; else s.late += 1;
      if (wd.was_reopened) s.reopened += 1;
      if (wd.verified) s.verified += 1;
      if ((WO_TIER[wd.difficulty] || 1) >= 3) s.heavy += p.total;
      const day = (wd.closed_at || '').slice(0, 10);
      if (day) { s.perDay[day] = (s.perDay[day] || 0) + p.total; s.dayQ = s.dayQ || {}; const q = s.dayQ[day] || (s.dayQ[day] = { c: 0, ok: 0 }); q.c++; if (wd.on_time !== false && (wd.verified || (wd.review && wd.review.total > 0 && wd.review.done === wd.review.total))) q.ok++; }
    });
    /* [FIX 168] attendance effects on points (transparent, printed on slips) */
    (f.attendance || []).forEach(a => {
      if (monthKey && String(a.date || '').slice(0, 7) !== monthKey) return;
      if (!monthKey && new Date(a.date + 'T00:00:00').getTime() < cut) return;
      const r0 = resolveStaff(f, a.staff);
      const s = map[r0 ? r0.name : (a.staff || 'Unassigned')];
      if (!s) return;
      s.att = s.att || { late: 0, earlyIn: 0, eod: 0, eon: 0, off: 0, coff: 0 };
      if (a.status === 'late') s.att.late++;
      else if (a.status === 'early_in') s.att.earlyIn++;
      else if (a.status === 'early_out_done') s.att.eod++;
      else if (a.status === 'early_out_notdone') s.att.eon++;
      else if (a.status === 'day_off') { s.att.off++; s.dayOff = s.dayOff || {}; s.dayOff[a.date] = true; }
      else if (a.status === 'cancelled_day_off') s.att.coff++;
    });
    Object.values(map).forEach(s => {
      if (!s.att) return;
      const adj = s.att.earlyIn * 0.25 + s.att.coff * 1 - s.att.late * 0.5 - s.att.eon * 1;
      s.pts = Math.max(0, Math.round((s.pts + adj) * 10) / 10);
      s.attAdj = adj;
    });
    return Object.values(map).sort((a, b) => b.pts - a.pts);
  }
  window.staffPerf = staffPerf;

  function staffBadges(s) {
    const b = [];
    if (s.closed >= 3 && s.heavy === Math.max(1, s.heavy) && s.heavy > 0) b.push(['🏋️', 'Heavy Lifter']);
    if (s.closed >= 3 && s.onTime / s.closed >= 0.9) b.push(['⏱️', 'On-Time Hero']);
    if (s.closed >= 3 && s.reopened === 0) b.push(['🛡️', 'Quality Streak']);
    if (s.pts > 0 && s.late === 0 && s.closed >= 2) b.push(['✨', 'Clean Sweep']);
    if (((s.att && s.att.late) || 0) === 0 && (s.closed || 0) >= 5) b.push(['🕐', 'Punctual']);
    if (s.dayQ) {
      const today = new Date(); let streak = 0;
      for (let i = 0; i < 60; i++) {
        const d = new Date(today.getTime() - i * 864e5);
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const q = s.dayQ[key];
        if (q && q.c > 0 && q.ok === q.c) streak++;
        else if (i === 0 && !q) continue; /* today not closed yet doesn't break streak */
        else if (!q && i === 1) continue; /* yesterday may still be in progress */
        else if (s.dayOff && s.dayOff[key]) continue; /* [FIX 168] day-off never breaks streak */
        else break;
      }
      if (streak >= 3) b.push(['📅', 'Consistency ' + streak + 'd']);
    }
    return b;
  }

  function heatCells(s) {
    let out = '';
    const today = new Date(); 
    for (let i = 55; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 864e5);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const v = s.perDay[key] || 0;
      const bg = v === 0 ? 'rgba(145,207,202,.08)' : v < 3 ? 'rgba(87,212,141,.3)' : v < 6 ? 'rgba(87,212,141,.55)' : 'rgba(87,212,141,.85)';
      out += `<span title="${key}: ${v} pts" style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${bg};margin:1px"></span>`;
    }
    return out;
  }

  window.openPerfCenter = async function (drillName, daysArg) {
    const f = F0();
    if (daysArg) window.__perfDays = +daysArg;
    try {
      const fid0 = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null);
      if (fid0 && window.ARSCloud && ARSCloud.listCommerceRows) {
        const rr = await ARSCloud.listCommerceRows(fid0);
        (rr || []).forEach(rw => { const p = rw.payload; if (!p || !p.id) return; if (rw.entity_type === 'staff_rec') { const i = staffRoster(f).findIndex(x => x.id === p.id); if (i >= 0) staffRoster(f)[i] = p; else staffRoster(f).push(p); } else if (rw.entity_type === 'att_rec') { f.attendance = Array.isArray(f.attendance) ? f.attendance : []; const i = f.attendance.findIndex(x => x.id === p.id); if (i >= 0) f.attendance[i] = p; else f.attendance.push(p); } });
      }
    } catch (e) {}

    const daysSel = +window.__perfDays || 30;
    const rows = staffPerf(f, daysSel);
    const maxPts = Math.max(1, ...rows.map(r => r.pts));
    const cap = 40; /* ~6-day-week healthy monthly load in points */
    document.getElementById('perfCenterModal')?.remove();
    const drill = drillName ? rows.find(r => r.name === drillName) : null;
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="perfCenterModal" style="z-index:9999999!important" onclick="if(event.target===this)this.remove()">
      <div class="reminder-modal" style="max-width:720px;width:96%;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#ffd98a;letter-spacing:.12em;font-weight:800">🏆 STAFF PERFORMANCE CENTER</div><h2>Effort × quality, never just counts</h2><div style="margin:4px 0 8px"><select class="select" style="max-width:220px" onchange="openPerfCenter(null, this.value)"><option value="30" ${daysSel === 30 ? 'selected' : ''}>Last 30 days</option><option value="90" ${daysSel === 90 ? 'selected' : ''}>Last 90 days</option><option value="365" ${daysSel === 365 ? 'selected' : ''}>Last 12 months</option><option value="3650" ${daysSel === 3650 ? 'selected' : ''}>All time</option></select></div><small class="muted">pts = (effort tier + priority bonus) × verified/on-time/reopen multipliers</small></div><button class="close-reminder" onclick="document.getElementById('perfCenterModal').remove()">×</button></div>
        <div class="dash-section-title" style="margin:8px 0 6px">WORKLOAD (open assigned points · capacity ≈ ${cap})</div>
        ${rows.map(r => { const pct = Math.min(100, Math.round(r.openPts / cap * 100)); const col = r.openPts > cap ? '#ff8b95' : r.openPts > cap * 0.6 ? '#ffc968' : '#57d48d'; return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><small style="width:130px;color:#c9d9d7">${({day:'☀️',night:'🌙',split:'🌓',flex:'🕑'})[r.shift] || '🕑'} ${esc(r.name)}</small><div style="flex:1;height:10px;border-radius:6px;background:rgba(145,207,202,.10)"><div style="width:${pct}%;height:100%;border-radius:6px;background:${col}"></div></div><small style="width:52px;text-align:right;color:${col}">${woPtsFmt(r.openPts)} pts</small></div>`; }).join('') || '<small class="muted">No staff with work orders yet.</small>'}
        <div class="dash-section-title" style="margin:14px 0 6px">LEADERBOARD · tap a card for the full profile</div>
        ${rows.map((r, i) => `<div class="wo-row" style="cursor:pointer" onclick="openPerfCenter('${esc(r.name).replace(/'/g, "\\'")}')">
          <div class="wo-row-top"><b>#${i + 1} ${esc(r.name)}</b>${r.shift ? `<span class="wo-pri" style="border-color:#57d48d55;background:#57d48d18;color:#57d48d">${({day:'☀️',night:'🌙',split:'🌓',flex:'🕑'})[r.shift] || '🕑'} ${r.shift}</span>` : ''}<span class="wo-pri" style="border-color:#ffd98a55;background:#ffd98a18;color:#ffd98a">${woPtsFmt(r.pts)} pts</span></div>
          <div class="wo-row-meta"><span>✔ ${r.closed} closed</span><span>⏱ ${r.closed ? Math.round(r.onTime / r.closed * 100) : 0}% on-time</span><span>🛡 ${r.verified} verified</span><span>↩ ${r.reopened} reopened</span><span>🏋 ${r.heavy} heavy pts</span>${r.att ? `<span>🕐 L${r.att.late} · EI${r.att.earlyIn} · EO${r.att.eon}</span>` : ''}</div>
          <div style="height:8px;border-radius:5px;background:rgba(145,207,202,.10);margin:6px 0 4px"><div style="width:${Math.round(r.pts / maxPts * 100)}%;height:100%;border-radius:5px;background:linear-gradient(90deg,#13b9ad,#57d48d)"></div></div>
          <div>${staffBadges(r).map(b => `<span class="wo-pri" style="margin-right:6px;border-color:#57d48d55;background:#57d48d18;color:#57d48d">${b[0]} ${b[1]}</span>`).join('') || '<small class="muted">No badges yet this month.</small>'}</div>
        </div>`).join('') || ''}
        ${drill ? `<div class="dash-section-title" style="margin:14px 0 6px">PROFILE · ${esc(drill.name)}</div>
        <div class="wo-row"><small class="muted">8-week contribution heatmap (darker = more points that day)</small><div style="max-width:340px;margin:8px 0">${heatCells(drill)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost small" onclick="printMvpSlip('${esc(drill.name).replace(/'/g, "\\'")}')">🖨 Print MVP slip (BLE)</button></div></div>` : ''}
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost small" onclick="printMvpSlip()">🖨 Print Monthly MVP slip</button><button class="btn ghost small" onclick="printRulesSlip()">📜 Print Staff Points Guide (BLE)</button><button class="btn ghost small" onclick="openStaffRoster()">👥 Staff Roster &amp; Shifts</button><button class="btn small" onclick="openIncentiveModal()">💰 Incentive / Bunos</button><button class="btn ghost small" onclick="openAttendance()">🕐 Attendance</button></div>
      </div></div>`);
  };

  /* [FIX 160] work orders sync cross-device via explicit targeted writes */
  function arsWOSync(rows) {
    try {
      const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null);
      if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, (rows || []).map(r => Object.assign({ _et: 'work_order' }, r))).catch(() => {});
    } catch (e) {}
  }

  /* [FIX 161] quick staff/task filter for the WO list */
  window.woFilterList = function (term) {
    const t = String(term || '').toLowerCase();
    document.querySelectorAll('#woListModal .wo-row').forEach(row => {
      row.style.display = !t || row.textContent.toLowerCase().includes(t) ? '' : 'none';
    });
  };

  window.woToggleLine = function (id, idx, on) {
    const f = F0(); const wd = wos(f).find(x => x.id === id);
    if (!wd) return;
    const s = new Set(wd.done_lines || []);
    if (on) s.add(idx); else s.delete(idx);
    wd.done_lines = [...s];
    if (typeof save === 'function') save();
    arsWOSync([wd]);
  };

  window.woVerify = function (id) {
    const f = F0(); const wd = wos(f).find(x => x.id === id);
    if (!wd) return;
    wd.verified = true;
    if (typeof save === 'function') save();
    arsWOSync([wd]);
    if (typeof renderAll === 'function') renderAll();
    window.openWOList();
    toast('🛡 Verified — full points credited.');
  };

  /* [FIX 159] END-OF-SHIFT REVIEW — mirrors the owner's real process: staff
     reports back, owner ticks what was done correctly; unchecked items give
     proportional (partial) credit instead of all-or-nothing. */
  window.woReview = function (id) {
    const f = F0(); const wd = wos(f).find(x => x.id === id);
    if (!wd) return;
    const lines = String(wd.details || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) { toast('⚠ This work order has no checklist items to review.'); return; }
    const doneSet = new Set(Array.isArray(wd.done_lines) ? wd.done_lines : (wd.review && Array.isArray(wd.review.doneLines) ? wd.review.doneLines : lines.map((_, i) => i)));
    document.getElementById('woReviewModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="woReviewModal" style="z-index:99999999!important" onclick="if(event.target===this)this.remove()">
      <form class="reminder-modal" style="max-width:560px;width:96%;text-align:left" onsubmit="woReviewSave(event,'${wd.id}')">
        <div class="modal-top"><div><div class="eyebrow" style="color:#ffd98a;letter-spacing:.12em;font-weight:800">🔍 END-OF-SHIFT REVIEW</div><h2>${esc(wd.title)}</h2><small class="muted">${esc(wd.assignee || 'Unassigned')} · untick items NOT done correctly — points become proportional</small></div><button type="button" class="close-reminder" onclick="document.getElementById('woReviewModal').remove()">×</button></div>
        <div style="margin:6px 0"><button type="button" class="btn ghost small" onclick="document.querySelectorAll('#woReviewModal input[name=rv]').forEach(c=>c.checked=true)">✔ All done correctly</button></div>
        ${lines.map((l, i) => `<label style="display:flex;gap:8px;align-items:flex-start;padding:6px 4px;border-bottom:1px solid var(--line);font-size:12.5px;color:#d7e6e4"><input type="checkbox" name="rv" value="${i}" ${doneSet.has(i) ? 'checked' : ''} style="width:auto;margin-top:2px"> ${esc(l)}</label>`).join('')}
        <div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('woReviewModal').remove()">Cancel</button><button class="btn">💾 Save review &amp; verify</button></div>
      </form></div>`);
  };

  window.woReviewSave = function (ev, id) {
    ev.preventDefault();
    const f = F0(); const wd = wos(f).find(x => x.id === id);
    if (!wd) return;
    const boxes = [...ev.target.querySelectorAll('input[name=rv]')];
    const doneLines = boxes.filter(c => c.checked).map(c => +c.value);
    wd.review = { done: doneLines.length, total: boxes.length, doneLines, at: new Date().toISOString() };
    wd.done_lines = doneLines;
    wd.verified = true;
    if (wd.status === 'pending_review') {
      wd.status = 'closed';
      wd.closed_at = wd.closed_at || new Date().toISOString();
      wd.on_time = !(wd.due && new Date(wd.closed_at).getTime() > new Date(wd.due).getTime());
    }
    if (typeof save === 'function') save();
    if (typeof renderAll === 'function') renderAll();
    document.getElementById('woReviewModal')?.remove();
    const q = Math.round(Math.max(0.5, doneLines.length / Math.max(1, boxes.length)) * 100);
    toast(`🔍 Review saved — ${doneLines.length}/${boxes.length} items · ${q}% quality credit.`);
    window.openWOList();
  };

  /* Printable Taglish guide so every staff sees the rules on paper. */
  window.printRulesSlip = function () {
    const f = F0();
    if (!window.btPrintTextLines) { toast('⚠ Bluetooth printing unavailable.'); return; }
    const W = 32, sep = '-'.repeat(W);
    const clean = t => String(t).replace(/[·₱×↩]/g, m => ({ '·': '-', '₱': 'P', '×': 'x', '↩': '<-' }[m])).replace(/[^\x20-\x7E]/g, '');
    const ctr = t => { t = clean(t); return t.length >= W ? t : ' '.repeat(Math.max(0, (W - t.length) >> 1)) + t; };
    const wrap = t => { let out = [], cur = ''; String(t).split(/\s+/).forEach(x => { if ((cur + ' ' + x).trim().length > W) { if (cur.trim()) out.push(cur.trim()); cur = x; } else cur = cur ? cur + ' ' + x : x; }); if (cur.trim()) out.push(cur.trim()); return out; };
    const L = [];
    L.push({ t: ctr('STAFF POINTS GUIDE'), b: 1, c: 1 });
    L.push({ t: ctr(f.name || 'ARSwineTech'), c: 1 });
    L.push({ t: sep });
    wrap('Paano nakakuha ng points? Bawat work order may bigat: Madali=1, Medyo=2, Mabigat=3, Expert=5. Critical +2, High +1.').forEach(t => L.push({ t: clean(t) }));
    wrap('Tama lahat ng checklist sa dulo ng shift = BUONG points.').forEach(t => L.push({ t: clean(t), b: true }));
    wrap('May naiwang kulang = proportional lang ang points ng task na yun (hal. 3/5 items = 60%).').forEach(t => L.push({ t: clean(t) }));
    wrap('Huli sa due = 60% lang. Binuksan uli dahil mali = 50%.').forEach(t => L.push({ t: clean(t) }));
    wrap('Hindi bilang ng task ang mahalaga - BIGAT + TAMA + TAMANG ORAS.').forEach(t => L.push({ t: clean(t), b: 1 }));
    L.push({ t: sep });
    wrap('Check ang lista bago mag-sign off. Tanungin si Boss kung may unclear. Good luck!').forEach(t => L.push({ t: clean(t) }));
    window.btPrintTextLines(L, 'Staff guide');
  };

  window.printMvpSlip = function (name) {
    const f = F0();
    const rows = staffPerf(f, 30);
    const mvp = name ? rows.find(r => r.name === name) : rows[0];
    if (!mvp) { toast('⚠ No completed work orders yet.'); return; }
    if (!window.btPrintTextLines) { toast('⚠ Bluetooth printing unavailable.'); return; }
    const W = 32, sep = '-'.repeat(W);
    const clean = t => String(t).replace(/[·₱×↩]/g, m => ({ '·': '-', '₱': 'P', '×': 'x', '↩': '<-' }[m])).replace(/[^\x20-\x7E]/g, '');
    const ctr = t => { t = clean(t); return t.length >= W ? t : ' '.repeat(Math.max(0, (W - t.length) >> 1)) + t; };
    const L = [];
    L.push({ t: ctr((f.name || 'Farm') + ' MVP'), b: 1, c: 1 });
    L.push({ t: ctr('STAFF PERFORMANCE SLIP'), c: 1 });
    L.push({ t: sep });
    L.push({ t: clean('Staff: ' + mvp.name), b: 1 });
    L.push({ t: clean('Points: ' + woPtsFmt(mvp.pts)) });
    L.push({ t: clean('Closed WOs: ' + mvp.closed + '  On-time: ' + (mvp.closed ? Math.round(mvp.onTime / mvp.closed * 100) : 0) + '%') });
    L.push({ t: clean('Verified: ' + mvp.verified + '  Reopened: ' + mvp.reopened) });
    L.push({ t: clean('Heavy/Expert points: ' + mvp.heavy) });
    L.push({ t: sep });
    staffBadges(mvp).forEach(b => L.push({ t: clean(b[0] + ' ' + b[1]) }));
    L.push({ t: sep });
    L.push({ t: ctr('Keep up the great work!'), c: 1 });
    L.push({ t: ctr('Printed ' + new Date().toLocaleDateString()), c: 1 });
    window.btPrintTextLines(L, 'MVP slip');
  };
})();
