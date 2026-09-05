/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 169/170] BIOMETRIC TIME IN/OUT KIOSK.
   FIX 170 UX: no auto-camera (staff chooses 📷 face or 🔢 PIN), in-app PIN
   modal with clear correct/wrong feedback, auto-print on clock-in (or prompt
   to connect Bluetooth), then a SHIFT CARD with the day's work orders + a
   quick performance view + "✔ Done — next staff" so the kiosk cycles.
   FIX 171: shift card reads the REAL work-order list (it was always 0 — the
   list helper lived inside work-orders.js and was never shared), rows now
   show status + due/overdue, and clocking in AUTO-STARTS the staff's
   actionable open tasks (overdue / due today / ongoing no-due) so the shift
   begins with work already IN PROGRESS. Future-dated tasks stay OPEN.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const F0 = () => (typeof F === 'function' && F()) ? F() : {};
  const WOL = f => Array.isArray(f.workOrders) ? f.workOrders : [];
  const MODEL_URI = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js/weights';
  let faceReady = null;

  function ensureFaceLib() {
    if (faceReady) return faceReady;
    faceReady = new Promise((resolve, reject) => {
      const go = () => {
        Promise.all([
          window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URI),
          window.faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URI),
          window.faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URI)
        ]).then(() => resolve(true)).catch(e => reject(e));
      };
      if (window.faceapi) return go();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
      s.onload = go;
      s.onerror = () => reject(new Error('face lib unavailable'));
      document.head.appendChild(s);
    });
    return faceReady;
  }
  const startCamera = video => navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }).then(st => { video.srcObject = st; return video.play(); });
  const stopCamera = video => { try { (video.srcObject?.getTracks() || []).forEach(t => t.stop()); } catch (e) {} };
  async function grabDescriptor(video) {
    const det = await window.faceapi.detectSingleFace(video, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })).withFaceLandmarks().withFaceDescriptor();
    return det ? det.descriptor : null;
  }
  const staffSyncOne = (f, rec) => { try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, [Object.assign({ _et: 'staff_rec' }, rec)]).catch(() => {}); } catch (e) {} };
  const printerOn = () => (window.btConnected ? window.btConnected() : false);

  /* ── face enrollment (inline feedback) ──────────────────────────────────── */
  window.arsEnrollFace = async function (staffId) {
    const f = F0(); const st = (window.staffRoster ? staffRoster(f) : []).find(x => x.id === staffId);
    if (!st) return;
    document.getElementById('faceEnrollModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="faceEnrollModal" style="z-index:99999999!important">
      <div class="reminder-modal" style="max-width:460px;width:96%;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#ffd98a;letter-spacing:.12em;font-weight:800">📷 FACE ENROLLMENT</div><h2>${esc(st.name)}</h2><small class="muted">Good light · face inside the guide · one capture</small></div><button class="close-reminder" onclick="window.__enrollStop&&window.__enrollStop();document.getElementById('faceEnrollModal').remove()">×</button></div>
        <div style="position:relative;border-radius:12px;overflow:hidden;background:#000"><video id="enrollVideo" autoplay muted playsinline style="width:100%;display:block"></video><div style="position:absolute;inset:12%;border:2px dashed rgba(87,212,141,.7);border-radius:50%"></div><small id="enrollMsg" style="position:absolute;bottom:6px;left:0;right:0;text-align:center;color:#c9f5ef;font-size:11px">Loading camera…</small></div>
        <div class="due-actions" style="margin-top:10px"><button class="btn" id="enrollBtn">📸 Capture face</button></div>
      </div></div>`);
    const video = document.getElementById('enrollVideo');
    const msg = document.getElementById('enrollMsg');
    window.__enrollStop = () => stopCamera(video);
    try {
      await startCamera(video);
      msg.textContent = 'Loading face model (first time only)…';
      await ensureFaceLib();
      msg.textContent = 'Center the face in the circle, then tap Capture.';
    } catch (e) { msg.textContent = '⚠ Camera/model unavailable — set a 🔢 PIN instead.'; if (window.toast) toast('⚠ Camera unavailable for ' + st.name + ' — use Set PIN.'); return; }
    document.getElementById('enrollBtn').onclick = async () => {
      msg.textContent = 'Computing face signature…';
      try {
        const d = await grabDescriptor(video);
        if (!d) { msg.textContent = '⚠ No face detected — adjust light/angle and try again.'; return; }
        st.face = { v: Array.from(d), at: new Date().toISOString() };
        if (typeof save === 'function') save();
        staffSyncOne(f, st);
        stopCamera(video);
        document.getElementById('faceEnrollModal')?.remove();
        if (window.toast) toast('✔ Face enrolled for ' + st.name + ' — kiosk can now recognize them.');
        window.openStaffRoster && window.openStaffRoster();
      } catch (e) { msg.textContent = '⚠ ' + (e.message || e); }
    };
  };

  /* ── PIN set (in-app modal, real feedback) ──────────────────────────────── */
  window.arsSetPin = function (staffId) {
    const f = F0(); const st = (window.staffRoster ? staffRoster(f) : []).find(x => x.id === staffId);
    if (!st) return;
    document.getElementById('pinSetModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="pinSetModal" style="z-index:99999999!important" onclick="if(event.target===this)this.remove()">
      <form class="reminder-modal" style="max-width:380px;width:92%;text-align:left" onsubmit="event.preventDefault();window.__pinSave('${st.id}')">
        <div class="modal-top"><div><div class="eyebrow" style="color:#ffd98a;letter-spacing:.12em;font-weight:800">🔢 SET PIN</div><h2>${esc(st.name)}</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('pinSetModal').remove()">×</button></div>
        <input id="pinSetInput" type="password" inputmode="numeric" maxlength="4" placeholder="4-digit PIN" style="width:100%;padding:12px;font-size:20px;letter-spacing:8px;text-align:center">
        <small id="pinSetMsg" style="display:block;margin:8px 0;color:#ffc968;font-size:12px"></small>
        <div class="due-actions"><button class="btn">💾 Save PIN</button></div>
      </form></div>`);
    setTimeout(() => document.getElementById('pinSetInput')?.focus(), 60);
  };
  window.__pinSave = function (staffId) {
    const f = F0(); const st = (window.staffRoster ? staffRoster(f) : []).find(x => x.id === staffId);
    const pin = (document.getElementById('pinSetInput')?.value || '').trim();
    const msg = document.getElementById('pinSetMsg');
    if (!/^\d{4}$/.test(pin)) { if (msg) msg.textContent = '⚠ PIN must be exactly 4 digits.'; return; }
    st.pin = pin;
    if (typeof save === 'function') save();
    staffSyncOne(f, st);
    document.getElementById('pinSetModal')?.remove();
    if (window.toast) toast('✔ PIN saved for ' + st.name + ' — they can now clock in with it.');
    window.openStaffRoster && window.openStaffRoster();
  };

  /* ── duty slip printing ─────────────────────────────────────────────────── */
  function printDayOrders(f, name) {
    const todays = WOL(f).filter(wd => {
      const r = window.resolveStaff ? resolveStaff(f, wd.assignee) : null;
      return (r ? r.name : wd.assignee) === name && ['open', 'in_progress'].includes(wd.status);
    });
    if (!todays.length || !window.btPrintTextLines) return 0;
    const W = 32, sep = '-'.repeat(W);
    const clean = t => String(t).replace(/[·₱×]/g, m => ({ '·': '-', '₱': 'P', '×': 'x', '↩': '<-' }[m])).replace(/[^\x20-\x7E]/g, '');
    const ctr = t => { t = clean(t); return t.length >= W ? t : ' '.repeat(Math.max(0, (W - t.length) >> 1)) + t; };
    const wrap = t => { let out = [], cur = ''; String(t).split(/\s+/).forEach(x => { if ((cur + ' ' + x).trim().length > W) { if (cur.trim()) out.push(cur.trim()); cur = x; } else cur = cur ? cur + ' ' + x : x; }); if (cur.trim()) out.push(cur.trim()); return out; };
    const L = [];
    L.push({ t: ctr('DUTY SLIP - ' + name), b: 1, c: 1 });
    L.push({ t: ctr(new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })), c: 1 });
    L.push({ t: sep });
    todays.forEach(wd => {
      L.push({ t: clean('[' + (wd.priority || '').toUpperCase() + '] ' + wd.title), b: 1 });
      String(wd.details || '').split(/\n+/).map(s => s.trim()).filter(Boolean).forEach(line => wrap('[ ] ' + line).forEach((t, i) => L.push({ t: i ? '    ' + t : t })));
      L.push({ t: sep });
    });
    L.push({ t: ctr('Good luck! Signed at time-in.'), c: 1 });
    window.btPrintTextLines(L, 'Duty slip');
    return todays.length;
  }
  window.arsPrintDayOrders = printDayOrders;

  function tryPrint(f, name) {
    if (printerOn()) {
      const n = printDayOrders(f, name);
      if (n) { if (window.toast) toast('🖨 Printed ' + n + ' task' + (n > 1 ? 's' : '') + ' for ' + name + '.'); return true; }
      if (window.toast) toast('ℹ No open work orders for ' + name + ' today.');
      return false;
    }
    if (window.toast) toast('📶 No Bluetooth printer — opening scanner…');
    window.btScanPrinter && window.btScanPrinter();
    setTimeout(() => { const n = printDayOrders(f, name); if (n && window.toast) toast('🖨 Printed ' + n + ' task' + (n > 1 ? 's' : '') + '.'); }, 5000);
    return false;
  }

  /* ── attendance clock ───────────────────────────────────────────────────── */
  function clockToggle(f, st, via) {
    const date = new Date(); const p = n => String(n).padStart(2, '0');
    const dstr = date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
    const id = 'ATT-' + String(st.name).toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + dstr;
    f.attendance = Array.isArray(f.attendance) ? f.attendance : [];
    const rec = f.attendance.find(a => a.id === id);
    const hm = p(date.getHours()) + ':' + p(date.getMinutes());
    if (!rec || !rec.in_at) {
      let status = 'ontime';
      if (st.start_time) {
        const [sh, sm] = String(st.start_time).split(':').map(Number);
        if (date.getHours() * 60 + date.getMinutes() > sh * 60 + (sm || 0) + 15) status = 'late';
      }
      const r = { id, staff: st.name, date: dstr, status, note: 'time-in ' + hm + ' via ' + via, in_at: hm };
      const i = f.attendance.findIndex(a => a.id === id);
      if (i >= 0) f.attendance[i] = Object.assign(f.attendance[i], r); else f.attendance.push(r);
      if (typeof save === 'function') save();
      try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, [Object.assign({ _et: 'att_rec' }, r)]).catch(() => {}); } catch (e) {}
      if (window.toast) toast((status === 'late' ? ' TIME-IN (LATE) — ' : '✅ TIME-IN — ') + st.name + ' · ' + hm);
      return { action: 'in', status, hm };
    }
    if (!rec.out_at) {
      rec.out_at = hm; rec.note = (rec.note || '') + ' · time-out ' + hm + ' via ' + via;
      if (typeof save === 'function') save();
      try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, [Object.assign({ _et: 'att_rec' }, rec)]).catch(() => {}); } catch (e) {}
      if (window.toast) toast('🏁 TIME-OUT — ' + st.name + ' · ' + hm);
      return { action: 'out', hm };
    }
    if (window.toast) toast('ℹ ' + st.name + ' already clocked in & out today.');
    return { action: 'done', hm };
  }

  /* ── SHIFT CARD: day's WOs + quick performance + print + next staff ─────── */
  window.arsOpenShiftCard = function (st, info) {
    const f = F0();
    /* FIX 171: clock-in auto-starts the staff's actionable open tasks */
    if (info && info.action === 'in' && window.arsAutoStartTasks) {
      const n = window.arsAutoStartTasks(f, st.name);
      if (n && window.toast) toast('▶ ' + n + ' task' + (n > 1 ? 's' : '') + ' auto-started for ' + st.name + ' — shift on!');
    }
    const perf = (window.staffPerf ? staffPerf(f, 30) : []).find(r => r.name === st.name) || null;
    const act = WOL(f).filter(wd => {
      const r = window.resolveStaff ? resolveStaff(f, wd.assignee) : null;
      return (r ? r.name : wd.assignee) === st.name && ['open', 'in_progress'].includes(wd.status);
    });
    /* overdue first, then due today, then ongoing (no due), then future */
    const t0 = Date.now();
    const rank = wd => { if (!wd.due || isNaN(new Date(wd.due).getTime())) return 2; const dt = new Date(wd.due).getTime(); if (dt < t0) return 0; if (new Date(wd.due).toDateString() === new Date(t0).toDateString()) return 1; return 3; };
    act.sort((a, b) => rank(a) - rank(b) || String(a.due || '9999').localeCompare(String(b.due || '9999')));
    document.getElementById('shiftCardModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="shiftCardModal" style="z-index:99999999!important">
      <div class="reminder-modal" style="max-width:560px;width:96%;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#57d48d;letter-spacing:.12em;font-weight:800">🧾 SHIFT CARD</div><h2>${esc(st.name)}</h2><small class="muted">${info && info.action === 'in' ? (info.status === 'late' ? '⏰ Time-in ' + info.hm + ' (LATE)' : '✅ Time-in ' + info.hm + ' (on time)') : info && info.action === 'out' ? '🏁 Time-out ' + info.hm : ''}</small></div><button class="close-reminder" onclick="document.getElementById('shiftCardModal').remove()">×</button></div>
        <div class="wo-row-meta" style="margin:4px 0 10px"><span>🏅 ${perf ? woPtsFmt(perf.pts) + ' pts (30d)' : '0 pts'}</span><span>⏱ ${perf && perf.closed ? Math.round(perf.onTime / perf.closed * 100) : 0}% on-time</span><span>🛡 ${perf ? perf.verified : 0} verified</span><span>📅 ${perf ? (perf.dayQ ? 'streak active' : '') : ''}</span></div>
        <div class="dash-section-title" style="margin:0 0 2px">ACTIVE WORK ORDERS (${act.length})</div>
        <small class="muted" style="display:block;margin:0 0 6px">overdue &amp; due-today first · actionable tasks auto-start when you time in</small>
        ${act.map(wd => { const od = wd.due && new Date(wd.due).getTime() < t0; const sx = wd.status === 'in_progress' ? ['▶ STARTED', '#57d48d'] : ['OPEN', '#94a3b8']; const dl = wd.due ? (od ? '⚠ OVERDUE · ' : '🗓 ') + new Date(wd.due).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '🔁 ongoing — no due date'; const ni = wd.details ? String(wd.details).split(/\n+/).filter(s => s.trim()).length : 0; return `<div class="wo-row"><div class="wo-row-top"><span class="wo-pri" style="border-color:#ffd98a55;background:#ffd98a18;color:#ffd98a">${(wd.priority || '').toUpperCase()}</span><b>${esc(wd.title)}</b><span class="wo-pri" style="border-color:${sx[1]}55;background:${sx[1]}18;color:${sx[1]}">${sx[0]}</span></div><small class="muted" style="${od ? 'color:#ff5c68' : ''}">${dl}${ni ? ' · ' + ni + ' checklist items' : ''}</small></div>`; }).join('') || '<small class="muted">No active work orders right now — rest up or add one in the W.O. Center.</small>'}
        <div class="due-actions" style="margin-top:12px;flex-wrap:wrap">
          <button class="btn" id="shiftPrintBtn">🖨 Print duty slip</button>
          <button class="btn" id="shiftDoneBtn" style="background:#0e7f6f">✔ Done — next staff</button>
        </div>
      </div></div>`);
    document.getElementById('shiftPrintBtn').onclick = () => { tryPrint(f, st.name); const d = document.getElementById('shiftDoneBtn'); if (d) d.style.boxShadow = '0 0 0 3px rgba(87,212,141,.5)'; };
    document.getElementById('shiftDoneBtn').onclick = () => { document.getElementById('shiftCardModal')?.remove(); window.arsOpenKiosk(); };
  };

  /* ── kiosk: choose face OR pin (no auto camera) ─────────────────────────── */
  window.arsOpenKiosk = function () {
    const f = F0();
    const roster = (window.staffRoster ? staffRoster(f) : []).filter(r => r.active !== false);
    document.getElementById('kioskModal')?.remove();
    document.getElementById('kioskFacePanel')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="kioskModal" style="z-index:99999999!important">
      <div class="reminder-modal" style="max-width:520px;width:96%;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#57d48d;letter-spacing:.12em;font-weight:800">🕐 TIME IN / OUT KIOSK</div><h2>Choose how to identify yourself</h2><small class="muted">First scan = time-in (+prints today's tasks) · second = time-out</small></div><button class="close-reminder" onclick="window.__kioskStop&&window.__kioskStop();document.getElementById('kioskModal').remove()">×</button></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" style="flex:1;padding:14px" onclick="window.__kioskFace()">📷 Scan my face</button>
          <button class="btn ghost" style="flex:1;padding:14px" onclick="window.__kioskPinPanel()">🔢 Use my PIN</button>
        </div>
        <div id="kioskPinPanel" style="display:none;margin-top:12px">
          <small class="muted">Select your name, enter your 4-digit PIN:</small>
          <div style="display:flex;gap:8px;margin-top:6px"><select id="kioskWho" class="select">${roster.map(r => `<option>${esc(r.name)}</option>`).join('')}</select><input id="kioskPin" type="password" inputmode="numeric" maxlength="4" placeholder="PIN" style="width:90px;letter-spacing:4px;text-align:center"></div>
          <small id="pinMsg" style="display:block;margin:8px 0;font-size:12px;color:#ffc968"></small>
          <button class="btn" onclick="window.__kioskPinGo()">✔ Clock in / out</button>
        </div>
        <div id="kioskFacePanel" style="display:none;margin-top:12px">
          <div style="position:relative;border-radius:12px;overflow:hidden;background:#000"><video id="kioskVideo" autoplay muted playsinline style="width:100%;display:block"></video><div style="position:absolute;inset:12%;border:2px dashed rgba(87,212,141,.6);border-radius:50%"></div><small id="kioskMsg" style="position:absolute;bottom:6px;left:0;right:0;text-align:center;color:#c9f5ef;font-size:11px">Starting camera…</small></div>
          <button class="btn ghost small" style="margin-top:8px" onclick="window.__kioskStop&&window.__kioskStop();document.getElementById('kioskFacePanel').style.display='none'">← Back</button>
        </div>
      </div></div>`);
  };

  window.__kioskPinPanel = () => { const p = document.getElementById('kioskPinPanel'); if (p) p.style.display = ''; };

  window.__kioskPinGo = function () {
    const f = F0();
    const name = document.getElementById('kioskWho')?.value;
    const pin = (document.getElementById('kioskPin')?.value || '').trim();
    const msg = document.getElementById('pinMsg');
    const st = (window.staffRoster ? staffRoster(f) : []).find(r => r.name === name);
    if (!st) { if (msg) msg.textContent = '⚠ Select your name.'; return; }
    if (!st.pin) { if (msg) msg.textContent = '⚠ No PIN set yet — ask the owner to set it in Staff Roster.'; if (window.toast) toast('⚠ No PIN for ' + st.name + '.'); return; }
    if (st.pin !== pin) { if (msg) msg.textContent = '⚠ Wrong PIN — try again.'; if (window.toast) toast('⚠ Wrong PIN for ' + st.name + '.'); return; }
    if (msg) msg.textContent = '✔ Correct PIN — welcome, ' + st.name + '!';
    if (window.toast) toast('✔ PIN verified for ' + st.name + '.');
    const info = clockToggle(f, st, 'PIN');
    if (info && info.action === 'in') tryPrint(f, st.name);
    document.getElementById('kioskPin').value = '';
    setTimeout(() => { document.getElementById('kioskModal')?.remove(); window.arsOpenShiftCard(st, info); }, 700);
  };

  window.__kioskFace = async function () {
    const f = F0();
    const roster = (window.staffRoster ? staffRoster(f) : []).filter(r => r.active !== false);
    const panel = document.getElementById('kioskFacePanel');
    if (panel) panel.style.display = '';
    const video = document.getElementById('kioskVideo');
    const msg = document.getElementById('kioskMsg');
    let live = true, busy = false;
    window.__kioskStop = () => { live = false; stopCamera(video); };
    try {
      await startCamera(video);
      msg.textContent = 'Loading face model (first time only)…';
      await ensureFaceLib();
      msg.textContent = 'Look at the camera…';
    } catch (e) { msg.textContent = '⚠ Camera unavailable — use 🔢 PIN instead.'; return; }
    const tick = async () => {
      if (!live) return;
      if (!busy) {
        busy = true;
        try {
          const d = await grabDescriptor(video);
          if (d) {
            let best = null, bestDist = 0.55;
            roster.forEach(r => {
              if (!r.face || !r.face.v) return;
              let sum = 0; for (let i = 0; i < d.length; i++) { const df = d[i] - r.face.v[i]; sum += df * df; }
              const dist = Math.sqrt(sum);
              if (dist < bestDist) { bestDist = dist; best = r; }
            });
            if (best) {
              live = false; stopCamera(video);
              if (msg) msg.textContent = '✔ ' + best.name;
              if (window.toast) toast('✔ Face recognized: ' + best.name);
              const info = clockToggle(f, best, 'face');
              if (info && info.action === 'in') tryPrint(f, best.name);
              setTimeout(() => { document.getElementById('kioskModal')?.remove(); window.arsOpenShiftCard(best, info); }, 700);
              return;
            }
          }
        } catch (e) {}
        busy = false;
      }
      setTimeout(tick, 1300);
    };
    tick();
  };
})();
