function reportBootError(message) {
  console.warn('App startup note:', message);
  const box = document.getElementById('loginError'),
    status = document.getElementById('authStatus');
  if (box && message) {
    box.textContent = message;
    box.classList.add('show');
  }
  if (status) {
    status.textContent = 'Secure sign-in active';
    status.className = 'auth-status';
  }
}
/* The app also works inside sandboxed previews where browser STORE is unavailable. */
const STORE = (() => {
  try {
    const t = '__ars_test__';
    window.localStorage.setItem(t, '1');
    window.localStorage.removeItem(t);
    return window.localStorage;
  } catch (e) {
    const memory = new Map();
    return {
      getItem: k => memory.has(k) ? memory.get(k) : null,
      setItem: (k, v) => memory.set(k, String(v)),
      removeItem: k => memory.delete(k)
    };
  }
})();
window.STORE = STORE;

/* [REBUILD FIX 86] STORAGE-QUOTA PROTECTION.
   Piglet photos used to be stored as raw base64 (a 3 MB camera file ≈ 4 MB of
   text) inside the offline DB, which blew the ~5 MB localStorage quota
   ("Failed to execute 'setItem' … exceeded the quota"). Now: images are
   downscaled on upload, oversized stored images are migrated on boot, and
   every DB write is quota-safe with staged recovery. */
window.arsDownscaleImage = function (dataUrl, maxDim = 1000, quality = 0.8, keepPng = false) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, (maxDim || 1000) / Math.max(img.width || 1, img.height || 1));
        if (scale === 1 && keepPng) { resolve(dataUrl); return; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
        canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
        const ctx = canvas.getContext('2d');
        if (!keepPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = dataUrl;
  });
};
window.arsMigrateOversizedPhotos = function (done) {
  const jobs = [];
  Object.values(window.DB || {}).forEach(f => {
    (f.reservations || []).forEach(r => {
      if (r.photo && r.photo.length > 400000) jobs.push(() => window.arsDownscaleImage(r.photo, 1000, 0.8).then(s => { if (s && s.length < r.photo.length) r.photo = s; }).catch(() => {}));
    });
    if (f.logo && f.logo.length > 500000) jobs.push(() => window.arsDownscaleImage(f.logo, 512, 0.85, true).then(s => { if (s && s.length < f.logo.length) { f.logo = s; f.logo_url = s; } }).catch(() => {}));
  });
  if (!jobs.length) { done && done(false); return; }
  Promise.all(jobs.map(j => j())).then(() => done && done(true)).catch(() => done && done(false));
};
window.arsQuotaRecovery = function () {
  /* 1) drop local recovery snapshots (cloud remains authoritative) and retry */
  try {
    const kill = [];
    for (let i = 0; i < STORE.length; i++) { const k = STORE.key(i); if (k && k.startsWith('arswine-recovery-')) kill.push(k); }
    kill.forEach(k => STORE.removeItem(k));
  } catch (_) {}
  try { STORE.setItem('arswine-db-v1', JSON.stringify(window.DB)); return; } catch (_) {}
  /* 2) asynchronously compress oversized stored photos, then retry */
  window.arsMigrateOversizedPhotos(changed => {
    if (changed) {
      try { STORE.setItem('arswine-db-v1', JSON.stringify(window.DB)); if (typeof toast === 'function') toast('✓ Stored photos optimized — device space freed.'); } catch (_) {}
    }
  });
  if (typeof toast === 'function') toast('⚠ Device storage is full — records stay in memory & cloud sync. Oversized photos are being compressed; remove unused piglet photos if this repeats.');
};
setTimeout(() => {
  window.arsMigrateOversizedPhotos(changed => { if (changed && typeof save === 'function') save(); });
}, 2500);
var farmId = STORE.getItem('arswine-active-farm') || '';
window.farmId = farmId;

// Local storage is a recovery source only. It is never an authentication grant.
// The authenticated user and active farm are established by startApp() after
// Supabase verifies the session and returns an active membership.
window.currentFarmAssigned = false;
window.platformAdminVerified = false;
window.myFarmRole = null;
window.arsSessionUser = null;
window.arsMemberships = [];
window.arsActiveMembership = null;
window.arsContextReady = false;
window.arsOfflineMode = false;
window.__arsActiveFarmId = null;
window.arsServerFarms = [];
window.__arsCloudBaselineReady = false;
window.__arsLastSavedFarmById = window.__arsLastSavedFarmById || {};
// A save made before a verified cloud baseline must remain visibly pending,
// but the marker is cleared when that baseline is later loaded successfully.
window.__arsPendingUnverifiedSave = false;
window.__arsDirectCloudVerification = 0;
/* [REBUILD] The original pinned all date math to a hardcoded TODAY = '2026-07-21' (demo snapshot).
   A working copy needs the real clock; seed data still renders sensible dashboards.
   [FIX M2] TODAY must be the Manila wall-clock date. (window.localToday ? window.localToday() : new Date().toISOString().slice(0,10))
   is UTC, which between 00:00-08:00 (+08:00) shows YESTERDAY on the farm floor. */
function localToday(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
window.localToday = localToday;
const TODAY = localToday(),
  d = s => {
    if (!s) return new Date();
    const str = String(s).trim();
    if (str.includes('T')) return new Date(str);
    return new Date(str + 'T00:00:00');
  },
  days = (a, b = TODAY) => {
    const da = d(a), db = d(b);
    if (isNaN(da.getTime()) || isNaN(db.getTime())) return 0;
    return Math.round((db - da) / 864e5);
  },
  esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  peso = x => new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0
  }).format(x || 0),
  isoOff = n => {
    let x = d(TODAY);
    x.setDate(x.getDate() + n);
    return x.toISOString().slice(0, 10);
  };

// datetime-local inputs require a local wall-clock value. Using
// new Date().toISOString().slice(0, 16) displays UTC (08:00 behind Manila),
// which made a 10:56 AM pickup appear as 2:56 AM. Stored timestamps remain
// UTC ISO strings; this helper only formats the input for the user's timezone.
function localDateTimeValue(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
window.localDateTimeValue = localDateTimeValue;
// Offline-first local database: durable IndexedDB snapshot plus the lightweight UI store.
const DEVICE_DB_NAME = 'arswinetech-device',
  DEVICE_STORE = 'snapshots',
  DEVICE_KEY = 'farm-data-v1';

function deviceDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DEVICE_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DEVICE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error)
  })
}
async function deviceRead() {
  try {
    const db = await deviceDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DEVICE_STORE, 'readonly');
      const r = tx.objectStore(DEVICE_STORE).get(DEVICE_KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error)
    })
  } catch (e) {
    return null
  }
}
async function deviceWrite(value) {
  try {
    const db = await deviceDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DEVICE_STORE, 'readwrite');
      tx.objectStore(DEVICE_STORE).put(value, DEVICE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.warn('Offline device database unavailable', e)
  }
}
const seeds = {
  'farm-ars': {
    name: 'ARS Demo Farm · Ocampo',
    sows: [{
      id: 'S-001',
      name: 'Bella',
      sire: 'Thor',
      breed: 'Large White',
      dob: '2023-02-10',
      parity: 3,
      insemination: '2026-04-13',
      vaccine: 'Parvo',
      vaccineDate: '2026-05-12',
      notes: 'Good body condition'
    }, {
      id: 'S-002',
      name: 'Maya',
      sire: 'Atlas',
      breed: 'Landrace',
      dob: '2022-11-06',
      parity: 4,
      insemination: '2026-04-20'
    }, {
      id: 'S-003',
      name: 'Luna',
      sire: 'Thor',
      breed: 'Duroc',
      dob: '2023-05-14',
      parity: 2,
      insemination: '2026-05-04'
    }, {
      id: 'S-004',
      name: 'Daisy',
      sire: 'Apollo',
      breed: 'Yorkshire',
      dob: '2022-08-21',
      parity: 5,
      insemination: '2026-03-25'
    }, {
      id: 'S-005',
      name: 'Ginger',
      sire: 'Atlas',
      breed: 'Landrace',
      dob: '2024-03-08',
      parity: 1
    }],
    piglets: [{
      id: 'B-2601',
      sow: 'Bella',
      sire: 'Thor',
      semen: 'TH-245',
      birth: '2026-06-16',
      males: 6,
      females: 5,
      iron: false,
      castration: false,
      weaning: false,
      notes: ''
    }, {
      id: 'B-2602',
      sow: 'Maya',
      sire: 'Atlas',
      semen: 'AT-611',
      birth: '2026-07-02',
      males: 5,
      females: 6,
      iron: false,
      castration: false,
      weaning: false,
      notes: ''
    }, {
      id: 'B-2518',
      sow: 'Daisy',
      sire: 'Apollo',
      semen: 'AP-928',
      birth: '2026-05-30',
      males: 7,
      females: 5,
      iron: true,
      castration: true,
      weaning: false,
      notes: ''
    }],
    feed: [{
      type: 'Pre Starter',
      bags: 18,
      price: 1380
    }, {
      type: 'Starter',
      bags: 24,
      price: 1320
    }, {
      type: 'Grower',
      bags: 38,
      price: 1250
    }, {
      type: 'Finisher',
      bags: 15,
      price: 1230
    }, {
      type: 'Gestating',
      bags: 10,
      price: 1400
    }, {
      type: 'Lactating',
      bags: 13,
      price: 1450
    }],
    semen: [{
      boar: 'Thor',
      breed: 'Duroc',
      collection: '2026-07-14',
      expiration: '2026-07-25',
      bottles: 8
    }, {
      boar: 'Atlas',
      breed: 'Landrace',
      collection: '2026-07-17',
      expiration: '2026-07-31',
      bottles: 12
    }],
    transactions: [{
      date: '2026-07-04',
      type: 'Income',
      category: 'Piglet Sales',
      description: 'Batch B-2512',
      amount: 28600,
      paid: 22000
    }, {
      date: '2026-07-08',
      type: 'Expense',
      category: 'Feed',
      description: 'Grower feed delivery',
      amount: 11250,
      paid: 11250
    }, {
      date: '2026-07-12',
      type: 'Income',
      category: 'Hog Sales',
      description: '4 heads',
      amount: 43200,
      paid: 43200
    }, {
      date: '2026-07-17',
      type: 'Expense',
      category: 'Medicine',
      description: 'Vaccines',
      amount: 3800,
      paid: 3800
    }],
    sales: [{
      date: '2026-07-12',
      product: 'Market Hog × 4',
      qty: 4,
      total: 43200,
      paid: 43200,
      is_returned: false
    }, {
      date: '2026-07-04',
      product: 'Piglet batch B-2512',
      qty: 11,
      total: 28600,
      paid: 22000,
      is_returned: false
    }],
    reminders: [{
      title: 'Clean water lines',
      type: 'Weekly',
      schedule: 'Every Monday',
      active: true
    }, {
      title: 'Order Gestating feed',
      type: 'One Time',
      schedule: '2026-07-23',
      active: true
    }, {
      title: 'Check generator',
      type: 'Interval',
      schedule: 'Every 12 hours',
      active: true
    }]
  },
  'farm-sample': {
    name: 'San Isidro Hog Farm',
    sows: [{
      id: 'SI-01',
      name: 'Rosa',
      sire: 'Max',
      breed: 'Large White',
      dob: '2023-06-04',
      parity: 2,
      insemination: '2026-04-25'
    }],
    piglets: [{
      id: 'SI-B1',
      sow: 'Rosa',
      sire: 'Max',
      semen: 'MX-10',
      birth: '2026-06-01',
      males: 4,
      females: 4,
      iron: true,
      castration: true,
      weaning: false
    }],
    feed: [{
      type: 'Starter',
      bags: 9,
      price: 1300
    }, {
      type: 'Grower',
      bags: 16,
      price: 1200
    }],
    semen: [],
    transactions: [],
    sales: [],
    reminders: []
  }
}

