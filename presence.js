/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 127] SCALABLE ONLINE/OFFLINE PRESENCE — Supabase Realtime.

   Design constraints honored (per platform-owner spec):
     • NO database rows, NO heartbeat UPDATEs, NO polling — presence lives in
       the Realtime service's in-memory channel (WebSocket, Phoenix protocol);
       device counts are never stored permanently anywhere.
     • Elapsed "Online · 42m" timers are computed LOCALLY from online_at.
     • Device categories are coarse (📱 Android / iOS / Mobile, 💻 Desktop) —
       no fingerprinting.
     • Egress cost ≈ one WebSocket upgrade + ~100-byte frames on join/leave
       and a 25s socket keep-alive — Realtime traffic does not touch the
       Supabase DB egress quota at all.

   Every signed-in device tracks itself on channel `realtime:ars-presence`
   with key `<uid>:<session_id>`; the admin screen reads presenceState and
   groups by uid → "🟢 Online · N devices" + expandable per-device details.
   When a socket drops (app closed / offline), the server removes the entry
   automatically — nothing to clean up in the database, ever.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const cfg = window.ARS_SUPABASE_CONFIG || {};
  const TOPIC = 'realtime:ars-presence';
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let ws = null, hb = null, retry = null, refN = 0, stopped = true, backoff = 2000;
  let myMeta = null, state = {};
  const listeners = new Set();

  function deviceInfo() {
    const ua = String(navigator.userAgent || '');
    if (/android/i.test(ua)) return { icon: '📱', label: 'Android' };
    if (/iphone|ipad|ipod/i.test(ua)) return { icon: '📱', label: 'iOS' };
    if (/mobi/i.test(ua)) return { icon: '📱', label: 'Mobile' };
    return { icon: '💻', label: 'Desktop' };
  }
  function sessionId() {
    try {
      let s = localStorage.getItem('ars-presence-sid');
      if (!s) { s = Math.random().toString(36).slice(2, 10); localStorage.setItem('ars-presence-sid', s); }
      return s;
    } catch (e) { return 's' + Math.random().toString(36).slice(2, 10); }
  }
  const nextRef = () => String(++refN);
  const send = o => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch (e) {} };
  const emit = () => { const s = summary(); listeners.forEach(fn => { try { fn(s); } catch (e) {} }); renderSlots(); };

  function mergeDiff(diff) {
    for (const [key, val] of Object.entries(diff.joins || {})) {
      const cur = (state[key] && state[key].metas) || [];
      state[key] = { metas: cur.concat(val.metas || []) };
    }
    for (const [key, val] of Object.entries(diff.leaves || {})) {
      const refs = new Set((val.metas || []).map(m => m.phx_ref));
      if (state[key]) {
        const metas = state[key].metas.filter(m => !refs.has(m.phx_ref));
        if (metas.length) state[key] = { metas }; else delete state[key];
      }
    }
  }

  /* Group live metas by user; one entry per distinct device session. */
  function summary() {
    const byUid = {};
    for (const val of Object.values(state)) {
      for (const m of val.metas || []) {
        if (!m || !m.uid) continue;
        const b = byUid[m.uid] || (byUid[m.uid] = { uid: m.uid, email: m.email || '', sessions: {} });
        const sid = m.session_id || m.phx_ref;
        const prev = b.sessions[sid];
        if (!prev || String(m.online_at || '9999') < String(prev.online_at || '9999')) b.sessions[sid] = m;
      }
    }
    return byUid;
  }

  function connect() {
    if (stopped || !cfg.url || !myMeta) return;
    try {
      const wss = cfg.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(cfg.anonKey || '') + '&vsn=1.0';
      ws = new WebSocket(wss);
    } catch (e) { scheduleRetry(); return; }
    ws.onopen = () => {
      backoff = 2000;
      send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() });
      send({
        topic: TOPIC, event: 'phx_join', ref: nextRef(),
        payload: {
          config: { broadcast: { self: true }, presence: { key: myMeta.uid + ':' + myMeta.session_id } },
          access_token: (window.ARSCloud && ARSCloud.getAccessToken) ? ARSCloud.getAccessToken() : ''
        }
      });
      /* [FIX 128] Supabase realtime wire format: payload {type:'track', payload} */
      send({ topic: TOPIC, event: 'presence', ref: nextRef(), payload: { type: 'track', payload: myMeta } });
      if (!hb) hb = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() }), 25000);
    };
    ws.onmessage = ev => {
      let msg = null; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || msg.topic !== TOPIC) return;
      if (msg.event === 'presence_state') { state = msg.payload || {}; emit(); }
      else if (msg.event === 'presence_diff') { mergeDiff(msg.payload || {}); emit(); }
    };
    ws.onclose = () => { cleanup(); scheduleRetry(); };
    ws.onerror = () => { try { ws && ws.close(); } catch (e) {} };
  }
  function cleanup() { if (hb) { clearInterval(hb); hb = null; } ws = null; }
  function scheduleRetry() {
    if (stopped || retry) return;
    retry = setTimeout(() => { retry = null; connect(); }, backoff = Math.min(60000, Math.round(backoff * 1.6)));
  }

  function start(user) {
    if (!user || !cfg.url) return;
    stopped = false;
    const d = deviceInfo();
    /* [FIX 128] key presence by lowercased email — matches admin rows */
    myMeta = { uid: String(user.uid || user.email || '').toLowerCase(), email: user.email || '', device: d.label, icon: d.icon, session_id: sessionId(), online_at: new Date().toISOString() };
    state = {};
    connect();
  }
  function stop() {
    stopped = true;
    if (retry) { clearTimeout(retry); retry = null; }
    send({ topic: TOPIC, event: 'presence', ref: nextRef(), payload: { type: 'untrack' } });
    try { ws && ws.close(); } catch (e) {}
    cleanup(); state = {}; emit();
  }

  function fmtAgo(iso) {
    const t = Date.now() - new Date(iso).getTime();
    if (!isFinite(t) || t < 60000) return 'now';
    const m = Math.floor(t / 60000);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }

  /* ── Admin UI: fill every .prs-slot on the User Access page ─────────────── */
  let agoTimer = null;
  function renderSlots() {
    const slots = document.querySelectorAll('.prs-slot');
    if (!slots.length) { if (agoTimer) { clearInterval(agoTimer); agoTimer = null; } return; }
    const sum = summary();
    slots.forEach(el => {
      const entry = sum[el.dataset.uid];
      const devs = entry ? Object.values(entry.sessions) : [];
      const wasOpen = el.querySelector('.prs-detail.open');
      if (!devs.length) {
        el.innerHTML = '<span style="font-size:11px;color:#8aa0a0">⚪ Offline</span>';
        return;
      }
      const n = devs.length;
      el.innerHTML =
        `<button type="button" class="prs-toggle" style="background:none;border:none;color:#4ade80;font-size:11.5px;font-weight:700;padding:0;cursor:pointer">🟢 Online · ${n} device${n > 1 ? 's' : ''}</button>` +
        `<div class="prs-detail${wasOpen ? ' open' : ''}" style="${wasOpen ? '' : 'display:none;'}margin-top:4px;border-left:2px solid #4ade8055;padding-left:8px">` +
        devs.map(d => `<div style="font-size:11px;line-height:1.5;color:#cfe8e4">${d.icon || '📱'} <b>${esc(d.device || 'Device')}</b> · Online · ${fmtAgo(d.online_at)}<br><small style="color:#7d9494">session ${esc(d.session_id || '—')}</small></div>`).join('') +
        `</div>`;
      const btn = el.querySelector('.prs-toggle');
      const det = el.querySelector('.prs-detail');
      if (btn && det) btn.onclick = () => { det.classList.toggle('open'); det.style.display = det.classList.contains('open') ? '' : 'none'; };
    });
    if (!agoTimer) agoTimer = setInterval(renderSlots, 30000); /* local timer only */
  }

  window.ARSPresence = {
    start, stop, summary, renderSlots,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    /* console diagnostics: ARSPresence.debug() → socket state + live keys */
    debug: () => ({ stopped, ws: ws ? ws.readyState : null, meta: myMeta, keys: Object.keys(state), topic: TOPIC })
  };
})();
