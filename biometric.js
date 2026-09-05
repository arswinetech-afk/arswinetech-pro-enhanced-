/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 169] BIOMETRIC TIME IN/OUT KIOSK — face recognition (camera)
   + 4-digit PIN fallback. On a successful clock-IN the staff's work orders
   for the day print automatically on the BLE thermal printer.

   • Enrollment: Staff Roster → 📷 Enroll face (camera capture → AI face
     signature stored on the staff record & synced) and 🔢 Set PIN.
   • Kiosk: 🕐 Time In/Out → live camera match (threshold 0.55) or PIN pad.
   • Clock-in writes the Attendance ledger (on time / late vs roster start
     time, 15-min grace). Second scan = clock-out (records out_at).
   • Face model lazy-loads from CDN on first use; PIN always works offline.
   • Fingerprint templates are impossible in browsers (OS keeps them sealed) —
     PIN is the per-person fallback, by platform design.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const F0 = () => (typeof F === 'function' && F()) ? F() : {};
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

  function startCamera(video) {
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }).then(st => { video.srcObject = st; return video.play(); });
  }
  function stopCamera(video) { try { (video.srcObject?.getTracks() || []).forEach(t => t.stop()); } catch (e) {} }

  async function grabDescriptor(video) {
    const det = await window.faceapi.detectSingleFace(video, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })).withFaceLandmarks().withFaceDescriptor();
    return det ? det.descriptor : null;
  }

  function staffSyncOne(f, rec) {
    try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, [Object.assign({ _et: 'staff_rec' }, rec)]).catch(() => {}); } catch (e) {}
  }

  /* ── enrollment ─────────────────────────────────────────────────────────── */
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
    try {
      await startCamera(video);
      msg.textContent = 'Loading face model (first time only)…';
      await ensureFaceLib();
      msg.textContent = 'Center the face in the circle, then capture.';
    } catch (e) { msg.textContent = '⚠ Camera/model unavailable — use 🔢 Set PIN instead.'; return; }
    window.__enrollStop = () => stopCamera(video);
    document.getElementById('enrollBtn').onclick = async () => {
      msg.textContent = 'Computing face signature…';
      try {
        const d = await grabDescriptor(video);
        if (!d) { msg.textContent = '⚠ No face detected — adjust light/angle.'; return; }
        st.face = { v: Array.from(d), at: new Date().toISOString() };
        if (typeof save === 'function') save();
        staffSyncOne(f, st);
        stopCamera(video);
        document.getElementById('faceEnrollModal')?.remove();
        toast('✔ Face enrolled for ' + st.name + '.');
        window.openStaffRoster && window.openStaffRoster();
      } catch (e) { msg.textContent = '⚠ ' + (e.message || e); }
    };
  };

  window.arsSetPin = function (staffId) {
    const f = F0(); const st = (window.staffRoster ? staffRoster(f) : []).find(x => x.id === staffId);
    if (!st) return;
    const pin = prompt('Set 4-digit PIN for ' + st.name + ':');
    if (!pin) return;
    if (!/^\d{4}$/.test(pin)) { toast('⚠ PIN must be exactly 4 digits.'); return; }
    st.pin = pin;
    if (typeof save === 'function') save();
    staffSyncOne(f, st);
    toast('✔ PIN saved for ' + st.name + '.');
    window.openStaffRoster && window.openStaffRoster();
  };

  /* ── clock in/out + auto-print of the day's work orders ─────────────────── */
  function printDayOrders(f, name) {
    const todays = (window.wos ? wos(f) : (f.workOrders || [])).filter(wd => {
      const r = window.resolveStaff ? resolveStaff(f, wd.assignee) : null;
      return (r ? r.name : wd.assignee) === name && ['open', 'in_progress'].includes(wd.status);
    });
    if (!todays.length) return 0;
    if (!window.btPrintTextLines) return 0;
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
        const grace = 15;
        const lateAt = sh * 60 + (sm || 0) + grace;
        if (date.getHours() * 60 + date.getMinutes() > lateAt) status = 'late';
      }
      const r = { id, staff: st.name, date: dstr, status, note: 'time-in ' + hm + ' via ' + via, in_at: hm };
      const i = f.attendance.findIndex(a => a.id === id);
      if (i >= 0) f.attendance[i] = Object.assign(f.attendance[i], r); else f.attendance.push(r);
      if (typeof save === 'function') save();
      try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, [Object.assign({ _et: 'att_rec' }, r)]).catch(() => {}); } catch (e) {}
      toast((status === 'late' ? ' TIME-IN (LATE) ' : '✅ TIME-IN ') + st.name + ' · ' + hm);
      const n = printDayOrders(f, st.name);
      if (n) setTimeout(() => toast('🖨 ' + n + ' work order' + (n > 1 ? 's' : '') + ' printed for ' + st.name + '.'), 600);
    } else if (!rec.out_at) {
      rec.out_at = hm;
      rec.note = (rec.note || '') + ' · time-out ' + hm + ' via ' + via;
      if (typeof save === 'function') save();
      try { const fid = window.__arsActiveFarmId || (typeof farmId !== 'undefined' ? farmId : null); if (fid && window.ARSCloud && ARSCloud.upsertCommerceRows) ARSCloud.upsertCommerceRows(fid, [Object.assign({ _et: 'att_rec' }, rec)]).catch(() => {}); } catch (e) {}
      toast('🏁 TIME-OUT ' + st.name + ' · ' + hm);
    } else {
      toast('ℹ ' + st.name + ' already clocked in & out today.');
    }
  }

  /* ── kiosk modal ────────────────────────────────────────────────────────── */
  window.arsOpenKiosk = async function () {
    const f = F0();
    const roster = (window.staffRoster ? staffRoster(f) : []).filter(r => r.active !== false);
    document.getElementById('kioskModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="kioskModal" style="z-index:99999999!important">
      <div class="reminder-modal" style="max-width:520px;width:96%;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#57d48d;letter-spacing:.12em;font-weight:800">🕐 TIME IN / OUT KIOSK</div><h2>Scan face or enter PIN</h2><small class="muted">First scan = time-in (+prints today's tasks) · second scan = time-out</small></div><button class="close-reminder" onclick="window.__kioskStop&&window.__kioskStop();document.getElementById('kioskModal').remove()">×</button></div>
        <div style="position:relative;border-radius:12px;overflow:hidden;background:#000"><video id="kioskVideo" autoplay muted playsinline style="width:100%;display:block"></video><div style="position:absolute;inset:12%;border:2px dashed rgba(87,212,141,.6);border-radius:50%"></div><small id="kioskMsg" style="position:absolute;bottom:6px;left:0;right:0;text-align:center;color:#c9f5ef;font-size:11px">Starting camera…</small></div>
        <div style="margin-top:10px"><small class="muted">PIN fallback:</small>
          <div style="display:flex;gap:8px;margin-top:4px"><select id="kioskWho" class="select">${roster.map(r => `<option>${esc(r.name)}</option>`).join('')}</select><input id="kioskPin" inputmode="numeric" maxlength="4" placeholder="PIN" style="width:80px"><button class="btn ghost" onclick="window.__kioskPin()">✔</button></div>
        </div>
      </div></div>`);
    const video = document.getElementById('kioskVideo');
    const msg = document.getElementById('kioskMsg');
    let busy = false, live = false;
    window.__kioskStop = () => { live = false; stopCamera(video); };
    window.__kioskPin = () => {
      const name = document.getElementById('kioskWho').value;
      const pin = document.getElementById('kioskPin').value;
      const st = roster.find(r => r.name === name);
      if (!st) return;
      if (!st.pin) { toast('⚠ No PIN set for ' + name + ' — enroll one in Staff Roster.'); return; }
      if (st.pin !== pin) { toast('⚠ Wrong PIN.'); return; }
      clockToggle(f, st, 'PIN');
      document.getElementById('kioskPin').value = '';
    };
    try {
      await startCamera(video); live = true;
      msg.textContent = 'Loading face model…';
      await ensureFaceLib();
      msg.textContent = 'Look at the camera…';
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
                const a = d, b = new Float32Array(r.face.v);
                let sum = 0; for (let i = 0; i < a.length; i++) { const df = a[i] - b[i]; sum += df * df; }
                const dist = Math.sqrt(sum);
                if (dist < bestDist) { bestDist = dist; best = r; }
              });
              if (best) { msg.textContent = '✔ ' + best.name; clockToggle(f, best, 'face'); }
            }
          } catch (e) {}
          busy = false;
        }
        setTimeout(tick, 1300);
      };
      tick();
    } catch (e) {
      msg.textContent = '⚠ Camera unavailable — use the PIN pad below.';
    }
  };
})();