function sanitizeFarm(f) {
  if (!f || typeof f !== 'object') return;
  if (!Array.isArray(f.sows)) f.sows = [];
  if (!Array.isArray(f.piglets)) f.piglets = [];
  if (!Array.isArray(f.feed)) f.feed = [];
  if (!Array.isArray(f.semen)) f.semen = [];
  if (!Array.isArray(f.transactions)) f.transactions = [];
  if (!Array.isArray(f.sales)) f.sales = [];
  if (!Array.isArray(f.reminders)) f.reminders = [];
  if (!Array.isArray(f.medicines)) f.medicines = [];
  if (!Array.isArray(f.vaccinations)) f.vaccinations = [];
  if (!Array.isArray(f.reservations)) f.reservations = [];
  if (!Array.isArray(f.semenSales)) f.semenSales = [];
  if (!Array.isArray(f.semenResellers)) f.semenResellers = [];
  if (!Array.isArray(f.semenResellerTx)) f.semenResellerTx = [];
  if (!Array.isArray(f.semenResellerAdjustments)) f.semenResellerAdjustments = [];
  if (!Array.isArray(f.feedTrials)) f.feedTrials = [];
  if (!Array.isArray(f.feedOrders)) f.feedOrders = [];
  if (!Array.isArray(f.boars)) f.boars = [];
  if (!Array.isArray(f.barns)) f.barns = [];
  if (!Array.isArray(f.movements)) f.movements = [];
  if (!Array.isArray(f.rfid_tags)) f.rfid_tags = [];
  if (!Array.isArray(f.rfid_scans)) f.rfid_scans = [];
  if (!Array.isArray(f.breedingRecords)) f.breedingRecords = [];
  if (!Array.isArray(f.pigletLedger)) f.pigletLedger = [];
  if (!Array.isArray(f.heatRecords)) f.heatRecords = [];
  if (!Array.isArray(f.treatments)) f.treatments = [];
  if (!Array.isArray(f.med_movements)) f.med_movements = [];
  if (!Array.isArray(f.vaccination_events)) f.vaccination_events = [];
  if (!Array.isArray(f.vaxSchedules)) f.vaxSchedules = [];
  if (!Array.isArray(f.vetCatalog)) f.vetCatalog = [];
  if (!Array.isArray(f.marketQuotes)) f.marketQuotes = [];
  // Canonical production-control ledgers. These are additive only: legacy
  // records remain untouched and can be reconciled against the new ledgers.
  if (!Array.isArray(f.productionEvents)) f.productionEvents = [];
  if (!Array.isArray(f.feedAllocations)) f.feedAllocations = [];
  if (!Array.isArray(f.auditLog)) f.auditLog = [];
  if (!Array.isArray(f.integrationEvents)) f.integrationEvents = [];
  if (!Array.isArray(f.populationSnapshots)) f.populationSnapshots = [];
  if (!Array.isArray(f.benchmarkProfiles)) f.benchmarkProfiles = [];

  // Feed inventory is a balance row, not a set of silently mergeable records.
  // Older deployments could leave duplicate rows for the same feed type. Keep
  // the newest explicitly revised row as the active balance and preserve every
  // displaced row in a farm-scoped recovery ledger so a later cloud pull cannot
  // resurrect an older bags/price value or silently destroy the duplicate.
  if (!Array.isArray(f.feedDuplicateRecovery)) f.feedDuplicateRecovery = [];
  if (Array.isArray(f.feed) && f.feed.length > 1) {
    const groups = new Map();
    f.feed.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const type = String(item.type || item.feed_name || item.name || '').trim();
      if (!type) return;
      const key = type.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ item, index });
    });
    const active = [];
    groups.forEach((items, key) => {
      items.sort((a, b) => {
        const aTime = new Date(a.item.updated_at || a.item.feed_revision_at || a.item.created_at || 0).getTime() || 0;
        const bTime = new Date(b.item.updated_at || b.item.feed_revision_at || b.item.created_at || 0).getTime() || 0;
        if (bTime !== aTime) return bTime - aTime;
        const aRev = Number(a.item.feed_revision || 0), bRev = Number(b.item.feed_revision || 0);
        if (bRev !== aRev) return bRev - aRev;
        return a.index - b.index;
      });
      const winner = items[0].item;
      if (!winner.id) winner.id = `feed-${key.replace(/[^a-z0-9]/g, '-')}`;
      if (!winner._ars_cloud_local_id) winner._ars_cloud_local_id = winner.id;
      active.push(winner);
      items.slice(1).forEach(({ item }, duplicateIndex) => {
        const recoveryId = `feed-recovery-${key}-${String(item.id || item._ars_cloud_local_id || duplicateIndex).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        if (!f.feedDuplicateRecovery.some(row => row && row.id === recoveryId)) {
          f.feedDuplicateRecovery.push({
            id: recoveryId,
            feed_type: winner.type || key,
            displaced_record: JSON.parse(JSON.stringify(item)),
            displaced_at: new Date().toISOString(),
            reason: 'Duplicate feed inventory row preserved while the newest revised balance became active.'
          });
        }
      });
    });
    f.feed = active;
  } else if (Array.isArray(f.feed) && f.feed.length === 1) {
    const row = f.feed[0];
    if (row && typeof row === 'object') {
      if (!row.id) row.id = `feed-${String(row.type || 'stock').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      if (!row._ars_cloud_local_id) row._ars_cloud_local_id = row.id;
    }
  }
}

function purgeDemoSeedsFromFarm(f) {
  if (!f || typeof f !== 'object') return;
  const demoSowIds = new Set(['S-001', 'S-002', 'S-003', 'S-004', 'S-005']);
  const demoSowNames = new Set(['Bella', 'Maya', 'Luna', 'Daisy', 'Ginger']);
  const demoLitterIds = new Set(['B-2601', 'B-2602', 'B-2518']);

  if (Array.isArray(f.sows)) {
    const seen = new Set();
    f.sows = f.sows.filter(s => {
      if (!s || typeof s !== 'object') return false;
      const sName = String(s.name || s.id || '').toLowerCase();
      // Purge automated test sows
      if (sName.includes('verify sow') || sName.includes('live sync') || sName.includes('lint verify') || sName.includes('test sow') || sName.includes('e2e live') || sName.includes('e2e ')) {
        return false;
      }
      if (demoSowIds.has(s.id) && demoSowNames.has(s.name)) {
        return false;
      }
      // Deduplicate sows strictly by unique name or ID
      const key = String(s.id || s.name || '').trim().toLowerCase();
      if (key && seen.has(key)) return false;
      if (key) seen.add(key);
      return true;
    });
  }

  if (Array.isArray(f.piglets)) {
    f.piglets = f.piglets.filter(b => !(b && demoLitterIds.has(b.id)));
  }
}

async function cleanTestRecordsAction() {
  const f = F();
  if (!f) return;
  const beforeCount = (f.sows || []).length;
  purgeDemoSeedsFromFarm(f);
  const afterCount = (f.sows || []).length;
  save();
  if (window.ARSCloud && typeof ARSCloud.cleanCloudTestRecords === 'function' && farmId) {
    await ARSCloud.cleanCloudTestRecords(farmId).catch(() => {});
  }
  renderAll();
  if (window.refreshOpenDrilldown) window.refreshOpenDrilldown();
  toast(`✓ Cleaned ${beforeCount - afterCount} test records. ${afterCount} real sows active.`);
}
window.cleanTestRecordsAction = cleanTestRecordsAction;

function createEmptyFarmRecord(name = "RM's Hog Farm") {
  return {
    name,
    sows: [], piglets: [], feed: [], semen: [], transactions: [], sales: [],
    reminders: [], medicines: [], vaccinations: [], reservations: [],
    semenSales: [], semenResellers: [], semenResellerTx: [], semenResellerAdjustments: [], feedTrials: [], feedOrders: [],
    boars: [], barns: [], movements: [], rfid_tags: [], rfid_scans: [],
    breedingRecords: [], pigletLedger: [], heatRecords: [], treatments: [],
    med_movements: [], vaccination_events: [], vaxSchedules: [], vetCatalog: [], marketQuotes: [],
    productionEvents: [], feedAllocations: [], auditLog: [], integrationEvents: [],
    populationSnapshots: [], benchmarkProfiles: [], feedDuplicateRecovery: []
  };
}

function ensureFarmBucket(id, name = "RM's Hog Farm", logoUrl = null) {
  if (!id) return null;
  if (!DB[id]) DB[id] = createEmptyFarmRecord(name);
  if (name && (!DB[id].name || DB[id].name === "RM's Hog Farm")) DB[id].name = name;
  if (logoUrl && !DB[id].logo && !DB[id].logo_url) {
    DB[id].logo = logoUrl;
    DB[id].logo_url = logoUrl;
  }
  sanitizeFarm(DB[id]);
  return DB[id];
}

function unifyAndRestoreRealHerd() {
  // Previous builds merged every local farm bucket into a hard-coded primary
  // farm. That could combine unrelated devices/farms before authentication and
  // then upload the merged snapshot. Keep local buckets separate and preserve
  // them as recovery data; server membership selects the active farm later.
  if (!DB || typeof DB !== 'object') return;
  Object.keys(DB).forEach(id => sanitizeFarm(DB[id]));
  const stored = STORE.getItem('arswine-active-farm');
  if (stored && DB[stored]) {
    farmId = stored;
    window.farmId = stored;
  } else if (!farmId || !DB[farmId]) {
    const first = Object.keys(DB)[0] || '';
    farmId = first;
    window.farmId = first;
  }
}
window.unifyAndRestoreRealHerd = unifyAndRestoreRealHerd;

function load() {
  let x = STORE.getItem('arswine-db-v1');
  let data = null;
  if (x) {
    try { data = JSON.parse(x); } catch (e) { data = null; }
  }
  if (!data || typeof data !== 'object') {
    data = {};
  }
  Object.keys(data).forEach(k => {
    sanitizeFarm(data[k]);
  });
  return data;
}

var DB = load();
unifyAndRestoreRealHerd();

const F = () => {
  if (!DB || typeof DB !== 'object') DB = load();
  const currentId = String(window.farmId || farmId || STORE.getItem('arswine-active-farm') || Object.keys(DB)[0] || 'local-unassigned');
  farmId = currentId;
  window.farmId = currentId;

  ensureFarmBucket(farmId);
  return DB[farmId];
};

window.DB = DB;
window.farmId = farmId;
window.F = F;
window.sanitizeFarm = sanitizeFarm;

function dueThisWeek(f) {
  if (!f || !Array.isArray(f.sows)) return [];
  const now = d(TODAY);
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return (f.sows || []).filter(x => {
    if (!x || !x.insemination || x.farrowingDate || x.lactationStart || x.culled) return false;
    const due = d(x.insemination);
    due.setDate(due.getDate() + 114);
    const dGest = days(x.insemination);
    return (due >= start && due <= end) || dGest >= 114;
  });
}
window.dueThisWeek = dueThisWeek;

function watchlistSows(f) {
  if (!f || !Array.isArray(f.sows)) return [];
  const nearDueOrOverdue = (f.sows || []).filter(x => {
    if (!x || x.culled || x.culledAt || String(x.status || '').toUpperCase() === 'CULLED') return false;
    if (!x.insemination || x.farrowingDate || x.lactationStart || x.weanedAt || x.lactationEndedAt) return false;
    const st = typeof status === 'function' ? status(x) : 'Pregnant';
    const gestationDays = days(x.insemination);
    // Day 110–114 is near due; anything beyond 114 is overdue.
    return (st === 'Pregnant' || (!x.farrowingDate && !x.lactationStart)) && gestationDays >= 110;
  });
  // Highest gestation first: overdue sows appear before those merely near due.
  return nearDueOrOverdue.sort((a, b) => days(b.insemination) - days(a.insemination));
}
window.watchlistSows = watchlistSows;

function togglePregnantWatchlist() {
  const panel = document.getElementById('pregnantWatchlistPanel');
  const button = document.getElementById('pregnantWatchlistToggle');
  if (!panel || !button) return;
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  button.textContent = willOpen ? '▲ Collapse' : '▼ Expand';
  button.setAttribute('aria-expanded', String(willOpen));
}
window.togglePregnantWatchlist = togglePregnantWatchlist;

const isActiveSow = x => !x.culled && !x.culledAt && String(x.status || '').toUpperCase() !== 'CULLED';

function save() {
  const activeId = String(window.farmId || farmId || '');
  const currentFarm = activeId && DB[activeId] ? F() : null;
  if (currentFarm && window.ARSCloud && typeof ARSCloud.markLocalChanges === 'function') {
    const previous = window.__arsLastSavedFarmById && window.__arsLastSavedFarmById[activeId];
    window.__arsPendingUnverifiedSave = !(previous && window.arsContextReady && window.__arsCloudBaselineReady);
    // The production-control layer receives the last saved baseline before it
    // is replaced. It only appends audit/event records; it never overwrites or
    // deletes legacy production records. Run it before dirty-row detection so
    // the new audit/event rows are synchronized with the same save operation.
    if (typeof window.ARSProductionOnSave === 'function') {
      try { window.ARSProductionOnSave(activeId, previous, currentFarm); } catch (error) { console.warn('[ARSProduction] audit capture skipped:', error); }
    }
    if (previous && window.arsContextReady) ARSCloud.markLocalChanges(activeId, previous, currentFarm);
    window.__arsLastSavedFarmById = window.__arsLastSavedFarmById || {};
    window.__arsLastSavedFarmById[activeId] = JSON.parse(JSON.stringify(currentFarm));
  }
  try {
    STORE.setItem('arswine-db-v1', JSON.stringify(DB));
  } catch (quotaErr) {
    console.warn('[ARS] localStorage quota exceeded on save:', quotaErr);
    window.arsQuotaRecovery && window.arsQuotaRecovery();
  }
  deviceWrite(DB);
  // cloud-sync.js schedules a dirty-record push after save(). It is blocked
  // until a verified farm context and cloud baseline are ready.
  if (window.scheduleAutoPush) window.scheduleAutoPush(750);
}

function status(s) {
  if (!s || typeof s !== 'object') return 'Open';
  if (s.culled || s.status === 'CULLED' || s.status === 'Culled') return 'Culled';
  if (s.status === 'Reheat' || s.reheatDate || s.lifecycle === 'Reheat') return 'Reheat';
  if (s.status === 'Heat' || s.lifecycle === 'Heat') return 'Heat';
  if (s.lastHeatDate && (!s.insemination || days(s.lastHeatDate) <= days(s.insemination))) return 'Heat';
  if (s.status === 'Open' && s.lifecycle === 'Weaned') return 'Open';

  let linked = (F().piglets || []).filter(b => b && (b.dam_id === s.id || b.sow_id === s.id || b.sow === s.name || b.dam === s.name)),
    hasWeaned = linked.some(b => b.weanedAt || b.weaning_date || b.status === 'Weaned' || b.weaning),
    activeLitter = linked.some(b => !b.weanedAt && !b.weaning_date && b.status !== 'Weaned' && !b.weaning && !b.archived);

  if ((s.lactationEndedAt || s.weanedAt || (!activeLitter && hasWeaned)) && !s.insemination) return 'Open';

  let lactationDate = s.farrowingDate || s.lactationStart;
  if (lactationDate && !s.weanedAt && !s.lactationEndedAt && (activeLitter || !hasWeaned)) {
    return 'Lactating';
  }

  if (!s.insemination) return 'Open';
  let n = days(s.insemination);
  if (n >= 0) return n >= 33 ? 'Pregnant' : 'Inseminated';
  return 'Open';
}

function sowClass(s) {
  let st = status(s);
  return st === 'Pregnant' ? '' : st === 'Lactating' ? 'warn' : 'dark'
}

function fmtDate(v) {
  if (!v) return '—';
  try {
    const s = String(v).trim();
    if (!s || s === 'null' || s === 'undefined' || s === '—') return '—';
    const dateObj = s.includes('T') ? new Date(s) : new Date(s + 'T00:00:00');
    if (isNaN(dateObj.getTime())) return s;
    return dateObj.toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (e) {
    return String(v || '—');
  }
}

function permittedFarmIds() {
  if (!window.arsContextReady || !DB || typeof DB !== 'object') return [];
  if (typeof isSuperAdmin === 'function' && isSuperAdmin()) {
    const serverIds = (window.arsServerFarms || []).map(f => String(f.id || '')).filter(Boolean);
    return serverIds.length ? serverIds : Object.keys(DB);
  }
  return (window.arsMemberships || [])
    .filter(m => m && m.is_active !== false && m.farm_id)
    .map(m => String(m.farm_id));
}

function setFarmSelect() {
  const sel = document.getElementById('farmSelect');
  if (!sel) return;
  const allowed = permittedFarmIds();
  sel.innerHTML = allowed.map(id => `<option value="${esc(id)}">${esc(DB[id]?.name || 'RM\'s Hog Farm')}</option>`).join('');
  sel.disabled = allowed.length === 0;
  if (allowed.length && !allowed.includes(String(farmId))) {
    const preferred = window.arsActiveMembership?.farm_id;
    farmId = allowed.includes(String(preferred)) ? String(preferred) : allowed[0];
    window.farmId = farmId;
    STORE.setItem('arswine-active-farm', farmId);
  }
  sel.value = farmId || '';
  const lbl = document.getElementById('farmLabel');
  if (lbl && DB[farmId]) lbl.textContent = DB[farmId].name + ' · SECURE WORKSPACE';
}

async function switchFarm(id) {
  if (!permittedFarmIds().includes(String(id))) {
    toast('Access denied: this farm is not assigned to your account.');
    setFarmSelect();
    return;
  }
  const ok = await activateFarmContext(String(id));
  if (ok) toast('Switched secure farm workspace');
}

/* [REBUILD] Removed the original first dashboard() definition; it was dead code —
   a later declaration overrides it (function hoisting: last definition wins). */

function financeSummary(short = false) {
  const summary = window.ARSFinance && typeof ARSFinance.summary === 'function'
    ? ARSFinance.summary(F())
    : { grossSales: 0, collected: 0, receivables: 0, operatingExpenses: 0, netProfit: 0 };
  return `<div class="summary-row"><span>Gross sales</span><b>${peso(summary.grossSales)}</b></div>${!short?`<div class="summary-row"><span>Actual cash collected</span><b>${peso(summary.collected)}</b></div><div class="summary-row"><span>Outstanding receivables</span><b>${peso(summary.receivables)}</b></div>`:''}<div class="summary-row"><span>Total operating expenses</span><b>${peso(summary.operatingExpenses)}</b></div><div class="summary-row"><b>Net operating profit</b><strong class="net">${peso(summary.netProfit)}</strong></div>`
}
const configs = {
  sows: {
    title: 'Sow Management',
    key: 'sows',
    add: 'Add sow',
    fields: [
      ['id', 'Sow ID', 'text'],
      ['name', 'Sow Name', 'text'],
      /* [FIX 116] physical ear tag — shown in the Pedigree & Lineage Report */
      ['ear_tag', 'Ear Tag (optional)', 'text'],
      ['sire', 'Sire', 'text'],
      ['dam', 'Dam', 'text'],
      ['breed', 'Breed', 'select:Large White,Landrace,Duroc,Yorkshire,Crossbred,Custom / Other Breed'],
      ['customBreed', 'Specific / custom breed', 'text'],
      ['dob', 'Date of Birth', 'date'],
      ['parity', 'Parity', 'number'],
      ['insemination', 'Insemination Date', 'date'],
      ['vaccine', 'Vaccine', 'text'],
      ['vaccineDate', 'Vaccine Date', 'date'],
      /* [REBUILD FIX 102] concise acquisition record for bought sows/gilts */
      ['source_farm', 'Source farm / supplier (optional)', 'text'],
      ['purchase_price', 'Purchase price ₱ (optional)', 'number'],
      ['purchase_date', 'Purchase date (optional)', 'date'],
      ['notes', 'Notes', 'textarea']
    ]
  },
  piglets: {
    title: 'Piglet Batches',
    key: 'piglets',
    add: 'Add batch',
    fields: [
      ['id', 'Batch ID', 'text'],
      ['sow', 'Sow', 'text'],
      ['sire', 'Sire', 'text'],
      ['semen', 'Semen', 'text'],
      ['birth', 'Birth Date', 'date'],
      ['males', 'Number of Males', 'number'],
      ['females', 'Number of Females', 'number'],
      ['notes', 'Notes', 'textarea']
    ]
  },
  feed: {
    title: 'Feed Inventory',
    key: 'feed',
    add: 'Add feed stock',
    fields: [
      ['type', 'Feed Type', 'select:Pre Starter,Starter,Grower,Finisher,Booster,Gestating,Lactating'],
      ['bags', 'Bags', 'number'],
      ['price', 'Price Per Bag', 'number']
    ]
  },
  semen: {
    title: 'Boar Semen Inventory',
    key: 'semen',
    add: 'Add semen collection',
    fields: [
      ['boar', 'Boar Name', 'text'],
      ['breed', 'Breed', 'text'],
      ['collection', 'Collection Date', 'date'],
      ['expiration', 'Expiration Date', 'date'],
      ['bottles', 'Bottles Available', 'number']
    ]
  },
  reminders: {
    title: 'Reminders',
    key: 'reminders',
    add: 'Add reminder',
    fields: [
      ['title', 'Reminder title', 'text'],
      ['type', 'Type', 'select:One Time,Daily,Weekly,Monthly,Interval'],
      ['schedule', 'Schedule', 'text']
    ]
  },
  financials: {
    title: 'Financial Management',
    key: 'transactions',
    add: 'Record transaction',
    fields: [
      ['date', 'Date', 'date'],
      ['type', 'Transaction Type', 'select:Income,Expense'],
      ['category', 'Category', 'text'],
      ['description', 'Description', 'text'],
      ['amount', 'Amount (₱)', 'number'],
      ['paid', 'Cash Collected / Paid (₱)', 'number']
    ]
  },
  pos: {
    title: 'POS Sales',
    key: 'sales',
    add: 'New sale',
    fields: [
      ['date', 'Sale Date', 'date'],
      ['product', 'Product', 'text'],
      ['qty', 'Quantity', 'number'],
      ['total', 'Total (₱)', 'number'],
      ['paid', 'Payment received (₱)', 'number']
    ]
  }
};
window.configs = configs;

function batchDeleteRecordId(kind, item, index) {
  const type = kind === 'sows' ? 'sow' : kind === 'piglets' ? 'piglet_batch' : kind === 'semen' ? 'semen_inventory' : 'transaction';
  const raw = item && (item._ars_cloud_local_id || item.id || item.no || item.tag || item.code || item.name);
  return String(raw || `${type}-${index}`);
}

function batchDeleteRowAttrs(kind, item, index) {
  if (!['sows', 'piglets', 'semen', 'financials'].includes(kind)) return '';
  const entity = kind === 'sows' ? 'sow' : kind === 'piglets' ? 'piglet_batch' : kind === 'semen' ? 'semen_inventory' : 'transaction';
  return ` data-batch-delete-row data-batch-delete-entity="${esc(entity)}" data-batch-delete-key="${esc(batchDeleteRecordId(kind, item, index))}"`;
}

function crudPage(k) {
  let c = configs[k],
    f = F(),
    data = f[c.key];
  let extra = '';
  if (k === 'feed') {
    let val = data.reduce((a, x) => a + x.bags * x.price, 0);
    /* [REBUILD FEATURE] Feeding Guide Program panel (js/feeding-guide.js). */
    extra = `<div class="notice"><b>${peso(val)}</b> total inventory value · ${data.reduce((a,x)=>a+ +x.bags,0)} bags on hand${/* [REBUILD FIX 52] feed ordering tracker entry */''}${window.feedOrdersPageBtn ? feedOrdersPageBtn() : ''}</div>` + (window.feedGuidePanel ? window.feedGuidePanel() : '')
  }
  /* [REBUILD FIX 54] POS page opens with the semen-collectibles rollup
     (per-branch balances + Receipt / 💰 Payment actions) */
  if (k === 'pos') extra = (window.posCollectiblesPanel ? posCollectiblesPanel() : '');
  if (k === 'financials') {
    const fin = window.ARSFinance && typeof ARSFinance.summary === 'function'
      ? ARSFinance.summary(f)
      : { grossSales: 0, receivables: 0, netProfit: 0 };
    extra = `<div class="metric-grid" style="margin-bottom:16px"><div class="panel metric"><span class="muted">Gross Sales</span><b>${peso(fin.grossSales)}</b></div><div class="panel metric"><span class="muted">Receivables</span><b>${peso(fin.receivables)}</b></div><div class="panel metric"><span class="muted">Net Operating Profit</span><b style="color:var(--ok)">${peso(fin.netProfit)}</b></div></div>`;
  }
  let headers, rows;
  if (k === 'sows') {
    headers = ['Sow', 'Breed', 'Parity', 'Insemination', 'Status'];
    rows = data.map((x, i) => [`<b>${x.name}</b><br><small class="muted">${x.id}</small>`, x.breed || '—', x.parity ?? 'N/A', fmtDate(x.insemination), `<span class="tag ${sowClass(x)}">${status(x)}</span>`, i])
  } else if (k === 'piglets') {
    headers = ['Batch', 'Parents', 'Born', 'Total Born', 'Care status'];
    rows = data.map((x, i) => [`<b>${x.id}</b>`, `${x.sow} × ${x.sire}`, fmtDate(x.birth), `${(+x.males||0)+(+x.females||0)} (${x.males}M/${x.females}F)`, `${x.iron?'✓ Iron':'Iron'} · ${x.castration?'✓ Castration':'Castration'} · ${x.weaning?'✓ Weaned':'Weaning'}`, i])
  } else if (k === 'feed') {
    headers = ['Feed Type', 'Bags', 'Price / bag', 'Inventory value'];
    rows = data.map((x, i) => [`<b>${x.type}</b>`, x.bags, peso(x.price), `<b>${peso(x.bags*x.price)}</b>`, i])
  } else if (k === 'semen') {
    headers = ['Boar', 'Breed', 'Collected', 'Expires', 'Bottles'];
    rows = data.map((x, i) => [`<b>${x.boar}</b>`, x.breed, fmtDate(x.collection), `<span class="${days(TODAY,x.expiration)<=7?'tag warn':''}">${fmtDate(x.expiration)}</span>`, x.bottles, i])
  } else if (k === 'financials') {
    headers = ['Date', 'Type', 'Category', 'Description', 'Amount', 'Collected'];
    rows = data.map((x, i) => [fmtDate(x.date), `<span class="tag ${['voided','deleted','undone'].includes(String(x.status || '').toLowerCase()) ? 'warn' : (x.type==='Expense'?'dark':'')}">${['voided','deleted','undone'].includes(String(x.status || '').toLowerCase()) ? String(x.status).toUpperCase() : x.type}</span>`, x.category, x.description, peso(x.amount), peso(x.paid), i])
  } else if (k === 'pos') {
    headers = ['Date', 'Product', 'Qty', 'Total', 'Paid', 'Status'];
    rows = data.map((x, i) => [fmtDate(x.date), x.product, x.qty, peso(x.total), peso(x.paid), `<span class="tag ${x.is_returned?'dark':''}">${x.is_returned?'RETURNED':'Completed'}</span>`, i])
  } else {
    headers = ['Reminder', 'Type', 'Schedule', 'Action'];
    rows = data.map((x, i) => [`<b>${x.title}</b>`, `<span class="tag">${x.type}</span>`, x.schedule, `<button class="btn ghost" onclick="dismiss(${i})">GOT IT · DISMISS</button>`, i])
  }
  document.getElementById(k).innerHTML = `${extra}<div class="toolbar"><div class="toolbar-left"><input class="search" placeholder="Search ${c.title.toLowerCase()}" oninput="filterTable('${k}',this.value)"></div><button class="btn" onclick="openModal('${k}')">+ ${c.add}</button></div><div class="panel table-wrap"><table class="table" id="table-${k}"><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map(r=>{const rowIndex=r.at(-1);return `<tr${batchDeleteRowAttrs(k,data[rowIndex],rowIndex)}>${r.slice(0,-1).map(x=>`<td>${x}</td>`).join('')}<td class="right">${k==='sows'?`<button class="btn ghost" onclick="openSowProfile(${rowIndex})">Profile</button> `:''}<button class="btn ghost" onclick="editRecord('${k}',${rowIndex})">Edit</button> <button class="btn ghost delete-action" onclick="deleteRecord('${k}',${rowIndex})">Delete</button>${k==='pos'?` <button class="btn ghost" onclick="toggleReturn(${rowIndex})">Return</button>`:''}</td></tr>`}).join('')||`<tr><td colspan="9" class="empty">No records in this farm yet.</td></tr>`}</tbody></table></div>`
}

/* [FIX FEED PREDICTOR] Stage & departure-aware feed forecast.
   The old engine counted every batch's heads through age 180 no matter what, so
   fatteners that go to market at 160 days (and breeders released at 90 days)
   kept "eating" for up to 20 extra days inside the chosen horizon — Grower and
   Finisher bags were over-stated once those pigs had already left the farm.
   Now each batch is split into living pools (fattener / breeder / farm-use /
   unassigned) via the authoritative count engine, and each pool stops consuming
   when its scheduled departure day is reached:
     • fattener heads leave at 160 days of age (market, matches production());
     • breeder heads leave at 90 days of age (release, matches production());
     • farm-use & unassigned have no scheduled departure (finisher window caps
       the very old at 180 days as before).
   Grower bags are therefore only computed for days a head is actually alive AND
   inside the day 71-120 grower stage. */
function feedPoolsForBatch(b) {
  if (window.getPigletCounts && typeof window.getPigletCounts === 'function') {
    try {
      const c = window.getPigletCounts(b);
      if (c && typeof c === 'object') {
        return {
          fattener: Math.max(0, +c.fattener || 0),
          breeder: Math.max(0, +c.breeder || 0),
          farm: Math.max(0, +c.farm || 0),
          unassigned: Math.max(0, +c.availableAll || 0)
        };
      }
    } catch (_) { /* fall through to legacy estimate */ }
  }
  const ledger = (F().pigletLedger || []).filter(x => String(x.batch_id) === String(b.id) && !['undone', 'deleted', 'voided'].includes(String(x.status || '').toLowerCase()));
  const sum = t => ledger.filter(x => x.type === t).reduce((a, x) => a + (+x.quantity || 0), 0);
  const born = (+b.males || 0) + (+b.females || 0);
  return { fattener: 0, breeder: 0, farm: 0, unassigned: Math.max(0, born - sum('mortality') - sum('sold')) };
}
function feedStageForAge(age) {
  if (age <= 30) return 'Pre Starter';
  if (age <= 70) return 'Starter';
  if (age <= 120) return 'Grower';
  return 'Finisher';
}

/* [FIX PREDICTOR CONSISTENCY] The Feed Predictor and the Feeding Guide must be
   the SAME engine, otherwise the same 30-day window shows 116 bags in one place
   and 11 bags in the other.
   • When the feeding guide IS configured, feedForecast() delegates to
     computeFeedPlan(period): per-batch planned bags/head per stage + the
     manager's "consumed bags" tracking + sow/boar ration splits. A batch that
     has already eaten most of its Grower allocation (e.g. ~100-day-old pigs
     with 90% of their grower plan consumed) only shows the REMAINING grower
     bags — exactly what the Feeding Guide reports.
   • When it is NOT configured, the standard age-based engine (fixed kg/head/day
     by age, market day 160 / breeder release day 90 / 180-day cap) is used as a
     sensible default, also converted to bags.
   Both paths return totals in BAGS plus totalsKg so the UI is consistent. */
  function bagKgOfType(t) {
    const o = (F().feedPlan && F().feedPlan.bagKg) || {};
    const key = Object.keys(o).find(k => k.toLowerCase() === String(t).toLowerCase());
    if (key && +o[key]) return +o[key];
    return String(t).toLowerCase() === 'pre starter' ? 25 : 50;
  }
  window.bagKgOfType = bagKgOfType;

  function emptyFeedTotals() {
    return { 'Pre Starter': 0, 'Starter': 0, 'Grower': 0, 'Finisher': 0, 'Gestating': 0, 'Lactating': 0 };
  }
  function emptyGroups() {
    return {
      'Pre Starter': { heads: 0, batches: [] },
      'Starter': { heads: 0, batches: [] },
      'Grower': { heads: 0, batches: [] },
      'Finisher': { heads: 0, batches: [] },
      'Gestating': { heads: 0, sows: 0, boars: 0 },
      'Lactating': { heads: 0, sows: 0 }
    };
  }

function feedForecast(period = 30) {
  const f = F();
  const todayStr = (typeof TODAY !== 'undefined' ? TODAY : new Date().toISOString().slice(0, 10));
  const planConfigured = Boolean(f.feedPlan && f.feedPlan.configured);
  const totals = emptyFeedTotals();   // BAGS
  const totalsKg = emptyFeedTotals(); // KG
  const consumingGroups = emptyGroups();

  const activeBatches = (f.piglets || []).filter(b => !b.archived && !b.deleted_at);
  const activeSows = (f.sows || []).filter(isActiveSow);
  const activeBoars = (f.boars || []).filter(b => String(b.status || 'Active') === 'Active');

  /* ══ PATH 1 (configured): identical engine to the Feeding Guide ═══════ */
  if (planConfigured && window.computeFeedPlan && typeof window.computeFeedPlan === 'function') {
    const c = window.computeFeedPlan(String(period));
    Object.entries(c.req || {}).forEach(([t, r]) => {
      const bags = +(r.req || 0);
      totals[t] = bags;
      totalsKg[t] = bags * bagKgOfType(t);
    });
    (c.batchSec || []).forEach(x => {
      const label = x.stage;
      if (!label || x.heads <= 0 || x.done) return;
      if (!consumingGroups[label]) consumingGroups[label] = { heads: 0, batches: [] };
      consumingGroups[label].heads += x.heads;
      consumingGroups[label].batches.push({ id: x.id, age: x.age, heads: x.heads, breed: x.dam || '', req: x.req, stage: label, ageDerived: x.ageDerived });
    });
    if (c.sowSec) {
      consumingGroups['Gestating'].sows = c.sowSec.gestNow || 0;
      consumingGroups['Lactating'].sows = c.sowSec.lactNow || 0;
      consumingGroups['Gestating'].heads += c.sowSec.gestNow || 0;
      consumingGroups['Lactating'].heads += c.sowSec.lactNow || 0;
    }
    if (c.boarSec && c.boarSec.active) {
      const bt = c.boarSec.type || 'Gestating';
      if (!consumingGroups[bt]) consumingGroups[bt] = { heads: 0, batches: [] };
      consumingGroups[bt].boars = (consumingGroups[bt].boars || 0) + c.boarSec.active;
      consumingGroups[bt].heads += c.boarSec.active;
      if (bt !== 'Gestating') consumingGroups['Gestating'].boars = 0; // boars on their own ration
    }
    return { totals, totalsKg, consumingGroups, activeBatches, activeSows, activeBoars, engine: 'guide', guide: c };
  }

  /* ══ PATH 2 (not configured): age-based standard-rate simulation ══════ */
  const p = {
    sowGestKg: (f.feedPlan && f.feedPlan.sowGestKg) || 2.5,
    sowLactKg: (f.feedPlan && f.feedPlan.sowLactKg) || 3.5,
    boarKg: (f.feedPlan && f.feedPlan.boarKg) || 2.0,
    boarFeedType: (f.feedPlan && f.feedPlan.boarFeedType) || 'Gestating'
  };
  const DEPART_AGE = { fattener: 160, breeder: 90 }; /* market / breeder release (birth + N days) */
  const MAX_AGE = 180;
  const RATES = { 'Pre Starter': 0.35, 'Starter': 1.10, 'Grower': 2.10, 'Finisher': 2.75 };

  // Today's population by age stage (pool-aware, sold already removed)
  activeBatches.forEach(b => {
    const age = days(b.birth);
    const pools = feedPoolsForBatch(b);
    const batchHeads = Object.values(pools).reduce((a, h) => a + h, 0);
    if (batchHeads <= 0) return;
    const stage = feedStageForAge(age);
    consumingGroups[stage].heads += batchHeads;
    consumingGroups[stage].batches.push({ id: b.id, age, heads: batchHeads, breed: b.breed, pools });
  });
  activeSows.forEach(s => {
    const st = status(s);
    if (st === 'Lactating' || (s.insemination && days(s.insemination) >= 110)) {
      consumingGroups['Lactating'].sows++;
      consumingGroups['Lactating'].heads++;
    } else {
      consumingGroups['Gestating'].sows++;
      consumingGroups['Gestating'].heads++;
    }
  });
  consumingGroups['Gestating'].boars += activeBoars.length;
  consumingGroups['Gestating'].heads += activeBoars.length;

  const kgTotals = emptyFeedTotals();
  for (let dayOffset = 0; dayOffset < period; dayOffset++) {
    // 1. Batches day-by-day, pool by pool; fattener leaves at 160, breeder at 90
    activeBatches.forEach(b => {
      const simAge = days(b.birth) + dayOffset;
      const pools = feedPoolsForBatch(b);
      Object.entries(pools).forEach(([pool, heads]) => {
        const h = Math.max(0, +heads || 0);
        if (h <= 0) return;
        const depart = DEPART_AGE[pool];
        if (depart && simAge >= depart) return;
        if (!depart && simAge > MAX_AGE) return;
        if (simAge < 5 || simAge > MAX_AGE) return;
        const stage = feedStageForAge(simAge);
        kgTotals[stage] += h * RATES[stage];
      });
    });
    // 2. Sows: gestating → lactating at day 110
    activeSows.forEach(s => {
      const st = status(s);
      if (st === 'Lactating') kgTotals['Lactating'] += (p.sowLactKg || 3.5);
      else if (s.insemination) {
        if (days(s.insemination) + dayOffset >= 110) kgTotals['Lactating'] += (p.sowLactKg || 3.5);
        else kgTotals['Gestating'] += (p.sowGestKg || 2.5);
      } else kgTotals['Gestating'] += (p.sowGestKg || 2.5);
    });
    // 3. Boars
    if (activeBoars.length > 0) kgTotals[p.boarFeedType || 'Gestating'] += activeBoars.length * (p.boarKg || 2.0);
  }
  Object.entries(kgTotals).forEach(([t, kg]) => {
    if (kg > 0) {
      totals[t] = +(kg / bagKgOfType(t)).toFixed(2);
      totalsKg[t] = kg;
    }
  });
  return { totals, totalsKg, consumingGroups, activeBatches, activeSows, activeBoars, engine: 'age' };
}

function predictor(period = 30) {
  const sim = feedForecast(period);
  const t = sim.totals;
  const cGroups = sim.consumingGroups;
  const f = F();

  const totalPigletsHeads = sim.activeBatches.reduce((a, b) => {
    const dead = (f.pigletLedger || []).filter(x => x.batch_id === b.id && x.type === 'mortality' && !['undone', 'deleted'].includes(x.status)).reduce((la, x) => la + (+x.quantity || 0), 0);
    const sold = (f.pigletLedger || []).filter(x => x.batch_id === b.id && x.type === 'sold' && !['undone', 'deleted'].includes(x.status)).reduce((la, x) => la + (+x.quantity || 0), 0);
    return a + Math.max(0, (+b.males || 0) + (+b.females || 0) - dead - sold);
  }, 0);

  const totalHerdAnimals = sim.activeSows.length + sim.activeBoars.length + totalPigletsHeads;

  // Compute feed programs analysis
  const feedPrograms = [
    { type: 'Pre Starter', icon: '🥣', bagKg: 25, defaultPrice: 1350 },
    { type: 'Starter', icon: '🌾', bagKg: 50, defaultPrice: 1850 },
    { type: 'Grower', icon: '🌱', bagKg: 50, defaultPrice: 1650 },
    { type: 'Finisher', icon: '🥩', bagKg: 50, defaultPrice: 1550 },
    { type: 'Gestating', icon: '🐷', bagKg: 50, defaultPrice: 1500 },
    { type: 'Lactating', icon: '🍼', bagKg: 50, defaultPrice: 1750 }
  ];

  let totalRequiredKg = 0;
  let totalRequiredBags = 0;
  let totalProjectedCost = 0;
  let totalShortfallBags = 0;
  let totalShortfallCost = 0;
  let criticalAlertCount = 0;

  const analyzedFeeds = feedPrograms.map(fp => {
    /* [FIX PREDICTOR CONSISTENCY] totals are now BAGS (same engine as the
       Feeding Guide); totalsKg keeps the kg figure for burn-rate labels. */
    const reqBags = +(t[fp.type] || 0);
    const reqKg = +(sim.totalsKg && sim.totalsKg[fp.type] || reqBags * fp.bagKg);
    const stockItem = (f.feed || []).find(x => String(x.type).toLowerCase() === fp.type.toLowerCase());
    const stockBags = stockItem ? +stockItem.bags || 0 : 0;
    const price = stockItem ? +stockItem.price || fp.defaultPrice : fp.defaultPrice;
    const cost = reqBags * price;

    const dailyBurnKg = +(reqKg / period).toFixed(1);
    const dailyBurnBags = +(reqBags / period).toFixed(2);
    const daysOfStock = dailyBurnBags > 0 ? (stockBags / dailyBurnBags) : 999;
    const shortfallBags = Math.max(0, Math.ceil(reqBags - stockBags));
    const shortfallCost = shortfallBags * price;

    totalRequiredKg += reqKg;
    totalRequiredBags += reqBags;
    totalProjectedCost += cost;
    totalShortfallBags += shortfallBags;
    totalShortfallCost += shortfallCost;

    let statusTag = { cls: 'ok', label: `✓ STOCKED FOR ${period}d` };
    if (reqKg > 0) {
      if (stockBags <= 0) {
        statusTag = { cls: 'danger', label: '🚨 OUT OF STOCK' };
        criticalAlertCount++;
      } else if (daysOfStock < 3) {
        statusTag = { cls: 'danger', label: `🚨 CRITICAL (${daysOfStock.toFixed(1)}d LEFT)` };
        criticalAlertCount++;
      } else if (daysOfStock < 7) {
        statusTag = { cls: 'warn', label: `⚠️ REORDER SOON (${daysOfStock.toFixed(0)}d LEFT)` };
        criticalAlertCount++;
      } else if (shortfallBags > 0) {
        statusTag = { cls: 'warn', label: `📦 SHORT ${shortfallBags} BAGS` };
      }
    } else {
      statusTag = { cls: 'ok', label: '— No Active Demand' };
    }

    const cGroup = cGroups[fp.type] || { heads: 0 };
    const stockCoveragePct = reqBags > 0 ? Math.min(100, Math.round((stockBags / reqBags) * 100)) : 100;

    return {
      ...fp,
      reqKg,
      reqBags,
      stockBags,
      price,
      cost,
      dailyBurnKg,
      dailyBurnBags,
      daysOfStock,
      shortfallBags,
      shortfallCost,
      statusTag,
      cGroup,
      stockCoveragePct
    };
  });

  const dailyHerdIntakeKg = +(totalRequiredKg / period).toFixed(1);
  const dailyHerdIntakeBags = +(totalRequiredBags / period).toFixed(1);

  const container = document.getElementById('predictor');
  if (!container) return;

  container.innerHTML = `
    <!-- Top Header Card -->
    <div class="forecast-header-card" style="margin-bottom:14px">
      <div class="forecast-header-top">
        <div>
          <div class="eyebrow" style="color:var(--teal2);font-weight:800">FEED REQUIREMENTS &amp; CONSUMPTION PATTERN PREDICTOR</div>
          <h2 style="margin:2px 0 6px 0;font-size:24px">Feed Predictor &amp; Inventory Demand Forecast</h2>
          <p class="muted" style="margin:0">Real-time consumption simulation based on active herd population, daily burn rates and stage transitions — matched to your Feeding Guide plan (&quot;consumed bags&quot; per batch) when the guide is configured. Stock-out forecasting included.</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${window.feedOrdersPageBtn ? window.feedOrdersPageBtn() : ''}
          <button type="button" class="btn ghost small" onclick="predictor(${period})">⟳ Re-Simulate</button>
        </div>
      </div>

      <!-- Hero KPI Summary Grid -->
      <div class="predictor-hero-grid">
        <div class="predictor-kpi-card">
          <small>Total Projected Demand</small>
          <b>${totalRequiredBags.toFixed(1)} Bags</b>
          <span>${totalRequiredKg.toFixed(1)} kg · ${peso(totalProjectedCost)}</span>
        </div>
        <div class="predictor-kpi-card">
          <small>Daily Herd Consumption</small>
          <b>${dailyHerdIntakeKg} kg / day</b>
          <span>~${dailyHerdIntakeBags} bags consumed daily</span>
        </div>
        <div class="predictor-kpi-card">
          <small>Consuming Population</small>
          <b>${totalHerdAnimals} Animals</b>
          <span>${sim.activeSows.length} Sows · ${sim.activeBoars.length} Boars · ${totalPigletsHeads} Piglets</span>
        </div>
        <div class="predictor-kpi-card" style="${totalShortfallBags > 0 ? 'border-color:rgba(239,68,68,0.5);background:rgba(239,68,68,0.08)' : ''}">
          <small>${totalShortfallBags > 0 ? '⚠️ Stock Shortfall' : 'Inventory Coverage'}</small>
          <b style="${totalShortfallBags > 0 ? 'color:#ef4444' : 'color:var(--teal2)'}">${totalShortfallBags > 0 ? totalShortfallBags + ' Bags Short' : '✓ Fully Covered'}</b>
          <span>${totalShortfallBags > 0 ? 'Order Est: ' + peso(totalShortfallCost) : `Covers next ${period} days`}</span>
        </div>
      </div>
    </div>

    <!-- Timeframe Switcher & Pattern Explanation -->
    <div class="forecast-filter-panel" style="margin-bottom:14px">
      <div class="forecast-filter-row" style="border-bottom:0;padding-bottom:0;margin-bottom:0">
        <span class="forecast-filter-title">Forecast Horizon:</span>
        <div class="forecast-pills" style="flex-wrap:wrap">
          ${[
            [7, '7 Days (This Week)'],
            [15, '15 Days (Bi-Weekly)'],
            [30, '30 Days (Monthly)'],
            [60, '60 Days (2 Months)'],
            [90, '90 Days (Quarterly)']
          ].map(([pDays, label]) => `
            <button type="button" class="period ${pDays === period ? 'active' : ''}" onclick="predictor(${pDays})">${label}</button>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- Pattern Insight Banner -->
    <div class="notice" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px;background:rgba(13,141,145,0.08);border:1px solid rgba(13,141,145,0.3);border-radius:12px;padding:12px 16px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:18px">📊</span>
        <div>
          <b>Real-Time Population &amp; Consumption Pattern Analysis</b>
          <small class="muted" style="display:block">${sim.engine === 'guide'
            ? `Uses the same per-batch stage-plan engine as the Feeding Guide: <b>${sim.activeBatches.length} active litters</b> (${totalPigletsHeads} heads) + <b>${sim.activeSows.length} sows</b> (switching to Lactating feed at Day 110) + <b>${sim.activeBoars.length} boars</b>, with each batch's planned bags/head per stage and your "consumed bags" updates — so Grower demand only counts the grower ration still remaining per batch.`
            : `Standard age-based simulation across <b>${sim.activeBatches.length} active litters</b> (${totalPigletsHeads} heads) + <b>${sim.activeSows.length} sows</b> (switching to Lactating feed at Day 110) + <b>${sim.activeBoars.length} boars</b>. Fattener-assigned heads leave the simulation at <b>market day 160</b> and breeder-assigned heads at <b>release day 90</b>, so bags are never projected for animals already sold within the horizon.`}</small>
        </div>
      </div>
      ${criticalAlertCount > 0 ? `
        <span class="feed-pulse-tag danger">⚠️ ${criticalAlertCount} Feed Program(s) Require Reorder</span>
      ` : `
        <span class="feed-pulse-tag ok">✓ Stock Levels Healthy</span>
      `}
    </div>

    <!-- Feed Program Analysis Cards -->
    <div class="predictor-cards-list">
      ${analyzedFeeds.map(af => {
        if (af.reqKg === 0 && af.stockBags === 0) return '';
        const consumersLabel = af.type === 'Gestating'
          ? `${af.cGroup.sows} sows (${sim.activeSows.filter(s => status(s) !== 'Lactating').length} gestating/open) + ${af.cGroup.boars} boars`
          : af.type === 'Lactating'
          ? `${af.cGroup.sows} lactating &amp; transition sows`
          : `${af.cGroup.heads} piglets across ${af.cGroup.batches?.length || 0} active batch(es)`;

        return `
          <div class="predictor-feed-card ${af.statusTag.cls}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px">
              <div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:18px">${af.icon}</span>
                  <h3 style="margin:0;font-size:17px;color:var(--ink)">${af.type} Feed</h3>
                  <span class="feed-pulse-tag ${af.statusTag.cls}">${af.statusTag.label}</span>
                </div>
                <small class="muted" style="display:block;margin-top:3px">
                  Consuming population: <b>${consumersLabel}</b> · Daily intake: <b>${af.dailyBurnKg} kg/day</b> (~${af.dailyBurnBags} bags/day)
                </small>
              </div>
              <div style="text-align:right">
                <b style="font-size:17px;color:var(--ink)">${af.reqKg.toFixed(1)} kg</b>
                <small class="muted" style="display:block">${af.reqBags} bags · ${peso(af.cost)}</small>
              </div>
            </div>

            <!-- Stock vs Demand Visual Coverage Bar -->
            <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:10px 12px;margin:8px 0">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">
                <span>Current Stock on Hand: <b style="color:var(--ink)">${af.stockBags} bags</b> (${(af.stockBags * af.bagKg)} kg)</span>
                <span>${af.daysOfStock < 999 ? `Stock Coverage: <b style="color:${af.daysOfStock < 7 ? '#f87171' : 'var(--teal2)'}">~${af.daysOfStock.toFixed(1)} days</b>` : 'No active burn'}</span>
              </div>
              <div style="height:8px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;position:relative">
                <div style="height:100%;background:${af.stockBags >= af.reqBags ? 'var(--teal2)' : (af.stockBags > 0 ? '#f59e0b' : '#ef4444')};width:${af.stockCoveragePct}%;border-radius:999px"></div>
              </div>
            </div>

            <!-- Bottom Action & Shortfall Order Row -->
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:10px">
              <div>
                ${af.shortfallBags > 0 ? `
                  <span style="color:#ef4444;font-weight:750;font-size:12.5px">⚠️ Projected Shortfall: <b>${af.shortfallBags} bags</b> (${peso(af.shortfallCost)} estimated cost)</span>
                ` : `
                  <span style="color:var(--teal2);font-weight:600;font-size:12.5px">✓ Current inventory covers this ${period}-day simulation window.</span>
                `}
              </div>
              <div style="display:flex;gap:6px">
                ${window.openOrderForm ? `
                  <button type="button" class="btn small" style="background:${af.shortfallBags > 0 ? '#0ea5e9' : 'rgba(13,141,145,0.2)'};color:#fff" onclick="openOrderForm(null, '${esc(af.type)}', ${af.shortfallBags || 10})">
                    📦 Order ${af.type} (${af.shortfallBags > 0 ? af.shortfallBags + ' bags' : '+ Restock'})
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PRODUCTION & BREEDER OFFTAKE FORECAST HUB
   Interactive timelines, smart timeframe & breed filters, customer reservations
   and direct phone / Facebook Messenger outreach.
   ═══════════════════════════════════════════════════════════════════════════ */
window.forecastFilterState = window.forecastFilterState || {
  timeframe: '30',
  category: 'all',
  breed: 'all',
  searchQuery: '',
  monthPicker: ''
};

window.setForecastTimeframe = function(tf) {
  window.forecastFilterState.timeframe = tf;
  window.forecastFilterState.monthPicker = '';
  production();
};

window.setForecastCategory = function(cat) {
  window.forecastFilterState.category = cat;
  production();
};

window.setForecastBreed = function(br) {
  window.forecastFilterState.breed = br;
  production();
};

window.setForecastMonth = function(m) {
  if (m) {
    window.forecastFilterState.timeframe = 'month:' + m;
    window.forecastFilterState.monthPicker = m;
  } else {
    window.forecastFilterState.timeframe = '30';
    window.forecastFilterState.monthPicker = '';
  }
  production();
};

let __arsForecastSearchTimer = null;
window.setForecastSearch = function(q) {
  window.forecastFilterState.searchQuery = q || '';
  /* [REBUILD FIX 88] re-rendering on EVERY keystroke rebuilt the search input
     itself, dropping focus — users could only type one letter at a time.
     Debounce the re-render and restore focus + caret afterwards. */
  clearTimeout(__arsForecastSearchTimer);
  __arsForecastSearchTimer = setTimeout(() => {
    production();
    const el = document.querySelector('#production input[type="search"]');
    if (el) {
      el.focus({ preventScroll: true });
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch (_) {}
    }
  }, 180);
};

function production(periodOverride) {
  if (periodOverride && typeof periodOverride === 'number') {
    window.forecastFilterState.timeframe = String(periodOverride);
  }

  const f = F();
  const st = window.forecastFilterState;
  const todayStr = (typeof TODAY !== 'undefined' ? TODAY : new Date().toISOString().slice(0, 10));

  // Helper date calculators
  const dueDateCalc = s => {
    if (!s.insemination) return null;
    const z = new Date(s.insemination + (s.insemination.includes('T') ? '' : 'T00:00:00'));
    z.setDate(z.getDate() + 114);
    return z.toISOString().slice(0, 10);
  };

  const daysDiff = targetDate => {
    if (!targetDate) return 9999;
    const d1 = new Date(todayStr + 'T00:00:00');
    const d2 = new Date(targetDate + (targetDate.includes('T') ? '' : 'T00:00:00'));
    return Math.round((d2 - d1) / 864e5);
  };

  const addDaysToDate = (baseDateStr, daysCount) => {
    if (!baseDateStr) return '';
    const d = new Date(baseDateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + (+daysCount || 0));
    return d.toISOString().slice(0, 10);
  };

  const rawEvents = [];

  // 1. 🐷 Expected Farrowing Events
  (f.sows || []).forEach((s, idx) => {
    if (s.culled || s.status === 'CULLED' || !s.insemination || s.farrowingDate || s.lactationStart) return;
    const fDate = dueDateCalc(s);
    if (!fDate) return;
    const diff = daysDiff(fDate);
    const gestDay = Math.max(0, Math.round((new Date(todayStr + 'T00:00:00') - new Date(s.insemination + 'T00:00:00')) / 864e5));

    rawEvents.push({
      type: 'farrowing',
      id: s.id || s.name,
      title: s.name || s.id || `Sow #${idx + 1}`,
      breed: s.breed || 'Commercial Crossbred',
      date: fDate,
      daysDiff: diff,
      gestDay,
      parity: s.parity || 0,
      sire: s.sire || s.lastSemenBoarName || 'AI Service Boar',
      dam: s.dam || '—',
      estimatedHeads: 10,
      sowIndex: idx,
      sow: s,
      note: diff < 0 ? `Overdue by ${Math.abs(diff)} days!` : (diff === 0 ? 'Farrowing Expected Today!' : `Due in ${diff} days · Prepare farrowing pen`)
    });
  });

  // 2. 🍼 Scheduled Weaning Events
  (f.piglets || []).forEach(b => {
    if (b.archived || b.weaning || !b.birth) return;
    /* [FIX H1] weaning is exactly birth + 28 days — isoOff(days(birth)+28) added
       the batch's current age twice, pushing the event ~2×age days into the future. */
    const weanDate = addDaysToDate(b.birth, 28);
    const diff = daysDiff(weanDate);
    const ageDays = Math.max(0, days(b.birth));
    const liveHeads = (Number(b.males || 0) + Number(b.females || 0));

    if (liveHeads > 0) {
      rawEvents.push({
        type: 'weaning',
        id: b.id,
        title: `Batch ${b.id}`,
        breed: b.breed || 'Crossbred',
        date: weanDate,
        daysDiff: diff,
        ageDays,
        heads: liveHeads,
        males: b.males || 0,
        females: b.females || 0,
        sow: b.dam_name || b.sow || '—',
        sire: b.sire_name || b.sire || '—',
        batch: b,
        note: diff <= 0 ? 'Ready to Wean Now · Move to Nursery' : `Weaning in ${diff} days (${ageDays}d old)`
      });
    }
  });

  // 3. ⭐ Breeder Stock Release / Offtake Events (Exclusively "Breeder" & 90+ Day Minimum Age)
  (f.piglets || []).forEach(b => {
    if (b.archived || !b.birth) return;
    const ledger = f.pigletLedger || [];
    const breederEntries = ledger.filter(x => x.batch_id === b.id && x.type === 'breeder' && !['undone', 'deleted'].includes(x.status));
    const breederM = breederEntries.filter(x => x.gender === 'male').reduce((a, x) => a + (+x.quantity || 0), 0);
    const breederF = breederEntries.filter(x => x.gender === 'female').reduce((a, x) => a + (+x.quantity || 0), 0);
    const breederHeads = breederM + breederF;

    // Strictly include only batches that have piglets assigned exclusively to "Breeder"
    if (breederHeads <= 0) return;

    const bRes = (f.reservations || []).filter(r => (r.batch_id === b.id || (Array.isArray(r.lines) && r.lines.some(l => l.batch_id === b.id))) && r.status !== 'Cancelled');
    const ageDays = Math.max(0, days(b.birth));

    // Target release date is strictly 90 days (3 months) from birth
    const target90Date = addDaysToDate(b.birth, 90);
    const releaseDate = (b.release_date && b.release_date >= target90Date) ? b.release_date : target90Date;
    const diff = daysDiff(releaseDate);
    const daysToRelease = Math.max(0, 90 - ageDays);
    const isReady = ageDays >= 90;

    rawEvents.push({
      type: 'breeder',
      id: b.id,
      title: `Batch ${b.id} (Breeder Offtake)`,
      breed: b.breed || 'F1 Breeder Stock',
      date: releaseDate,
      daysDiff: diff,
      ageDays,
      daysToRelease,
      isReady,
      heads: breederHeads,
      males: breederM,
      females: breederF,
      sow: b.dam_name || b.sow || '—',
      sire: b.sire_name || b.sire || '—',
      reservations: bRes,
      batch: b,
      note: isReady ? `⭐ Ready for Customer Release (${ageDays}d old · 3+ months mature)` : `⏳ Release in ${daysToRelease} days (${ageDays}/90d old · Target: ${fmtDate(releaseDate)})`
    });
  });

  // 4. 📈 Fattener Market Readiness Events
  (f.piglets || []).forEach(b => {
    if (b.archived || !b.birth) return;
    /* [FIX FATTENER LIVE COUNTS] market events use the LIVING fattener pool
       (assigned minus deaths/sales), not the gross allocation — a batch with
       dead pigs must not show those heads as still eating toward market. */
    let fattenerHeads = 0;
    try {
      fattenerHeads = window.getPigletCounts ? Math.max(0, +window.getPigletCounts(b).fattener || 0) : 0;
    } catch (_) {}
    if (!fattenerHeads) {
      const ledger = f.pigletLedger || [];
      fattenerHeads = ledger.filter(x => x.batch_id === b.id && x.type === 'fattener' && !['undone', 'deleted'].includes(x.status)).reduce((a, x) => a + (+x.quantity || 0), 0);
    }
    const ageDays = Math.max(0, days(b.birth));

    if (fattenerHeads > 0) {
      /* [FIX H1] market target is exactly birth + 160 days (the feed predictor
         and release flows use the same 160d convention). */
      const mktDate = addDaysToDate(b.birth, 160);
      const diff = daysDiff(mktDate);

      rawEvents.push({
        type: 'fattener',
        id: b.id,
        title: `Batch ${b.id} (Grow-Finish)`,
        breed: b.breed || 'Commercial Meat Hog',
        date: mktDate,
        daysDiff: diff,
        ageDays,
        heads: fattenerHeads,
        sow: b.dam_name || b.sow || '—',
        sire: b.sire_name || b.sire || '—',
        batch: b,
        note: diff <= 0 ? '📈 Market Harvest Ready (90–110 kg)' : `Market Target in ${diff} days (~${ageDays}d old)`
      });
    }
  });

  // Unique breeds for smart filtering
  const farmBreeds = Array.from(new Set([
    'All Breeds',
    'F1',
    'Large White',
    'Landrace',
    'Duroc',
    'Pietrain',
    'Crossbred',
    ...rawEvents.map(e => e.breed).filter(Boolean)
  ])).filter(Boolean);

  // Apply Filters
  const filteredEvents = rawEvents.filter(ev => {
    // 1. Timeframe Filter
    const diff = ev.daysDiff;
    if (st.timeframe === 'this_month') {
      const currentYM = todayStr.slice(0, 7);
      if (!ev.date.startsWith(currentYM)) return false;
    } else if (st.timeframe === 'next_month') {
      const d = new Date(todayStr + 'T00:00:00');
      d.setMonth(d.getMonth() + 1);
      const nextYM = d.toISOString().slice(0, 7);
      if (!ev.date.startsWith(nextYM)) return false;
    } else if (st.timeframe.startsWith('month:')) {
      const selYM = st.timeframe.replace('month:', '');
      if (!ev.date.startsWith(selYM)) return false;
    } else if (st.timeframe === 'today' && ev.date !== todayStr) {
      return false;
    } else if (st.timeframe === 'tomorrow' && diff !== 1) {
      return false;
    } else if (st.timeframe === '7' && (diff < 0 || diff > 7)) {
      return false;
    } else if (st.timeframe === '14' && (diff < 0 || diff > 14)) {
      return false;
    } else if (st.timeframe === '30' && (diff < 0 || diff > 30)) {
      return false;
    } else if (st.timeframe === '60' && (diff < 0 || diff > 60)) {
      return false;
    } else if (st.timeframe === '90' && (diff < 0 || diff > 90)) {
      return false;
    } else if (st.timeframe === '180' && (diff < 0 || diff > 180)) {
      return false;
    }

    // 2. Category Filter
    if (st.category !== 'all' && ev.type !== st.category) return false;

    // 3. Breed Filter
    if (st.breed !== 'all' && st.breed !== 'All Breeds') {
      if (!String(ev.breed || '').toLowerCase().includes(st.breed.toLowerCase())) return false;
    }

    // 4. Search Filter
    if (st.searchQuery) {
      const q = st.searchQuery.toLowerCase();
      const match = `${ev.title} ${ev.breed} ${ev.sow} ${ev.sire} ${ev.note} ${ev.id}`.toLowerCase();
      const resMatch = (ev.reservations || []).some(r => `${r.customer} ${r.contact} ${r.no}`.toLowerCase().includes(q));
      if (!match.includes(q) && !resMatch) return false;
    }

    return true;
  }).sort((a, b) => a.date.localeCompare(b.date));

  // Compute Headline KPI Metrics
  const totalFarSows = rawEvents.filter(e => e.type === 'farrowing').length;
  const totalWeanPigs = rawEvents.filter(e => e.type === 'weaning').reduce((a, e) => a + (e.heads || 0), 0);
  const totalBreederHeads = rawEvents.filter(e => e.type === 'breeder').reduce((a, e) => a + (e.heads || 0), 0);
  const totalReservations = (f.reservations || []).filter(r => r.status !== 'Cancelled').length;

  // Month Picker Dropdown Options
  const monthOptions = [];
  const currD = new Date(todayStr + 'T00:00:00');
  for (let m = 0; m < 12; m++) {
    const dObj = new Date(currD.getFullYear(), currD.getMonth() + m, 1);
    const val = dObj.toISOString().slice(0, 7);
    const label = dObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    monthOptions.push(`<option value="${val}" ${st.monthPicker === val || st.timeframe === 'month:' + val ? 'selected' : ''}>📅 ${label}</option>`);
  }

  // Compute specific breed breakdown for breeder offtakes in the current filtered events
  const breederEventsInView = filteredEvents.filter(e => e.type === 'breeder');
  const totalBreedersInView = breederEventsInView.reduce((a, e) => a + e.heads, 0);
  const totalBMInView = breederEventsInView.reduce((a, e) => a + e.males, 0);
  const totalBFInView = breederEventsInView.reduce((a, e) => a + e.females, 0);

  const breedBreakdown = {};
  breederEventsInView.forEach(e => {
    const br = e.breed || 'Crossbred';
    if (!breedBreakdown[br]) breedBreakdown[br] = { heads: 0, m: 0, f: 0 };
    breedBreakdown[br].heads += e.heads;
    breedBreakdown[br].m += e.males;
    breedBreakdown[br].f += e.females;
  });

  const container = document.getElementById('production');
  if (!container) return;

  container.innerHTML = `
    <!-- Top Hero Card & Summary -->
    <div class="forecast-header-card">
      <div class="forecast-header-top">
        <div>
          <div class="eyebrow" style="color:var(--teal2);font-weight:800">OPERATIONS &amp; OFFTAKE FORECASTING</div>
          <h2 style="margin:2px 0 6px 0;font-size:24px">Production &amp; Breeder Offtake Forecast</h2>
          <p class="muted" style="margin:0">Unified schedules for upcoming farrowings, weanings, breeder stock releases (min 90 days), and customer reservations.</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn ghost small" onclick="production()">⟳ Refresh</button>
        </div>
      </div>

      <!-- KPI Summary Cards -->
      <div class="forecast-kpi-grid">
        <div class="forecast-kpi-box farrow" onclick="window.setForecastCategory('farrowing')" style="cursor:pointer">
          <small>Expected Farrowing</small>
          <b>${totalFarSows} Sows</b>
          <span>~${totalFarSows * 10} Estimated Piglets</span>
        </div>
        <div class="forecast-kpi-box wean" onclick="window.setForecastCategory('weaning')" style="cursor:pointer">
          <small>Scheduled Weaning</small>
          <b>${totalWeanPigs} Piglets</b>
          <span>Across ${rawEvents.filter(e => e.type === 'weaning').length} Active Batches</span>
        </div>
        <div class="forecast-kpi-box breeder" onclick="window.setForecastCategory('breeder')" style="cursor:pointer">
          <small>Breeder Stock Offtake</small>
          <b>${totalBreederHeads} Heads</b>
          <span>Exclusively Assigned Breeders</span>
        </div>
        <div class="forecast-kpi-box res" onclick="go('reservations')" style="cursor:pointer">
          <small>Customer Reservations</small>
          <b>${totalReservations} Orders</b>
          <span>Tap to Manage Reservations</span>
        </div>
      </div>
    </div>

    <!-- Smart Interactive Filter Panel -->
    <div class="forecast-filter-panel">
      <!-- 1. Category Filter Row -->
      <div class="forecast-filter-row">
        <span class="forecast-filter-title">Category:</span>
        <div class="forecast-pills">
          ${[
            ['all', '🌐 All Schedules'],
            ['breeder', '⭐ Breeder Offtake / Releases'],
            ['farrowing', '🐷 Expected Farrowing'],
            ['weaning', '🍼 Weaning Schedule'],
            ['fattener', '📈 Market Readiness']
          ].map(([k, l]) => `<button type="button" class="period ${st.category === k ? 'active' : ''}" onclick="window.setForecastCategory('${k}')">${l}</button>`).join('')}
        </div>
      </div>

      <!-- 2. Timeframe Selection Row (Month Chooser + Windows) -->
      <div class="forecast-filter-row">
        <span class="forecast-filter-title">Timeframe:</span>
        <div class="forecast-pills" style="flex-wrap:wrap">
          ${[
            ['this_month', '📅 This Month (' + new Date(todayStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' }) + ')'],
            ['next_month', '📅 Next Month (' + new Date(new Date(todayStr + 'T00:00:00').getFullYear(), new Date(todayStr + 'T00:00:00').getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'short' }) + ')'],
            ['30', '30 Days'],
            ['60', '60 Days'],
            ['90', '90 Days'],
            ['180', '6 Months'],
            ['all', 'All Schedules']
          ].map(([tf, l]) => `<button type="button" class="period ${st.timeframe === tf ? 'active' : ''}" onclick="window.setForecastTimeframe('${tf}')">${l}</button>`).join('')}
          <select class="select" id="forecastMonthChooser" style="padding:6px 12px;font-size:12px;font-weight:700" onchange="window.setForecastMonth(this.value)">
            <option value="">🗓 Select Month / Year…</option>
            ${monthOptions.join('')}
          </select>
        </div>
      </div>

      <!-- 3. Smart Breed Filter & Search Row -->
      <div class="forecast-filter-row" style="border-bottom:0;padding-bottom:0;margin-bottom:0">
        <span class="forecast-filter-title">Breed Filter:</span>
        <div class="forecast-pills" style="flex:1">
          ${farmBreeds.slice(0, 8).map(br => {
            const val = (br === 'All Breeds' ? 'all' : br);
            const active = (st.breed === val || (st.breed === 'all' && br === 'All Breeds'));
            return `<button type="button" class="period ${active ? 'active' : ''}" onclick="window.setForecastBreed('${val}')">${br === 'All Breeds' ? '✨ All Breeds' : br}</button>`;
          }).join('')}
        </div>
        <input type="search" class="search" style="min-width:220px;font-size:12.5px" placeholder="🔍 Search batch, customer, breed..." value="${esc(st.searchQuery)}" oninput="window.setForecastSearch(this.value)">
      </div>
    </div>

    <!-- Interactive Breeder Breed Breakdown Ribbon -->
    ${breederEventsInView.length ? `
      <div class="forecast-breeder-summary-tray" style="background:linear-gradient(135deg,rgba(245,158,11,0.12),rgba(217,119,6,0.06));border:1.5px solid rgba(245,158,11,0.4);border-radius:14px;padding:14px 16px;margin:14px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div>
            <div style="font-size:14px;font-weight:800;color:#f59e0b;display:flex;align-items:center;gap:6px">
              <span>⭐</span>
              <span>BREEDER OFFTAKE AVAILABLE IN THIS TIMEFRAME: <b>${totalBreedersInView} Heads</b></span>
            </div>
            <small class="muted">Exclusively assigned breeders · Gender split: <b>♂ ${totalBMInView} Males · ♀ ${totalBFInView} Females</b> · 90-day minimum release age</small>
          </div>
          <span class="badge" style="background:#f59e0b;color:#000;font-weight:800">${breederEventsInView.length} Breeder Batches</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${Object.entries(breedBreakdown).map(([br, stat]) => `
            <button type="button" class="btn ghost small" style="background:rgba(0,0,0,0.3);border:1.5px solid ${st.breed.toLowerCase() === br.toLowerCase() ? '#f59e0b' : 'rgba(245,158,11,0.35)'};border-radius:999px;padding:5px 12px;font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--ink)" onclick="window.setForecastBreed('${escJS(br)}')">
              <b>${esc(br)}</b>: <span style="color:#f59e0b;font-weight:800">${stat.heads} head</span> <small class="muted">(♂${stat.m} · ♀${stat.f})</small>
            </button>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <!-- Active Filter Ribbon & Count -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 10px 0">
      <div class="eyebrow" style="color:var(--teal2);font-weight:800">
        SCHEDULED FORECAST EVENTS (${filteredEvents.length} RECORDS FOUND)
      </div>
      <small class="muted">
        ${st.breed !== 'all' ? `Filtered by Breed: <b>${st.breed}</b> · ` : ''}
        ${st.category !== 'all' ? `Category: <b>${st.category.toUpperCase()}</b> · ` : ''}
        Timeframe: <b>${st.timeframe === 'this_month' ? 'This Month' : (st.timeframe === 'next_month' ? 'Next Month' : (st.timeframe.startsWith('month:') ? st.timeframe.replace('month:', '') : st.timeframe === 'all' ? 'All Schedules' : st.timeframe + ' days'))}</b>
      </small>
    </div>

    <!-- Forecast Cards Grid -->
    <div class="forecast-card-grid">
      ${filteredEvents.map(ev => renderForecastCardHTML(ev, f)).join('') || `
        <div class="panel empty" style="grid-column:1/-1">
          <h3>No scheduled events match the current filter</h3>
          <p class="muted">Try selecting a broader timeframe (e.g. 60 or 90 days), choosing "All Breeds", or resetting your search.</p>
          <button type="button" class="btn ghost" onclick="window.setForecastTimeframe('90');window.setForecastBreed('all');window.setForecastCategory('all')">Reset All Filters</button>
        </div>
      `}
    </div>
  `;
}

function renderForecastCardHTML(ev, farm) {
  const isBreeder = ev.type === 'breeder';
  const isFarrowing = ev.type === 'farrowing';
  const isWeaning = ev.type === 'weaning';
  const isFattener = ev.type === 'fattener';

  const badgeIcon = isBreeder ? '⭐' : (isFarrowing ? '🐷' : (isWeaning ? '🍼' : '📈'));
  const badgeLabel = isBreeder ? 'Breeder Offtake' : (isFarrowing ? 'Expected Farrowing' : (isWeaning ? 'Scheduled Wean' : 'Market Ready'));

  // Linked Customer Reservations Box (Breeder & Batches)
  let reservationsHTML = '';
  if (ev.reservations && ev.reservations.length > 0) {
    reservationsHTML = `
      <div class="forecast-customer-box">
        <div class="forecast-customer-header">
          <b style="color:var(--teal2)">📜 Linked Customer Reservation (${ev.reservations.length})</b>
          <span class="badge ok" style="font-size:10.5px">Active Orders</span>
        </div>
        ${ev.reservations.map(r => {
          const cleanPhone = (r.contact || '').replace(/[^\d+]/g, '');
          const smsText = `Hello ${r.customer}, your reserved ${ev.breed} piglets from ${ev.title} at ${farm.name} are scheduled for release on ${fmtDate(ev.date)}. Total: ${r.quantity} heads. Balance: ₱${(r.price * r.quantity - (r.paid || 0))}. Thank you!`;
          return `
            <div style="padding:6px 0;border-top:1px dashed var(--line);margin-top:4px;font-size:12px">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <b>👤 ${esc(r.customer)}</b>
                <span class="tag">${r.quantity} heads · ${r.gender || 'Any'}</span>
              </div>
              <small class="muted" style="display:block;margin-top:2px">
                Order #${esc(r.no || r.id)} · Status: <b>${esc(r.status || 'Confirmed')}</b> · Paid: <b>₱${r.paid || 0}</b> / ₱${(r.price || 0) * (r.quantity || 1)}
              </small>
              <div class="forecast-contact-tray">
                ${cleanPhone ? `
                  <a href="tel:${cleanPhone}" class="btn ghost small" style="text-decoration:none;padding:3px 8px;font-size:11px" title="Direct Phone Call">📞 Call (${cleanPhone})</a>
                  <a href="sms:${cleanPhone}?body=${encodeURIComponent(smsText)}" class="btn ghost small" style="text-decoration:none;padding:3px 8px;font-size:11px" title="Send SMS Update">✉️ SMS</a>
                ` : ''}
                <a href="https://m.me" target="_blank" class="btn small" style="background:#0084ff;color:#fff;text-decoration:none;padding:3px 9px;font-size:11px" title="Contact via Facebook Messenger / Business Suite">💬 Messenger</a>
                <button type="button" class="btn ghost small" style="padding:3px 7px;font-size:11px" onclick="navigator.clipboard?.writeText('${esc(smsText).replace(/'/g, "\\'")}'); toast('✓ Customer reminder message copied to clipboard!')">📋 Copy Msg</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else if (isBreeder) {
    reservationsHTML = `
      <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:10px;padding:8px 12px;margin:8px 0;display:flex;justify-content:space-between;align-items:center;font-size:12px">
        <span style="color:#b45309">✓ Available for Customer Reservation</span>
        <button type="button" class="btn small ghost" style="padding:3px 9px;font-size:11px" onclick="openReservationForBatch('${escJS(ev.id)}')">＋ Reserve Now</button>
      </div>
    `;
  }

  return `
    <div class="forecast-item-card ${ev.type}">
      <!-- Top Title & Badge -->
      <div class="forecast-item-top">
        <div>
          <span class="forecast-badge ${ev.type}">${badgeIcon} ${badgeLabel}</span>
          <h3 style="margin:6px 0 2px 0;font-size:16.5px;color:var(--ink)">${esc(ev.title)}</h3>
          <small class="muted">Breed: <b style="color:var(--teal2)">${esc(ev.breed)}</b></small>
        </div>
        <div style="text-align:right">
          <b style="font-size:15px;color:var(--ink)">${fmtDate(ev.date)}</b>
          <small class="muted" style="display:block;font-size:11px">${esc(ev.note)}</small>
        </div>
      </div>

      <!-- Vitals Metadata Grid -->
      <div class="forecast-meta-grid">
        ${isFarrowing ? `
          <div><small>Inseminated</small><b>Day ${ev.gestDay} of 114</b></div>
          <div><small>Service Boar</small><b>${esc(ev.boar)}</b></div>
          <div><small>Estimated Litter</small><b>~${ev.estimatedHeads} Piglets</b></div>
          <div><small>Parity</small><b>Parity ${ev.parity}</b></div>
        ` : isWeaning ? `
          <div><small>Live Piglets</small><b>${ev.heads} Heads</b></div>
          <div><small>Gender Split</small><b>♂ ${ev.males} · ♀ ${ev.females}</b></div>
          <div><small>Current Age</small><b>${ev.ageDays} Days Old</b></div>
          <div><small>Dam × Sire</small><b>${esc(ev.sow)} × ${esc(ev.sire)}</b></div>
        ` : isBreeder ? `
          <div style="grid-column:1/-1;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:10px;padding:8px 12px;margin-bottom:4px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <small style="font-weight:700;color:#f59e0b">3-Month Biological Maturity (Min 90 Days):</small>
              <b style="font-size:12px;color:${ev.isReady ? 'var(--teal2)' : '#f59e0b'}">${ev.isReady ? '🏆 Ready for Release (90+ Days Old)' : `${ev.ageDays} / 90 Days (${ev.daysToRelease}d remaining)`}</b>
            </div>
            <div style="background:rgba(0,0,0,0.3);height:6px;border-radius:999px;overflow:hidden">
              <div style="background:${ev.isReady ? 'var(--teal2)' : '#f59e0b'};height:100%;width:${Math.min(100, Math.round(ev.ageDays / 90 * 100))}%"></div>
            </div>
          </div>
          <div><small>Breeder Stock</small><b>${ev.heads} Heads (Breeder Only)</b></div>
          <div><small>Gender Split</small><b>♂ ${ev.males} · ♀ ${ev.females}</b></div>
          <div><small>Target 90d Release</small><b>${fmtDate(ev.date)}</b></div>
          <div><small>Lineage (Dam × Sire)</small><b>${esc(ev.sow)} × ${esc(ev.sire)}</b></div>
        ` : `
          <div><small>Heads in Group</small><b>${ev.heads} Fatteners</b></div>
          <div><small>Current Age</small><b>~${ev.ageDays} Days</b></div>
          <div><small>Target Weight</small><b>90–110 kg</b></div>
          <div><small>Harvest Date</small><b>${fmtDate(ev.date)}</b></div>
        `}
      </div>

      <!-- Customer Reservations Box -->
      ${reservationsHTML}

      <!-- Bottom Interactive Action Toolbar -->
      <div class="forecast-actions-row">
        ${isFarrowing ? `
          <button type="button" class="btn small" onclick="openLinkedPigletModal(null,'${esc(ev.sow_id||ev.title)}')">🐷 Record Farrowing</button>
          <button type="button" class="btn ghost small" onclick="openSowProfile(${ev.sowIndex})">👁️ Gestation Dossier</button>
          <button type="button" class="btn ghost small" onclick="window.openMovementWizard && window.openMovementWizard('${escJS(ev.sow_id||ev.title)}','sow')">🚚 Move Stall</button>
        ` : isWeaning ? `
          <button type="button" class="btn small" onclick="openBatchHub('${escJS(ev.id)}')">🍼 Record Weaning</button>
          <button type="button" class="btn ghost small" onclick="window.openMovementWizard && window.openMovementWizard('${escJS(ev.id)}','batch')">🚚 Move to Nursery</button>
          <button type="button" class="btn ghost small" onclick="openBatchPerformance('${escJS(ev.id)}')">⚖️ Scale Weigh-In</button>
        ` : isBreeder ? `
          <button type="button" class="btn small" onclick="openAllocation('${escJS(ev.id)}','breeder')">⭐ Breeder Allocation</button>
          <button type="button" class="btn ghost small" onclick="openBatchPerformance('${escJS(ev.id)}')">⚖️ Performance &amp; Ear Notches</button>
          <button type="button" class="btn ghost small" onclick="openBatchHub('${escJS(ev.id)}')">📊 Batch Hub</button>
        ` : `
          <button type="button" class="btn small" onclick="openFattenerCenter('${escJS(ev.id)}')">📈 Fattener Center &amp; Selling</button>
          <button type="button" class="btn ghost small" onclick="openBatchHub('${escJS(ev.id)}')">Batch Details</button>
        `}
      </div>
    </div>
  `;
}
window.production = production;

function toggleCustomBreed(value) {
  let f = document.getElementById('customBreedField');
  if (f) f.style.display = value === 'Custom / Other Breed' ? 'block' : 'none'
}

function normalizeSowKey(v) {
  return String(v || '').trim().toLowerCase()
}

function sowDuplicate(field, value, index) {
  let key = normalizeSowKey(value);
  if (!key) return false;
  return (F().sows || []).some((x, i) => i !== index && normalizeSowKey(field === 'id' ? x.id : x.name) === key)
}

function attachSowDuplicateGuard(index) {
  let form = document.getElementById('recordForm'),
    button = form.querySelector('.actions button:last-child'),
    idInput = form.querySelector('[name="id"]'),
    nameInput = form.querySelector('[name="name"]'),
    timer;

  function mark(input, duplicate, message) {
    let host = input.closest('.field'),
      hint = host.querySelector('.duplicate-hint') || document.createElement('small');
    hint.className = 'duplicate-hint';
    if (!hint.parentNode) host.appendChild(hint);
    input.classList.toggle('duplicate-input', duplicate);
    input.classList.toggle('available-input', !!input.value.trim() && !duplicate);
    hint.textContent = duplicate ? `⚠ ${message}` : input.value.trim() ? '✓ Available in this farm' : '';
    hint.classList.toggle('error', duplicate);
    let invalid = sowDuplicate('id', idInput.value, index) || sowDuplicate('name', nameInput.value, index);
    button.disabled = invalid;
    button.classList.toggle('blocked-breed', invalid)
  }

  function check() {
    mark(idInput, sowDuplicate('id', idInput.value, index), 'A sow with this ID already exists in this farm.');
    mark(nameInput, sowDuplicate('name', nameInput.value, index), 'A sow with this name already exists in this farm.')
  } [idInput, nameInput].forEach(input => {
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(check, 350)
    });
    input.addEventListener('blur', check)
  });
  check()
}

function openModal(k, index = null) {
  let c = configs[k],
    r = index === null ? {} : F()[c.key][index];
  document.getElementById('modalTitle').textContent = index === null ? c.add : 'Edit record';
  document.getElementById('modalDesc').textContent = `Saved securely to ${F().name}; records are scoped by farm_id.`;
  document.getElementById('formFields').innerHTML = c.fields.map(([key, label, type]) => {
    let field;
    if (type.startsWith('select:')) {
      let options = type.slice(7).split(','),
        current = r[key] || '',
        selected = (key === 'breed' && current && !options.includes(current)) ? 'Custom / Other Breed' : current;
      field = `<select name="${key}" required ${key==='breed'?'onchange=\"toggleCustomBreed(this.value)\"':''}><option value="">Select…</option>${options.map(q=>`<option ${selected===q?'selected':''}>${q}</option>`).join('')}</select>`
    } else if (type === 'textarea') field = `<textarea name="${key}">${r[key]||''}</textarea>`;
    else if (k === 'financials' && key === 'category') field = `<input name="category" list="financialCategoryOptions" required value="${r[key] ?? ''}" placeholder="e.g. Utilities, Labor, Feed, Loan Proceeds"><datalist id="financialCategoryOptions"><option value="Feed"><option value="Utilities"><option value="Labor"><option value="Veterinary / Medicine"><option value="Debt Interest"><option value="Loan Proceeds"><option value="Principal Repayment"><option value="Equipment / Capital Expenditure"><option value="Breeding Stock Purchase"><option value="Barn / Facility"><option value="Equity Contribution"><option value="Owner Draw"><option value="Livestock Mortality Loss"><option value="Piglet Sales"><option value="Hog Sales"><option value="Semen Sales"><option value="Other Operating"></datalist>`;
    else field = `<input name="${key}" type="${type}" value="${r[key]??(key==='date'?TODAY:'')}" ${key==='id'||key==='type'||key==='title'||key==='product'||key==='boar'?'required':''}>`;
    let customValue = (key === 'customBreed' ? (r.customBreed || (!['Large White', 'Landrace', 'Duroc', 'Yorkshire', 'Crossbred'].includes(r.breed || '') ? r.breed || '' : '')) : '');
    if (key === 'customBreed' && customValue) {
      field = `<input name="customBreed" type="text" value="${customValue}" placeholder="Enter breed name">`
    }
    let style = key === 'customBreed' && (!r.breed || ['Large White', 'Landrace', 'Duroc', 'Yorkshire', 'Crossbred'].includes(r.breed)) ? 'style="display:none"' : '';
    return `<div id="${key==='customBreed'?'customBreedField':''}" class="field ${type==='textarea'?'full':''}" ${style}><label>${label}${key==='customBreed'?' (required for Custom / Other Breed)':''}</label>${field}</div>`
  }).join('');
  if (k === 'sows') attachSowDuplicateGuard(index);
  document.getElementById('recordForm').onsubmit = async e => {
    e.preventDefault();
    let obj = Object.fromEntries(new FormData(e.target));
    if (k === 'sows' && (sowDuplicate('id', obj.id, index) || sowDuplicate('name', obj.name, index))) {
      toast('Duplicate sow ID or name detected in this farm.');
      return
    }
    if (k === 'sows' && obj.breed === 'Custom / Other Breed') {
      if (!obj.customBreed?.trim()) {
        toast('Enter the specific breed name.');
        return
      }
      obj.breed = obj.customBreed.trim()
    }
    for (let q of ['bags', 'price', 'parity', 'males', 'females', 'bottles', 'amount', 'paid', 'qty', 'total', 'purchase_price'])
      if (q in obj) obj[q] = +obj[q];
    if (k === 'piglets' && index === null) {
      obj.iron = false;
      obj.castration = false;
      obj.weaning = false
    }
    if (k === 'reminders' && index === null) obj.active = true;
    if (k === 'pos' && index === null) obj.is_returned = false;
    if (k === 'feed') {
      const existing = index === null ? null : F().feed[index];
      const feedType = String(obj.type || '').trim();
      if (!feedType || !Number.isFinite(Number(obj.bags)) || Number(obj.bags) < 0 || !Number.isFinite(Number(obj.price)) || Number(obj.price) < 0) {
        toast('Feed type, bags and price must be valid non-negative values.');
        return;
      }
      obj.type = feedType;
      obj.bags = Number(obj.bags);
      obj.price = Number(obj.price);
      obj.id = existing?.id || `feed-${feedType.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      obj._ars_cloud_local_id = existing?._ars_cloud_local_id || obj.id;
      obj.feed_revision = Date.now();
      obj.updated_at = new Date().toISOString();
    }
    /* [REBUILD FIX 102] sow/gilt acquisition cost → booked once under
       "Breeding Stock Purchase" (capital → Investing activities in the
       Statement of Cash Flows). Editing later never double-books. */
    if (k === 'sows' && Number(obj.purchase_price) > 0 && !obj.purchase_tx_id) {
      const tx = {
        id: 'tx-' + Date.now().toString(36) + '-sowbuy',
        date: obj.purchase_date || new Date().toISOString().slice(0, 10),
        type: 'Expense', category: 'Breeding Stock Purchase',
        description: `Purchased ${+obj.parity > 0 ? 'sow' : 'gilt'} ${obj.name || obj.id || ''} from ${obj.source_farm || 'outside farm'}`,
        amount: Number(obj.purchase_price), paid: Number(obj.purchase_price),
        created_at: new Date().toISOString()
      };
      (F().transactions = F().transactions || []).unshift(tx);
      obj.purchase_tx_id = tx.id;
    }
    if (index === null) F()[c.key].push(obj);
    else F()[c.key][index] = Object.assign(F()[c.key][index], obj);
    save();
    closeModal();
    renderAll();
    if (window.ARSCloud && typeof ARSCloud.verifyFarmSave === 'function') {
      const syncResult = await ARSCloud.verifyFarmSave(window.__arsActiveFarmId || farmId, `${k} record`);
      if (!syncResult || syncResult.success === false) {
        const label = k === 'feed' ? 'Feed stock' : c.title;
        if (window.updateSyncIndicator) window.updateSyncIndicator('pending', `${label} pending`, syncResult?.reason || `${label} remains safely on this device until cloud review completes.`);
        toast(`${label} saved locally; cloud verification is still pending. It will not be overwritten automatically.`);
      } else {
        toast(k === 'feed'
          ? (index === null ? 'Feed stock added and cloud-verified' : 'Feed stock edit saved and cloud-verified')
          : (index === null ? 'Record added and cloud-verified' : 'Record updated and cloud-verified'));
      }
    } else {
      toast(index === null ? 'Record added' : 'Record updated');
    }
  };
  document.getElementById('modalBg').classList.add('open')
}

function editRecord(k, i) {
  openModal(k, i)
}

function closeModal() {
  document.getElementById('modalBg').classList.remove('open')
}

function dismiss(i) {
  F().reminders.splice(i, 1);
  save();
  crudPage('reminders');
  toast('Reminder dismissed')
}

function toggleReturn(i) {
  F().sales[i].is_returned = !F().sales[i].is_returned;
  save();
  crudPage('pos');
  toast('Return status updated')
}

function filterTable(k, v) {
  document.querySelectorAll(`#table-${k} tbody tr`).forEach(x => x.style.display = x.textContent.toLowerCase().includes(v.toLowerCase()) ? '' : 'none')
}
let titles = {
  dashboard: 'Farm Overview',
  sows: 'Sow Management',
  piglets: 'Piglet Batches',
  /* [REBUILD FIX 36] Vaccination Program center. */
  vaccination: 'Vaccination Program',
  barns: 'Multi-Barn Movements & Biosecurity',
  rfid: 'RFID & EID Ear-Tag Center',
  pedigree: 'Pedigree & Breeding',
  feed: 'Feed Inventory',
  medicine: 'Medicine & Treatments',
  predictor: 'Feed Predictor',
  production: 'Production Forecast',
  /* [REBUILD FEATURE] dedicated KPI Center page fed by the Production Control layer */
  kpis: 'KPI Center',
  semen: 'Boar Semen Inventory',
  financials: 'Financial Management',
  pos: 'POS Sales',
  reminders: 'Reminders',
  reservations: 'Reservations',
  subscription: 'Subscription',
  useradmin: 'User Access'
};

/* [REBUILD] Removed the original first go() definition; dead code —
   the guarded second go() (modal cleanup + premium gate) overrides it. */

function renderAll() {
  if (!document.body.classList.contains('farm-access-granted')) return;
  try { dashboard(); } catch (e) { console.error('Dashboard error:', e); }
  for (let k of ['sows', 'piglets', 'feed', 'semen', 'financials', 'pos', 'reminders']) {
    try { crudPage(k); } catch (e) { console.error('CrudPage error on ' + k, e); }
  }
  try { if (window.predictor) predictor(); } catch (e) {}
  try { if (window.production) production(); } catch (e) {}
  try { if (window.subscriptionPage) subscriptionPage(); } catch (e) {}
  try { if (window.adminPage) adminPage(); } catch (e) {}
  try { if (window.applyAccess) applyAccess(); } catch (e) {}
  try { if (window.injectDashboardReminders) injectDashboardReminders(); } catch (e) {}
}

function toast(s) {
  let x = document.getElementById('toast');
  if (!x) return;
  x.textContent = s;
  x.classList.add('show');
  setTimeout(() => x.classList.remove('show'), 2400);
}

function openDueWatchlist() {
  const f = (typeof F === 'function' && F()) ? F() : {};
  const due = dueThisWeek(f);
  if (!due.length) {
    toast('No sows currently due this week or overdue in this farm.');
    return;
  }
  const modalHTML = `
    <div class="due-modal-bg open" id="dueWatchlistModal" onclick="if(event.target===this)this.remove()">
      <div class="due-modal" style="max-width:680px;width:95%">
        <div class="modal-top">
          <div>
            <div class="eyebrow">FARROWING SCHEDULE · ${esc(f.name || "RM's Hog Farm")}</div>
            <h2>Sows Due This Week & Overdue</h2>
            <p class="muted">${due.length} sow${due.length > 1 ? 's' : ''} in the 110–114+ day gestation window</p>
          </div>
          <button class="close-reminder" onclick="document.getElementById('dueWatchlistModal').remove()">×</button>
        </div>
        <div class="panel table-wrap" style="margin-top:15px;max-height:60vh">
          <table class="table">
            <thead><tr><th>Sow</th><th>Parity</th><th>Gestation</th><th>Status / Due</th><th>Actions</th></tr></thead>
            <tbody>
              ${due.map((x) => {
                const gDays = days(x.insemination);
                const isOverdue = gDays > 114;
                const sowIdx = (f.sows || []).findIndex(s => s.id === x.id || s.name === x.name);
                return `<tr>
                  <td><b>${esc(x.name)}</b><br><small class="muted">${esc(x.id)} · ${esc(x.breed || 'Breed')}</small></td>
                  <td>${x.parity ?? '1'}</td>
                  <td><b>${gDays} days</b><br><small class="muted">${fmtDate(x.insemination)}</small></td>
                  <td><span class="tag ${isOverdue ? 'danger' : 'warn'}">${isOverdue ? 'OVERDUE (' + (gDays - 114) + 'd)' : 'Due ' + fmtDate(isoOff(114 - gDays))}</span></td>
                  <td style="white-space:nowrap">
                    <button type="button" class="btn ghost small" onclick="document.getElementById('dueWatchlistModal').remove();if(window.openSowProfile)openSowProfile(${sowIdx})">👁 Dossier</button>
                    <button type="button" class="btn small" onclick="document.getElementById('dueWatchlistModal').remove();if(window.openLinkedPigletModal)openLinkedPigletModal(null,'${esc(x.id)}')">🐷 Farrow</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  document.querySelectorAll('#dueWatchlistModal').forEach(m => m.remove());
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}
window.openDueWatchlist = openDueWatchlist;

function dashboard() {
  const f = (typeof F === 'function' && F()) ? F() : (window.DB && window.DB[window.farmId]) || {};
  if (!f) return;
  if (window.sanitizeFarm) sanitizeFarm(f);

  try {
    const ledAct = (f.pigletLedger || []).filter(x => x && !['undone', 'deleted'].includes(x.status));
    const lsum = (bid, t) => ledAct.filter(x => x.batch_id === bid && x.type === t).reduce((a, x) => a + (+x.quantity || 0), 0);
    const lsrc = (bid, t, src) => ledAct.filter(x => x.batch_id === bid && x.type === t && x.source === src).reduce((a, x) => a + (+x.quantity || 0), 0);

    const activeSows = (f.sows || []).filter(isActiveSow);
    const pregnant = (f.sows || []).filter(x => status(x) === 'Pregnant');
    const lact = (f.sows || []).filter(x => status(x) === 'Lactating');
    const pig = (f.piglets || []).filter(x => !x.archived);

    const totalPig = pig.reduce((a, x) => {
      if (window.getPigletCounts) {
        const counts = window.getPigletCounts(x);
        return a + (counts ? counts.alive : 0);
      }
      const m = +x.males || +x.male_count || 0;
      const fem = +x.females || +x.female_count || 0;
      return a + Math.max(0, m + fem - lsum(x.id, 'mortality') - lsum(x.id, 'sold'));
    }, 0);

    const boars = (f.boars || []).filter(b => b && (!b.status || String(b.status).toLowerCase() === 'active')).length;

    const fatAssigned = pig.reduce((a, b) => {
      if (window.getPigletCounts) {
        const counts = window.getPigletCounts(b);
        return a + (counts ? counts.fattener : 0);
      }
      return a + Math.max(0, lsum(b.id, 'fattener') - lsrc(b.id, 'reserved', 'fattener') + lsrc(b.id, 'cancel_reservation', 'fattener'));
    }, 0);
    const fatteners = fatAssigned;

    const totalFeedBags = (f.feed || []).reduce((a, x) => a + (+x.bags || +x.quantity || +x.qty || 0), 0);
    const feedVal = (f.feed || []).reduce((a, x) => {
      const bags = +(x.bags ?? x.quantity ?? x.qty ?? 0) || 0;
      const price = +(x.price ?? x.price_per_bag ?? x.unit_price ?? 0) || 1400;
      return a + bags * price;
    }, 0);

    const semenBottles = (f.semen || []).reduce((a, x) => {
      if (!x || typeof x !== 'object') return a;
      const count = +(x.available_bottles !== undefined ? x.available_bottles : (x.bottles || 0));
      return a + Math.max(0, count);
    }, 0);

    const finance = window.ARSFinance && typeof ARSFinance.summary === 'function'
      ? ARSFinance.summary(f)
      : { grossSales: 0, collected: 0, receivables: 0, operatingExpenses: 0, netProfit: 0 };
    const income = finance.grossSales;
    const collected = finance.collected;
    const expenses = finance.operatingExpenses;
    const receivables = finance.receivables;
    const customerCredit = finance.customerCredit || 0;
    const netProfit = finance.netProfit;

    const dueList = dueThisWeek(f);
    const dueCount = dueList.length;
    const watchlist = watchlistSows(f);
    const watchlistVisible = watchlist.slice(0, 3);
    const ironDue = window.pigletCareDue ? pigletCareDue() : pig.filter(x => (!x.iron || !x.castration) && days(x.birth) >= 3 && days(x.birth) <= 25).length;
    const vaxOverdue = (window.vaxOverdueCount ? vaxOverdueCount() : 0);

    // Compute dynamic health score
    let healthScore = 96;
    if (vaxOverdue > 0) healthScore -= Math.min(15, vaxOverdue * 5);
    if (dueList.some(s => days(s.insemination) > 114)) healthScore -= 4;
    if (totalFeedBags <= 0) healthScore -= 10;
    healthScore = Math.max(70, Math.min(100, healthScore));

    const attention = [
      ['🐖', 'Sows Due This Week', dueCount, 'openDueWatchlist()'],
      ['💉', 'Iron & Castration', ironDue, 'openPigletCare()'],
      ['🐖', 'Piglet Batches — Stage Planner', pig.length + (pig.length === 1 ? ' batch' : ' batches'), 'openFeedStagePlanner()'],
      ['◉', 'Active Reminders', (f.reminders || []).length, "go('reminders')"]
    ];

    // Herd population distribution
    const totalHerd = activeSows.length + boars + totalPig;
    const sowPct = totalHerd > 0 ? ((activeSows.length / totalHerd) * 100).toFixed(1) : '0';
    const boarPct = totalHerd > 0 ? ((boars / totalHerd) * 100).toFixed(1) : '0';
    const pigPct = totalHerd > 0 ? (((totalPig - fatteners) / totalHerd) * 100).toFixed(1) : '0';
    const fatPct = totalHerd > 0 ? ((fatteners / totalHerd) * 100).toFixed(1) : '0';

    // Post-AI 16th/21st day monitoring counts
    const todayDate = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
    let postAICount = 0;
    activeSows.forEach(s => {
      if (!s.insemination) return;
      const insemDate = new Date(String(s.insemination).slice(0, 10) + 'T00:00:00');
      const d = Math.round((todayDate - insemDate) / 86400000);
      if (d >= 15 && d <= 24) postAICount++;
    });

    const dashEl = document.getElementById('dashboard');
    if (!dashEl) return;

    dashEl.innerHTML = `
      <div class="dash-hero">
        <div class="panel health-card">
          <div class="score-ring interactive-ring" onclick="openFarmSummaryModal()" title="Click to view full Farm Biosecurity & Operations Summary" style="background: conic-gradient(var(--teal) 0 ${healthScore * 3.6}deg, #17383a ${healthScore * 3.6}deg)">
            <div class="ring-glow-pulse"></div>
            <div class="score-inner"><strong id="dashHealthScoreNum">${healthScore}</strong><small>/100</small></div>
          </div>
          <div class="health-copy">
            <h2>${healthScore >= 90 ? 'Excellent' : healthScore >= 80 ? 'Good' : 'Needs Attention'}</h2>
            <p>Herd biosecurity & health status for <b>${esc(f.name || "RM's Hog Farm")}</b>.</p>
            <button class="btn ghost" onclick="openFarmSummaryModal()">View breakdown →</button>
          </div>
          <div class="checklist">
            <span class="${vaxOverdue ? 'bad' : ''} check-item" style="cursor:pointer" onclick="openVaccinationCenter()" title="Click to view Vaccination Program"><span class="check-ico">${vaxOverdue ? '⚠' : '✓'}</span> ${vaxOverdue ? vaxOverdue + ' vaccine follow-ups overdue' : 'No overdue vaccinations'}</span>
            <span class="check-item" style="cursor:pointer" onclick="openFeedStockSummaryModal()" title="Click to view Current Feed Stock Inventory"><span class="check-ico">✓</span> Feed inventory: ${totalFeedBags} bags</span>
            <span class="check-item" style="cursor:pointer" onclick="openMedicineSummaryModal()" title="Click to view Medicine &amp; Treatments"><span class="check-ico">✓</span> No pending treatments</span>
            <span class="check-item ${postAICount > 0 ? 'hl' : ''}" style="cursor:pointer" onclick="openPostAIMonitoringModal()" title="Click to monitor sows at 16th and 21st day post-AI milestones"><span class="check-ico">✓</span> Post-AI Monitoring${postAICount > 0 ? `: ${postAICount} on watch` : ''}</span>
          </div>
          <div id="sowMonitorPanel" class="sowmon-panel ${window.__monOpen ? 'open' : ''}"></div>
          <div id="feedShortPanel" class="sowmon-panel feed-panel"></div>
        </div>

        <div class="panel attention">
          <h3>⚠ &nbsp; ATTENTION REQUIRED</h3>
          <div class="attention-items">
            ${attention.map(x => `<div class="attention-item"${x[3] ? ` style="cursor:pointer" onclick="${x[3]}" title="Tap to open"` : ''}><span class="alert-icon">${x[0]}</span><div><b>${x[2]}</b><small>${x[1]}</small></div></div>`).join('')}
          </div>
        </div>
      </div>

      <!-- Live Herd Population Composition Bar -->
      <div class="herd-comp-box">
        <div class="herd-comp-head">
          <span>LIVESTOCK HEADCOUNT BREAKDOWN</span>
          <span><b>${totalHerd}</b> Total Heads on Farm</span>
        </div>
        <div class="herd-comp-bar">
          <div class="herd-seg sows" style="width:${sowPct}%" title="Sows: ${activeSows.length} (${sowPct}%)"></div>
          <div class="herd-seg boars" style="width:${boarPct}%" title="Boars: ${boars} (${boarPct}%)"></div>
          <div class="herd-seg piglets" style="width:${pigPct}%" title="Piglets: ${Math.max(0, totalPig - fatteners)} (${pigPct}%)"></div>
          <div class="herd-seg fatteners" style="width:${fatPct}%" title="Fatteners: ${fatteners} (${fatPct}%)"></div>
        </div>
        <div class="herd-legend">
          <div class="herd-legend-item" style="cursor:pointer" onclick="go('sows')"><span class="herd-dot" style="background:#1cd5c2"></span> Sows: <b>${activeSows.length}</b> (${sowPct}%)</div>
          <div class="herd-legend-item" style="cursor:pointer" onclick="go('semen')"><span class="herd-dot" style="background:#3eabda"></span> Boars: <b>${boars}</b> (${boarPct}%)</div>
          <div class="herd-legend-item" style="cursor:pointer" onclick="go('piglets')"><span class="herd-dot" style="background:#68cd61"></span> Piglets: <b>${Math.max(0, totalPig - fatteners)}</b> (${pigPct}%)</div>
          <div class="herd-legend-item" style="cursor:pointer" onclick="openFattenerCenter()"><span class="herd-dot" style="background:#b87bf8"></span> Fatteners: <b>${fatteners}</b> (${fatPct}%)</div>
        </div>
      </div>

      <div class="dash-section-title">AT A GLANCE · BREEDING HERD</div>
      <div class="glance-grid">
        <div class="panel glance interactive-card" onclick="go('sows')" title="View all active sows">
          <span class="symbol">🐷</span><small>Total Sows</small><b>${activeSows.length}</b><small>Live farm count →</small>
        </div>
        <div class="panel glance interactive-card" onclick="go('sows')" title="View pregnant sows">
          <span class="symbol">❤</span><small>Pregnant Sows</small><b>${pregnant.length}</b><small>In gestation cycle →</small>
        </div>
        <div class="panel glance interactive-card" onclick="go('sows')" title="View lactating sows">
          <span class="symbol">🍼</span><small>Lactating Sows</small><b>${lact.length}</b><small>Nursing litters →</small>
        </div>
        <div class="panel glance interactive-card" onclick="go('semen')" title="View registered boars">
          <span class="symbol">♂</span><small>Active Boars</small><b>${boars}</b><small>Registered active boars →</small>
        </div>
      </div>

      <div class="section split">
        <div>
          <div class="dash-section-title">PIG PRODUCTION & GROW-FINISH</div>
          <div class="glance-grid" style="grid-template-columns:repeat(2,1fr)">
            <div class="panel glance interactive-card" onclick="go('piglets')" title="Open Piglet batches">
              <span class="symbol">🐖</span><small>Piglets Alive</small><b>${totalPig}</b><small>Across ${pig.length} active batches →</small>
            </div>
            <div class="panel glance interactive-card" onclick="openFattenerCenter()" title="Open the Fattener & grow-finish center">
              <span class="symbol">📈</span><small>Fatteners in Grow-Finish</small><b>${fatteners}</b><small>${fatAssigned ? fatAssigned + ' in batch ledger' : 'Fattener tracking active'} →</small>
            </div>
          </div>
        </div>
        <div>
          <div class="dash-section-title">FEED & SEMEN INVENTORY</div>
          <div class="glance-grid" style="grid-template-columns:repeat(2,1fr)">
            <div class="panel glance interactive-card" onclick="go('feed')" title="Open Feed Inventory">
              <span class="symbol">🛍</span><small>Feed Stock</small><b>${totalFeedBags} <small>bags</small></b><small>${peso(feedVal)} value →</small>
            </div>
            <div class="panel glance interactive-card" onclick="go('semen')" title="Open Boar Semen Inventory">
              <span class="symbol"><img src="assets/semen-bottle.png" alt="Boar Semen" style="height:30px;width:auto;object-fit:contain;vertical-align:middle;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.35))"></span><small>Boar Semen</small><b>${semenBottles} <small>doses</small></b><small>Available in stock →</small>
            </div>
          </div>
        </div>
      </div>

      <div class="dash-section-title">FINANCIAL PERFORMANCE</div>
      <div class="business-grid">
        <div class="panel stat interactive-card" onclick="go('financials')" title="Open Financials">
          <span class="label">Gross Sales</span><strong class="money">${peso(income)}</strong><div class="trend">▲ Cash & receivables →</div>
        </div>
        <div class="panel stat interactive-card" onclick="go('pos')" title="Open POS Sales">
          <span class="label">Actual Collected</span><strong class="money">${peso(collected)}</strong><div class="trend">▲ Cash in hand →</div>
        </div>
        <div class="panel stat interactive-card" onclick="go('pos')" title="Open POS Sales">
          <span class="label">Outstanding Receivables</span><strong class="money" style="color:#f0b64b">${peso(receivables)}</strong><div class="trend" style="color:#f0b64b">${customerCredit > 0 ? `Customer credit ${peso(customerCredit)}` : 'Follow up customers'} →</div>
        </div>
        <div class="panel stat interactive-card" onclick="go('financials')" title="Open Financials">
          <span class="label">Net Operating Profit</span><strong class="money">${peso(netProfit)}</strong><div class="trend">${income > expenses ? 'Healthy operating margin' : 'Operating margin tracker'} →</div>
        </div>
      </div>

      <div class="section dashboard-bottom-grid">
        <div>
          <div class="section-head">
            <div><h2>Pregnant sow watchlist</h2><p>Near due and overdue · showing the first ${Math.min(3, watchlist.length)} of ${watchlist.length}</p></div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
              <button class="btn ghost" onclick="go('sows')">Manage sows →</button>
              <button type="button" class="btn ghost small" id="pregnantWatchlistToggle" aria-expanded="true" onclick="togglePregnantWatchlist()">▲ Collapse</button>
            </div>
          </div>
          <div id="pregnantWatchlistPanel" class="panel table-wrap watchlist-collapsible-panel">
            <table class="table">
              <thead><tr><th>Sow</th><th>Parity</th><th>Inseminated</th><th>Gestation</th><th>Status / Due</th><th>Action</th></tr></thead>
              <tbody>
                ${watchlistVisible.map(x => {
                  const gDays = days(x.insemination);
                  const isOverdue = gDays > 114;
                  const isNearDue = gDays >= 110;
                  const sowIdx = (f.sows || []).findIndex(s => s.id === x.id || s.name === x.name);
                  return `
                    <tr class="watchlist-row" onclick="if(window.openSowProfile)openSowProfile(${sowIdx})">
                      <td><b>${esc(x.name)}</b><br><small class="muted">${esc(x.id)}${x.breed ? ' · ' + esc(x.breed) : ''}</small></td>
                      <td>${x.parity ?? '1'}</td>
                      <td>${fmtDate(x.insemination)}<br><small class="muted">${esc(x.semen || x.sire || 'Boar semen')}</small></td>
                      <td><b>${gDays} days</b><br><small class="muted">${gDays <= 114 ? (114 - gDays) + 'd to farrow' : (gDays - 114) + 'd overdue'}</small></td>
                      <td><span class="tag ${isOverdue ? 'danger' : (isNearDue ? 'warn' : '')}">${isOverdue ? 'OVERDUE (' + (gDays - 114) + 'd)' : 'DUE SOON'}</span></td>
                      <td style="white-space:nowrap" onclick="event.stopPropagation()">
                        <button type="button" class="btn ghost small" onclick="if(window.openSowProfile)openSowProfile(${sowIdx})">👁 Dossier</button>
                        <button type="button" class="btn small" onclick="if(window.openLinkedPigletModal)openLinkedPigletModal(null,'${esc(x.id)}')">🐷 Farrow</button>
                      </td>
                    </tr>
                  `;
                }).join('') || '<tr><td colspan="6" class="empty">No sows are near due or overdue.</td></tr>'}
              </tbody>
            </table>
            ${watchlist.length > 3 ? `<div class="watchlist-more-note">${watchlist.length - 3} additional near-due/overdue sow${watchlist.length - 3 === 1 ? '' : 's'} available in Sow Management.</div>` : ''}
          </div>
        </div>
        <div>
          <div class="section-head">
            <div><h2>Today’s tasks & reminders</h2><p>Operational schedule for ${esc(f.name || 'this farm')}</p></div>
            <button class="btn ghost" onclick="openModal('reminders')">+ Add task</button>
          </div>
          <div class="panel summary">
            ${(f.reminders || []).slice(0, 5).map(x => `
              <div class="summary-row interactive-card" style="cursor:pointer" onclick="go('reminders')">
                <span>◉ &nbsp; <b>${esc(x.title || x.name || 'Task')}</b><br><small class="muted">${esc(x.type || x.reminder_type || 'One Time')} · ${esc(x.schedule || fmtDate(x.next_trigger || x.date || TODAY))}</small></span>
                <b style="color:#57d48d">Active</b>
              </div>
            `).join('') || '<div class="empty">No active tasks scheduled. <button class="btn ghost small" style="margin-top:8px" onclick="openModal(\'reminders\')">+ Add Task</button></div>'}
          </div>
        </div>
      </div>
    `;

    if (window.__monOpen && window.renderMonitorPanel) {
      window.renderMonitorPanel();
      const el = document.getElementById('sowMonitorPanel');
      const chip = document.getElementById('sowMonChip');
      if (el) el.classList.add('open');
      if (chip) chip.classList.add('on');
    }
  } catch (err) {
    console.error('Dashboard render error:', err);
  }
}
window.dashboard = dashboard;

/* [REBUILD] Removed the original first login() definition; dead code AND a security footgun —
   it granted access without any credential check. The async Supabase login() below wins. */

async function logout() {
  // Never upload a full local snapshot as part of logout. If there are pending
  // changes, the recovery copy and dirty-state indicator remain available for
  // an explicit review instead of silently overwriting cloud rows.
  STORE.removeItem('ars-auth');
  if (window.ARSCloud) {
    try { await ARSCloud.signOut(); } catch(e) {}
    if (window.ARSPresence) window.ARSPresence.stop(); /* [FIX 127] */
  }
  window.currentFarmAssigned = false;
  window.platformAdminVerified = false;
  window.myFarmRole = null;
  window.arsSessionUser = null;
  window.arsMemberships = [];
  window.arsActiveMembership = null;
  window.arsContextReady = false;
  window.arsOfflineMode = false;
  window.__arsActiveFarmId = null;
  window.arsServerFarms = [];
  window.__arsCloudBaselineReady = false;
  document.body.classList.remove('farm-access-granted');
  if (window.closeDueReminderAlert) window.closeDueReminderAlert();
  if (typeof closeJoinFarmModal === 'function') closeJoinFarmModal();
  clearLoginError();
  const authStatus = document.getElementById('authStatus');
  if (authStatus) {
    authStatus.textContent = 'Secure sign-in active';
    authStatus.className = 'auth-status';
  }
  document.querySelectorAll('.login-screen .logo-img, .reset-screen .logo-img, .onboard-screen .logo-img').forEach(img => {
    img.src = 'assets/arswinetech-logo.png';
  });
  document.getElementById('loginScreen').style.display = 'grid';
  setFarmSelect();
  toast('You have been logged out');
}

function toggleTheme() {
  document.documentElement.classList.toggle('light-theme');
  STORE.setItem('ars-theme', document.documentElement.classList.contains('light-theme') ? 'light' : 'dark')
}
if (STORE.getItem('ars-theme') === 'light') document.documentElement.classList.add('light-theme'); /* Never restore dashboard access from a local flag; a verified Supabase membership is required. */
const SUPER_ADMIN_EMAIL = 'arswinetech@gmail.com';
const baseUsers = [{
  id: 'u-owner',
  email: 'arswinetech@gmail.com',
  name: 'ARSwineTech Administrator',
  farmId: 'platform',
  role: 'super_admin',
  plan: 'platform',
  access: true
}, {
  id: 'u-andy',
  email: 'manager@arswine.ph',
  name: 'Farm Manager',
  farmId: 'farm-ars',
  role: 'owner',
  plan: 'starter',
  access: true
}, {
  id: 'u-worker',
  email: 'staff@arswine.ph',
  name: 'Juan Dela Cruz',
  farmId: 'farm-ars',
  role: 'staff',
  plan: 'starter',
  access: true
}, {
  id: 'u-isidro',
  email: 'owner@sanisidro.ph',
  name: 'San Isidro Owner',
  farmId: 'farm-sample',
  role: 'owner',
  plan: 'full',
  access: true
}];

function users() {
  let u = STORE.getItem('ars-users-v1');
  if (!u) {
    STORE.setItem('ars-users-v1', JSON.stringify(baseUsers));
    return structuredClone(baseUsers)
  }
  try {
    return JSON.parse(u)
  } catch (e) {
    return structuredClone(baseUsers)
  }
}

function saveUsers(u) {
  STORE.setItem('ars-users-v1', JSON.stringify(u))
}

function currentEmail() {
  return (STORE.getItem('ars-current-email') || 'manager@arswine.ph').toLowerCase()
}

function isSuperAdmin() {
  return window.platformAdminVerified === true &&
    String(window.arsSessionUser?.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

function isPlatformOwnerEmail(email) {
  return String(email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

function myUser() {
  return users().find(u => u.email.toLowerCase() === currentEmail())
}

function planForCurrentFarm() {
  return isSuperAdmin() ? 'platform' : (window.arsActiveMembership?.plan || 'starter');
}

function applyAccess() {
  let admin = document.getElementById('adminNav');
  if (admin && admin.style) admin.style.display = isSuperAdmin() ? 'flex' : 'none';
  let u = myUser();
  const role = window.arsActiveMembership?.role || window.myFarmRole || 'Staff';
  const full = isSuperAdmin() || planForCurrentFarm() === 'full' || planForCurrentFarm() === 'platform';
  document.querySelectorAll('.nav [data-page]').forEach(b => {
    if (!b || !b.style) return;
    let premium = ['predictor', 'production', 'semen', 'financials', 'pos'].includes(b.dataset.page);
    if (premium && !full) {
      b.style.opacity = '.45';
      b.title = 'Full Access subscription required';
    } else if (b.dataset.page !== 'useradmin') b.style.opacity = '';
  });
  let header = document.querySelector('.user span');
  if (header) {
    header.innerHTML = `${isSuperAdmin()?'ARSwineTech Admin':(u?.name || window.arsSessionUser?.email || 'Farm User')}<br><b style="color:var(--ink)">${isSuperAdmin()?'Platform Owner':role}</b>`;
  }
}

function subscriptionPage() {
  let current = planForCurrentFarm(),
    plans = [
      ['starter', 'Starter', '₱499 / month', ['Dashboard and herd records', 'Sows, piglets and feed', 'Reminders and local offline data']],
      ['full', 'Full Access', '₱1,299 / month', ['All pages and forecasting', 'Finance, POS and semen inventory', 'Cloud backup and multi-device sync', 'Priority farm support']],
      ['platform', 'Platform Admin', 'Private', ['All Full Access features', 'User and farm administration', 'Available only to ARSwineTech']]
    ];
  const fp = (typeof F === 'function' && F()) ? F() : {}; /* [FIX 118] farm profile values */
  document.getElementById('subscription').innerHTML = `<div class="panel subscription-hero"><div><div class="eyebrow">YOUR FARM PLAN</div><h2>${current==='platform'?'Platform Administration':current==='full'?'Full Access':'Starter'}${current==='platform'?'':' subscription'}</h2><p class="muted">${current==='platform'?'Verified platform owner access is active across all registered farms and application features.':'Upgrade when you are ready to unlock your farm’s complete operational toolkit.'}</p></div><span class="tag">${current==='full'?'ACTIVE · FULL ACCESS':current==='platform'?'PLATFORM ADMIN':'ACTIVE · STARTER'}</span></div><div class="section subscription-plans">${plans.map(p=>`<div class="panel plan-card ${p[0]==='full'?'featured':''}"><div class="plan-label">${p[0]==='full'?'MOST COMPLETE':'ARSWINETECH PRO'}</div><h2>${p[1]}</h2><div class="price">${p[2]}</div><ul>${p[3].map(x=>`<li>${x}</li>`).join('')}</ul>${p[0]==='platform'?'<button class="btn ghost" disabled>Administrator only</button>':p[0]===current?'<button class="btn ghost" disabled>Current plan</button>':`<button class="btn" onclick="choosePlan('${p[0]}')">${p[0]==='full'?'Upgrade to Full Access':'Select Starter'}</button>`}</div>`).join('')}</div><p class="muted" style="font-size:12px;margin-top:16px">Prototype checkout: selecting a plan updates access immediately. Production checkout should connect to Google Play Billing, Apple In-App Purchase, or a PCI-compliant payment provider and validate the subscription on the server.</p>
  <div class="panel" style="margin-top:18px;padding:16px">
    <div class="eyebrow">FARM PROFILE</div>
    <h2 style="margin:6px 0 4px">🏠 Registration details</h2>
    <p class="muted" style="font-size:12px;margin-bottom:12px">Used to auto-fill the Owner and Location on your Pedigree &amp; Lineage Reports. Save once — it syncs with your farm.</p>
    <form onsubmit="saveFarmProfile(event)" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
      <div class="field"><label>Owner full name</label><input name="owner" value="${esc(fp.owner || fp.owner_name || '')}" placeholder="e.g. Andy Resuena Albar"></div>
      <div class="field"><label>Mobile number (optional)</label><input name="mobile" value="${esc(fp.mobile || '')}"></div>
      <div class="field"><label>Farm address (optional)</label><input name="address" value="${esc(fp.address || '')}"></div>
      <div class="field"><label>Barangay (optional)</label><input name="barangay" value="${esc(fp.barangay || '')}"></div>
      <div class="field"><label>Municipality / City</label><input name="municipality" value="${esc(fp.municipality || '')}" placeholder="e.g. Ocampo"></div>
      <div class="field"><label>Province</label><input name="province" value="${esc(fp.province || '')}" placeholder="e.g. Camarines Sur"></div>
      <div style="grid-column:1/-1"><button class="btn">💾 Save farm profile</button></div>
    </form>
  </div>`
}

function choosePlan(plan) {
  if (isSuperAdmin()) return;
  F().subscription = plan;
  let list = users(),
    u = list.find(x => x.email.toLowerCase() === currentEmail());
  if (u) u.plan = plan;
  saveUsers(list);
  save();
  applyAccess();
  subscriptionPage();
  toast(plan === 'full' ? 'Full Access activated' : 'Starter plan selected')
}

async function adminPage() {
  if (!isSuperAdmin()) {
    document.getElementById("useradmin").innerHTML = "<div class=\"panel empty\">Administrator access is required.</div>";
    return;
  }

  let us = users().filter(u => !String(u.email || '').toLowerCase().includes('@arswine-test.ph'));
  const userMap = new Map(us.map(u => [String(u.email || '').trim().toLowerCase(), u]));

  // 1. Fetch live registered platform users from Supabase or cloud controller
  if (window.ARSCloud && typeof ARSCloud.listPlatformUsers === "function") {
    try {
      const liveList = await ARSCloud.listPlatformUsers();
      if (Array.isArray(liveList) && liveList.length > 0) {
        liveList.forEach(u => {
          if (!u || !u.email) return;
          const email = String(u.email || '').trim().toLowerCase();
          if (email.includes('@arswine-test.ph')) return;
          const fName = u.farm_name || (u.farm_id === 'platform' ? 'ARSwineTech Platform' : (DB[u.farm_id]?.name || (u.farm_id && u.farm_id !== 'null' ? u.farm_id : "RM's Hog Farm")));
          userMap.set(email, {
            user_id: u.id,
            id: u.id,
            name: u.name || (u.email ? u.email.split("@")[0] : "User"),
            email: u.email,
            farmId: u.farm_id || u.farmId,
            farmName: fName,
            role: isPlatformOwnerEmail(email) ? 'super_admin' : (u.role || 'staff'),
            plan: isPlatformOwnerEmail(email) ? 'platform' : (u.plan || 'starter'),
            access: isPlatformOwnerEmail(email) || u.is_active !== false,
            created_at: u.created_at
          });
        });
      }
    } catch (e) {
      console.warn("Live user list fetch note:", e);
    }
  }

  // 2. Query team members across all registered farms (e.g. invite-code joins)
  if (window.ARSCloud && typeof ARSCloud.getFarmMembers === "function" && window.DB) {
    try {
      for (const fId of Object.keys(DB)) {
        if (fId.includes('e2e') || fId.includes('lint')) continue;
        const farmName = DB[fId]?.name || fId;
        const members = await ARSCloud.getFarmMembers(fId).catch(() => []);
        if (Array.isArray(members)) {
          members.forEach(m => {
            if (!m || !m.email) return;
            const email = String(m.email).trim().toLowerCase();
            if (email.includes('@arswine-test.ph')) return;
            const existing = userMap.get(email);
            if (!existing) {
              userMap.set(email, {
                user_id: m.user_id,
                id: m.user_id,
                name: email.split('@')[0],
                email: m.email,
                farmId: fId,
                farmName: farmName,
                role: isPlatformOwnerEmail(email) ? 'super_admin' : (m.role || 'staff'),
                plan: isPlatformOwnerEmail(email) ? 'platform' : (m.plan || 'starter'),
                access: isPlatformOwnerEmail(email) || m.is_active !== false,
                created_at: m.created_at || new Date().toISOString()
              });
            } else {
              if (m.user_id && !existing.user_id) {
                existing.user_id = m.user_id;
                existing.id = m.user_id;
              }
              if (fId && (!existing.farmId || existing.farmId === 'unassigned' || existing.farmId === 'platform')) {
                if (existing.role !== 'super_admin') {
                  existing.farmId = fId;
                  existing.farmName = farmName;
                }
              }
              if (isPlatformOwnerEmail(email)) {
                existing.role = 'super_admin';
                existing.plan = 'platform';
                existing.access = true;
              } else {
                if (m.role && existing.role !== 'super_admin') existing.role = m.role;
                if (m.is_active !== undefined) existing.access = m.is_active !== false;
              }
            }
          });
        }
      }
    } catch (e) {
      console.warn("Farm members sync note:", e);
    }
  }

  // 3. Fetch members across all farms and invitation code registrations (local/demo storage)
  try {
    const demoMemberships = JSON.parse(STORE.getItem('ars-demo-memberships-v1') || '{}');
    Object.entries(demoMemberships).forEach(([em, m]) => {
      const email = String(em).trim().toLowerCase();
      if (email.includes('@arswine-test.ph')) return;
      const fName = (window.DB && m.farm_id && DB[m.farm_id]?.name) || (m.farm_id === 'platform' ? 'ARSwineTech Platform' : (m.farm_id ? m.farm_id : "RM's Hog Farm"));
      if (!userMap.has(email)) {
        userMap.set(email, {
          name: email.split('@')[0],
          email: email,
          farmId: m.farm_id,
          farmName: fName,
          role: isPlatformOwnerEmail(email) ? 'super_admin' : (m.role || 'staff'),
          plan: isPlatformOwnerEmail(email) ? 'platform' : 'starter',
          access: true,
          created_at: new Date().toISOString()
        });
      } else {
        const u = userMap.get(email);
        if (m.farm_id && u.role !== 'super_admin') {
          u.farmId = m.farm_id;
          u.farmName = fName;
        }
        if (m.role && u.role !== 'super_admin') u.role = m.role;
      }
    });
  } catch(e) {}

  us = Array.from(userMap.values()).filter(u => !String(u.email || '').toLowerCase().includes('@arswine-test.ph'));
  saveUsers(us);

  const container = document.getElementById("useradmin");
  if (!container) return;
  container.innerHTML = `
    <div class="panel admin-banner">♚ <div><b>ARSwineTech Platform Administration</b><br><span class="muted">Manage registered users, farm roles, access status and subscription entitlement in real-time.</span></div></div>
    <div class="toolbar">
      <div class="toolbar-left"><input class="search" placeholder="Search registered users" oninput="filterTable('useradmin',this.value)"></div>
      <div class="toolbar-right" style="display:flex;gap:8px;align-items:center;">
        <button type="button" class="btn ghost" onclick="purgeTestAccountsAdmin()" title="Purge any leftover test accounts and dummy test farms">🧹 Purge Test Data</button>
        <button type="button" class="btn ghost" onclick="adminPage()" title="Refresh live cloud user list">⟳ Refresh</button>
        <div class="tag">${us.length} registered users</div>
      </div>
    </div>
    <div class="panel table-wrap"><table class="table" id="table-useradmin"><thead><tr><th>User</th><th>Farm</th><th>Role</th><th>Plan / Access</th><th>Actions</th></tr></thead><tbody>
    ${us.map((u, i) => `
      <tr>
        <td><b>${esc(u.name)}</b><br><small class="muted">${esc(u.email)}</small><div class="prs-slot" data-uid="${esc(u.id || u.email)}" style="margin-top:4px"></div></td>
        <td>${esc(u.farmName && u.farmName !== 'null' ? u.farmName : (u.farmId === "platform" ? "ARSwineTech Platform" : (DB[u.farmId]?.name || (u.farmId && u.farmId !== 'null' ? u.farmId : "RM's Hog Farm"))))}</td>
        <td>
          <select class="select" ${isPlatformOwnerEmail(u.email) ? "disabled title=\"Platform Owner is fixed by verified email\"" : ""} onchange="changeUser(${i},'role',this.value)">
            ${["owner", "manager", "staff", "viewer"].map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r.replace("_", " ").toUpperCase()}</option>`).join("")}${isPlatformOwnerEmail(u.email) ? '<option value="super_admin" selected>SUPER ADMIN</option>' : ''}
          </select>
        </td>
        <td>
          <select class="select" ${isPlatformOwnerEmail(u.email) ? "disabled" : ""} onchange="changeUser(${i},'plan',this.value)">
            <option value="starter" ${u.plan === "starter" ? "selected" : ""}>Starter</option>
            <option value="full" ${u.plan === "full" ? "selected" : ""}>Full Access</option>
            <option value="platform" ${u.plan === "platform" || isPlatformOwnerEmail(u.email) ? "selected" : ""}>Platform</option>
          </select>
          <label style="margin-left:9px;font-size:12px">
            <input class="access-toggle" type="checkbox" ${u.access ? "checked" : ""} ${isPlatformOwnerEmail(u.email) ? "disabled" : ""} onchange="changeUser(${i},'access',this.checked)"> Active
          </label>
        </td>
        <td style="white-space:nowrap">
          <button class="btn ghost" onclick="saveUserAccessRow(${i})">Save</button>
          <button type="button" class="btn ghost delete-action" title="Permanently delete this user" ${isPlatformOwnerEmail(u.email) || u.email.toLowerCase() === currentEmail() ? "disabled" : ""} onclick="deleteUserComplete('${esc(u.email)}')">🗑</button>
        </td>
      </tr>
    `).join("")}
    </tbody></table></div>
    <div class="admin-farm-sec">
      <div class="dash-section-title">REGISTERED FARMS · ADMIN ONLY</div>
      <p class="muted admin-farm-note">Complete erase removes the farm and <b>all</b> of its data — on this device and in the cloud. This cannot be undone.</p>
      <div class="panel table-wrap"><table class="table" id="table-farmadmin"><thead><tr><th>Farm</th><th>Records</th><th>Batches</th><th>Sows</th><th>Delete</th><th>Invite code</th></tr></thead><tbody>${window.farmAdminRowsHTML ? farmAdminRowsHTML() : ""}</tbody></table></div>
    </div>
    <div class="notice" style="margin-top:15px"><b>Security:</b><span>Platform users and farm roles are synchronized in real-time with PostgreSQL authentication and RLS tenant policies.</span></div>
  `;
  if (window.ARSPresence) window.ARSPresence.renderSlots(); /* [FIX 127] presence badges */
}

async function purgeTestAccountsAdmin() {
  if (!confirm("Purge all test accounts (*@arswine-test.ph) and test farm records from cloud and local storage?")) return;
  try {
    if (window.ARSCloud && typeof ARSCloud.purgeTestAccounts === "function") {
      await ARSCloud.purgeTestAccounts();
    }
    // Clean local users
    const filtered = users().filter(u => !String(u.email || '').toLowerCase().includes('@arswine-test.ph'));
    saveUsers(filtered);

    // Clean local DB test farms
    Object.keys(DB || {}).forEach(k => {
      if (k.includes('e2e') || k.includes('lint') || DB[k]?.name?.includes('E2E Live') || DB[k]?.name?.includes('Lint Verify')) {
        delete DB[k];
      }
    });
    save();
    toast("✓ Successfully purged test accounts and dummy test farms.");
    adminPage();
  } catch (e) {
    console.warn("Purge test accounts note:", e);
    toast("✓ Local test accounts purged.");
    adminPage();
  }
}
window.purgeTestAccountsAdmin = purgeTestAccountsAdmin;

async function changeUser(i, key, value) {
  let us = users();
  let u = us[i];
  if (!u || isPlatformOwnerEmail(u.email)) return;
  if (key === 'role' && value === 'super_admin') {
    toast('Only the verified platform owner email can be SUPER ADMIN.');
    return;
  }
  u[key] = value;
  saveUsers(us);

  if (key === "plan" && DB[u.farmId]) {
    DB[u.farmId].subscription = value;
    save();
  }

  // Real-time sync of role/plan/access to Supabase backend
  if (window.ARSCloud && ARSCloud.updateMemberAccess && u.farmId && (key === 'role' || key === 'plan' || key === 'access')) {
    try {
      await ARSCloud.updateMemberAccess(u.farmId, u.user_id || u.id || u.email, u.role, u.plan, u.access);
      toast(`✓ Updated ${u.name} role to ${String(u.role).toUpperCase()}`);
    } catch (e) {
      console.warn("[User Access Sync] updateMemberAccess error:", e);
    }
  }
}
window.changeUser = changeUser;

async function saveUserAccessRow(i) {
  let us = users();
  let u = us[i];
  if (!u || isPlatformOwnerEmail(u.email)) return;
  saveUsers(us);
  if (window.ARSCloud && ARSCloud.updateMemberAccess && u.farmId) {
    try {
      await ARSCloud.updateMemberAccess(u.farmId, u.user_id || u.id || u.email, u.role, u.plan, u.access);
    } catch(e) {
      console.warn("Cloud member access update note:", e);
    }
  }
  toast(`✓ Access confirmed for ${u.name} (${String(u.role).toUpperCase()})`);
}
window.saveUserAccessRow = saveUserAccessRow;


function go(page) {
  document.querySelectorAll('#reservationDetail,#batchHub,#drillModal,#dueReminderModal,#reservationModal,#allocationModal,#releaseModal,.due-modal-bg,.drill-bg').forEach(x => x.remove());
  document.body.classList.remove('app-modal-open');
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  if (page === 'dashboard') {
    dashboard();
    setTimeout(() => window.decorateDashboard?.(), 0);
  }
  if (page === 'barns') {
    setTimeout(() => window.renderBarns?.(), 0);
  }
  if (page === 'rfid') {
    setTimeout(() => window.renderRFID?.(), 0);
  }
  if (page === 'kpis') {
    setTimeout(() => window.renderKpiCenter?.(), 0);
  }
  if (page === 'useradmin') {
    setTimeout(() => adminPage(), 0);
  }
  const premium = ['predictor', 'production', 'kpis', 'semen', 'financials', 'pos'];
  if (premium.includes(page) && !isSuperAdmin() && planForCurrentFarm() !== 'full' && planForCurrentFarm() !== 'platform') {
    page = 'subscription';
    toast('Full Access subscription required for that feature')
  }
  /* [FIX 104] expired trial farms lose premium access */
  if (window.arsIsTrialFarm && window.arsIsTrialFarm() && window.arsTrialActive && !window.arsTrialActive()) {
    page = 'subscription';
    window.arsTrialExpiredScreen && window.arsTrialExpiredScreen();
  }
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  document.getElementById(page).classList.add('active');
  document.querySelectorAll('[data-page]').forEach(x => x.classList.toggle('active', x.dataset.page === page));
  document.getElementById('pageTitle').textContent = titles[page];
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  })
}
// override login to register the signed-in address in the local directory and apply platform permissions.
function showLoginError(message) {
  let box = document.getElementById('loginError');
  if (box) {
    box.textContent = message;
    box.classList.add('show')
  }
}

function clearLoginError() {
  let box = document.getElementById('loginError');
  if (box) {
    box.textContent = '';
    box.classList.remove('show')
  }
}

function authError(id, message) {
  let box = document.getElementById(id);
  if (box) {
    box.textContent = message;
    box.classList.add('show')
  }
}

function clearAuthError(id) {
  let box = document.getElementById(id);
  if (box) {
    box.textContent = '';
    box.classList.remove('show')
  }
}
function clearVerifiedWorkspace() {
  STORE.removeItem('ars-auth');
  window.currentFarmAssigned = false;
  window.platformAdminVerified = false;
  window.myFarmRole = null;
  window.arsSessionUser = null;
  window.arsMemberships = [];
  window.arsActiveMembership = null;
  window.arsContextReady = false;
  window.arsOfflineMode = false;
  window.__arsActiveFarmId = null;
  window.arsServerFarms = [];
  window.__arsCloudBaselineReady = false;
  window.__arsPendingUnverifiedSave = false;
  document.body.classList.remove('farm-access-granted');
  const loginScr = document.getElementById('loginScreen');
  if (loginScr) loginScr.style.display = 'grid';
  setFarmSelect();
  applyAccess();
}

function rememberMembership(user, membership) {
  if (!membership || !membership.farm_id) return;
  const farmRelation = membership.farms && !Array.isArray(membership.farms) ? membership.farms : null;
  const record = {
    user_id: user?.id || null,
    farm_id: String(membership.farm_id),
    farm_name: farmRelation?.name || DB[membership.farm_id]?.name || "RM's Hog Farm",
    role: membership.role || 'staff',
    plan: membership.plan || 'starter',
    is_active: membership.is_active !== false,
    saved_at: new Date().toISOString()
  };
  try { STORE.setItem('ars-last-membership-v1', JSON.stringify(record)); } catch (_) {}
}

async function activateFarmContext(id, options = {}) {
  const targetId = String(id || '').trim();
  const membership = (window.arsMemberships || []).find(m => String(m.farm_id) === targetId) || null;
  if (!targetId || (!isSuperAdmin() && !membership)) {
    showLoginError('This farm is not assigned to the signed-in account.');
    return false;
  }

  farmId = targetId;
  window.farmId = targetId;
  window.__arsActiveFarmId = targetId;
  window.arsActiveMembership = membership || {
    farm_id: targetId,
    role: 'platform',
    plan: 'platform',
    is_active: true
  };
  window.myFarmRole = window.arsActiveMembership.role;
  window.arsContextReady = true;
  window.__arsCloudBaselineReady = false;
  window.__arsPendingUnverifiedSave = false;
  STORE.setItem('arswine-active-farm', targetId);
  F(); // creates only an empty local bucket when this farm has no local cache
  setFarmSelect();

  if (options.offline) {
    window.__arsLastSavedFarmById = window.__arsLastSavedFarmById || {};
    window.__arsLastSavedFarmById[targetId] = JSON.parse(JSON.stringify(F()));
    window.arsOfflineMode = true;
    window.currentFarmAssigned = true;
    document.body.classList.add('farm-access-granted');
    const loginScr = document.getElementById('loginScreen');
    if (loginScr) loginScr.style.display = 'none';
    if (window.updateSyncIndicator) window.updateSyncIndicator('offline', 'Offline', 'Cloud was not contacted. Local records are not marked as synchronized.');
    renderAll();
    applyAccess();
    if (window.arsPostFarmActivate) window.arsPostFarmActivate(targetId); /* [FIX 106] */
    return true;
  }

  if (window.ARSCloud && ARSCloud.configured()) {
    if (!navigator.onLine) {
      showLoginError('Internet access is required to verify the farm workspace. Reopen the app online, or use the explicitly marked offline workspace.');
      window.arsContextReady = false;
      return false;
    }
    if (window.updateSyncIndicator) window.updateSyncIndicator('syncing', 'Verifying farm...');
    const result = await ARSCloud.pullFarm(targetId, { allowDirty: true });
    if (!result || result.success === false) {
      window.arsContextReady = false;
      window.currentFarmAssigned = false;
      window.arsActiveMembership = null;
      window.__arsActiveFarmId = null;
      document.body.classList.remove('farm-access-granted');
      if (window.updateSyncIndicator) window.updateSyncIndicator('error', 'Not synced', result?.reason || 'Could not verify the cloud farm dataset.');
      showLoginError(result?.reason || 'Could not load the verified cloud farm dataset. No local data was uploaded.');
      return false;
    }
    window.__arsCloudBaselineReady = true;
    window.arsOfflineMode = false;
    if (window.updateSyncIndicator) window.updateSyncIndicator('synced', 'Synced', `Cloud baseline verified: ${result.count} records.`);
  }

  window.currentFarmAssigned = true;
  document.body.classList.add('farm-access-granted');
  const loginScr = document.getElementById('loginScreen');
  if (loginScr) loginScr.style.display = 'none';
  const onboardScr = document.getElementById('onboardScreen');
  if (onboardScr) onboardScr.classList.remove('open');
  setFarmSelect();
  renderAll();
  /* [FIX 106] let the trial module offer data migration after real activation */
  if (window.arsPostFarmActivate) window.arsPostFarmActivate(targetId);
  applyAccess();
  return true;
}

async function finishAuthenticated(email, suppliedUser = null, options = {}) {
  const user = suppliedUser || await ARSCloud.getCurrentUser();
  const cleanEmail = String(user?.email || email || '').trim().toLowerCase();
  if (!user?.id || !cleanEmail) throw new Error('Supabase returned an incomplete authenticated user.');

  window.arsSessionUser = user;
  STORE.setItem('ars-current-email', cleanEmail);
  /* [FIX 127] this device now appears in the admin presence list */
  if (window.ARSPresence) window.ARSPresence.start({ uid: user.id, email: cleanEmail });
  const userList = users();
  let account = userList.find(u => String(u.email || '').toLowerCase() === cleanEmail);
  if (!account) {
    account = { id: user.id, email: cleanEmail, name: cleanEmail.split('@')[0], farmId: null, role: 'staff', plan: 'starter', access: true };
    userList.push(account);
    saveUsers(userList);
  }

  let allMemberships;
  try {
    allMemberships = await ARSCloud.getFarmMemberships();
  } catch (error) {
    clearVerifiedWorkspace();
    showLoginError(`Signed in, but the farm membership could not be verified: ${error.message || error}`);
    return false;
  }
  allMemberships = Array.isArray(allMemberships) ? allMemberships : [];
  const activeMemberships = allMemberships.filter(m => m && m.farm_id && m.is_active !== false);
  window.arsMemberships = activeMemberships;

  let platformAdmin = false;
  try { platformAdmin = (await ARSCloud.isPlatformAdmin()) === true; } catch (_) { platformAdmin = false; }
  window.platformAdminVerified = platformAdmin;

  // A platform owner is authorized by the server-side email check, not by a
  // local plan flag. Load every server farm into the admin selector without
  // overwriting any existing local bucket or farm logo.
  let serverFarms = [];
  if (platformAdmin) {
    try {
      serverFarms = await ARSCloud.listFarms();
      window.arsServerFarms = Array.isArray(serverFarms) ? serverFarms : [];
      window.arsServerFarms.forEach(serverFarm => {
        if (!serverFarm?.id) return;
        ensureFarmBucket(serverFarm.id, serverFarm.name || "RM's Hog Farm", serverFarm.logo_url || null);
      });
    } catch (error) {
      window.arsServerFarms = [];
      console.warn('[Platform Admin] Farm catalog read failed:', error);
    }
  } else {
    /* [FIX 117] members also get their farm's registration meta (owner,
       municipality, province) so reports can auto-fill Farm Information. */
    try {
      const memberFarms = await ARSCloud.listFarms();
      window.arsServerFarms = Array.isArray(memberFarms) ? memberFarms : [];
    } catch (_) {
      window.arsServerFarms = [];
    }
  }

  if (!platformAdmin && !activeMemberships.length) {
    clearVerifiedWorkspace();
    window.arsSessionUser = user;
    STORE.setItem('ars-current-email', cleanEmail);
    if (allMemberships.some(m => m && m.farm_id && m.is_active === false)) {
      showLoginError('This account has no active farm membership. Contact the farm administrator.');
      return false;
    }
    const loginScr = document.getElementById('loginScreen');
    if (loginScr) loginScr.style.display = 'none';
    document.getElementById('onboardScreen')?.classList.add('open');
    return true;
  }

  let selectedId = activeMemberships.find(m => String(m.farm_id) === String(STORE.getItem('arswine-active-farm')))?.farm_id;
  if (!selectedId && activeMemberships.length) selectedId = activeMemberships[0].farm_id;
  if (!selectedId && platformAdmin) {
    selectedId = serverFarms.find(f => String(f.id) === String(STORE.getItem('arswine-active-farm')))?.id || serverFarms[0]?.id;
  }
  if (!selectedId) {
    clearVerifiedWorkspace();
    showLoginError('No farm workspace is available for this authenticated account.');
    return false;
  }

  // Preserve any old/orphaned local farm buckets before selecting the validated
  // server membership. They are recovery references only and are never merged
  // or uploaded automatically.
  if (window.ARSCloud && typeof ARSCloud.saveLocalRecovery === 'function') {
    const allowedIds = new Set((platformAdmin ? (window.arsServerFarms || []).map(f => f.id) : activeMemberships.map(m => m.farm_id)).map(String));
    Object.keys(DB || {}).forEach(localId => {
      if (!allowedIds.has(String(localId)) && DB[localId]) {
        ARSCloud.saveLocalRecovery(localId, DB[localId], 'orphaned local bucket preserved during membership selection');
      }
    });
  }

  const membership = activeMemberships.find(m => String(m.farm_id) === String(selectedId));
  window.arsActiveMembership = membership || { farm_id: selectedId, role: 'platform', plan: 'platform', is_active: true };
  window.myFarmRole = window.arsActiveMembership.role;
  rememberMembership(user, window.arsActiveMembership);
  if (account) {
    account.farmId = String(selectedId);
    account.role = window.arsActiveMembership.role;
    account.plan = window.arsActiveMembership.plan;
    account.access = true;
    saveUsers(userList);
  }

  const ok = await activateFarmContext(selectedId);
  if (!ok) {
    document.getElementById('loginScreen').style.display = 'grid';
    return false;
  }
  STORE.setItem('ars-auth', '1');
  toast(`Welcome back, ${account?.name || cleanEmail.split('@')[0]}`);
  return true;
}
async function login(e) {
  if (e) e.preventDefault();
  clearLoginError();
  let field = document.querySelector('.login-card input[type="email"]'),
    password = document.querySelector('.login-card input[type="password"]')?.value || '',
    email = (field?.value || '').trim().toLowerCase();
  if (!email || !password) {
    showLoginError('Enter your email address and password, then try again.');
    return;
  }
  if (!window.ARSCloud) {
    showLoginError('The cloud sign-in service did not load. Refresh this page and try again.');
    return;
  }
  try {
    await ARSCloud.signIn(email, password);
    await finishAuthenticated(email);
  } catch (err) {
    const msg = err && err.message ? err.message : '';
    if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
      /* [FIX 108] farmer-friendly wording — no backend jargon for new users */
      showLoginError('Wrong email or password. Please try again, or tap "Forgot password?" to reset it.');
    } else {
      showLoginError(msg || 'Unable to sign in. Check your email and password.');
    }
  }
}
async function registerAccount() {
  clearLoginError();
  let email = document.querySelector('.login-card input[type="email"]')?.value.trim().toLowerCase(),
    password = document.querySelector('.login-card input[type="password"]')?.value || '';
  if (!email || !password || password.length < 6) {
    showLoginError('Enter an email and a password with at least 6 characters.');
    return;
  }
  if (!window.ARSCloud) {
    showLoginError('The cloud registration service did not load. Refresh this page and try again.');
    return;
  }
  try {
    let result = await ARSCloud.signUp(email, password);
    if (result && (result.session || result.access_token)) {
      await finishAuthenticated(email);
    } else {
      showLoginError('Account created! Please sign in with your password.');
    }
  } catch (err) {
    const msg = err && err.message ? err.message : '';
    if (msg.includes('User already registered') || msg.includes('user_already_exists')) {
      showLoginError('This email is already registered in Supabase. Please sign in with your password.');
    } else {
      showLoginError(msg || 'Unable to create account.');
    }
  }
}

function showResetRequest() {
  clearAuthError('resetError');
  document.getElementById('resetScreen').classList.add('open');
  document.getElementById('resetRequestForm').style.display = 'block';
  document.getElementById('resetNewForm').style.display = 'none';
  document.getElementById('resetTitle').textContent = 'Reset your password';
  document.getElementById('resetText').textContent = 'Enter your account email and we will send a secure password reset link.';
  document.getElementById('resetEmail').value = document.querySelector('.login-card input[type="email"]')?.value || ''
}

function closeReset() {
  document.getElementById('resetScreen').classList.remove('open')
}
async function requestPasswordReset() {
  clearAuthError('resetError');
  let email = document.getElementById('resetEmail').value.trim();
  if (!email) {
    authError('resetError', 'Enter the email address for your ARSwineTech account.');
    return
  }
  try {
    await ARSCloud.sendPasswordReset(email, location.origin + location.pathname);
    document.getElementById('resetRequestForm').style.display = 'none';
    document.getElementById('resetText').textContent = 'If that email belongs to an account, Supabase has sent a secure reset link. Check your inbox and spam folder.'
  } catch (err) {
    authError('resetError', err.message || 'Could not send a reset link. Try again.')
  }
}

function openNewPassword() {
  clearAuthError('resetError');
  document.getElementById('resetScreen').classList.add('open');
  document.getElementById('resetRequestForm').style.display = 'none';
  document.getElementById('resetNewForm').style.display = 'block';
  document.getElementById('resetTitle').textContent = 'Create a new password';
  document.getElementById('resetText').textContent = 'This page is protected by your one-time Supabase recovery link.'
}
async function completePasswordReset() {
  clearAuthError('resetError');
  let a = document.getElementById('newPassword').value,
    b = document.getElementById('confirmPassword').value;
  if (a.length < 6) {
    authError('resetError', 'Use at least 6 characters for your new password.');
    return
  }
  if (a !== b) {
    authError('resetError', 'The passwords do not match.');
    return
  }
  try {
    await ARSCloud.updatePassword(a);
    document.getElementById('resetText').textContent = 'Password updated successfully. You can now sign in.';
    document.getElementById('resetNewForm').style.display = 'none';
    setTimeout(closeReset, 1800)
  } catch (err) {
    authError('resetError', err.message || 'The reset link is invalid or expired. Request a new one.')
  }
}
function openJoinFarmModal() {
  const screen = document.getElementById('joinFarmScreen');
  const input = document.getElementById('joinInvitationCode');
  const error = document.getElementById('joinFarmError');
  if (!screen) return;
  if (error) {
    error.textContent = '';
    error.classList.remove('show');
  }
  if (input) {
    input.value = '';
    input.disabled = false;
  }
  screen.classList.add('open');
  screen.setAttribute('aria-hidden', 'false');
  setTimeout(() => input?.focus(), 40);
}

function closeJoinFarmModal() {
  const screen = document.getElementById('joinFarmScreen');
  if (!screen) return;
  screen.classList.remove('open');
  screen.setAttribute('aria-hidden', 'true');
  const error = document.getElementById('joinFarmError');
  if (error) {
    error.textContent = '';
    error.classList.remove('show');
  }
}

async function submitJoinFarm(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('joinInvitationCode');
  const error = document.getElementById('joinFarmError');
  const submit = document.getElementById('joinFarmSubmit');
  // Normalize copied codes such as "ARS - 139C68" without changing the
  // server-side authorization decision. The RPC performs the authoritative
  // case-insensitive lookup and expiry/rotation check.
  const code = String(input?.value || '').trim().toUpperCase().replace(/\s+/g, '');
  const showError = message => {
    if (error) {
      error.textContent = message;
      error.classList.add('show');
    }
  };
  if (!code || code.length < 6) {
    showError('Enter the current invitation code from the farm owner.');
    input?.focus();
    return;
  }
  if (!window.ARSCloud || typeof ARSCloud.joinFarmWithInvitation !== 'function') {
    showError('The secure invitation service did not load. Refresh the app and try again.');
    return;
  }

  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Verifying invitation…';
  }
  if (input) input.disabled = true;
  if (error) {
    error.textContent = '';
    error.classList.remove('show');
  }

  try {
    // This RPC only creates/activates the caller's membership. It does not
    // upload local farm data and does not overwrite any existing app record.
    const result = await ARSCloud.joinFarmWithInvitation(code);
    const joinedFarmId = typeof result === 'string'
      ? result
      : (result?.farm_id || result?.id || result?.farmId || result?.join_farm_with_invitation || '');
    if (!joinedFarmId) throw new Error('The invitation was accepted but no farm workspace was returned.');

    // Re-read the verified session and memberships, then pull the cloud
    // baseline through the same safe path used by normal sign-in.
    const user = await ARSCloud.getCurrentUser();
    const ok = await finishAuthenticated(user.email, user, { joined: true });
    if (!ok) throw new Error('Your membership was created, but the farm workspace could not be verified. Please sign in again.');
    closeJoinFarmModal();
    toast('✓ You joined the farm securely. Cloud records are now syncing.');
  } catch (ex) {
    console.warn('[Farm invitation] Join failed:', ex);
    const message = String(ex?.message || ex || 'Could not join this farm.');
    showError(/invalid|expired|invitation/i.test(message)
      ? 'That invitation code is invalid, expired, or has already been replaced. Ask the farm owner for the current code.'
      : message);
    if (input) input.disabled = false;
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Join farm securely →';
    }
  }
}

async function completeOnboarding(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const err = document.getElementById('onboardError');
  err.classList.remove('show');
  try {
    const id = await ARSCloud.onboard(data);
    /* [FIX 117] keep the registration details (owner name, address,
       municipality, province) on the local farm record so reports can
       auto-fill Farm Information. */
    const ownerName = ((data.first_name || '') + ' ' + (data.last_name || '')).trim();
    DB[id] = {
      name: data.farm_name,
      owner: ownerName, owner_name: ownerName,
      mobile: data.mobile_number || '',
      address: data.farm_address || '', barangay: data.barangay || '',
      municipality: data.municipality || '', province: data.province || '',
      location: [data.municipality, data.province].filter(Boolean).join(', '),
      sows: [], piglets: [], feed: [], semen: [], transactions: [], sales: [],
      reminders: [], medicines: [], vaccinations: [], reservations: [],
      subscription: 'starter'
    };
    farmId = id;
    window.farmId = id;
    STORE.setItem('arswine-active-farm', id);
    // The RPC already created the membership. Re-read it and load the empty
    // cloud baseline; do not push the local onboarding object back to cloud.
    const user = await ARSCloud.getCurrentUser();
    const ok = await finishAuthenticated(user.email, user, { onboarding: true });
    if (!ok) throw new Error('The new farm was created, but its membership could not be verified.');
    toast('Your secure farm workspace is ready.');
  } catch (ex) {
    /* [FIX 126] farmer-friendly wording for the one-time DB setup error */
    const rawMsg = ex.message || 'Could not create your farm workspace. Please try again.';
    err.textContent = /uuid_generate_v4/i.test(rawMsg)
      ? 'The secure workspace needs a one-time database setup (missing uuid extension). Please contact ARSwineTech support and ask them to run supabase/fix_uuid_extension.sql once, then try again.'
      : rawMsg;
    err.classList.add('show');
  }
}
if (window.ARSCloud && ARSCloud.captureRecoverySession()) setTimeout(openNewPassword, 50);
async function startApp() {
  // IndexedDB is only a same-device recovery source. It may fill an entirely
  // empty local database, but it must never win merely because it has more rows.
  const offlineSnapshot = await deviceRead();
  if (offlineSnapshot && typeof offlineSnapshot === 'object' && !Object.keys(DB || {}).length) {
    DB = offlineSnapshot;
    Object.keys(DB).forEach(k => sanitizeFarm(DB[k]));
    window.DB = DB;
  }

  const rememberedEmail = (STORE.getItem('ars-current-email') || '').toLowerCase();
  const emailInput = document.getElementById('loginEmailInput') || document.querySelector('.login-card input[type="email"]');
  if (emailInput && rememberedEmail) emailInput.value = rememberedEmail;

  if (!window.ARSCloud || !ARSCloud.configured()) {
    clearVerifiedWorkspace();
    showLoginError('The secure cloud configuration is unavailable.');
    return;
  }

  const restored = await ARSCloud.restoreSession();
  if (restored && restored.verified) {
    const ok = await finishAuthenticated(restored.user.email, restored.user, { restored: true });
    if (ok) return;
  }

  // Explicit offline mode is allowed only from a previously validated user/farm
  // context, and it is visibly marked as offline rather than synced.
  if (restored && restored.offline && !navigator.onLine) {
    let last = null;
    try { last = JSON.parse(STORE.getItem('ars-last-membership-v1') || 'null'); } catch (_) {}
    if (last && last.user_id === restored.user?.id && last.farm_id) {
      window.arsSessionUser = restored.user;
      window.arsMemberships = [last];
      window.arsActiveMembership = last;
      window.platformAdminVerified = false;
      const ok = await activateFarmContext(last.farm_id, { offline: true });
      if (ok) return;
    }
  }

  // A stale local ars-auth flag never grants access. Keep local data untouched
  // for recovery, but require a verified session before showing production data.
  clearVerifiedWorkspace();
  applyAccess();
}
let st = document.getElementById('authStatus');
if (st) {
  st.textContent = '✓ Secure cloud sign-in ready';
  st.className = 'auth-status ready';
}
document.querySelectorAll('[data-page]').forEach(x => x.onclick = () => go(x.dataset.page));

function bootApp() {
  startApp().then(() => {
    if (document.body.classList.contains('farm-access-granted')) {
      renderAll();
    }
  }).catch(e => console.warn('App boot note:', e));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  setTimeout(bootApp, 30);
}

window.renderAll = renderAll;
window.crudPage = crudPage;
window.dashboard = dashboard;
window.predictor = predictor;
window.feedForecast = feedForecast;
window.production = production;
window.subscriptionPage = subscriptionPage;
window.adminPage = adminPage;
window.applyAccess = applyAccess;
window.go = go;
window.save = save;
window.status = status;
window.fmtDate = fmtDate;
window.d = d;
window.days = days;
window.peso = peso;
window.isActiveSow = isActiveSow;
window.activateFarmContext = activateFarmContext;
window.openJoinFarmModal = openJoinFarmModal;
window.closeJoinFarmModal = closeJoinFarmModal;
window.submitJoinFarm = submitJoinFarm;
window.isSuperAdmin = isSuperAdmin;
window.isPlatformOwnerEmail = isPlatformOwnerEmail;
window.esc = esc;
/* [REBUILD FIX 125] escJS — string-safe encoding for inline onclick="fn('...')"
   handlers. Unlike esc(), it backslash-escapes \ ' " & so apostrophes in
   user-typed IDs ("Rm's Blake") can no longer terminate the JS string and
   silently kill the button. */
function escJS(v) { return String(v ?? '').replace(/[\'"&]/g, ch => '\\' + ch); }
window.escJS = escJS;
window.isoOff = isoOff;

/* [REBUILD FIX 115] REGISTERED ANIMAL PHOTOS — upload, on-device compression,
   removal. Photos are downscaled to ≤320px JPEG (~15–40 KB each) BEFORE they
   are stored in the farm record, so a farm with hundreds of photographed
   animals only adds a few megabytes — well inside the cloud quota — and the
   same tiny data-url syncs to every device and flows into the Pedigree &
   Lineage Report automatically. */
function arsCompressImage(file, maxDim = 320, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return reject(new Error('that file is not an image'));
    if (file.size > 12 * 1024 * 1024) return reject(new Error('image is too large (max 12 MB)'));
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) { reject(new Error('could not process the image')); }
      };
      img.onerror = () => reject(new Error('could not read the image'));
      img.src = fr.result;
    };
    fr.onerror = () => reject(new Error('could not read the file'));
    fr.readAsDataURL(file);
  });
}
window.arsCompressImage = arsCompressImage;

function arsPickAnimalPhoto(rec, done) {
  if (!rec) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const url = await arsCompressImage(file);
      rec.photo = url;
      save();
      toast(`📷 Photo saved — compressed to ${Math.max(1, Math.round(url.length / 1024))} KB.`);
      if (typeof done === 'function') done();
    } catch (e) {
      toast('Could not use that image: ' + e.message);
    }
  };
  input.click();
}
window.arsPickAnimalPhoto = arsPickAnimalPhoto;

function arsRemoveAnimalPhoto(rec, done) {
  if (!rec) return;
  delete rec.photo;
  save();
  toast('📷 Photo removed.');
  if (typeof done === 'function') done();
}
window.arsRemoveAnimalPhoto = arsRemoveAnimalPhoto;

function arsSowPhoto(index) {
  const s = (F() && F().sows || [])[index];
  if (s) arsPickAnimalPhoto(s, () => renderAll());
}
window.arsSowPhoto = arsSowPhoto;

function arsSowPhotoRemove(index) {
  const s = (F() && F().sows || [])[index];
  if (s) arsRemoveAnimalPhoto(s, () => renderAll());
}
window.arsSowPhotoRemove = arsSowPhotoRemove;

function arsBoarPhoto(id) {
  const rec = (F() && F().boars || []).find(x => (x.id || x.name) === id);
  if (rec) arsPickAnimalPhoto(rec, () => { if (window.openBoarDetailModal) window.openBoarDetailModal(rec); });
}
window.arsBoarPhoto = arsBoarPhoto;

function arsBoarPhotoRemove(id) {
  const rec = (F() && F().boars || []).find(x => (x.id || x.name) === id);
  if (rec) arsRemoveAnimalPhoto(rec, () => { if (window.openBoarDetailModal) window.openBoarDetailModal(rec); });
}
window.arsBoarPhotoRemove = arsBoarPhotoRemove;

/* [REBUILD FIX 118] Save the Farm Profile (owner + registration address).
   Stored on the farm record so it syncs with the farm and auto-fills the
   Pedigree & Lineage Report's Farm Information block. */
function saveFarmProfile(e) {
  e.preventDefault();
  const f = (typeof F === 'function' && F()) ? F() : null;
  if (!f) { toast('No active farm.'); return; }
  const d = new FormData(e.target);
  f.owner = f.owner_name = String(d.get('owner') || '').trim();
  f.mobile = String(d.get('mobile') || '').trim();
  f.address = String(d.get('address') || '').trim();
  f.barangay = String(d.get('barangay') || '').trim();
  f.municipality = String(d.get('municipality') || '').trim();
  f.province = String(d.get('province') || '').trim();
  f.location = [f.municipality, f.province].filter(Boolean).join(', ') || f.address;
  save();
  renderAll();
  toast('✓ Farm profile saved — reports now show your owner name and location.');
}
window.saveFarmProfile = saveFarmProfile;
