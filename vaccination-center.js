/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 36] js/vaccination-center.js — Vaccination Program center.

   Central immunization page for the herd:
     • Sows, boars and piglet batches can each carry TWO OR MORE vaccines —
       every saved record is one vaccine program entry for one animal/group.
     • Both pickers are type-ahead search boxes fed by live records: active
       sows (isActiveSow), registry boars (getActiveBoars), non-archived piglet
       batches, and the Medicine Inventory (F().medicines — vaccine/biologic
       types first) for the vaccine name. Free text still works as a fallback.
     • Optional follow-up rule: the manager says in how many DAYS the next
       dose is due and at what TIME; the entry arms an active reminder through
       the standard reminder engine — so a real alert fires on that date and
       time (vaccine titles automatically get the engine's critical alarm
       treatment) and the reminder appears on the Reminders page + dashboard
       widget like any other farm reminder.
     • Saving can deduct the prepared total (ml × heads) straight from the
       stocked medicine and writes to the same movement ledger treatments use.
     • Print/PDF report: due & upcoming follow-ups with the exact ml to
       prepare per animal, rolled up per vaccine, a stock advisory when the
       on-hand medicine cannot cover the plan, and the completed-rounds list.
   [REBUILD FIX 51] Never-vaccinated register + scheduled vaccinations:
     • A "Not yet vaccinated" section lists EVERY active sow, registry boar
       and live piglet batch that has zero vaccine records, with one-tap
       💉 Record (pre-filled record modal) on each row.
     • Each unvaccinated animal can get a SCHEDULE (date + time): saving arms
       a real one-time reminder through the standard reminder engine — the
       "Vaccin…" title gets the engine's critical-alarm treatment (loud
       repeating tone, vibration, on-screen due modal + browser notification
       when enabled) exactly at the set date & time. Past times fire
       immediately. Schedules can be edited, cancelled, or recorded as done.
     • Recording a matching vaccine for that animal (any record path)
       automatically completes the pending schedule and silences the alarm.
     • Both the schedule list and the never-vaccinated register print in the
       PDF report (plus a footer counter).
   Records live in F().vaccinations; schedules in F().vaxSchedules; linked
   reminders use ids 'vacc-rem-<entry id>' / 'vaxsched-rem-<schedule id>'
   inside F().reminders.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsq = v => "'" + String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + "'";
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const round2 = n => Math.round((+n || 0) * 100) / 100;
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad2 = n => String(n).padStart(2, '0');
  const dstr = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const today = () => dstr(new Date());
  /* local-timezone-safe date + N days (toISOString would shift a day back in PH time) */
  const isoOff = (base, n) => { const d = new Date(String(base || today()) + 'T00:00:00'); d.setDate(d.getDate() + (+n || 0)); return dstr(d); };
  const fmtD = s => { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }); };
  const TYPE_META = {
    sow: { ico: '♀', label: 'Sow', hint: 'sow name or ID' },
    boar: { ico: '♂', label: 'Boar', hint: 'boar name' },
    batch: { ico: '🐖', label: 'Piglet batch', hint: 'batch id or dam' }
  };

  const entries = () => (F().vaccinations = Array.isArray(F().vaccinations) ? F().vaccinations : []);
  const medicines = () => (Array.isArray(F().medicines) ? F().medicines : []);
  const findMed = id => medicines().find(m => m.id === id) || null;

  function aliveBatchHeads(b) {
    /* [FIX M1] vaccine doses must be planned on truly living heads — the old
       formula ignored sold/released piglets and over-prepared doses. */
    if (window.liveHeadsFor) return Math.max(0, window.liveHeadsFor(b));
    const mort = (F().pigletLedger || []).filter(x => x.batch_id === b.id && x.type === 'mortality' && !['undone', 'deleted'].includes(x.status)).reduce((t, x) => t + (+x.quantity || 0), 0);
    return Math.max(0, (+b.males || 0) + (+b.females || 0) - mort);
  }
  /* batches shrink over time — always recompute before preparing a dose */
  function liveHeads(e) {
    if (e.target_type === 'batch') {
      const b = (F().piglets || []).find(x => x.id === e.target_id);
      if (b) return aliveBatchHeads(b);
    }
    return e.heads || 1;
  }

  /* ── type-ahead candidates ─────────────────────────────────────────── */
  function targetCandidates(cat) {
    if (cat === 'sow') {
      return (F().sows || []).filter(s => typeof isActiveSow === 'function' ? isActiveSow(s) : true)
        .map((s, idx) => {
          const sId = s.id || s.name || `sow-${idx}`;
          const sName = s.name || s.id || `Sow ${idx + 1}`;
          const label = sName + (s.id && s.id !== sName ? ' (' + s.id + ')' : '');
          return {
            ref: 'sow:' + sId,
            label: label,
            heads: 1,
            search: (sName + ' ' + (s.id || '') + ' ' + (s.breed || '')).toLowerCase()
          };
        });
    }
    if (cat === 'boar') {
      return (window.getActiveBoars ? getActiveBoars() : [])
        .map(b => ({ ref: 'boar:' + (b.id || b.name), label: (b.name || b.id) + (b.breed ? ' · ' + b.breed : ''), heads: 1, search: ((b.name || '') + ' ' + (b.id || '') + ' ' + (b.breed || '')).toLowerCase() }));
    }
    return (F().piglets || []).filter(b => !b.archived && aliveBatchHeads(b) > 0)
      .map(b => ({ ref: 'batch:' + b.id, label: b.id + ' · ' + (b.dam_name || b.sow || '—') + ' · ' + aliveBatchHeads(b) + ' alive', id: b.id, heads: aliveBatchHeads(b), search: (b.id + ' ' + (b.dam_name || b.sow || '') + ' ' + (b.sire_name || b.sire || '')).toLowerCase() }));
  }
  /* medicines matching the text, vaccines & biologics first */
  function medCandidates(q) {
    const t = String(q || '').trim().toLowerCase();
    const match = m => (m.item_name + ' ' + (m.brand_name || '') + ' ' + (m.active_ingredient || '') + ' ' + (m.med_type || '')).toLowerCase().includes(t);
    const isVax = m => /vaccin|biologic/i.test(m.med_type || '') || /vaccin/i.test(m.item_name || '');
    return medicines().filter(m => !t || match(m)).sort((a, b) => (isVax(b) ? 1 : 0) - (isVax(a) ? 1 : 0) || a.item_name.localeCompare(b.item_name)).slice(0, 14);
  }

  /* ── [REBUILD FIX 37] unified multi-select (mass vaccination day) ────── */
  function uniCandidates(cat) {
    const out = [];
    if (cat === 'all' || cat === 'sow') out.push(...targetCandidates('sow').map(c => Object.assign({ type: 'sow' }, c)));
    if (cat === 'all' || cat === 'boar') out.push(...targetCandidates('boar').map(c => Object.assign({ type: 'boar' }, c)));
    if (cat === 'all' || cat === 'batch') out.push(...targetCandidates('batch').map(c => Object.assign({ type: 'batch' }, c)));
    return out;
  }
  /* heads are re-resolved at save time — batch headcounts move constantly */
  function freshHeads(c) {
    if (c.type === 'batch') {
      const b = (F().piglets || []).find(x => x.id === c.id);
      return b ? aliveBatchHeads(b) : 0;
    }
    return 1;
  }
  function vaxSetMode(m) {
    curMode = m;
    document.querySelectorAll('#vaxModes .period').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    const sb = document.getElementById('vaxSingleBox'), mb = document.getElementById('vaxMultiBox'), hf = document.getElementById('vaxHeadsField');
    if (sb) sb.style.display = m === 'single' ? '' : 'none';
    if (mb) mb.style.display = m === 'multi' ? '' : 'none';
    if (hf) hf.style.display = m === 'single' ? '' : 'none';
    if (m === 'multi') { renderVaxChips(); vaxUniFilter((document.getElementById('vaxUniInput') || {}).value || ''); }
    vaxCalc();
  }
  function vaxUniSetCat(c) {
    uniCat = c;
    document.querySelectorAll('#vaxUniCats .period').forEach(b => b.classList.toggle('active', b.dataset.ucat === c));
    vaxUniFilter((document.getElementById('vaxUniInput') || {}).value || '');
  }
  function vaxUniFilter(q, openBox) {
    const box = document.getElementById('vaxUniSug');
    if (!box) return;
    if (openBox === undefined) openBox = true;
    const t = String(q || '').trim().toLowerCase();
    curUni = uniCandidates(uniCat).filter(c => !t || c.search.includes(t));
    const chosen = new Set(multiSel.map(x => x.ref));
    box.innerHTML = curUni.length
      ? curUni.slice(0, 15).map((c, i) => {
          const added = chosen.has(c.ref);
          return `<button type="button"${added ? ' disabled style="opacity:.45"' : ''} onmousedown="vaxUniPick(${i})"><span><b>${esc(c.label)}</b></span><span class="treat-sug-heads">${TYPE_META[c.type].ico} ${TYPE_META[c.type].label}${c.heads > 1 ? ' · ' + c.heads + ' heads' : ''}${added ? ' · ✓ added' : ''}</span></button>`;
        }).join('')
      : `<div class="suggestion-empty">No match${t ? '' : ' — register sows, boars or batches first'}.</div>`;
    box.classList.toggle('open', openBox);
    box.style.display = openBox ? 'block' : 'none';
  }
  function vaxUniPick(i) {
    const c = curUni[i];
    if (!c) return;
    if (multiSel.some(x => x.ref === c.ref)) { vaxUniClose(); return; } /* dup tap: behave like any pick — close the box */
    multiSel.push({ ref: c.ref, type: c.type, id: c.ref.split(':').slice(1).join(':'), label: c.label, heads: c.heads });
    const inp = document.getElementById('vaxUniInput');
    if (inp) inp.value = '';
    vaxUniClose(); /* like the treatment picker: close after each pick so the chips/quick-add buttons below stay tappable */
    renderVaxChips();
  }
  function vaxUniClose() { const b = document.getElementById('vaxUniSug'); if (b) { b.classList.remove('open'); b.style.display = 'none'; } }
  function vaxUniAddAll(type) {
    uniCandidates(type).forEach(c => {
      if (!multiSel.some(x => x.ref === c.ref)) multiSel.push({ ref: c.ref, type: c.type, id: c.ref.split(':').slice(1).join(':'), label: c.label, heads: c.heads });
    });
    vaxUniFilter((document.getElementById('vaxUniInput') || {}).value || '', false); /* refresh rows only — don't pop the box when using quick-add */
    renderVaxChips();
  }
  function vaxMultiRemove(ref) {
    multiSel = multiSel.filter(c => c.ref !== ref);
    vaxUniFilter((document.getElementById('vaxUniInput') || {}).value || '', false);
    renderVaxChips();
  }
  function renderVaxChips() {
    const box = document.getElementById('vaxChips'), tools = document.getElementById('vaxMultiTools');
    if (tools) {
      tools.innerHTML = ['sow', 'boar', 'batch'].map(t => {
        const n = uniCandidates(t).filter(c => !multiSel.some(x => x.ref === c.ref)).length;
        return n ? `<button type="button" class="btn ghost vax-mini" onclick="vaxUniAddAll('${t}')">＋ All ${t === 'batch' ? 'live batches' : t + 's'} (${n})</button>` : '';
      }).join('');
    }
    if (box) {
      box.innerHTML = multiSel.map(c => `<span class="vax-chip">${TYPE_META[c.type].ico} ${esc(c.label)}${c.heads > 1 ? ` <small>· ${c.heads} heads</small>` : ''}<button type="button" onclick="vaxMultiRemove(${jsq(c.ref)})" aria-label="Remove">×</button></span>`).join('');
    }
    vaxCalc();
  }

  /* ── reminders ─────────────────────────────────────────────────────── */
  function removeVaxReminder(e) {
    if (!Array.isArray(F().reminders)) return;
    const rid = 'vacc-rem-' + e.id;
    F().reminders = F().reminders.filter(r => r.id !== rid && r.id !== e.reminder_id);
    e.reminder_id = null;
  }
  function armVaxReminder(e) {
    removeVaxReminder(e);
    (F().reminders = Array.isArray(F().reminders) ? F().reminders : []);
    const total = round2(e.dose_ml * e.heads);
    const r = {
      id: 'vacc-rem-' + e.id,
      title: '💉 Vaccine follow-up: ' + e.vaccine + ' — ' + e.target_label,
      description: 'Next dose on ' + e.next_due + ' at ' + (e.time || '08:00') + ' · prepare ≈ ' + total + ' ml (' + e.dose_ml + ' ml/head × ' + e.heads + ' head' + (e.heads > 1 ? 's' : '') + ')',
      reminder_type: 'one_time', type: 'One Time', date: e.next_due, time: e.time || '08:00',
      is_active: true, active: true,
      schedule: e.next_due + ' · ' + (e.time || '08:00'),
      created_date: new Date().toISOString(), updated_date: new Date().toISOString(),
      next_trigger: new Date(e.next_due + 'T' + (e.time || '08:00')).toISOString()
    };
    F().reminders.push(r);
    e.reminder_id = r.id;
  }

  /* ── [REBUILD FIX 51] never-vaccinated register + vaccination schedules ──
     Targets with zero vaccine records surface on the page (and the PDF) so
     nothing silently misses the immunization program. A schedule stores a
     vaccine + exact date & time and arms a REAL one-time reminder through the
     standard engine — its "Vaccin…" title receives the engine's critical
     alarm treatment (repeating loud tone + vibration + due modal). */
  const schedules = () => (F().vaxSchedules = Array.isArray(F().vaxSchedules) ? F().vaxSchedules : []);
  const pendSchedules = () => schedules().filter(s => s.status !== 'done');
  const programTitle = s => s?.program_name || s?.vaccine || 'Vaccination program';
  const programKindLabel = s => ({ vaccination: 'Vaccination', medication: 'Medication', treatment: 'Treatment' }[s?.program_type] || 'Vaccination');
  const scheduleFor = (type, id) => pendSchedules().find(s => s.target_type === type && String(s.target_id) === String(id)) || null;

  /* same pools the record modal uses, minus those with any vaccine record */
  function neverVaccinated() {
    const out = [];
    (F().sows || []).filter(s => typeof isActiveSow === 'function' ? isActiveSow(s) : true).forEach(s => {
      if (!vaxRecordsFor('sow', s.id, s.name).length)
        out.push({ type: 'sow', id: s.id, name: s.name, label: s.name + ' (' + s.id + ')', detail: (s.breed || '—') + ' · parity ' + (s.parity ?? '—'), heads: 1 });
    });
    (window.getActiveBoars ? getActiveBoars() : []).forEach(b => {
      if (!vaxRecordsFor('boar', b.name, b.name).length)
        out.push({ type: 'boar', id: b.name, name: b.name, label: b.name + (b.breed ? ' · ' + b.breed : ''), detail: 'breeding boar', heads: 1 });
    });
    (F().piglets || []).filter(b => !b.archived && aliveBatchHeads(b) > 0).forEach(b => {
      if (!vaxRecordsFor('batch', b.id, b.id).length)
        out.push({ type: 'batch', id: b.id, name: b.id, label: b.id + ' · ' + (b.dam_name || b.sow || '—'), detail: (b.dam_name || b.sow || '—') + '’s litter', heads: aliveBatchHeads(b) });
    });
    return out;
  }

  function removeScheduleReminder(s) {
    if (!Array.isArray(F().reminders)) return;
    F().reminders = F().reminders.filter(r => r.id !== 'vaxsched-rem-' + s.id && r.id !== s.reminder_id);
  }
  function armScheduleReminder(s) {
    removeScheduleReminder(s);
    (F().reminders = Array.isArray(F().reminders) ? F().reminders : []);
    const r = {
      id: 'vaxsched-rem-' + s.id,
      title: (s.program_type === 'medication' ? '💊 Medication due: ' : s.program_type === 'treatment' ? '🩺 Treatment due: ' : '💉 Vaccination due: ') + programTitle(s) + ' — ' + s.target_label,
      description: 'Scheduled ' + programKindLabel(s).toLowerCase() + ' on ' + fmtD(s.date) + ' at ' + (s.time || '08:00') + (s.note ? ' · ' + s.note : '') + ' — open the Vaccination center to manage this program.',
      reminder_type: 'one_time', type: 'One Time', date: s.date, time: s.time || '08:00',
      is_active: true, active: true,
      schedule: s.date + ' · ' + (s.time || '08:00'),
      created_date: new Date().toISOString(), updated_date: new Date().toISOString(),
      next_trigger: new Date(s.date + 'T' + (s.time || '08:00') + ':00').toISOString()
    };
    F().reminders.push(r);
    s.reminder_id = r.id;
  }
  /* recording a matching vaccine for the animal (any record path — single or
     mass, same target + same vaccine name) completes its pending schedule and
     cancels the alarm automatically */
  function autoCompleteSchedules(made) {
    made.forEach(e => {
      pendSchedules().forEach(s => {
        if (s.target_type === e.target_type && String(s.target_id) === String(e.target_id)
          && String(s.vaccine || '').trim().toLowerCase() === String(e.vaccine || '').trim().toLowerCase()) {
          s.status = 'done';
          s.done_at = new Date().toISOString();
          removeScheduleReminder(s);
          s.reminder_id = null;
        }
      });
    });
  }

  /* ── medicine stock deduction (same ledger the treatments use) ─────── */
  function deductTotal(medId, total, note, entryForLabel) {
    const m = findMed(medId);
    if (!m) return;
    m.stock_quantity = round2((+m.stock_quantity || 0) - total);
    (F().med_movements = Array.isArray(F().med_movements) ? F().med_movements : []);
    F().med_movements.unshift({
      id: newId('mv-'), med_id: m.id, item_name: m.item_name, kind: 'treatment',
      delta: -round2(total), qty_after: m.stock_quantity, unit: m.unit,
      date: today(), at: new Date().toISOString(),
      note: note || ('Vaccination — ' + entryForLabel.target_label + ' (' + entryForLabel.vaccine + ')')
    });
  }
  function deductStock(e, total) { deductTotal(e.med_id, total, null, e); }

  /* ── due status ────────────────────────────────────────────────────── */
  const dateDiff = d => Math.round((new Date(String(d) + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5);
  function dueState(e) {
    if (!e.next_due) return { cls: 'dark', text: 'one-time — no follow-up', bucket: 'none' };
    const n = dateDiff(e.next_due);
    if (n < 0) return { cls: 'danger', text: 'OVERDUE ' + (-n) + ' day' + (-n > 1 ? 's' : ''), bucket: 'overdue' };
    if (n === 0) return { cls: 'warn', text: 'DUE TODAY · ' + (e.time || '08:00'), bucket: 'today' };
    if (n <= 7) return { cls: '', text: 'due in ' + n + ' day' + (n > 1 ? 's' : ''), bucket: 'week' };
    return { cls: '', text: 'due ' + fmtD(e.next_due), bucket: 'later' };
  }
  const needOf = e => round2((+e.dose_ml || 0) * (liveHeads(e) || 1));

  /* ── page render ───────────────────────────────────────────────────── */
  let vaxView = 'all', vaxQuery = '';

  function vaxPage() {
    const host = document.getElementById('vaccination');
    if (!host || !document.body.classList.contains('farm-access-granted')) return;
    const all = entries();
    const pending = all.filter(e => e.next_due).sort((a, b) => String(a.next_due + (a.time || '')).localeCompare(String(b.next_due + (b.time || ''))));
    const over = pending.filter(e => dueState(e).bucket === 'overdue').length,
      todayN = pending.filter(e => dueState(e).bucket === 'today').length,
      week = pending.filter(e => ['week'].includes(dueState(e).bucket)).length;
    const targets = new Set(all.map(e => e.target_type + ':' + e.target_id));
    const q = String(vaxQuery || '').trim().toLowerCase();
    const viewOk = e => (vaxView === 'all' || e.target_type === vaxView) && (!q || (e.target_label + ' ' + e.vaccine + ' ' + TYPE_META[e.target_type].label + ' ' + (e.notes || '')).toLowerCase().includes(q));

    /* [REBUILD FIX 51] never-vaccinated register + pending vaccination schedules */
    const unvax = neverVaccinated(),
      scheds = pendSchedules().sort((a, b) => String(a.date + (a.time || '')).localeCompare(String(b.date + (b.time || ''))));
    const unvaxOk = u => (vaxView === 'all' || u.type === vaxView) && (!q || (u.label + ' ' + u.name + ' ' + u.detail + ' ' + TYPE_META[u.type].label).toLowerCase().includes(q));
    const schedOk = x => (vaxView === 'all' || x.target_type === vaxView) && (!q || (x.target_label + ' ' + x.vaccine + ' ' + TYPE_META[x.target_type].label + ' ' + (x.note || '')).toLowerCase().includes(q));

    const unvaxRows = unvax.filter(unvaxOk).map(u => {
      const s = scheduleFor(u.type, u.id);
      return `<div class="vax-row unvax" data-vax>
        <span class="vax-ico">${TYPE_META[u.type].ico}</span>
        <div class="vax-main"><b>${esc(u.name)}</b>
          <small>${esc(u.label)} · ${TYPE_META[u.type].label}${u.type === 'batch' ? ' · ' + u.heads + ' heads' : ''}</small>
          <small>${esc(u.detail)}</small>
          ${s ? `<small class="vax-schedchip">⏰ ${esc(s.vaccine)} · ${fmtD(s.date)} · ${esc(s.time || '08:00')} — alarm armed</small>` : ''}
        </div>
        <div class="vax-need">${s ? `<b>${fmtD(s.date)}</b><small>⏰ ${esc(s.time || '08:00')}</small>` : `<b>—</b><small>no schedule</small>`}</div>
        <div class="vax-state"><span class="tag danger">no vaccine yet</span></div>
        <div class="vax-cta"><button class="btn" onclick="vaxRecordFor('${u.type}',${jsq(u.id)},${jsq(u.label)},${jsq(s ? s.id : '')})">💉 Record</button><button class="btn ghost" onclick="openVaxSchedule('${u.type}',${jsq(u.id)},${jsq(u.label)})">⏰ ${s ? 'Reschedule' : 'Schedule'}</button></div>
      </div>`;
    }).join('');

    const schedRows = scheds.filter(schedOk).map(x => {
      const n = dateDiff(x.date),
        tag = n < 0 ? { cls: 'danger', text: 'overdue ' + (-n) + ' day' + (-n > 1 ? 's' : '') }
          : n === 0 ? { cls: 'warn', text: 'TODAY · ' + (x.time || '08:00') }
          : { cls: '', text: 'in ' + n + ' day' + (n > 1 ? 's' : '') };
      const meta = TYPE_META[x.target_type] || { ico: '🐖', label: 'Group' };
      const completeAction = x.program_type && x.program_type !== 'vaccination'
        ? `<button class="btn" onclick="completeVaxProgram(${jsq(x.id)})">✓ Mark complete</button>`
        : `<button class="btn" onclick="vaxRecordFor('${x.target_type}',${jsq(x.target_id)},${jsq(x.target_label)},${jsq(x.id)})">💉 Record now</button>`;
      return `<div class="vax-row sched" data-vax>
        <span class="vax-ico">${meta.ico}</span>
        <div class="vax-main"><b>${esc(programTitle(x))}</b>
          <small>${esc(x.target_label)} · ${meta.label} · ${programKindLabel(x)}</small>
          <small>program scheduled${x.note ? ' · ' + esc(x.note) : ''}</small>
        </div>
        <div class="vax-need"><b>${fmtD(x.date)}</b><small>⏰ ${esc(x.time || '08:00')} · alarm on</small></div>
        <div class="vax-state"><span class="tag ${tag.cls}">${tag.text}</span></div>
        <div class="vax-cta">${completeAction}<button class="btn ghost" onclick="openVaxSchedule('${x.target_type}',${jsq(x.target_id)},${jsq(x.target_label)})" title="Edit schedule">✏️</button><button class="btn ghost delete-action" onclick="cancelVaxSchedule(${jsq(x.id)})" title="Cancel this schedule">🗑</button></div>
      </div>`;
    }).join('');

    const pendRows = pending.filter(viewOk).map(e => {
      const s = dueState(e), need = needOf(e), m = e.med_id ? findMed(e.med_id) : null,
        short = m && m.unit === 'ml' && (+m.stock_quantity || 0) < need;
      return `<div class="vax-row" data-vax>
        <span class="vax-ico">${TYPE_META[e.target_type].ico}</span>
        <div class="vax-main"><b>${esc(e.vaccine)}</b>
          <small>${esc(e.target_label)} · ${TYPE_META[e.target_type].label}</small>
          <small>last dose: ${fmtD(e.date)}${(e.rounds || []).length > 1 ? ' · dose ' + e.rounds.length + '' : ''} → next: <b>${fmtD(e.next_due)}</b> · ${esc(e.time || '08:00')}</small>
          ${short ? `<small class="vax-warn">⚠ only ${round2(m.stock_quantity)} ${esc(m.unit)} ${esc(m.item_name)} on hand — needs ${need} ml</small>` : ''}
        </div>
        <div class="vax-need"><b>${need} ml</b><small>${esc(e.dose_ml)} ml × ${liveHeads(e)} head${liveHeads(e) > 1 ? 's' : ''}</small></div>
        <div class="vax-state"><span class="tag ${s.cls}">${s.text}</span></div>
        <div class="vax-cta"><button class="btn" onclick="openVaxGive(${jsq(e.id)})">💉 Mark given</button><button class="btn ghost delete-action" onclick="vaxDelete(${jsq(e.id)})" title="Delete this vaccine program">🗑</button></div>
      </div>`;
    }).join('');

    const hist = [];
    all.forEach(e => (e.rounds || []).forEach((r, i) => hist.push({ e, r, i: i + 1 })));
    hist.sort((a, b) => String(b.r.date + (b.r.at || '')).localeCompare(String(a.r.date + (a.r.at || ''))));
    /* [REBUILD FIX 48] profile-recorded doses carry no ml — they print as — */
    const histRows = hist.filter(x => viewOk(x.e)).slice(0, 25).map(x => `<div class="vax-row hist" data-vax>
        <span class="vax-ico">${TYPE_META[x.e.target_type].ico}</span>
        <div class="vax-main"><b>${esc(x.e.vaccine)}</b>
          <small>${esc(x.e.target_label)} · ${TYPE_META[x.e.target_type].label} · dose ${x.i}</small>
          ${x.e.notes ? `<small>${esc(x.e.notes)}</small>` : ''}
        </div>
        <div class="vax-need"><b>${x.r.total_ml != null ? round2(x.r.total_ml) + ' ml' : '—'}</b><small>${x.r.dose_ml != null ? esc(x.r.dose_ml) + ' ml × ' : ''}${esc(x.r.heads ?? 1)} head${(x.r.heads ?? 1) > 1 ? 's' : ''}</small></div>
        <div class="vax-state"><span class="tag dark">✓ ${fmtD(x.r.date)}</span></div>
        <div class="vax-cta"></div>
      </div>`).join('');

    host.innerHTML = `
      <div class="panel vax-hero">
        <div class="eyebrow">🛡 HERD IMMUNIZATION PROGRAM</div>
        <h2>Vaccination center — sows, boars &amp; piglets</h2>
        <p class="muted">Record <b>two or more vaccines per animal</b>, link every dose to the <b>Medicine Inventory</b>, schedule the next dose as an <b>active reminder alert</b>, then print the preparation report before vaccination day.</p>
        <div class="vax-actions no-print">
          <button class="btn" onclick="openVaxModal()">＋ Record vaccination</button>
          <button class="btn ghost" onclick="openVaxProgramModal()">＋ Create program</button>
          <button class="btn ghost" onclick="openVaxReport()">🖨 Print report / PDF</button>
        </div>
      </div>
      <div class="vax-summary">
        <div class="panel vax-sum ${over ? 'hot' : ''}"><small>Overdue</small><b>${over}</b><span>follow-up doses</span></div>
        <div class="panel vax-sum ${todayN ? 'warm' : ''}"><small>Due today</small><b>${todayN}</b><span>to vaccinate now</span></div>
        <div class="panel vax-sum"><small>Next 7 days</small><b>${week}</b><span>scheduled doses</span></div>
        <div class="panel vax-sum"><small>On program</small><b>${all.length}</b><span>vaccines · ${targets.size} animals</span></div>
        <div class="panel vax-sum vax-sum-link ${unvax.length ? 'hot' : ''}" onclick="document.getElementById('vaxUnvaxSec')?.scrollIntoView({behavior:'smooth',block:'start'})"><small>Not yet vaccinated</small><b>${unvax.length}</b><span>sows · boars · batches</span></div>
        <div class="panel vax-sum vax-sum-link ${scheds.length ? 'warm' : ''}" onclick="document.getElementById('vaxSchedSec')?.scrollIntoView({behavior:'smooth',block:'start'})"><small>Scheduled</small><b>${scheds.length}</b><span>alarms armed</span></div>
      </div>
      <div class="vax-filters no-print">
        <div class="filters">${[['all', 'All'], ['sow', '♀ Sows'], ['boar', '♂ Boars'], ['batch', '🐖 Piglet batches']].map(([k, l]) => `<button class="period ${vaxView === k ? 'active' : ''}" data-vaxview="${k}" onclick="vaxSetView('${k}')">${l}</button>`).join('')}</div>
        <input id="vaxSearch" class="fg-search" type="search" inputmode="search" autocomplete="off" placeholder="🔍 Search animal, batch or vaccine…" value="${esc(vaxQuery)}" oninput="vaxSearchInput(this.value)">
      </div>
      <div class="panel vax-sec" id="vaxUnvaxSec"><h3>⚠ Not yet vaccinated <small class="muted">— sows, boars &amp; batches with no vaccine yet</small></h3>
        ${unvaxRows || `<div class="empty vax-ok-line">✓ Every active sow, boar and live piglet batch already has a vaccine on record.</div>`}
      </div>
      <div class="panel vax-sec" id="vaxSchedSec"><h3>⏰ Scheduled vaccinations <small class="muted">— alarm fires at the set date &amp; time</small></h3>
        ${schedRows || `<div class="empty">No vaccination schedules set — tap <b>⏰ Schedule</b> on any animal above to plan the date &amp; time and arm the alarm.</div>`}
      </div>
      <div class="panel vax-sec" id="vaxPendSec"><h3>📅 Follow-up schedule <small class="muted">— vaccine to prepare</small></h3>
        ${pendRows || `<div class="empty">No follow-up doses scheduled. Record a vaccination and switch on <b>“Schedule next dose”</b> to build the program.</div>`}
      </div>
      <div class="panel vax-sec" id="vaxHistSec"><h3>✅ Recorded vaccinations <small class="muted">— latest first</small></h3>
        ${histRows || '<div class="empty">No vaccinations recorded yet.</div>'}
        ${hist.length > 25 ? `<small class="muted">Showing the latest 25 rounds — the printed report includes the full history.</small>` : ''}
      </div>`;
  }
  function vaxSetView(v) { vaxView = v; vaxPage(); }
  function vaxSearchInput(q) {
    vaxQuery = q;
    /* live filter without a full re-render (keeps the caret in the box) */
    const host = document.getElementById('vaccination');
    if (!host || !document.getElementById('vaxSearch')) return;
    vaxPage();
    const box = document.getElementById('vaxSearch');
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }

  /* ── record modal ──────────────────────────────────────────────────── */
  let curCat = 'sow', curT = [], curM = [];
  /* [REBUILD FIX 37] mass-vaccination mode: one unified type-ahead covering
     sows, boars and piglet batches, with multi-select chips + quick-add-all;
     saving writes one program entry per selected animal (shared group_id). */
  let curMode = 'single', multiSel = [], curUni = [], uniCat = 'all';

  function targetControlHTML(cat) {
    const cands = targetCandidates(cat);
    if (!cands.length) {
      const empty = { sow: 'Sow name (no active sows registered)', boar: 'Boar name (register boars on the Boar Semen page first)', batch: 'Batch id (no live batches)' };
      return `<input name="animal_label" id="vaxTargetInput" placeholder="${empty[cat]}" value=""><input type="hidden" name="animal_ref" id="vaxTargetRef">`;
    }
    return `<div class="treat-typeahead vax-typeahead">
      <input name="animal_label" id="vaxTargetInput" autocomplete="off" placeholder="Type to search — ${TYPE_META[cat].hint}"
        oninput="vaxTargetFilter(this.value)" onfocus="vaxTargetFilter(this.value)" onblur="setTimeout(vaxTargetClose,180)">
      <input type="hidden" name="animal_ref" id="vaxTargetRef">
      <div id="vaxTargetSug" class="semen-suggestions treat-sug"></div></div>`;
  }

  function openVaxModal(defaultCat = 'sow', defaultId = '', defaultLabel = '') {
    document.getElementById('vaxModal')?.remove();
    curCat = defaultCat || 'sow';
    curT = []; curM = []; curMode = 'single'; multiSel = []; curUni = []; uniCat = 'all';

    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="vaxModal" style="z-index:9999999!important"><form class="reminder-modal perf-modal" onsubmit="saveVaxModal(event)">
      <div class="modal-top"><div><div class="eyebrow">VACCINATION PROGRAM</div><h2>＋ Record vaccination</h2><p>Sows, boars and piglet batches can hold several vaccines — save each one separately.</p></div><button type="button" class="close-reminder" onclick="document.getElementById('vaxModal').remove()">×</button></div>
      <div class="reminder-fields">
        <div class="field full"><label>Animal / group *</label>
          <div class="vax-cats" id="vaxModes">
            <button type="button" class="period active" data-mode="single" onclick="vaxSetMode('single')">🎯 Single animal</button>
            <button type="button" class="period" data-mode="multi" onclick="vaxSetMode('multi')">💉 Multiple — mass vaccination day</button>
          </div>
          <div id="vaxSingleBox">
          <div class="vax-cats" id="vaxCats">${Object.keys(TYPE_META).map(k => `<button type="button" class="period ${k === curCat ? 'active' : ''}" data-cat="${k}" onclick="vaxSetCat('${k}')">${TYPE_META[k].ico} ${TYPE_META[k].label}</button>`).join('')}</div>
          <div id="vaxTargetBox">${targetControlHTML(curCat)}</div>
          </div>
          <div id="vaxMultiBox" style="display:none">
            <div class="vax-cats" id="vaxUniCats">${[['all', 'All types'], ['sow', '♀ Sows'], ['boar', '♂ Boars'], ['batch', '🐖 Batches']].map(([k, l]) => `<button type="button" class="period ${k === 'all' ? 'active' : ''}" data-ucat="${k}" onclick="vaxUniSetCat('${k}')">${l}</button>`).join('')}</div>
            <div class="treat-typeahead vax-typeahead">
              <input id="vaxUniInput" autocomplete="off" placeholder="One search — sows, boars &amp; batches… tap to keep adding"
                oninput="vaxUniFilter(this.value)" onfocus="vaxUniFilter(this.value)" onblur="setTimeout(vaxUniClose,180)">
              <div id="vaxUniSug" class="semen-suggestions treat-sug"></div>
            </div>
            <div class="vax-multi-tools" id="vaxMultiTools"></div>
            <div id="vaxChips" class="vax-chips"></div>
            <small class="field-hint" id="vaxMultiSummary"></small>
          </div>
        </div>
        <div class="field full"><label>Vaccine * <small class="field-hint">auto-suggests from your Medicine Inventory — vaccines first</small></label>
          <div class="treat-typeahead vax-typeahead">
            <input id="vaxMedInput" autocomplete="off" placeholder="Type to search medicine inventory…"
              oninput="vaxMedFilter(this.value)" onfocus="vaxMedFilter(this.value)" onblur="setTimeout(vaxMedClose,180)">
            <input type="hidden" id="vaxMedId">
            <div id="vaxMedSug" class="semen-suggestions treat-sug"></div>
          </div>
          <small class="field-hint" id="vaxUnitTag">Not in inventory? Just type the vaccine name — it is still recorded.</small>
        </div>
        <div class="field"><label>Date given *</label><input name="date" id="vaxDate" type="date" value="${today()}" required oninput="vaxCalc()"></div>
        <div class="field" id="vaxHeadsField"><label>Heads *</label><input name="heads" id="vaxHeads" type="number" min="1" step="1" value="1" inputmode="numeric" oninput="vaxCalc()"><small class="field-hint">picking a piglet batch fills its live headcount</small></div>
        <div class="field"><label>Dose per head (ml) *</label><input name="dose_ml" id="vaxDose" type="number" min="0.1" step="0.1" value="2" inputmode="decimal" oninput="vaxCalc()"></div>
        <div class="field"><label>Prepare in total</label><div class="vax-total" id="vaxTotal">2 ml</div></div>
        <div class="field full" id="vaxDeductWrap" style="display:none"><label class="vax-check"><input type="checkbox" id="vaxDeductChk" checked><span id="vaxDeductText"></span></label></div>
        <div class="field full"><label class="vax-check"><input type="checkbox" id="vaxFollowChk" onchange="vaxToggleFollow()"><span><b>Schedule next dose</b> — asks how many days, then alerts you on that date &amp; time</span></label></div>
        <div id="vaxFollowBox" style="display:none;grid-column:1/-1">
          <div class="reminder-fields" style="margin-top:0">
            <div class="field"><label>Next dose after (days) *</label><input name="interval_days" id="vaxInterval" type="number" min="1" step="1" placeholder="e.g. 21" inputmode="numeric" oninput="vaxCalc()"></div>
            <div class="field"><label>Alert time</label><input name="time" id="vaxTime" type="time" value="08:00" oninput="vaxCalc()"></div>
          </div>
          <small class="field-hint" id="vaxNextHint">An active reminder will fire on the set date &amp; time — shown on the Reminders page and the dashboard alert widget, with the critical alarm treatment.</small>
        </div>
        <div class="field full"><label>Notes</label><textarea name="notes" id="vaxNotes" placeholder="Batch no., reaction watch, handler…"></textarea></div>
      </div>
      <div class="form-error" id="vaxErr"></div>
      <div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('vaxModal').remove()">Cancel</button><button class="btn">💉 Save vaccination</button></div>
    </form></div>`);

    if (defaultId || defaultLabel) {
      const inputEl = document.getElementById('vaxTargetInput');
      const refEl = document.getElementById('vaxTargetRef');
      const cand = targetCandidates(curCat).find(c =>
        c.ref === `sow:${defaultId}` ||
        c.ref === `sow:${defaultLabel}` ||
        c.label.toLowerCase().includes((defaultLabel || defaultId).toLowerCase())
      );
      if (inputEl) inputEl.value = cand ? cand.label : (defaultLabel || defaultId);
      if (refEl) refEl.value = cand ? cand.ref : `sow:${defaultId || defaultLabel}`;
    }

    vaxCalc();
  }
  window.openVaxModal = openVaxModal;
  window.openRecordVaccination = openVaxModal;

  function vaxSetCat(cat) {
    curCat = cat; curT = [];
    document.querySelectorAll('#vaxCats .period').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
    const box = document.getElementById('vaxTargetBox');
    if (box) box.innerHTML = targetControlHTML(cat);
    const h = document.getElementById('vaxHeads');
    if (h) h.value = 1;
    vaxCalc();
  }
  function vaxTargetFilter(q) {
    const box = document.getElementById('vaxTargetSug'), ref = document.getElementById('vaxTargetRef');
    if (!box) { return; }
    if (ref) ref.value = '';
    const t = String(q || '').trim().toLowerCase();
    curT = targetCandidates(curCat).filter(c => !t || c.search.includes(t));
    box.innerHTML = curT.length
      ? curT.slice(0, 12).map((c, i) => `<button type="button" onmousedown="vaxTargetPick(${i})"><span><b>${esc(c.label)}</b></span><span class="treat-sug-heads">${c.heads > 1 ? c.heads + ' heads' : ''}</span></button>`).join('')
      : `<div class="suggestion-empty">No match — finish typing the name; it is recorded as a custom entry.</div>`;
    box.classList.add('open');
    box.style.display = 'block';
  }
  function vaxTargetPick(i) {
    const c = curT[i];
    if (!c) return;
    document.getElementById('vaxTargetInput').value = c.label;
    document.getElementById('vaxTargetRef').value = c.ref;
    if (c.heads > 1) document.getElementById('vaxHeads').value = c.heads;
    vaxTargetClose();
    vaxCalc();
  }
  function vaxTargetClose() { const b = document.getElementById('vaxTargetSug'); if (b) { b.classList.remove('open'); b.style.display = 'none'; } }

  function vaxMedFilter(q) {
    const box = document.getElementById('vaxMedSug'), hid = document.getElementById('vaxMedId');
    if (!box) return;
    if (hid) hid.value = '';
    curM = medCandidates(q);
    box.innerHTML = curM.length
      ? curM.map((m, i) => `<button type="button" onmousedown="vaxMedPick(${i})"><span><b>${esc(m.item_name)}</b><small>${esc(m.brand_name || m.active_ingredient || '')}</small></span><span class="treat-sug-heads">${/vaccin|biologic/i.test(m.med_type || '') ? '💉 ' : ''}${esc(m.med_type || 'Medicine')} · ${round2(m.stock_quantity)} ${esc(m.unit)}</span></button>`).join('')
      : `<div class="suggestion-empty">No inventory match — finish typing the vaccine name; it is recorded without stock tracking.</div>`;
    box.classList.add('open');
    box.style.display = 'block';
  }
  function vaxMedPick(i) {
    const m = curM[i];
    if (!m) return;
    document.getElementById('vaxMedInput').value = m.item_name;
    document.getElementById('vaxMedId').value = m.id;
    const tag = document.getElementById('vaxUnitTag');
    if (tag) tag.innerHTML = `✓ Linked to inventory: <b>${esc(m.item_name)}</b> · ${round2(m.stock_quantity)} ${esc(m.unit)} on hand${m.expiry_date ? ' · expires ' + esc(m.expiry_date) : ''}`;
    vaxMedClose();
    vaxCalc();
  }
  function vaxMedClose() { const b = document.getElementById('vaxMedSug'); if (b) { b.classList.remove('open'); b.style.display = 'none'; } }

  function vaxToggleFollow() {
    const on = document.getElementById('vaxFollowChk').checked;
    document.getElementById('vaxFollowBox').style.display = on ? 'block' : 'none';
    if (on) vaxCalc();
  }
  /* live "ml to prepare", stock warning and the deduct-strip */
  function vaxCalc() {
    const inMulti = curMode === 'multi',
      dose = num(document.getElementById('vaxDose')?.value) || 0,
      heads = inMulti ? multiSel.reduce((a, c) => a + c.heads, 0) : (num(document.getElementById('vaxHeads')?.value) || 0),
      total = round2(dose * heads),
      tEl = document.getElementById('vaxTotal');
    if (tEl) tEl.innerHTML = `<b>${total} ml</b>` + (inMulti && multiSel.length ? `<small>${multiSel.length} animal${multiSel.length > 1 ? 's' : ''} · ${heads} heads</small>` : '');
    const sum = document.getElementById('vaxMultiSummary');
    if (sum && inMulti) {
      sum.innerHTML = multiSel.length
        ? `✓ ${multiSel.length} selected — ${heads} heads · ≈ <b>${total} ml</b> to prepare today`
        : 'No animals selected yet — search above, or use the quick-add buttons to take every sow, boar or live batch.';
    }
    const days = num(document.getElementById('vaxInterval')?.value),
      hint = document.getElementById('vaxNextHint'),
      date = document.getElementById('vaxDate')?.value || today();
    if (hint && document.getElementById('vaxFollowChk')?.checked) {
      hint.innerHTML = days
        ? `⏰ Next dose: <b>${fmtD(isoOff(date, days))}</b> · ${document.getElementById('vaxTime')?.value || '08:00'} — an active reminder alert fires at that date &amp; time.`
        : 'An active reminder alert fires on the set date &amp; time — visible on the Reminders page and the dashboard alert widget.';
    }
    const wrap = document.getElementById('vaxDeductWrap'), txt = document.getElementById('vaxDeductText'),
      m = findMed(document.getElementById('vaxMedId')?.value);
    if (wrap && txt) {
      if (m) {
        wrap.style.display = '';
        const short = m.unit === 'ml' && (+m.stock_quantity || 0) < total;
        txt.innerHTML = `Deduct <b>${total} ${esc(m.unit)}</b> from <b>${esc(m.item_name)}</b> stock (${round2(m.stock_quantity)} ${esc(m.unit)} on hand)` + (inMulti && multiSel.length ? ` — covers all ${multiSel.length} animals` : '') + (short ? ` — <span class="vax-warn">⚠ stock is short for this dose</span>` : '');
      } else wrap.style.display = 'none';
    }
  }

  function saveVaxModal(e) {
    e.preventDefault();
    const err = document.getElementById('vaxErr');
    const show = m => { err.textContent = m; err.classList.add('show'); };
    err.classList.remove('show');
    const vaccine = (document.getElementById('vaxMedInput')?.value || '').trim();
    if (!vaccine) return show('Type or pick the vaccine name.');
    const date = document.getElementById('vaxDate').value || today(),
      dose = num(document.getElementById('vaxDose').value),
      follow = document.getElementById('vaxFollowChk').checked,
      days = num(document.getElementById('vaxInterval').value),
      time = document.getElementById('vaxTime').value || '08:00',
      medId = document.getElementById('vaxMedId')?.value || '',
      m = findMed(medId),
      notes = (document.getElementById('vaxNotes')?.value || '').trim(),
      wantDeduct = !!(m && document.getElementById('vaxDeductChk')?.checked);
    if (!dose || dose <= 0) return show('Enter the dose per head in ml (e.g. 2).');
    if (follow && (!days || days < 1)) return show('How many days until the next dose? Enter 1 or more (e.g. 21).');
    const mkEntry = (target, heads) => ({
      id: newId('vax-'), ...target, vaccine, med_id: medId || null,
      date, dose_ml: dose, heads,
      interval_days: follow ? days : null, next_due: follow ? isoOff(date, days) : null, time: follow ? time : null,
      rounds: [{ date, dose_ml: dose, heads, total_ml: round2(dose * heads), at: new Date().toISOString() }],
      reminder_id: null, notes, created_at: new Date().toISOString()
    });
    const finish = made => {
      autoCompleteSchedules(made); /* [REBUILD FIX 51] matching pending schedules complete + alarms cancel */
      save();
      document.getElementById('vaxModal')?.remove();
      renderAll();
      const due = made[0] && made[0].next_due;
      toast(made.length > 1
        ? made.length + ' vaccinations recorded — one program per animal' + (due ? ' · reminders armed' : '')
        : (due ? 'Vaccination recorded — follow-up ' + fmtD(due) + ' (reminder armed)' : 'Vaccination recorded'));
    };

    /* [REBUILD FIX 37] mass-vaccination save: same vaccine, one program entry
       per selected animal — all share group_id and the follow-up rule. */
    if (curMode === 'multi') {
      if (!multiSel.length) return show('Select at least one sow, boar or piglet batch.');
      const gid = newId('vxg-'), made = [];
      multiSel.forEach(c => {
        const heads = freshHeads(c);
        if (heads < 1) return; /* batch emptied between pick and save — skipped safely */
        const entry = mkEntry({ target_type: c.type, target_id: c.id, target_label: c.label }, heads);
        entry.group_id = gid;
        entries().push(entry);
        if (follow) armVaxReminder(entry);
        made.push(entry);
      });
      if (!made.length) return show('Everything selected is empty now (0 heads) — nothing was recorded.');
      if (wantDeduct) deductTotal(medId, round2(dose * made.reduce((a, x) => a + x.heads, 0)), 'Mass vaccination — ' + made.length + ' animals (' + vaccine + ')');
      return finish(made);
    }

    const ref = (document.getElementById('vaxTargetRef')?.value || '').trim(),
      typed = (document.getElementById('vaxTargetInput')?.value || '').trim(),
      headsIn = num(document.getElementById('vaxHeads').value);
    let target = null;
    if (ref) {
      const [type, ...rest] = ref.split(':');
      const c = targetCandidates(curCat).find(x => x.ref === ref);
      target = { target_type: type, target_id: rest.join(':'), target_label: c ? c.label : typed };
    } else {
      if (!typed) return show('Pick or type the animal / group to vaccinate.');
      target = { target_type: curCat, target_id: typed, target_label: typed + ' (custom entry)' };
    }
    if (!headsIn || headsIn < 1) return show('Heads must be at least 1.');
    const entry = mkEntry(target, headsIn);
    entries().push(entry);
    if (follow) armVaxReminder(entry);
    if (wantDeduct) deductTotal(medId, round2(dose * headsIn), null, entry);
    finish([entry]);
  }

  /* ── [REBUILD FIX 51] schedule modal (date + time → armed alarm) ────── */
  let curSched = null, curSchedM = [];

  function openVaxSchedule(type, id, label) {
    document.getElementById('vaxSchedModal')?.remove();
    const ex = scheduleFor(type, id);
    curSched = { id: ex ? ex.id : null, type, targetId: id, label };
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="vaxSchedModal"><form class="reminder-modal perf-modal" onsubmit="saveVaxSchedule(event)">
      <div class="modal-top"><div><div class="eyebrow">VACCINATION SCHEDULE</div><h2>⏰ ${ex ? 'Edit schedule' : 'Schedule vaccination'}</h2><p>${TYPE_META[type].ico} ${esc(label)} — a loud <b>critical alarm</b> fires exactly at the set date &amp; time (also on the Reminders page and dashboard widget).</p></div><button type="button" class="close-reminder" onclick="document.getElementById('vaxSchedModal').remove()">×</button></div>
      <div class="reminder-fields">
        <div class="field full"><label>Vaccine to give * <small class="field-hint">auto-suggests from your Medicine Inventory</small></label>
          <div class="treat-typeahead vax-typeahead">
            <input id="schedMedInput" autocomplete="off" placeholder="e.g. Hog Cholera vaccine" value="${esc(ex ? ex.vaccine : '')}"
              oninput="schedMedFilter(this.value)" onfocus="schedMedFilter(this.value)" onblur="setTimeout(schedMedClose,180)">
            <input type="hidden" id="schedMedId" value="${esc(ex && ex.med_id ? ex.med_id : '')}">
            <div id="schedMedSug" class="semen-suggestions treat-sug"></div>
          </div>
        </div>
        <div class="field"><label>Date *</label><input id="schedDate" type="date" value="${esc(ex ? ex.date : today())}" required oninput="schedHint()"></div>
        <div class="field"><label>Time — alarm goes off *</label><input id="schedTime" type="time" value="${esc(ex ? ex.time || '08:00' : '08:00')}" required oninput="schedHint()"></div>
        <div class="field full"><label>Note</label><input id="schedNote" placeholder="Handler, barn, preparation note…" value="${esc(ex && ex.note ? ex.note : '')}"></div>
        <div class="field full"><small class="field-hint" id="schedHintTxt"></small></div>
      </div>
      <div class="form-error" id="schedErr"></div>
      <div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('vaxSchedModal').remove()">Cancel</button><button class="btn">⏰ Save schedule &amp; arm alarm</button></div>
    </form></div>`);
    schedHint();
  }
  function schedHint() {
    const el = document.getElementById('schedHintTxt');
    if (!el) return;
    const d = document.getElementById('schedDate')?.value, t = document.getElementById('schedTime')?.value || '08:00';
    if (!d) { el.textContent = ''; return; }
    el.innerHTML = new Date(d + 'T' + t + ':00') > new Date()
      ? `🔔 Alarm fires <b>${fmtD(d)} · ${esc(t)}</b> — stays visible on the Reminders page until dismissed.`
      : `🔔 That time has already passed — the alarm fires <b>right after saving</b>.`;
  }
  function schedMedFilter(q) {
    const box = document.getElementById('schedMedSug'), hid = document.getElementById('schedMedId');
    if (!box) return;
    if (hid) hid.value = '';
    curSchedM = medCandidates(q);
    box.innerHTML = curSchedM.length
      ? curSchedM.map((m, i) => `<button type="button" onmousedown="schedMedPick(${i})"><span><b>${esc(m.item_name)}</b><small>${esc(m.brand_name || m.active_ingredient || '')}</small></span><span class="treat-sug-heads">${/vaccin|biologic/i.test(m.med_type || '') ? '💉 ' : ''}${esc(m.med_type || 'Medicine')} · ${round2(m.stock_quantity)} ${esc(m.unit)}</span></button>`).join('')
      : `<div class="suggestion-empty">No inventory match — finish typing the vaccine name; the schedule is still saved.</div>`;
    box.classList.add('open');
    box.style.display = 'block';
  }
  function schedMedPick(i) {
    const m = curSchedM[i];
    if (!m) return;
    document.getElementById('schedMedInput').value = m.item_name;
    document.getElementById('schedMedId').value = m.id;
    schedMedClose();
  }
  function schedMedClose() { const b = document.getElementById('schedMedSug'); if (b) { b.classList.remove('open'); b.style.display = 'none'; } }

  function saveVaxSchedule(ev) {
    ev.preventDefault();
    const err = document.getElementById('schedErr');
    const show = m => { err.textContent = m; err.classList.add('show'); };
    err.classList.remove('show');
    const vaccine = (document.getElementById('schedMedInput')?.value || '').trim(),
      date = document.getElementById('schedDate')?.value,
      time = document.getElementById('schedTime')?.value || '08:00',
      note = (document.getElementById('schedNote')?.value || '').trim(),
      medId = document.getElementById('schedMedId')?.value || '';
    if (!curSched) return show('No animal selected — close this and pick ⏰ Schedule from the list.');
    if (!vaccine) return show('Type or pick the vaccine to give.');
    if (!date) return show('Pick the vaccination date.');
    let s = curSched.id ? schedules().find(x => x.id === curSched.id) : null;
    if (s) Object.assign(s, { vaccine, med_id: medId || null, date, time, note });
    else {
      s = {
        id: newId('vsch-'), target_type: curSched.type, target_id: curSched.targetId, target_label: curSched.label,
        vaccine, med_id: medId || null, date, time, note,
        reminder_id: null, status: 'pending', created_at: new Date().toISOString()
      };
      schedules().push(s);
    }
    armScheduleReminder(s);
    save();
    curSched = null;
    document.getElementById('vaxSchedModal')?.remove();
    renderAll();
    toast('Vaccination scheduled — alarm armed for ' + fmtD(date) + ' · ' + time);
  }

  function programTargetOptions() {
    const out = [];
    ['sow', 'boar', 'batch'].forEach(type => {
      const meta = TYPE_META[type] || { label: 'Group', ico: '🐖' };
      targetCandidates(type).forEach(c => out.push(`<option value="${esc(c.ref)}">${meta.ico} ${esc(c.label)} · ${meta.label}</option>`));
    });
    return out.join('');
  }

  let programMedHits = [];
  let programTargetHits = [];

  function programMedFilter(query) {
    const box = document.getElementById('programMedSug');
    const hidden = document.getElementById('programMedId');
    if (!box) return;
    if (hidden) hidden.value = '';
    const term = String(query || '').trim().toLowerCase();
    programMedHits = medCandidates(term);
    box.innerHTML = programMedHits.length
      ? programMedHits.map((m, i) => `<button type="button" onmousedown="programMedPick(${i})"><span><b>${esc(m.item_name)}</b><small>${esc(m.brand_name || m.active_ingredient || '')}</small></span><span class="treat-sug-heads">${round2(m.stock_quantity)} ${esc(m.unit)} on hand</span></button>`).join('')
      : '<div class="suggestion-empty">No inventory match. You may continue with a typed program name without linking stock.</div>';
    box.classList.add('open'); box.style.display = 'block';
  }

  function programMedPick(index) {
    const m = programMedHits[index];
    if (!m) return;
    const input = document.getElementById('programMedSearch');
    const hidden = document.getElementById('programMedId');
    const name = document.getElementById('programName');
    if (input) input.value = `${m.item_name} · ${round2(m.stock_quantity)} ${m.unit} on hand`;
    if (hidden) hidden.value = m.id;
    if (name && !name.value.trim()) name.value = m.item_name;
    document.getElementById('programMedSug')?.style && (document.getElementById('programMedSug').style.display = 'none');
  }

  function programMedClose() {
    const box = document.getElementById('programMedSug');
    if (box) { box.classList.remove('open'); box.style.display = 'none'; }
  }

  function programTargetFilter(query) {
    const box = document.getElementById('programTargetSug');
    const hidden = document.getElementById('programTargetRef');
    if (!box) return;
    if (hidden) hidden.value = '';
    const term = String(query || '').trim().toLowerCase();
    const all = [];
    ['sow', 'boar', 'batch'].forEach(type => {
      const meta = TYPE_META[type] || { label: 'Group', ico: '🐖' };
      targetCandidates(type).forEach(c => all.push({ ...c, type, meta }));
    });
    programTargetHits = all.filter(c => !term || c.search.includes(term));
    box.innerHTML = programTargetHits.length
      ? programTargetHits.slice(0, 20).map((c, i) => `<button type="button" onmousedown="programTargetPick(${i})"><span><b>${c.meta.ico} ${esc(c.label)}</b><small>${c.meta.label}${c.heads > 1 ? ' · ' + c.heads + ' live heads' : ''}</small></span></button>`).join('')
      : '<div class="suggestion-empty">No matching sow, boar, or live piglet batch.</div>';
    box.classList.add('open'); box.style.display = 'block';
  }

  function programTargetPick(index) {
    const c = programTargetHits[index];
    if (!c) return;
    const input = document.getElementById('programTargetSearch');
    const hidden = document.getElementById('programTargetRef');
    if (input) input.value = c.label;
    if (hidden) hidden.value = c.ref;
    programTargetClose();
  }

  function programTargetClose() {
    const box = document.getElementById('programTargetSug');
    if (box) { box.classList.remove('open'); box.style.display = 'none'; }
  }

  function openVaxProgramModal() {
    document.getElementById('vaxProgramModal')?.remove();
    const inventoryMedicines = medicines();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="vaxProgramModal"><form class="reminder-modal perf-modal" onsubmit="saveVaxProgram(event)">
      <div class="modal-top"><div><div class="eyebrow">PROGRAM SCHEDULER</div><h2>＋ Create farm health program</h2><p>Schedule a vaccination, medication, or treatment and arm an alarm for veterinary staff.</p></div><button type="button" class="close-reminder" onclick="document.getElementById('vaxProgramModal')?.remove()">×</button></div>
      <div class="reminder-fields">
        <div class="field"><label>Program type *</label><select name="program_type"><option value="vaccination">Vaccination</option><option value="medication">Medication</option><option value="treatment">Treatment</option></select></div>
        <div class="field full suggest-field" style="position:relative"><label>Medicine / vaccine inventory link <small class="field-hint">type to search inventory</small></label><div class="suggest-input-wrap"><input id="programMedSearch" class="suggest-input" autocomplete="off" placeholder="Type medicine, vaccine, or brand…" onfocus="programMedFilter(this.value)" oninput="programMedFilter(this.value)" onblur="setTimeout(programMedClose,180)"><input type="hidden" name="med_id" id="programMedId"><div id="programMedSug" class="semen-suggestions treat-sug"></div></div></div>
        <div class="field full"><label>Program name *</label><input id="programName" name="program_name" required placeholder="e.g. Mycoplasma follow-up, Iron injection, Farrowsure booster"></div>
        <div class="field full suggest-field" style="position:relative"><label>Animal / group * <small class="field-hint">type to search a sow, boar, or piglet batch</small></label><div class="suggest-input-wrap"><input id="programTargetSearch" class="suggest-input" name="target_label" autocomplete="off" placeholder="Type name or ID…" onfocus="programTargetFilter(this.value)" oninput="programTargetFilter(this.value)" onblur="setTimeout(programTargetClose,180)"><input type="hidden" name="target_ref" id="programTargetRef" required><div id="programTargetSug" class="semen-suggestions treat-sug"></div></div></div>
        <div class="field"><label>Date *</label><input name="date" type="date" value="${today()}" required></div>
        <div class="field"><label>Alarm time *</label><input name="time" type="time" value="08:00" required></div>
        <div class="field full"><label>Veterinary staff note</label><textarea name="note" placeholder="Dose preparation, barn/pen, handler, withdrawal or observation note"></textarea></div>
      </div>
      <div class="notice" style="margin-top:12px">🔔 The alarm will appear in Reminders and the dashboard at the exact date and time. When it triggers, staff can print a reference sheet.</div>
      <div class="form-error" id="programErr"></div>
      <div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('vaxProgramModal')?.remove()">Cancel</button><button class="btn">⏰ Create program &amp; arm alarm</button></div>
    </form></div>`);
  }

  function saveVaxProgram(ev) {
    ev.preventDefault();
    const err = document.getElementById('programErr');
    err.classList.remove('show');
    try {
      const d = Object.fromEntries(new FormData(ev.target));
      const targetRef = String(d.target_ref || '');
      if (!targetRef) throw new Error('Select an animal or group.');
      const [targetType, ...rest] = targetRef.split(':');
      const targetId = rest.join(':');
      const candidate = targetCandidates(targetType).find(c => c.ref === targetRef);
      const targetLabel = candidate?.label || targetId;
      const program = {
        id: newId('prog-'), program_type: d.program_type || 'vaccination', program_name: String(d.program_name || '').trim(),
        vaccine: String(d.program_name || '').trim(), med_id: d.med_id || null,
        target_type: targetType, target_id: targetId, target_label: targetLabel,
        date: d.date, time: d.time || '08:00', note: String(d.note || '').trim(),
        reminder_id: null, status: 'pending', created_at: new Date().toISOString()
      };
      if (!program.program_name) throw new Error('Enter the program name.');
      schedules().push(program);
      armScheduleReminder(program);
      save();
      document.getElementById('vaxProgramModal')?.remove();
      renderAll();
      toast(`${programKindLabel(program)} program created — alarm armed for ${fmtD(program.date)} · ${program.time}`);
    } catch (error) {
      err.textContent = error.message || 'Could not create the health program.';
      err.classList.add('show');
    }
  }

  async function completeVaxProgram(id) {
    const s = schedules().find(x => x.id === id);
    if (!s) return;
    if (!confirm(`Mark ${programKindLabel(s).toLowerCase()} “${programTitle(s)}” for ${s.target_label} as complete?`)) return;
    const reminderId = s.reminder_id || 'vaxsched-rem-' + s.id;
    try {
      const farmIdForDelete = window.__arsActiveFarmId || window.farmId;
      if (farmIdForDelete && window.ARSCloud?.deleteAppRecord) await ARSCloud.deleteAppRecord(farmIdForDelete, 'reminder', reminderId);
    } catch (_) {
      toast('Program was not completed because its cloud alarm could not be cleared.');
      return;
    }
    removeScheduleReminder(s);
    s.status = 'done'; s.done_at = new Date().toISOString(); s.reminder_id = null;
    save(); renderAll(); toast(`${programKindLabel(s)} program completed.`);
  }

  async function cancelVaxSchedule(id) {
    const s = schedules().find(x => x.id === id);
    if (!s) return;
    if (!confirm(`Cancel the ${s.vaccine} schedule for ${s.target_label} (${fmtD(s.date)} · ${s.time || '08:00'})? The alarm is cancelled too.`)) return;
    const farmIdForDelete = window.__arsActiveFarmId || window.farmId;
    const reminderId = s.reminder_id || 'vaxsched-rem-' + s.id;
    try {
      if (!farmIdForDelete || !window.ARSCloud?.deleteAppRecord) throw new Error('Verified cloud deletion is unavailable.');
      await ARSCloud.deleteAppRecord(farmIdForDelete, 'vax_schedule', s._ars_cloud_local_id || s.id);
      if (reminderId) await ARSCloud.deleteAppRecord(farmIdForDelete, 'reminder', reminderId);
    } catch (error) {
      toast(`⚠️ Vaccination schedule was not cancelled: cloud deletion failed — ${error.message || error}`);
      return;
    }
    removeScheduleReminder(s);
    F().vaxSchedules = schedules().filter(x => x.id !== id);
    save();
    renderAll();
    toast('Vaccination schedule cancelled from the cloud and this device');
  }

  /* 💉 Record / Record now — opens the record modal pre-filled with this
     animal (plus the scheduled vaccine when a schedule is armed) */
  function vaxRecordFor(type, id, label, schedId) {
    openVaxModal();
    vaxSetCat(type);
    const s = schedId ? schedules().find(x => x.id === schedId) : null,
      ref = type + ':' + id,
      cand = targetCandidates(type).find(c => c.ref === ref),
      inp = document.getElementById('vaxTargetInput'),
      hid = document.getElementById('vaxTargetRef');
    if (inp) inp.value = cand ? cand.label : label;
    if (hid) hid.value = ref;
    if (cand && cand.heads > 1 && document.getElementById('vaxHeads')) document.getElementById('vaxHeads').value = cand.heads;
    if (s) {
      const mi = document.getElementById('vaxMedInput');
      if (mi) mi.value = s.vaccine;
      if (s.med_id) {
        document.getElementById('vaxMedId').value = s.med_id;
        const m = findMed(s.med_id), tag = document.getElementById('vaxUnitTag');
        if (m && tag) tag.innerHTML = `✓ Linked to inventory: <b>${esc(m.item_name)}</b> · ${round2(m.stock_quantity)} ${esc(m.unit)} on hand`;
      }
    }
    vaxCalc();
  }

  /* ── mark a scheduled dose as given ────────────────────────────────── */
  function openVaxGive(id) {
    const e = entries().find(x => x.id === id);
    if (!e) return;
    document.getElementById('vaxGiveModal')?.remove();
    const heads = liveHeads(e), m = e.med_id ? findMed(e.med_id) : null;
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="vaxGiveModal"><form class="reminder-modal perf-modal" onsubmit="saveVaxGive(event)">
      <div class="modal-top"><div><div class="eyebrow">ADMINISTER FOLLOW-UP</div><h2>💉 ${esc(e.vaccine)}</h2><p>${esc(e.target_label)} · due ${fmtD(e.next_due)}${e.next_due ? ' · ' + esc(e.time || '08:00') : ''} · this will be dose ${(e.rounds || []).length + 1}</p></div><button type="button" class="close-reminder" onclick="document.getElementById('vaxGiveModal').remove()">×</button></div>
      <input type="hidden" id="vaxGId" value="${esc(e.id)}">
      <div class="reminder-fields">
        <div class="field"><label>Date given *</label><input id="vaxGDate" type="date" value="${today()}" required></div>
        <div class="field"><label>Heads *</label><input id="vaxGHeads" type="number" min="1" step="1" value="${heads}" inputmode="numeric" oninput="vaxGiveCalc()"></div>
        <div class="field"><label>Dose per head (ml) *</label><input id="vaxGDose" type="number" min="0.1" step="0.1" value="${esc(e.dose_ml)}" inputmode="decimal" oninput="vaxGiveCalc()"></div>
        <div class="field"><label>Prepare in total</label><div class="vax-total" id="vaxGTotal"></div></div>
        ${m ? `<div class="field full"><label class="vax-check"><input type="checkbox" id="vaxGDeductChk" checked><span id="vaxGDeductText"></span></label></div>` : ''}
        ${e.interval_days ? `<div class="field full"><p class="perf-sub" style="margin:0">After saving, the next dose is automatically re-scheduled <b>${e.interval_days} days</b> from the date given and the reminder re-arms for <b>${esc(e.time || '08:00')}</b>.</p></div>` : `<div class="field full"><p class="perf-sub" style="margin:0">This program has no follow-up — saving completes it and closes the reminder.</p></div>`}
      </div>
      <div class="form-error" id="vaxGErr"></div>
      <div class="due-actions" style="margin-top:16px"><button type="button" class="btn ghost" onclick="document.getElementById('vaxGiveModal').remove()">Cancel</button><button class="btn">✓ Mark as given</button></div>
    </form></div>`);
    vaxGiveCalc();
  }
  function vaxGiveCalc() {
    const dose = num(document.getElementById('vaxGDose')?.value) || 0,
      heads = num(document.getElementById('vaxGHeads')?.value) || 0,
      total = round2(dose * heads),
      t = document.getElementById('vaxGTotal');
    if (t) t.innerHTML = `<b>${total} ml</b>`;
    const e = entries().find(x => x.id === document.getElementById('vaxGId')?.value),
      m = e && e.med_id ? findMed(e.med_id) : null,
      txt = document.getElementById('vaxGDeductText');
    if (m && txt) {
      const short = m.unit === 'ml' && (+m.stock_quantity || 0) < total;
      txt.innerHTML = `Deduct <b>${total} ${esc(m.unit)}</b> from <b>${esc(m.item_name)}</b> stock (${round2(m.stock_quantity)} ${esc(m.unit)} on hand)` + (short ? ` — <span class="vax-warn">⚠ short for this dose</span>` : '');
    }
  }
  function saveVaxGive(ev) {
    ev.preventDefault();
    const e = entries().find(x => x.id === document.getElementById('vaxGId').value);
    if (!e) return;
    const err = document.getElementById('vaxGErr');
    const date = document.getElementById('vaxGDate').value || today(),
      dose = num(document.getElementById('vaxGDose').value),
      heads = num(document.getElementById('vaxGHeads').value);
    if (!dose || dose <= 0 || !heads || heads < 1) { err.textContent = 'Dose per head and heads are required.'; err.classList.add('show'); return; }
    const total = round2(dose * heads);
    e.rounds = Array.isArray(e.rounds) ? e.rounds : [];
    e.rounds.push({ date, dose_ml: dose, heads, total_ml: total, at: new Date().toISOString() });
    e.date = date; e.dose_ml = dose; e.heads = heads;
    if (e.interval_days) {
      e.next_due = isoOff(date, e.interval_days);
      armVaxReminder(e);
    } else {
      e.next_due = null;
      removeVaxReminder(e);
    }
    if (e.med_id && document.getElementById('vaxGDeductChk')?.checked) deductStock(e, total);
    save();
    document.getElementById('vaxGiveModal')?.remove();
    renderAll();
    toast(e.next_due ? `Dose recorded — next follow-up ${fmtD(e.next_due)} (reminder re-armed)` : 'Dose recorded — program completed');
  }

  async function vaxDelete(id) {
    const e = entries().find(x => x.id === id);
    if (!e) return;
    if (!confirm(`Delete the “${e.vaccine}” program for ${e.target_label}? Its ${(e.rounds || []).length} recorded dose(s) are removed and the reminder is cancelled. This cannot be undone.`)) return;
    const farmIdForDelete = window.__arsActiveFarmId || window.farmId;
    const reminderId = e.reminder_id || 'vacc-rem-' + e.id;
    try {
      // Delete both cloud records first. A local-only delete would be restored
      // by the next cloud pull and the overdue follow-up would come back.
      if (!farmIdForDelete || !window.ARSCloud?.deleteAppRecord) throw new Error('Verified cloud deletion is unavailable.');
      await ARSCloud.deleteAppRecord(farmIdForDelete, 'vaccination', e._ars_cloud_local_id || e.id);
      if (reminderId) await ARSCloud.deleteAppRecord(farmIdForDelete, 'reminder', reminderId);
    } catch (error) {
      toast(`⚠️ Vaccine program was not removed: cloud deletion failed — ${error.message || error}`);
      return;
    }
    removeVaxReminder(e);
    F().vaccinations = entries().filter(x => x.id !== id);
    save();
    renderAll();
    toast('Vaccine program deleted from the cloud and this device');
  }

  /* ── print / PDF report ────────────────────────────────────────────── */
  function openVaxReport() {
    document.getElementById('vaxReport')?.remove();
    const all = entries(),
      farm = F(),
      farmLogo = document.querySelector('.sidebar .logo-img')?.src || '',
      appLogo = document.querySelector('.sidebar .logo-img')?.dataset.defaultSrc || farmLogo,
      created = new Date();
    const pending = all.filter(e => e.next_due).sort((a, b) => String(a.next_due + (a.time || '')).localeCompare(String(b.next_due + (b.time || ''))));
    const rollup = {}, advisory = {};
    pending.forEach(e => {
      const need = needOf(e);
      (rollup[e.vaccine] = rollup[e.vaccine] || { doses: 0, ml: 0 });
      rollup[e.vaccine].doses += liveHeads(e);
      rollup[e.vaccine].ml = round2(rollup[e.vaccine].ml + need);
      const m = e.med_id ? findMed(e.med_id) : null;
      if (m && m.unit === 'ml') advisory[e.vaccine] = round2((advisory[e.vaccine] || 0) + need);
    });
    const tr = (cells, head) => `<tr>${cells.map(c => head ? `<th>${c}</th>` : `<td>${c}</td>`).join('')}</tr>`;
    const pendTable = pending.length
      ? `<table class="vax-rep">${tr(['Animal / group', 'Vaccine', 'Due date', 'Time', 'Dose (ml/head)', 'Heads', 'ml to prepare'], true)}${pending.map(e => {
        const s = dueState(e);
        return tr([`${TYPE_META[e.target_type].ico} <b>${esc(e.target_label)}</b><br><small>${TYPE_META[e.target_type].label}</small>`, esc(e.vaccine), `<b>${fmtD(e.next_due)}</b><br><small>${s.text}</small>`, esc(e.time || '08:00'), esc(e.dose_ml), liveHeads(e), `<b>${needOf(e)} ml</b>`]);
      }).join('')}</table>`
      : '<p class="vax-rep-empty">No follow-up doses are pending.</p>';
    const rollRows = Object.keys(rollup).sort().map(v => tr([esc(v), rollup[v].doses, `<b>${rollup[v].ml} ml</b>`])).join('');
    const grandMl = round2(Object.values(rollup).reduce((a, x) => a + x.ml, 0));
    const rollTable = rollRows
      ? `<table class="vax-rep">${tr(['Vaccine', 'Total head-doses', 'Total to prepare'], true)}${rollRows}${tr(['<b>GRAND TOTAL</b>', rollup ? Object.values(rollup).reduce((a, x) => a + (+x.doses || 0), 0) : 0, `<b>${grandMl} ml</b>`])}</table>`
      : '<p class="vax-rep-empty">Nothing to prepare right now.</p>';
    const shortRows = Object.keys(advisory).filter(v => { const mm = medicines().filter(m => m.item_name.toLowerCase() === v.toLowerCase() && m.unit === 'ml'); const have = mm.reduce((a, m) => a + (+m.stock_quantity || 0), 0); return have < advisory[v]; }).map(v => {
      const mm = medicines().filter(m => m.item_name.toLowerCase() === v.toLowerCase() && m.unit === 'ml'),
        have = round2(mm.reduce((a, m) => a + (+m.stock_quantity || 0), 0));
      return tr([esc(v), have + ' ml', advisory[v] + ' ml', `<b>${round2(advisory[v] - have)} ml short — restock before use</b>`]);
    }).join('');
    const hist = [];
    all.forEach(e => (e.rounds || []).forEach((r, i) => hist.push({ e, r, i: i + 1 })));
    hist.sort((a, b) => String(b.r.date + (b.r.at || '')).localeCompare(String(a.r.date + (a.r.at || ''))));
    const histTable = hist.length
      ? `<table class="vax-rep">${tr(['Date', 'Animal / group', 'Vaccine', 'Dose (ml/head)', 'Heads', 'Total used'], true)}${hist.map(x => tr([fmtD(x.r.date) + `<br><small>dose ${x.i}</small>`, `${TYPE_META[x.e.target_type].ico} <b>${esc(x.e.target_label)}</b>`, esc(x.e.vaccine), x.r.dose_ml != null ? esc(x.r.dose_ml) : '—', esc(x.r.heads ?? 1), x.r.total_ml != null ? `<b>${round2(x.r.total_ml)} ml</b>` : '—'])).join('')}</table>` /* [REBUILD FIX 48] untracked-ml doses print as — */
      : '<p class="vax-rep-empty">No completed vaccinations on record yet.</p>';
    /* [REBUILD FIX 51] scheduled vaccinations (date & time alarm) + the
       never-vaccinated register — both belong in the printed plan */
    const schedPend = pendSchedules().sort((a, b) => String(a.date + (a.time || '')).localeCompare(String(b.date + (b.time || ''))));
    const schedTable = schedPend.length
      ? `<table class="vax-rep">${tr(['Animal / group', 'Program', 'Date', 'Time', 'Alarm'], true)}${schedPend.map(x => { const meta = TYPE_META[x.target_type] || { ico: '🐖', label: 'Group' }; return tr([`${meta.ico} <b>${esc(x.target_label)}</b><br><small>${meta.label}</small>`, `${esc(programTitle(x))}<br><small>${programKindLabel(x)}</small>${x.note ? `<br><small>${esc(x.note)}</small>` : ''}`, `<b>${fmtD(x.date)}</b>`, esc(x.time || '08:00'), '🔔 armed']); }).join('')}</table>`
      : '<p class="vax-rep-empty">No vaccination schedules are set.</p>';
    const unvaxRep = neverVaccinated();
    const unvaxTable = unvaxRep.length
      ? `<table class="vax-rep">${tr(['Animal / group', 'Type', 'Details', 'Status', 'Schedule'], true)}${unvaxRep.map(u => {
        const s = scheduleFor(u.type, u.id);
        return tr([`<b>${esc(u.label)}</b>`, TYPE_META[u.type].ico + ' ' + TYPE_META[u.type].label, esc(u.detail) + (u.type === 'batch' ? ' · ' + u.heads + ' heads' : ''), '<b>no vaccine on record</b>', s ? `${esc(s.vaccine)} · ${fmtD(s.date)} · ${esc(s.time || '08:00')}` : '—']);
      }).join('')}</table>`
      : '<p class="vax-rep-empty">✓ Every active sow, boar and live piglet batch has at least one vaccine on record.</p>';

    document.body.insertAdjacentHTML('beforeend', `<div class="drill-bg" id="vaxReport"><article class="certificate">
      <header class="cert-header">
        <div class="cert-logo"><img src="${farmLogo}" alt="${esc(farm.name || 'Farm')} logo"></div>
        <div class="cert-actions no-print"><button class="btn" onclick="window.print()">Download PDF</button></div>
        <div class="cert-title"><small>ARS WINETECH PRO · HERD IMMUNIZATION PROGRAM</small><h1>Vaccination Report</h1><h2>${esc(farm.name || 'Farm')}</h2></div>
        <div class="cert-app-logo"><img src="${appLogo}" alt="ARSwineTech"><b>Breed. Feed. Predict.</b></div>
        <button class="close-reminder no-print" onclick="closeVaxReport()">×</button>
      </header>
      <main class="cert-grid">
        <section class="cert-card cert-wide"><h3>💉 Vaccines to prepare — pending follow-up doses</h3><p class="vax-rep-note">Draw exactly these totals before vaccination. The per-vaccine roll-up below tells you how much of each vaccine to pull from storage.</p>${pendTable}</section>
        <section class="cert-card cert-wide"><h3>⚗ Per-vaccine requirements — all pending doses</h3>${rollTable}</section>
        ${shortRows ? `<section class="cert-card cert-wide"><h3>⚠ Stock advisory</h3><table class="vax-rep">${tr(['Vaccine', 'On hand', 'Required', 'Action'], true)}${shortRows}</table></section>` : ''}
        <section class="cert-card cert-wide"><h3>⏰ Scheduled vaccinations — alarm set (date &amp; time)</h3><p class="vax-rep-note">These doses are planned ahead; the app fires an alarm at each set date &amp; time so no schedule is missed.</p>${schedTable}</section>
        <section class="cert-card cert-wide"><h3>⚠ Not yet vaccinated — no vaccine on record</h3><p class="vax-rep-note">Register of active sows, boars and live piglet batches with zero vaccine records — prioritise them on the next vaccination day.</p>${unvaxTable}</section>
        <section class="cert-card cert-wide"><h3>✅ Already vaccinated — completed rounds (latest first)</h3>${histTable}</section>
      </main>
      <footer class="cert-footer"><div>▣<span>Generated On<b>${created.toLocaleString('en-PH')}</b></span></div><div>♙<span>Generated By<b>${esc(farm.name || 'Farm')}</b></span></div><div>◇<span>Animals On Program<b>${new Set(all.map(e => e.target_type + ':' + e.target_id)).size} · ${all.length} vaccines</b></span></div><div>⚠<span>Not Yet Vaccinated<b>${unvaxRep.length} · ${schedPend.length} scheduled</b></span></div></footer>
      <div class="cert-end"><span>This document is system generated by ARSwineTech Pro</span><b>Vaccinate on schedule — protect the herd.</b></div>
      <div class="cert-sign"><span>Prepared by (Farm Representative)</span><span>Noted by (Farm Owner)</span></div>
    </article></div>`);
    document.body.classList.add('vax-report-open'); // [REBUILD FIX 38] flag used by print CSS to isolate the report
  }

  // [REBUILD FIX 38] close helper — always clears the print-isolation flag
  function closeVaxReport() {
    document.getElementById('vaxReport')?.remove();
    document.body.classList.remove('vax-report-open');
  }

  /* ── register ──────────────────────────────────────────────────────── */
  window.openVaxModal = openVaxModal;
  window.vaxSetCat = vaxSetCat;
  window.vaxTargetFilter = vaxTargetFilter;
  window.vaxTargetPick = vaxTargetPick;
  window.vaxTargetClose = vaxTargetClose;
  window.vaxSetMode = vaxSetMode;
  window.vaxUniSetCat = vaxUniSetCat;
  window.vaxUniFilter = vaxUniFilter;
  window.vaxUniPick = vaxUniPick;
  window.vaxUniClose = vaxUniClose;
  window.vaxUniAddAll = vaxUniAddAll;
  window.vaxMultiRemove = vaxMultiRemove;
  window.vaxMedFilter = vaxMedFilter;
  window.vaxMedPick = vaxMedPick;
  window.vaxMedClose = vaxMedClose;
  window.vaxToggleFollow = vaxToggleFollow;
  window.vaxCalc = vaxCalc;
  window.saveVaxModal = saveVaxModal;
  window.openVaxGive = openVaxGive;
  window.vaxGiveCalc = vaxGiveCalc;
  window.saveVaxGive = saveVaxGive;
  window.vaxDelete = vaxDelete;
  window.vaxSetView = vaxSetView;
  window.vaxSearchInput = vaxSearchInput;
  window.openVaxReport = openVaxReport;
  window.closeVaxReport = closeVaxReport; // [REBUILD FIX 38]
  /* ── [REBUILD FIX 51] register + schedules ──────────────────────────── */
  window.openVaxSchedule = openVaxSchedule;
  window.openVaxProgramModal = openVaxProgramModal;
  window.programMedFilter = programMedFilter;
  window.programMedPick = programMedPick;
  window.programMedClose = programMedClose;
  window.programTargetFilter = programTargetFilter;
  window.programTargetPick = programTargetPick;
  window.programTargetClose = programTargetClose;
  window.saveVaxProgram = saveVaxProgram;
  window.completeVaxProgram = completeVaxProgram;
  window.saveVaxSchedule = saveVaxSchedule;
  window.cancelVaxSchedule = cancelVaxSchedule;
  window.schedMedFilter = schedMedFilter;
  window.schedMedPick = schedMedPick;
  window.schedMedClose = schedMedClose;
  window.schedHint = schedHint;
  window.vaxRecordFor = vaxRecordFor;
  window.vaxNeverVaccinated = neverVaccinated;
  window.vaxPendSchedules = pendSchedules;
  window.vaxScheduleFor = scheduleFor;
  window.vaxPage = vaxPage;
  /* ── [REBUILD FIX 48] public fetch helpers — boar profiles, sow cards and
     piglet batch cards all display THIS center's records without duplicating
     the matching rules: exact target id first, then a name-prefix match on
     the stored label (covers free-typed legacy entries). Each record carries
     its vaccine type(s), latest dose date and dose count. */
  function vaxRecordsFor(type, id, name) {
    const nm = String(name || '').trim().toLowerCase();
    return entries()
      .filter(e => e.target_type === type && (String(e.target_id) === String(id) || (nm && String(e.target_label || '').toLowerCase().startsWith(nm))))
      .map(e => {
        const rounds = (Array.isArray(e.rounds) ? e.rounds : []).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        return { id: e.id, vaccine: e.vaccine, label: e.target_label, doses: rounds.length || (e.date ? 1 : 0), last: rounds.length ? rounds[rounds.length - 1].date : e.date, rounds };
      })
      .filter(x => x.vaccine)
      .sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')));
  }
  function vaxSummaryText(type, id, name, max) {
    const recs = vaxRecordsFor(type, id, name), cap = max || 3;
    if (!recs.length) return '';
    let txt = recs.slice(0, cap).map(r => r.vaccine + ' · ' + fmtD(r.last) + (r.doses > 1 ? ' · ' + r.doses + ' doses' : '')).join(' + ');
    if (recs.length > cap) txt += ' + ' + (recs.length - cap) + ' more';
    return txt;
  }
  window.vaxRecordsFor = vaxRecordsFor;
  window.vaxSummaryText = vaxSummaryText;
  /* [REBUILD FIX 36] dashboard health checklist reads the live overdue count. */
  window.vaxOverdueCount = () => entries().filter(e => e.next_due && dateDiff(e.next_due) < 0).length;

  const prevRenderAll = window.renderAll;
  window.renderAll = function () {
    prevRenderAll();
    vaxPage();
  };
})();
