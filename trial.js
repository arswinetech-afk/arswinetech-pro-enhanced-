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
  function seedFarm(id) {
    const d = off => new Date(Date.now() - off * DAY).toISOString().slice(0, 10);
    return {
      name: 'Demo Farm (15-Day Trial)',
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

  /* ── start / resume ── */
  window.arsStartTrial = async function () {
    /* Safety: never silently hijack a signed-in REAL farm session on this
       device — the trial swaps the active farm context. */
    const realSession = document.body.classList.contains('farm-access-granted') && !window.arsIsTrialFarm();
    if (realSession && !confirm('You are signed in to a REAL farm on this device.\n\nStart the demo trial anyway? You will be switched to the demo farm — your real data stays safe and you can sign back in anytime.')) return;
    let s = readState();
    if (s && Date.now() >= s.expiresAt) { window.arsTrialExpiredScreen(); return; }
    if (!s) {
      const id = 'trial-' + Date.now().toString(36);
      s = { startedAt: Date.now(), expiresAt: Date.now() + DAYS * DAY, farmId: id };
      writeState(s);
      try {
        const db = JSON.parse(localStorage.getItem('arswine-db-v1') || '{}');
        db[id] = seedFarm(id);
        localStorage.setItem('arswine-db-v1', JSON.stringify(db));
      } catch (_) {}
    }
    window.arsMemberships = [{ farm_id: s.farmId, role: 'owner', plan: 'full', is_active: true }];
    window.arsSessionUser = window.arsSessionUser || { email: 'trial@arswinetech.demo', name: 'Trial Farmer' };
    if (typeof window.activateFarmContext === 'function') {
      const ok = await window.activateFarmContext(s.farmId, { offline: true });
      if (ok) { injectBanner(); if (window.toast) window.toast(`🎁 Trial started — ${daysLeft(s)} days of full access. Explore everything!`); }
    }
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
      if (wantsTrial) window.arsTrialExpiredScreen();
      return;
    }
    setTimeout(() => {
      if (document.body.classList.contains('farm-access-granted')) injectBanner();
      else window.arsStartTrial();
    }, 400);
  });
})();
