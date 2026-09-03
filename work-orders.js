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
  window.openWOList = function () {
    const f = F0();
    const list = wos(f).slice().sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || String(a.due || '9999').localeCompare(String(b.due || '9999')));
    document.getElementById('woListModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="woListModal" onclick="if(event.target===this)this.remove()" style="z-index:999999!important">
      <div class="reminder-modal" style="max-width:720px;width:96%;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#f0b64b;letter-spacing:.12em;font-weight:800">📋 WORK ORDER CENTER</div><h2>All work orders</h2><small class="muted">Open first, sorted by due date · tap status to move through the pipeline</small></div><button class="close-reminder" onclick="document.getElementById('woListModal').remove()">×</button></div>
        <div style="display:flex;gap:8px;margin:4px 0 12px"><button class="btn" onclick="openWOForm()">＋ Create New W.O.</button></div>
        ${list.length ? list.map(w => {
          const late = w.status !== 'closed' && w.due && new Date(w.due).getTime() < now();
          return `<div class="wo-row">
            <div class="wo-row-top"><span class="wo-pri" style="border-color:${PRI[w.priority][1]}55;background:${PRI[w.priority][1]}18;color:${PRI[w.priority][1]}">${PRI[w.priority][0]}</span><b>${esc(w.title)}</b><small class="muted">${esc(w.id)}</small></div>
            <div class="wo-row-meta"><span>👤 ${esc(w.assignee || 'Unassigned')}</span><span>📍 ${esc(w.location || '—')}</span><span class="${late ? 'wo-bad' : ''}">🗓 ${fmtDue(w.due)}</span><span>Status: <b>${ST[w.status]}</b></span></div>
            ${w.details ? `<div style="margin:4px 0 0">${String(w.details).split(/\n+/).map(s => s.trim()).filter(Boolean).map(l => `<small class="muted" style="display:block">☐ ${esc(l)}</small>`).join('')}</div>` : ''}
            <div class="wo-actions">
              ${w.status === 'open' ? `<button class="btn ghost small" onclick="woSetStatus('${w.id}','in_progress')">▶ Start</button>` : ''}
              ${w.status === 'in_progress' ? `<button class="btn ghost small" onclick="woSetStatus('${w.id}','pending_review')">📋 To review</button>` : ''}
              ${w.status !== 'blocked' && w.status !== 'closed' ? `<button class="btn ghost small" onclick="woSetStatus('${w.id}','blocked')">⛔ Block</button>` : ''}
              ${w.status === 'blocked' ? `<button class="btn ghost small" onclick="woSetStatus('${w.id}','in_progress')">▶ Unblock</button>` : ''}
              ${w.status !== 'closed' ? `<button class="btn small" onclick="woSetStatus('${w.id}','closed')">✔ Close</button>` : `<button class="btn ghost small" onclick="woSetStatus('${w.id}','open')">↩ Reopen</button>`}
              <button class="btn ghost small" onclick="btPrintWorkOrder('${w.id}')">🖨 Print BLE</button>
              <button class="btn ghost small" onclick="openWOForm('${w.id}')">✎ Edit</button>
              <button class="btn ghost small delete-action" onclick="woDelete('${w.id}')">🗑</button>
            </div>
          </div>`;
        }).join('') : '<div class="empty" style="padding:20px">No work orders yet — create the first one for your team.</div>'}
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
          <div class="field"><label>Priority</label><select name="priority">${Object.keys(PRI).map(p => `<option value="${p}" ${w?.priority === p ? 'selected' : ''}>${PRI[p][0]}</option>`).join('')}</select></div>
          <div class="field"><label>Due date &amp; time</label><input name="due" type="datetime-local" value="${w?.due ? w.due.slice(0, 16) : ''}"></div>
          <div class="field"><label>Assignee</label><input name="assignee" value="${esc(w?.assignee || '')}" placeholder="Staff name"></div>
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
    const list = wos(f);
    const w = editId ? list.find(x => x.id === editId) : null;
    const dueVal = d.get('due') ? new Date(d.get('due')).toISOString() : '';
    if (w) {
      Object.assign(w, { title: d.get('title'), priority: d.get('priority'), assignee: d.get('assignee'), location: d.get('location'), details: d.get('details'), due: dueVal });
    } else {
      list.unshift({ id: 'WO-' + Date.now().toString(36).toUpperCase(), title: d.get('title'), priority: d.get('priority'), assignee: d.get('assignee'), location: d.get('location'), details: d.get('details'), due: dueVal, status: 'open', created_at: new Date().toISOString() });
    }
    const saved = w || list[0];
    if (typeof save === 'function') save();
    document.getElementById('woFormModal')?.remove();
    if (typeof renderAll === 'function') renderAll();
    toast('✔ Work order saved.');
    if (d.get('print_bt')) window.btPrintWorkOrder(saved.id);
    window.openWOList && window.openWOList();
  };

  window.woSetStatus = function (id, status) {
    const f = F0(), w = wos(f).find(x => x.id === id);
    if (!w) return;
    w.status = status;
    w.closed_at = status === 'closed' ? new Date().toISOString() : null;
    if (typeof save === 'function') save();
    if (typeof renderAll === 'function') renderAll();
    window.openWOList();
    toast(status === 'closed' ? '✔ Work order closed — good job.' : 'Status: ' + ST[status]);
  };

  window.woDelete = function (id) {
    const f = F0();
    if (!confirm('Delete this work order permanently?')) return;
    f.workOrders = f.workOrders.filter(x => x.id !== id);
    if (typeof save === 'function') save();
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
})();
