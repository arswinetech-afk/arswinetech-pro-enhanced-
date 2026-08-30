/* ═══ [REBUILD FIX 104] 15-DAY FULL-ACCESS TRIAL LINK ═══
   A prospect opens  https://<your-pages-url>/?trial=1  (or taps the trial
   button on the login screen) and instantly gets a seeded demo farm with ALL
   premium features unlocked, stored only on their device (offline mode — no
   account, no cloud writes). The trial state carries startedAt/expiresAt;
   after 15 days the trial farm locks and a subscribe/expired screen shows.
   Note: expiry is client-side (sales tool, not DRM — a determined user could
   reset it; real accounts/subscriptions remain the source of truth). */
(function () {
  'use strict';
  const DAYS = 15;
  const KEY = 'ars-trial-v1';
  const DAY = 86400000;

  const readState = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  const writeState = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} };
  const daysLeft = s => Math.max(0, Math.ceil(((s ? s.expiresAt : 0) - Date.now()) / DAY));

  window.arsTrialActive = () => { const s = readState(); return !!(s && Date.now() < s.expiresAt); };
  window.arsTrialDaysLeft = () => daysLeft(readState());
  window.arsIsTrialFarm = () => { const s = readState(); return !!(s && String(s.farmId) === String(window.__arsActiveFarmId || window.farmId)); };

  /* ── seeded demo farm so every screen has life on first open ── */
  function seedFarm(id, name) {
    const d = off => new Date(Date.now() - off * DAY).toISOString().slice(0, 10);
    return {
      name: name || 'My Trial Farm',
      trial: true,
      sows: [
        { id: 'S-001', name: 'Luningning', breed: 'Large White', parity: 3, status: 'Pregnant', insemination: d(45), sire: 'Thor', dam: 'Malaika', dob: d(900), vaccine: 'Hog Cholera', vaccineDate: d(30) },
        { id: 'S-002', name: 'Marites', breed: 'Landrace', parity: 2, status: 'Lactating', insemination: d(20), sire: 'Thor', dam: 'Puti', dob: d(800) },
        { id: 'S-003', name: 'Ganda', breed: 'Duroc', parity: 1, status: 'Open', sire: 'Bantog', dam: 'Durocia', dob: d(400) }
      ],
      boars: [
        { id: 'BOAR-1', name: 'Thor', breed: 'Duroc Pietrain', status: 'Active', sire: 'DanBred Duroc', dam: 'Siete', dob: d(700) }
      ],
      piglets: [
        { id: 'P-TRIAL-1', sow: 'Marites', dam_name: 'Marites', sire_name: 'Thor', breed: 'Large White × Duroc', birth: d(21), males: 6, females: 5 },
        { id: 'P-TRIAL-2', sow: 'Luningning', dam_name: 'Luningning', sire_name: 'Thor', breed: 'Large White', birth: d(95), males: 4, females: 4 }
      ],
      feed: [
        { type: 'Pre Starter', bags: 4, price: 1375, id: 'pre-starter' },
        { type: 'Starter', bags: 6, price: 1845, id: 'starter' },
        { type: 'Grower', bags: 10, price: 2100, id: 'grower' },
        { type: 'Finisher', bags: 8, price: 2200, id: 'finisher' },
        { type: 'Gestating', bags: 6, price: 1900, id: 'gestating' },
        { type: 'Lactating', bags: 5, price: 2050, id: 'lactating' }
      ],
      transactions: [
        { id: 'tx-t1', date: d(12), type: 'Income', category: 'Hog Sales', description: 'Sold 2 fatteners @ ₱185/kg', amount: 33300, paid: 33300 },
        { id: 'tx-t2', date: d(9), type: 'Expense', category: 'Feed', description: 'Grower 10 bags delivery', amount: 21000, paid: 21000 },
        { id: 'tx-t3', date: d(6), type: 'Income', category: 'Semen Sales', description: 'Semen 8 bottles', amount: 2400, paid: 2400 },
        { id: 'tx-t4', date: d(4), type: 'Expense', category: 'Medicine', description: 'Vaccines & vitamins', amount: 1850, paid: 1850 }
      ],
      reservations: [
        { id: 'res-t1', no: 'TRIAL-0001', customer: 'Aling Nena Balitaan', contact: '0917 000 1111', batch_id: 'P-TRIAL-1', gender: 'female', quantity: 2, total: 9000, paid: 4000, balance: 5000, status: 'partially_paid', date: d(5), lines: [{ batch_id: 'P-TRIAL-1', source: 'breeder', gender: 'female', quantity: 2, price: 4500 }] }
      ],
      reminders: [
        { id: 'rem-t1', title: 'Vaccination follow-up — Marites litter', date: d(-2), time: '08:00', active: true, repeat: 'none' }
      ],
      medicines: [
        { id: 'med-t1', item_name: 'Amoxicillin LA 15%', med_type: 'Antibiotic', unit: 'ml', stock_quantity: 80, minimum_stock_threshold: 25, unit_cost: 6.5 },
        { id: 'med-t2', item_name: 'Iron Dextran + B12', med_type: 'Vitamin & Mineral', unit: 'ml', stock_quantity: 90, minimum_stock_threshold: 30, unit_cost: 4 }
      ],
      barns: [],
      created_at: new Date().toISOString()
    };
  }

  /* ── banner + expiry UI ── */
  function injectBanner() {
    const s = readState();
    if (!s || !window.arsIsTrialFarm()) return;
    document.getElementById('trialBanner')?.remove();
    const left = daysLeft(s);
    const el = document.createElement('div');
    el.id = 'trialBanner';
    el.style.cssText = 'position:sticky;top:0;z-index:99999;background:linear-gradient(90deg,#0ea5e9,#0db8ae);color:#04262b;font-weight:800;font-size:12.5px;padding:8px 14px;text-align:center';
    el.innerHTML = left > 0
      ? `🎁 FULL-ACCESS TRIAL · <b>${left} day${left === 1 ? '' : 's'} left</b> · data lives on this device only · <u style="cursor:pointer" onclick="toast && toast('Love it? Message the developer to subscribe and move your real farm in!')">Subscribe →</u>`
      : `⏳ Trial expired — <u style="cursor:pointer" onclick="window.arsTrialExpiredScreen && window.arsTrialExpiredScreen()">see options</u>`;
    document.body.prepend(el);
  }
  window.arsTrialBanner = injectBanner;

  window.arsTrialExpiredScreen = function () {
    document.getElementById('trialExpiredModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="trialExpiredModal" style="z-index:10000000!important">
      <div class="due-modal" style="max-width:480px;width:94%;text-align:center">
        <h2 style="margin:6px 0">⏳ Your 15-day trial has ended</h2>
        <p class="muted">Hope you enjoyed the full ARSwineTech Pro experience! To keep using it with your REAL farm — and unlock cloud sync, multi-staff access and backups — subscribe or talk to us.</p>
        <div class="due-actions" style="justify-content:center;flex-wrap:wrap;margin-top:14px">
          <button class="btn" onclick="toast && toast('📲 Message us to subscribe — salamat po!')">💬 Contact / Subscribe</button>
          <button class="btn ghost" onclick="document.getElementById('trialExpiredModal')?.remove(); const l=document.getElementById('loginScreen'); if(l) l.style.display='grid';">I have an account — sign in</button>
        </div>
      </div></div>`);
  };

  /* ── [FIX 107] trial signup: their OWN farm name + credentials ──
     Collecting these up front makes subscribing one-tap later (signUp with the
     same email/password, farm created under their chosen name, then merge).
     The password is kept ONLY on this device, obfuscated, purely so the
     conversion step doesn't require retyping; real auth tokens replace it. */
  function openTrialSignup() {
    document.getElementById('trialSignupModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="trialSignupModal" style="z-index:10000001!important">
      <form class="due-modal" style="max-width:480px;width:94%;text-align:left" onsubmit="window.arsBeginTrial(event)">
        <div class="modal-top"><div><div class="eyebrow" style="color:#7dd3fc;font-weight:800">🎁 15-DAY FREE TRIAL</div><h2>Create your trial farm</h2><small class="muted">Full access, no payment. Your farm lives on this device for 15 days — if you subscribe, we create your cloud account with these same details and move everything across.</small></div><button type="button" class="close-reminder" onclick="document.getElementById('trialSignupModal')?.remove()">×</button></div>
        <div class="reminder-fields">
          <div class="field"><label>Your farm name *</label><input name="farm_name" required placeholder="e.g. Dela Cruz Piggery"></div>
          <div class="field"><label>Email *</label><input name="email" type="email" required placeholder="you@example.com"></div>
          <div class="field"><label>Choose a password *</label><input name="password" type="password" minlength="6" required placeholder="at least 6 characters"></div>
        </div>
        <small class="muted" style="display:block;margin:10px 0">We'll use this email to follow up on your trial. Credentials stay on this device to make subscribing one-tap.</small>
        <div class="due-actions" style="justify-content:flex-end"><button type="button" class="btn ghost" onclick="document.getElementById('trialSignupModal')?.remove()">Cancel</button><button class="btn">Start my 15-day trial →</button></div>
      </form></div>`);
  }

  window.arsBeginTrial = function (e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const farmName = String(d.farm_name || '').trim();
    const email = String(d.email || '').trim().toLowerCase();
    const pw = String(d.password || '');
    if (!farmName) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (window.toast) window.toast('⚠ Please enter a valid email address.'); return; }
    if (pw.length < 6) { if (window.toast) window.toast('⚠ Password must be at least 6 characters.'); return; }
    const id = 'trial-' + Date.now().toString(36);
    const s = { startedAt: Date.now(), expiresAt: Date.now() + DAYS * DAY, farmId: id, farmName, email, passB64: btoa(unescape(encodeURIComponent(pw))) };
    writeState(s);
    try {
      const db = JSON.parse(localStorage.getItem('arswine-db-v1') || '{}');
      db[id] = seedFarm(id, farmName);
      localStorage.setItem('arswine-db-v1', JSON.stringify(db));
    } catch (_) {}
    document.getElementById('trialSignupModal')?.remove();
    enterTrial(s);
  };

  async function enterTrial(s) {
    window.arsMemberships = [{ farm_id: s.farmId, role: 'owner', plan: 'full', is_active: true }];
    window.arsSessionUser = window.arsSessionUser || { email: s.email || 'trial@arswinetech.demo', name: s.farmName || 'Trial Farmer' };
    if (typeof window.activateFarmContext === 'function') {
      const ok = await window.activateFarmContext(s.farmId, { offline: true });
      if (ok) { injectBanner(); beacon('active'); if (window.toast) window.toast(`🎁 Welcome, ${s.farmName}! ${daysLeft(s)} days of full access — explore everything.`); }
    }
  }

  /* ── start / resume ── */
  window.arsStartTrial = async function () {
    /* Safety: never silently hijack a signed-in REAL farm session on this
       device — the trial swaps the active farm context. */
    const realSession = document.body.classList.contains('farm-access-granted') && !window.arsIsTrialFarm();
    if (realSession && !confirm('You are signed in to a REAL farm on this device.\n\nStart the demo trial anyway? You will be switched to the demo farm — your real data stays safe and you can sign back in anytime.')) return;
    let s = readState();
    if (s && Date.now() >= s.expiresAt) { window.arsTrialExpiredScreen(); return; }
    if (!s) { openTrialSignup(); return; }
    await enterTrial(s);
  };

  /* ── [FIX 107] one-tap conversion: create the real cloud account with the
     credentials chosen at trial start, create their farm under the same name,
     then merge all trial records and push. Falls back to signIn if the
     account already exists (e.g. confirmed via email earlier). */
  window.arsSubscribeAndMigrate = async function () {
    const s = readState();
    if (!s || !window.ARSCloud) return;
    const email = s.email;
    const pw = (() => { try { return decodeURIComponent(escape(atob(s.passB64 || ''))); } catch (_) { return ''; } })();
    if (!email || !pw) { if (window.toast) window.toast('⚠ Trial has no saved credentials — use Export packet instead.'); return; }
    if (window.toast) window.toast('🔐 Creating your account…');
    let authed = false;
    try { await window.ARSCloud.signUp(email, pw); authed = true; }
    catch (err) {
      const msg = String(err?.message || err);
      if (/already|exists|registered|duplicate/i.test(msg)) {
        try { await window.ARSCloud.signIn(email, pw); authed = true; }
        catch (e2) { if (window.toast) window.toast('⚠ Sign-in failed: ' + (e2?.message || e2) + ' — check your password or email confirmation.'); return; }
      } else {
        if (window.toast) window.toast('⚠ Account creation failed: ' + msg + ' — if we emailed you a confirmation link, confirm it first, then tap migrate again.');
        return;
      }
    }
    if (!authed) return;
    let memberships = [];
    try { memberships = (await window.ARSCloud.getFarmMemberships()) || []; } catch (_) {}
    let farmId = memberships[0] && memberships[0].farm_id;
    if (!farmId) {
      try {
        const on = await window.ARSCloud.onboard({ first_name: (s.farmName || 'My Farm').split(' ')[0], last_name: 'Owner', mobile_number: s.contact || '', farm_name: s.farmName || s.farmId, farm_address: '', barangay: '', municipality: '', province: '' });
        farmId = on && (on.farm_id || on.id || (Array.isArray(on) && on[0] && (on[0].farm_id || on[0].id)));
      } catch (e3) { if (window.toast) window.toast('⚠ Farm creation failed: ' + (e3?.message || e3)); return; }
    }
    if (!farmId) { if (window.toast) window.toast('⚠ Could not find or create your farm — contact support with your trial packet.'); return; }
    const ok = await window.activateFarmContext(farmId, {});
    if (!ok) { if (window.toast) window.toast('⚠ Could not open your new farm yet — try again online.'); return; }
    const src = dbAll()[s.farmId];
    const added = window.arsMergeFarmData(src, s.farmId);
    if (typeof window.save === 'function') window.save();
    const res = await pushActiveFarm();
    if (res && res.success !== false) {
      s.migrated = true; writeState(s); beacon('migrated');
      document.getElementById('trialMigrateModal')?.remove();
      if (window.toast) window.toast(`✅ Account created and ${added} trial records migrated to ${s.farmName} — synced to the cloud!`);
      if (typeof window.renderAll === 'function') window.renderAll();
    } else {
      if (window.toast) window.toast(`⚠ Merged ${added} records locally; cloud sync pending: ${res?.reason || 'retry when online.'}`);
    }
  };

  /* ═══ [REBUILD FIX 106] TRIAL → SUBSCRIBER DATA MIGRATION ═══
     Trial data is device-local by design. When the client subscribes and signs
     in (or joins via invitation), we OFFER to merge their trial records into
     the real farm — additive-only, pre-backup, then cloud-pushed. The owner
     can also receive a "migration packet" file via Messenger and import it
     into the target farm from the sync menu. */
  const dbAll = () => { try { return JSON.parse(localStorage.getItem('arswine-db-v1') || '{}'); } catch (_) { return {}; } };
  const KEYS = ['sows', 'boars', 'piglets', 'feed', 'transactions', 'reservations', 'medicines', 'reminders', 'vaccinations', 'treatments', 'pigletLedger', 'feedOrders', 'feedTrials'];
  const countsOf = f => ({ sows: (f.sows || []).length, boars: (f.boars || []).length, batches: (f.piglets || []).length, reservations: (f.reservations || []).length, transactions: (f.transactions || []).length });

  function beacon(status) {
    /* Optional live census — requires supabase/trial_beacons.sql to be run once.
       Fails silently otherwise; everything else keeps working. */
    try {
      const cfg = window.ARS_SUPABASE_CONFIG;
      const s = readState();
      if (!cfg || !s || !navigator.onLine) return;
      const f = dbAll()[s.farmId] || {};
      fetch(cfg.url + '/rest/v1/trial_beacons?on_conflict=id', {
        method: 'POST',
        headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: s.farmId, started_at: new Date(s.startedAt).toISOString(), expires_at: new Date(s.expiresAt).toISOString(), status: status || 'active', counts: countsOf(f), contact: s.contact || null, updated_at: new Date().toISOString() })
      }).catch(() => {});
    } catch (_) {}
  }

  window.arsMergeFarmData = function (src, label) {
    const dst = window.F ? window.F() : null;
    if (!src || !dst) return 0;
    let added = 0;
    KEYS.forEach(k => {
      (src[k] || []).forEach(item => {
        if (!item || typeof item !== 'object') return;
        const arr = (dst[k] = dst[k] || []);
        const dup = arr.some(x => (item.id && x.id === item.id) || (item.name && x.name === item.name && ['sows', 'boars', 'medicines'].includes(k)));
        if (!dup) { const copy = JSON.parse(JSON.stringify(item)); delete copy._ars_cloud_local_id; arr.push(copy); added++; }
      });
    });
    (dst.migration_log = dst.migration_log || []).push({ from: label || 'trial', at: new Date().toISOString(), added });
    return added;
  };

  async function pushActiveFarm() {
    if (window.ARSCloud && typeof window.ARSCloud.pushFarm === 'function') {
      return await window.ARSCloud.pushFarm(window.__arsActiveFarmId || window.farmId, window.F(), { dirtyOnly: false });
    }
    return null;
  }

  function trialCounts() { const s = readState(); return s ? countsOf(dbAll()[s.farmId] || {}) : null; }

  window.arsPostFarmActivate = function (targetId) {
    const s = readState();
    if (!s || s.migrated || String(targetId) === String(s.farmId)) return;
    const c = trialCounts();
    if (!c || (c.sows + c.batches + c.reservations + c.transactions) === 0) return;
    if (document.getElementById('trialMigrateModal')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="trialMigrateModal" style="z-index:10000001!important">
      <div class="due-modal" style="max-width:520px;width:94%;text-align:left">
        <div class="modal-top"><div><div class="eyebrow" style="color:#7dd3fc;font-weight:800">🚀 WELCOME, SUBSCRIBER!</div><h2>Migrate your trial data?</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('trialMigrateModal')?.remove()">×</button></div>
        <p class="muted">We found your trial records on this device: <b>${c.sows} sows · ${c.boars} boars · ${c.batches} batches · ${c.reservations} reservations · ${c.transactions} transactions</b>. Add them to <b>${(window.F() || {}).name || 'your new farm'}</b>? Records are ADDED only — nothing existing is deleted or overwritten.</p>
        <div class="due-actions" style="justify-content:flex-end;flex-wrap:wrap">
          <button class="btn ghost" onclick="window.arsExportTrialPacket && window.arsExportTrialPacket()">📤 Export packet</button>
          <button class="btn ghost" onclick="document.getElementById('trialMigrateModal')?.remove()">Later</button>
          <button class="btn ghost" onclick="window.arsMigrateTrialNow && window.arsMigrateTrialNow()">Merge into signed-in farm</button>
          <button class="btn" onclick="window.arsSubscribeAndMigrate && window.arsSubscribeAndMigrate()">🚀 Create my account &amp; migrate</button>
        </div>
      </div></div>`);
  };

  window.arsMigrateTrialNow = async function () {
    const s = readState(); if (!s) return;
    const src = dbAll()[s.farmId]; if (!src) return;
    const added = window.arsMergeFarmData(src, s.farmId);
    if (typeof window.save === 'function') window.save();
    const res = await pushActiveFarm();
    if (res && res.success !== false) {
      s.migrated = true; writeState(s); beacon('migrated');
      document.getElementById('trialMigrateModal')?.remove();
      if (window.toast) window.toast(`✅ Migrated ${added} records into your real farm and synced to the cloud.`);
      if (typeof window.renderAll === 'function') window.renderAll();
    } else {
      if (window.toast) window.toast(`⚠ Saved locally (${added} records) but cloud sync pending: ${res?.reason || 'retry when online.'}`);
    }
  };

  window.arsExportTrialPacket = function () {
    const s = readState(); if (!s) return;
    const contact = prompt('Optional: your contact (Messenger/phone) so the developer can assist migration:', '') || '';
    if (contact) { s.contact = contact; writeState(s); }
    const packet = { kind: 'ars-trial-packet', version: 1, exported_at: new Date().toISOString(), trial: { id: s.farmId, started_at: new Date(s.startedAt).toISOString(), expires_at: new Date(s.expiresAt).toISOString(), days_left: daysLeft(s), contact: s.contact || null, migrated: !!s.migrated }, counts: trialCounts(), farm: dbAll()[s.farmId] || {} };
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ARSwineTech-trial-packet-${s.farmId}.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 300);
    beacon('active');
    if (window.toast) window.toast('📤 Packet downloaded — send it to the developer via Messenger.');
  };

  /* ── OWNER tools (sync menu): import a packet / view live trial board ── */
  window.arsImportTrialPacketUI = function () {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      const text = await f.text();
      try {
        const p = JSON.parse(text);
        if (p.kind !== 'ars-trial-packet' || !p.farm) throw new Error('Not a trial packet file.');
        const c = p.counts || countsOf(p.farm);
        if (!confirm(`Import trial ${p.trial?.id || ''} into ACTIVE farm "${(window.F() || {}).name || ''}"?\n\n${c.sows} sows · ${c.batches} batches · ${c.reservations} reservations · ${c.transactions} transactions will be ADDED (duplicates skipped). Existing records are never deleted.`)) return;
        const added = window.arsMergeFarmData(p.farm, p.trial?.id || 'packet');
        if (typeof window.save === 'function') window.save();
        const res = await pushActiveFarm();
        if (window.toast) window.toast(res && res.success !== false ? `✅ Imported ${added} trial records into ${(window.F() || {}).name} and synced.` : `⚠ Imported ${added} records locally; cloud push pending.`);
        if (typeof window.renderAll === 'function') window.renderAll();
      } catch (e) {
        if (window.toast) window.toast('⚠ Could not import: ' + (e.message || e));
      }
    };
    inp.click();
  };

  window.arsTrialBoard = async function () {
    const box = document.getElementById('trialBoardModal'); box?.remove();
    const cfg = window.ARS_SUPABASE_CONFIG;
    let rowsHtml = '<div class="empty" style="padding:16px">No beacon table yet — run <b>supabase/trial_beacons.sql</b> once in your Supabase SQL editor to enable the live trial dashboard.</div>';
    if (cfg && window.ARSCloud?.rawRequest && navigator.onLine) {
      try {
        const res = await window.ARSCloud.rawRequest('/rest/v1/trial_beacons?order=started_at.desc&limit=50', { method: 'GET' });
        if (Array.isArray(res)) {
          const list = res;
          rowsHtml = list.length ? `<div class="table-wrap"><table class="table" style="min-width:420px;font-size:12px"><thead><tr><th>Trial</th><th>Status</th><th>Days left</th><th>Data</th><th>Contact</th></tr></thead><tbody>${list.map(t => {
            const left = Math.max(0, Math.ceil((new Date(t.expires_at) - Date.now()) / 86400000));
            const c = t.counts || {};
            return `<tr><td><b>${String(t.id).slice(-6)}</b><br><small>${String(t.started_at || '').slice(0, 10)}</small></td><td>${t.status === 'migrated' ? '✅ migrated' : left === 0 ? '⏳ expired' : '🎁 active'}</td><td>${left}</td><td>${c.sows || 0} sows · ${c.batches || 0} batches</td><td>${t.contact || '—'}</td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty" style="padding:16px">No trials beaconed yet — trial devices report automatically once they open the app next time.</div>';
        } else {
          /* [FIX 108] table not installed yet → clear one-time setup note */
          const em = String((res && res.message) || '').replace(/</g, '&lt;');
          rowsHtml = `<div class="empty" style="padding:16px">⚙ <b>One-time setup:</b> in your Supabase Dashboard → SQL Editor, paste the file <b>supabase/trial_beacons.sql</b> and press Run. Trial devices will start appearing here automatically on their next app open.<br><small class="muted">${em}</small></div>`;
        }
      } catch (e) {
        const em = String(e.message || e).replace(/</g, '&lt;');
        rowsHtml = `<div class="empty" style="padding:16px">⚙ <b>One-time setup:</b> run <b>supabase/trial_beacons.sql</b> once in Supabase → SQL Editor to enable the live trial dashboard.<br><small class="muted">${em}</small></div>`;
      }
    }
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="trialBoardModal" style="z-index:10000001!important" onclick="if(event.target===this)this.remove()"><div class="due-modal" style="max-width:640px;width:96%;text-align:left"><div class="modal-top"><div><div class="eyebrow" style="color:#7dd3fc;font-weight:800">🎁 TRIAL DASHBOARD</div><h2>Who is on trial / needs migration</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('trialBoardModal')?.remove()">×</button></div>${rowsHtml}<div class="due-actions" style="justify-content:flex-end"><button class="btn ghost" onclick="window.arsImportTrialPacketUI && window.arsImportTrialPacketUI()">📥 Import trial packet</button><button class="btn" onclick="document.getElementById('trialBoardModal')?.remove()">Close</button></div></div></div>`);
  };

  /* boot: ?trial=1 auto-starts; returning visitors resume; expired → lock */
  window.addEventListener('load', () => {
    const s = readState();
    const wantsTrial = /[?&]trial=1/.test(location.search) || location.hash.includes('trial');
    if (!s) {
      /* fresh visitor with the trial link — but never auto-switch a device
         that is already signed in to a real farm */
      if (wantsTrial && !document.body.classList.contains('farm-access-granted')) window.arsStartTrial();
      return;
    }
    if (Date.now() >= s.expiresAt) {
      beacon('expired'); /* [FIX 108] owner sees expired trials needing follow-up */
      if (wantsTrial) window.arsTrialExpiredScreen();
      return;
    }
    setTimeout(() => {
      if (document.body.classList.contains('farm-access-granted')) { injectBanner(); beacon('active'); /* [FIX 108] self-report on every open so the owner's board fills once the table exists */ }
      else window.arsStartTrial();
    }, 400);
    /* [FIX 109] re-beacon whenever connectivity returns so the owner board
       catches up even if the first beacon raced the SQL setup */
    window.addEventListener('online', () => { const st = readState(); if (st && Date.now() < st.expiresAt) beacon('active'); });
  });
})();
