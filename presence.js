/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 129] SCALABLE ONLINE/OFFLINE PRESENCE — official Supabase
   Realtime client (loaded from CDN as UMD; see index.html).

   FIX 127/128 hand-rolled the Phoenix WebSocket protocol; FIX 129 replaces it
   with @supabase/supabase-js's battle-tested channel/presence implementation,
   which sends the exact join/track wire format the server expects.

   Constraints honored (per platform-owner spec):
     • NO database rows / UPDATEs / polling — presence is in-memory on the
       Realtime service; sockets dropping auto-removes devices server-side.
     • Elapsed "Online · 42m" timers computed locally from online_at.
     • Coarse device categories only (📱 Android/iOS/Mobile, 💻 Desktop).
     • Egress ≈ one WebSocket + tiny frames; Realtime traffic never touches
       the DB egress quota.
     • If the CDN library is unavailable (first-load offline), presence is
       simply inactive — badges show ⚪ Offline and nothing else degrades.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const cfg = window.ARS_SUPABASE_CONFIG || {};
  const CHANNEL = 'ars-presence';
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let sb = null, chan = null, stopped = true, myMeta = null;
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

  function client() {
    if (sb || !window.supabase || !cfg.url || !cfg.anonKey) return sb;
    try {
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    } catch (e) { sb = null; }
    return sb;
  }

  const emit = () => { const s = summary(); listeners.forEach(fn => { try { fn(s); } catch (e) {} }); renderSlots(); };

  /* Group live metas by user; one entry per distinct device session. */
  function summary() {
    const raw = (chan && typeof chan.presenceState === 'function') ? chan.presenceState() : {};
    const byUid = {};
    for (const metas of Object.values(raw || {})) {
      for (const m of metas || []) {
        if (!m || !m.uid) continue;
        const b = byUid[m.uid] || (byUid[m.uid] = { uid: m.uid, email: m.email || '', sessions: {} });
        const sid = m.session_id || m.phx_ref;
        const prev = b.sessions[sid];
        if (!prev || String(m.online_at || '9999') < String(prev.online_at || '9999')) b.sessions[sid] = m;
      }
    }
    return byUid;
  }

  function teardownChannel() {
    if (chan) {
      try { chan.untrack(); } catch (e) {}
      try { sb && sb.removeChannel(chan); } catch (e) {}
      chan = null;
    }
  }

  function start(user) {
    if (!user || !cfg.url) return;
    stopped = false;
    const c = client();
    if (!c) return; /* CDN lib missing → presence inactive, app unaffected */
    const d = deviceInfo();
    myMeta = {
      uid: String(user.uid || user.email || '').toLowerCase(),
      email: user.email || '',
      device: d.label, icon: d.icon,
      session_id: sessionId(),
      online_at: new Date().toISOString()
    };
    teardownChannel();
    chan = c.channel(CHANNEL, { config: { presence: { key: myMeta.uid + ':' + myMeta.session_id } } });
    const sync = () => emit();
    chan.on('presence', { event: 'sync' }, sync);
    chan.on('presence', { event: 'join' }, sync);
    chan.on('presence', { event: 'leave' }, sync);
    chan.subscribe(status => {
      if (status === 'SUBSCRIBED' && !stopped && chan) {
        chan.track(myMeta).catch(() => {});
      }
    });
  }

  function stop() {
    stopped = true;
    teardownChannel();
    emit();
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
        devs.map(dev => `<div style="font-size:11px;line-height:1.5;color:#cfe8e4">${dev.icon || '📱'} <b>${esc(dev.device || 'Device')}</b> · Online · ${fmtAgo(dev.online_at)}<br><small style="color:#7d9494">session ${esc(dev.session_id || '—')}</small></div>`).join('') +
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
    /* console diagnostics: socket/channel state + live presence keys */
    debug: () => ({
      stopped,
      lib: Boolean(window.supabase),
      channel: chan ? String(chan.state || chan.status || 'created') : null,
      meta: myMeta,
      keys: Object.keys(summary())
    })
  };
})();
