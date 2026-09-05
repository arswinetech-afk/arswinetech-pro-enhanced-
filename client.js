/*
 * ARSwineTech Pro — browser Supabase client and safe cloud synchronizer.
 *
 * This file intentionally uses the public publishable key only. It never contains
 * a service-role/secret key. Production farm records remain protected by RLS.
 *
 * Synchronization safety rules:
 *   1. A local auth flag is never treated as a verified Supabase session.
 *   2. Access/refresh sessions are persisted and refreshed before protected calls.
 *   3. Cloud reads are paginated and errors are not converted into empty data.
 *   4. A successful cloud pull replaces the current farm bucket; it does not merge
 *      arbitrary local rows back into the cloud-authoritative result.
 *   5. Local-to-cloud writes are dirty-record-only and blocked until a verified
 *      cloud baseline has loaded.
 *   6. A newer remote version is never silently overwritten by a stale device.
 */
window.ARSCloud = (() => {
  const c = window.ARS_SUPABASE_CONFIG || {
    url: 'https://hgmrltewkxjmhlqevjrp.supabase.co',
    anonKey: 'sb_publishable_NWmfAur6bNoulNv0anC-nQ_11CkOtCT'
  };
  window.ARS_SUPABASE_CONFIG = c;

  const SESSION_KEY = 'ars-supabase-session-v2';
  const LEGACY_TOKEN_KEY = 'ars-supabase-token';
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 1000;

  const entityMap = {
    sows: 'sow',
    piglets: 'piglet_batch',
    feed: 'feed_inventory',
    semen: 'semen_inventory',
    transactions: 'transaction',
    sales: 'pos_sale',
    reminders: 'reminder',
    medicines: 'medicine',
    vaccinations: 'vaccination',
    reservations: 'reservation',
    semenSales: 'semen_sale',
    semenResellers: 'semen_reseller',
    semenResellerTx: 'semen_reseller_tx',
    semenResellerAdjustments: 'semen_reseller_adjustment',
    feedTrials: 'feed_trial',
    feedOrders: 'feed_order',
    boars: 'boar',
    barns: 'barn',
    movements: 'movement',
    rfid_tags: 'rfid_tag',
    rfid_scans: 'rfid_scan',
    breedingRecords: 'breeding_record',
    pigletLedger: 'piglet_ledger',
    heatRecords: 'heat_record',
    treatments: 'treatment',
    med_movements: 'med_movement',
    vaccination_events: 'vaccination_event',
    vaxSchedules: 'vax_schedule',
    vetCatalog: 'vet_catalog',
    marketQuotes: 'market_quote',
    productionEvents: 'production_event',
    feedAllocations: 'feed_allocation',
    auditLog: 'audit_event',
    integrationEvents: 'integration_event',
    populationSnapshots: 'population_snapshot',
    benchmarkProfiles: 'benchmark_profile',
    feedDuplicateRecovery: 'feed_duplicate_recovery'
  };

  const typeToKey = Object.fromEntries(Object.entries(entityMap).map(([key, type]) => [type, key]));
  typeToKey.rfid_scan = 'rfid_scans';
  typeToKey.rfid_scans = 'rfid_scans';

  const dirtyVersions = new Map();
  const cloudVersions = new Map();
  /* [FIX C3] Offline-safe delete queue. A delete recorded while offline (or that
     failed mid-flight) is queued per farm/entity/local-key and retried by the
     same auto-push loop; rows with a pending delete are never re-uploaded, so a
     later cloud pull cannot silently resurrect a record the farmer deleted. */
  const pendingDeletes = new Map(); // key -> {farm_id, entity_type, local_id, queued_at}
  let localMutationVersion = 0;
  let session = null;
  let token = '';
  let lastSessionError = null;

  function storage() {
    try {
      return window.localStorage;
    } catch (_) {
      return null;
    }
  }

  function clone(value) {
    if (value === undefined || value === null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  function readPersistedSession() {
    const store = storage();
    let saved = null;
    try { saved = store && JSON.parse(store.getItem(SESSION_KEY) || 'null'); } catch (_) { saved = null; }
    if (saved && saved.access_token) return saved;

    // A legacy access token may still be valid. It is deliberately not trusted
    // until restoreSession() validates it against /auth/v1/user.
    let legacy = '';
    try { legacy = sessionStorage.getItem(LEGACY_TOKEN_KEY) || ''; } catch (_) {}
    return legacy ? { access_token: legacy, refresh_token: null, user: null } : null;
  }

  function persistSession(body) {
    if (!body || !body.access_token) return null;
    const prior = session || {};
    const expiresIn = Number(body.expires_in || prior.expires_in || 3600);
    const expiresAt = Number(body.expires_at || prior.expires_at || Math.floor(Date.now() / 1000) + expiresIn);
    session = {
      access_token: body.access_token,
      refresh_token: body.refresh_token || prior.refresh_token || null,
      expires_in: expiresIn,
      expires_at: expiresAt,
      token_type: body.token_type || prior.token_type || 'bearer',
      user: body.user || prior.user || null
    };
    token = session.access_token;
    try { sessionStorage.setItem(LEGACY_TOKEN_KEY, token); } catch (_) {}
    const store = storage();
    try { if (store) store.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) {}
    return session;
  }

  function clearSession() {
    session = null;
    token = '';
    try { sessionStorage.removeItem(LEGACY_TOKEN_KEY); } catch (_) {}
    const store = storage();
    try { if (store) store.removeItem(SESSION_KEY); } catch (_) {}
  }

  function loadSessionOnce() {
    if (!session && !token) {
      session = readPersistedSession();
      token = session?.access_token || '';
    }
    return session;
  }

  function sessionExpired(skewSeconds = 60) {
    const expiresAt = Number(session?.expires_at || 0);
    return Boolean(expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + skewSeconds);
  }

  function errorFrom(body, status) {
    const message = body?.msg || body?.message || body?.error_description || body?.error || `Supabase error ${status}`;
    const error = new Error(message);
    error.status = status;
    error.body = body;
    return error;
  }

  async function rawRequest(path, options = {}, authenticated = true) {
    loadSessionOnce();
    const extra = options.headers || {};
    const bearer = authenticated && token ? token : c.anonKey;
    const response = await fetch(`${c.url}${path}`, {
      ...options,
      headers: {
        apikey: c.anonKey,
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...extra
      }
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw errorFrom(body, response.status);
    return { body, response };
  }

  async function refreshSessionInternal() {
    loadSessionOnce();
    if (!session?.refresh_token) return null;
    try {
      const result = await rawRequest('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: session.refresh_token }),
        headers: { Authorization: `Bearer ${c.anonKey}` }
      }, false);
      persistSession(result.body);
      lastSessionError = null;
      return session;
    } catch (error) {
      lastSessionError = error;
      if (error.status === 400 || error.status === 401) clearSession();
      throw error;
    }
  }

  async function ensureFreshSession(required = true) {
    loadSessionOnce();
    if (!token) {
      if (required) throw errorFrom({ message: 'Authentication required.' }, 401);
      return null;
    }
    if (sessionExpired(90)) {
      if (session?.refresh_token) return refreshSessionInternal();
      if (required && !session?.user) throw errorFrom({ message: 'The session must be verified again.' }, 401);
    }
    return session || { access_token: token };
  }

  async function requestWithMeta(path, options = {}, requestOptions = {}) {
    const {
      requireAuth = false,
      retryRefresh = true,
      authenticated = true
    } = requestOptions;
    if (requireAuth) await ensureFreshSession(true);
    try {
      return await rawRequest(path, options, authenticated);
    } catch (error) {
      if (error.status === 401 && retryRefresh && session?.refresh_token) {
        await refreshSessionInternal();
        return rawRequest(path, options, true);
      }
      throw error;
    }
  }

  async function request(path, options = {}, requestOptions = {}) {
    const result = await requestWithMeta(path, options, requestOptions);
    return result.body;
  }

  async function signIn(email, password) {
    const result = await requestWithMeta('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.anonKey}` },
      body: JSON.stringify({ email, password })
    }, { authenticated: false, retryRefresh: false });
    persistSession(result.body);
    lastSessionError = null;
    return result.body.user;
  }

  async function signUp(email, password) {
    const result = await requestWithMeta('/auth/v1/signup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.anonKey}` },
      body: JSON.stringify({ email, password })
    }, { authenticated: false, retryRefresh: false });
    if (result.body?.access_token) persistSession(result.body);
    if (result.body?.access_token && !result.body.session) {
      result.body.session = { access_token: result.body.access_token, user: result.body.user };
    }
    return result.body;
  }

  async function restoreSession() {
    loadSessionOnce();
    if (!token) return null;
    try {
      if (sessionExpired(90) && session?.refresh_token) await refreshSessionInternal();
      const result = await requestWithMeta('/auth/v1/user', {}, {
        requireAuth: true,
        retryRefresh: true
      });
      if (session) persistSession({ ...session, user: result.body });
      else persistSession({ access_token: token, user: result.body });
      lastSessionError = null;
      return { user: result.body, session: clone(session), verified: true, offline: false };
    } catch (error) {
      lastSessionError = error;
      // A network failure while offline may use the last validated local session
      // for an explicitly offline workspace. It must never be presented as cloud-synced.
      if (error.status !== 401 && !navigator.onLine && session?.user) {
        return { user: clone(session.user), session: clone(session), verified: false, offline: true, error };
      }
      if (error.status === 401) clearSession();
      return null;
    }
  }

  async function getCurrentUser() {
    const result = await requestWithMeta('/auth/v1/user', {}, { requireAuth: true });
    if (session) persistSession({ ...session, user: result.body });
    return result.body;
  }

  async function signOut() {
    loadSessionOnce();
    if (token) await request('/auth/v1/logout', { method: 'POST' }, { requireAuth: false }).catch(() => {});
    clearSession();
  }

  async function sendPasswordReset(email, redirectTo) {
    return request('/auth/v1/recover', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.anonKey}` },
      body: JSON.stringify({ email, redirect_to: redirectTo })
    }, { authenticated: false, retryRefresh: false });
  }

  function captureRecoverySession() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.get('type') === 'recovery' && params.get('access_token')) {
      persistSession({
        access_token: params.get('access_token'),
        refresh_token: params.get('refresh_token'),
        expires_in: Number(params.get('expires_in') || 3600)
      });
      history.replaceState({}, document.title, location.pathname);
      return true;
    }
    return false;
  }

  async function updatePassword(password) {
    await ensureFreshSession(true);
    return request('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password }) }, { requireAuth: true });
  }

  async function onboard(form) {
    return request('/rest/v1/rpc/onboard_my_farm', {
      method: 'POST',
      body: JSON.stringify({
        p_first_name: form.first_name,
        p_last_name: form.last_name,
        p_mobile_number: form.mobile_number,
        p_farm_name: form.farm_name,
        p_farm_address: form.farm_address,
        p_barangay: form.barangay,
        p_municipality: form.municipality,
        p_province: form.province,
        p_timezone: 'Asia/Manila'
      })
    }, { requireAuth: true });
  }

  async function joinFarmWithInvitation(code) {
    const normalized = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!normalized) throw new Error('Enter an invitation code.');
    return request('/rest/v1/rpc/join_farm_with_invitation', {
      method: 'POST',
      body: JSON.stringify({ p_invitation_code: normalized })
    }, { requireAuth: true });
  }

  async function getFarmMemberships() {
    return request('/rest/v1/farm_memberships?select=farm_id,role,plan,is_active,created_at,farms(id,name)&order=created_at.asc', {}, { requireAuth: true });
  }

  async function hasFarm() {
    const rows = await getFarmMemberships();
    return Array.isArray(rows) ? (rows[0] || null) : null;
  }

  async function listPlatformUsers() {
    try {
      const res = await request('/rest/v1/rpc/list_platform_users', { method: 'POST', body: '{}' }, { requireAuth: true });
      return Array.isArray(res) ? res : [];
    } catch (e) {
      console.warn('[ARSCloud] listPlatformUsers error:', e);
      return [];
    }
  }

  async function listFarms() {
    try {
      const res = await request('/rest/v1/farms?select=*&order=created_at.asc', {}, { requireAuth: true }); /* [FIX 117] full row: owner + location captured at registration */
      return Array.isArray(res) ? res : [];
    } catch (e) {
      console.warn('[ARSCloud] listFarms error:', e);
      return [];
    }
  }

  async function isPlatformAdmin() {
    return request('/rest/v1/rpc/is_platform_admin', { method: 'POST', body: '{}' }, { requireAuth: true });
  }

  async function getFarmMeta(farmId) {
    const r = await request('/rest/v1/farms?id=eq.' + encodeURIComponent(farmId) + '&select=name,logo_url&limit=1', {}, { requireAuth: true });
    return Array.isArray(r) ? (r[0] || null) : null;
  }

  async function getFarmName(farmId) {
    const meta = await getFarmMeta(farmId);
    return meta?.name || null;
  }

  async function getFarmRecordCounts(farmId) {
    await ensureFreshSession(true);
    const counts = {};
    for (const [key, type] of Object.entries(entityMap)) {
      const path = `/rest/v1/app_records?select=entity_type&farm_id=eq.${encodeURIComponent(farmId)}&entity_type=eq.${encodeURIComponent(type)}&limit=1`;
      const result = await requestWithMeta(path, { headers: { Prefer: 'count=exact' } }, { requireAuth: true });
      const range = result.response.headers.get('content-range') || '';
      const match = range.match(/\/(\d+|\*)$/);
      counts[key] = match && match[1] !== '*' ? Number(match[1]) : (Array.isArray(result.body) ? result.body.length : 0);
    }
    return counts;
  }

  async function overridePigletLineage(payload) {
    return request('/rest/v1/rpc/override_piglet_lineage', { method: 'POST', body: JSON.stringify(payload) }, { requireAuth: true });
  }

  async function updateMemberAccess(farmId, userId, role, plan, isActive) {
    return request('/rest/v1/rpc/update_farm_member_access', {
      method: 'POST',
      body: JSON.stringify({ p_farm_id: farmId, p_user_id: userId, p_role: role, p_plan: plan, p_is_active: isActive })
    }, { requireAuth: true });
  }

  async function vetReferenceSearch(payload) {
    return request('/functions/v1/vet-reference-search', { method: 'POST', body: JSON.stringify(payload) }, { requireAuth: true });
  }

  async function deleteFarm(farmId) {
    return request('/rest/v1/rpc/delete_my_farm', { method: 'POST', body: JSON.stringify({ p_farm_id: farmId }) }, { requireAuth: true });
  }

  function localIdFor(payload, type, index) {
    if (!payload || typeof payload !== 'object') return `${type}-${index}`;
    const raw = payload._ars_cloud_local_id || payload.id || payload.no || payload.tag || payload.code || payload.name;
    if (raw !== undefined && raw !== null && String(raw).trim()) return String(raw);
    if (type === 'feed_inventory' && payload.type) return `feed-${payload.type}`;
    return `${type}-${index}`;
  }

  function rowKey(farmId, type, localId) {
    return `${String(farmId)}:::${String(type)}:::${String(localId)}`;
  }

  function stablePayload(value) {
    const copy = clone(value) || {};
    if (copy && typeof copy === 'object') {
      delete copy.updated_at;
    }
    return JSON.stringify(copy);
  }

  function markLocalChanges(farmId, previousFarm, currentFarm) {
    if (!farmId || !previousFarm || !currentFarm) return 0;
    let marked = 0;
    const mark = key => {
      dirtyVersions.set(key, (dirtyVersions.get(key) || 0) + 1);
      localMutationVersion++;
      marked++;
    };

    Object.entries(entityMap).forEach(([key, type]) => {
      const before = Array.isArray(previousFarm[key]) ? previousFarm[key] : [];
      const after = Array.isArray(currentFarm[key]) ? currentFarm[key] : [];
      after.forEach((item, index) => {
        if (item && typeof item === 'object' && !item._ars_cloud_local_id && !item.id && !item.no && !item.tag && !item.code && !item.name) {
          item._ars_cloud_local_id = `${type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
        }
      });
      const beforeMap = new Map(before.map((item, index) => [localIdFor(item, type, index), item]));
      const afterMap = new Map(after.map((item, index) => [localIdFor(item, type, index), item]));
      afterMap.forEach((item, id) => {
        if (!beforeMap.has(id) || stablePayload(beforeMap.get(id)) !== stablePayload(item)) mark(rowKey(farmId, type, id));
      });
      // Deletions are intentionally not auto-pushed. Explicit delete actions use
      // deleteAppRecord(), while the old local value remains in recovery storage.
    });

    if (stablePayload(previousFarm.logo || previousFarm.logo_url) !== stablePayload(currentFarm.logo || currentFarm.logo_url)) {
      mark(rowKey(farmId, 'farm_logo', 'logo'));
    }
    if (stablePayload(previousFarm.feedPlan) !== stablePayload(currentFarm.feedPlan)) {
      mark(rowKey(farmId, 'feed_plan', 'config'));
    }
    if (stablePayload(previousFarm.settings) !== stablePayload(currentFarm.settings) || stablePayload(previousFarm.reminderSettings) !== stablePayload(currentFarm.reminderSettings)) {
      mark(rowKey(farmId, 'farm_settings', 'config'));
    }
    return marked;
  }

  function dirtyKeysForFarm(farmId) {
    const prefix = `${String(farmId)}:::`;
    return Array.from(dirtyVersions.keys()).filter(key => key.startsWith(prefix));
  }

  function hasDirtyChanges(farmId) {
    return dirtyKeysForFarm(farmId).length > 0;
  }

  /* ── pending delete queue (FIX C3) ─────────────────────────────────────── */
  function deleteKeyFor(farmId, entityType, localId) {
    return rowKey(farmId, entityType, localId);
  }
  function queuePendingDelete(farmId, entityType, localId) {
    const key = deleteKeyFor(farmId, entityType, localId);
    if (!pendingDeletes.has(key)) {
      pendingDeletes.set(key, { farm_id: String(farmId), entity_type: entityType, local_id: String(localId), queued_at: new Date().toISOString() });
    }
    return key;
  }
  function pendingDeletesForFarm(farmId) {
    return Array.from(pendingDeletes.values()).filter(d => String(d.farm_id) === String(farmId));
  }
  async function flushPendingDeletes(farmId) {
    const queued = pendingDeletesForFarm(farmId);
    if (!queued.length) return { deleted: 0, failed: 0, pending: 0 };
    let deleted = 0, failed = 0;
    for (const d of queued) {
      try {
        await request(`/rest/v1/app_records?farm_id=eq.${encodeURIComponent(d.farm_id)}&entity_type=eq.${encodeURIComponent(d.entity_type)}&local_id=eq.${encodeURIComponent(d.local_id)}`, { method: 'DELETE' }, { requireAuth: true });
        pendingDeletes.delete(deleteKeyFor(d.farm_id, d.entity_type, d.local_id));
        deleted++;
      } catch (error) {
        /* network failure keeps the row queued; auth errors surface on the next
           session restore instead of blocking the whole farm flush. */
        failed++;
      }
    }
    return { deleted, failed, pending: pendingDeletesForFarm(farmId).length };
  }

  function saveLocalRecovery(farmId, farm, reason = 'cloud-authoritative pull') {
    if (!farm || typeof farm !== 'object') return false;
    const hasRecords = Object.values(entityMap).some(type => {
      const key = typeToKey[type];
      return Array.isArray(farm[key]) && farm[key].length > 0;
    });
    if (!hasRecords && !farm.name) return false;
    const userId = session?.user?.id || 'unverified-user';
    const record = {
      version: 1,
      captured_at: new Date().toISOString(),
      reason,
      farm_id: String(farmId),
      farm: clone(farm)
    };
    try {
      const store = storage();
      if (store) store.setItem(`arswine-recovery-${userId}-${farmId}`, JSON.stringify(record));
      window.__arsRecoveryAvailable = true;
      return true;
    } catch (error) {
      console.warn('[ARSCloud] Could not save local recovery snapshot:', error);
      return false;
    }
  }

  function listLocalRecoverySnapshots() {
    const store = storage();
    const snapshots = [];
    if (!store) return snapshots;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith('arswine-recovery-')) continue;
      try {
        const value = JSON.parse(store.getItem(key) || 'null');
        if (value && value.farm) snapshots.push({ storage_key: key, ...value });
      } catch (_) {}
    }
    return snapshots;
  }

  function ensureFarmObject(farmId) {
    if (!window.DB || typeof window.DB !== 'object') window.DB = {};
    if (!window.DB[farmId]) {
      window.DB[farmId] = {
        name: "RM's Hog Farm",
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
    if (window.sanitizeFarm) window.sanitizeFarm(window.DB[farmId]);
    return window.DB[farmId];
  }

  async function listFarmRows(farmId) {
    const rows = [];
    let offset = 0;
    let expectedTotal = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      // The live production table is a legacy app_records table without an id
      // column. The unique farm/entity/local key is sufficient for stable
      // pagination and keeps reads compatible with both schemas.
      const path = `/rest/v1/app_records?farm_id=eq.${encodeURIComponent(farmId)}&select=farm_id,entity_type,local_id,payload,updated_at&order=entity_type.asc,local_id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
      const result = await requestWithMeta(path, { headers: { Prefer: 'count=exact' } }, { requireAuth: true });
      const batch = Array.isArray(result.body) ? result.body : [];
      const range = result.response.headers.get('content-range') || '';
      const totalMatch = range.match(/\/(\d+|\*)$/);
      if (totalMatch && totalMatch[1] !== '*') expectedTotal = Number(totalMatch[1]);
      rows.push(...batch);
      offset += batch.length;
      if (!batch.length || batch.length < PAGE_SIZE || (expectedTotal !== null && rows.length >= expectedTotal)) break;
    }
    if (expectedTotal !== null && rows.length < expectedTotal) {
      throw new Error(`Cloud read incomplete: received ${rows.length} of ${expectedTotal} records.`);
    }
    if (rows.length >= MAX_PAGES * PAGE_SIZE) throw new Error('Cloud read exceeded safe pagination limit.');
    return { rows, expectedTotal: expectedTotal ?? rows.length };
  }

  function buildRows(farmId, farm, onlyKeys = null) {
    const rowsMap = new Map();
    Object.entries(entityMap).forEach(([key, type]) => {
      (farm[key] || []).forEach((payload, index) => {
        if (!payload || typeof payload !== 'object') return;
        let localId = localIdFor(payload, type, index);
        let compound = rowKey(farmId, type, localId);
        if (rowsMap.has(compound)) {
          localId = `${localId}-${index}`;
          compound = rowKey(farmId, type, localId);
        }
        if (onlyKeys && !onlyKeys.has(compound)) return;
        const payloadCopy = clone(payload) || {};
        // Sync markers are device/UI state, not farm business data. Never
        // persist a transient "pending" label into the authoritative cloud
        // payload; otherwise a successful upload can still display as pending
        // after the next cloud refresh.
        if (type === 'semen_reseller_tx') {
          delete payloadCopy.sync_status;
          delete payloadCopy.sync_last_attempt_at;
          delete payloadCopy.sync_last_error;
        }
        payloadCopy._ars_cloud_local_id = localId;
        payloadCopy.farm_id = payloadCopy.farm_id || String(farmId);
        payloadCopy.updated_at = new Date().toISOString();
        rowsMap.set(compound, {
          farm_id: String(farmId),
          entity_type: type,
          local_id: localId,
          payload: payloadCopy,
          // Keep the table timestamp aligned with the payload timestamp. The
          // conflict preflight uses this top-level column as the remote version.
          updated_at: payloadCopy.updated_at,
          updated_by: null
        });
      });
    });

    const logoData = farm.logo || farm.logo_url || (window.STORE && STORE.getItem('ars-farm-logo-' + farmId)) || null;
    if (logoData) {
      const key = rowKey(farmId, 'farm_logo', 'logo');
      if (!onlyKeys || onlyKeys.has(key)) rowsMap.set(key, {
        farm_id: String(farmId), entity_type: 'farm_logo', local_id: 'logo',
        payload: { dataUrl: logoData, updated_at: new Date().toISOString() }, updated_by: null
      });
    }
    if (farm.feedPlan && typeof farm.feedPlan === 'object') {
      const key = rowKey(farmId, 'feed_plan', 'config');
      if (!onlyKeys || onlyKeys.has(key)) {
        const updatedAt = new Date().toISOString();
        rowsMap.set(key, {
          farm_id: String(farmId), entity_type: 'feed_plan', local_id: 'config',
          payload: { ...clone(farm.feedPlan), updated_at: updatedAt },
          updated_at: updatedAt,
          updated_by: null
        });
      }
    }
    if (farm.settings || farm.reminderSettings) {
      const key = rowKey(farmId, 'farm_settings', 'config');
      if (!onlyKeys || onlyKeys.has(key)) rowsMap.set(key, {
        farm_id: String(farmId), entity_type: 'farm_settings', local_id: 'config',
        payload: { settings: farm.settings || {}, reminderSettings: farm.reminderSettings || {}, updated_at: new Date().toISOString() }, updated_by: null
      });
    }
    return Array.from(rowsMap.values());
  }

  function serverRowMap(rows) {
    const result = new Map();
    rows.forEach(row => result.set(rowKey(row.farm_id, row.entity_type, row.local_id), row));
    return result;
  }

  async function pushFarm(farmId, farm, options = {}) {
    loadSessionOnce();
    if (!token || !farmId || !farm) return { success: false, reason: 'Missing authentication or farm data.' };
    if (window.__arsActiveFarmId && String(window.__arsActiveFarmId) !== String(farmId)) {
      return { success: false, reason: 'Farm context changed; cloud write blocked.' };
    }
    if (window.__arsCloudBaselineReady !== true && options.allowUninitialized !== true) {
      return { success: false, reason: 'Cloud baseline is not verified; local data was not uploaded.' };
    }

    // FIX C3: try the offline delete queue first, and never re-upload a row
    // that is still pending deletion (it would resurrect on the next pull).
    const queuedDeletes = pendingDeletesForFarm(farmId);
    if (queuedDeletes.length) {
      const flush = await flushPendingDeletes(farmId);
      if (flush.failed > 0 && flush.pending > 0) {
        return { success: false, reason: `${flush.pending} deletion(s) still waiting for cloud connectivity; upload paused so deleted records cannot return.`, pending: true, deletionsPending: flush.pending };
      }
    }

    const onlyKeys = options.dirtyOnly === false ? null : new Set(dirtyKeysForFarm(farmId));
    if (onlyKeys && !onlyKeys.size) return { success: true, count: 0, pending: false };
    const rows = buildRows(farmId, farm, onlyKeys);
    if (!rows.length) {
      /* [REBUILD FIX 96] dirty keys with no buildable rows can never upload —
         clear them so the indicator doesn't spin "Pending changes" forever. */
      (onlyKeys || new Set()).forEach(key => dirtyVersions.delete(key));
      return { success: true, count: 0, pending: hasDirtyChanges(farmId) };
    }

    // Re-read the server state before writing. If another device changed a row
    // after this device's baseline, do not overwrite it silently.
    let serverRows;
    try {
      serverRows = (await listFarmRows(farmId)).rows;
    } catch (error) {
      window.__arsLastPushError = `Cloud preflight failed: ${error.message}`;
      return { success: false, reason: `Cloud preflight failed: ${error.message}` };
    }
    const serverMap = serverRowMap(serverRows);
    const conflicts = [];
    const writable = [];
    rows.forEach(row => {
      const key = rowKey(farmId, row.entity_type, row.local_id);
      const remote = serverMap.get(key);
      const baseline = cloudVersions.get(key);
      const remoteTime = remote?.updated_at ? new Date(remote.updated_at).getTime() : 0;
      const baselineTime = baseline?.updated_at ? new Date(baseline.updated_at).getTime() : 0;
      if (remote && (!baseline || remoteTime > baselineTime)) {
        conflicts.push({ farm_id: farmId, entity_type: row.entity_type, local_id: row.local_id, remote_updated_at: remote.updated_at, baseline_updated_at: baseline?.updated_at || null });
      } else {
        writable.push(row);
      }
    });
    if (conflicts.length) {
      return { success: false, reason: 'Remote changes detected; no conflicting local rows were uploaded.', conflicts, pending: true };
    }

    const versionsAtStart = new Map();
    (onlyKeys || new Set(writable.map(row => rowKey(farmId, row.entity_type, row.local_id)))).forEach(key => versionsAtStart.set(key, dirtyVersions.get(key) || 0));
    try {
      for (let i = 0; i < writable.length; i += 50) {
        const chunk = writable.slice(i, i + 50);
        await request(`/rest/v1/app_records?on_conflict=farm_id,entity_type,local_id`, {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(chunk)
        }, { requireAuth: true });
      }
      writable.forEach(row => {
        const key = rowKey(farmId, row.entity_type, row.local_id);
        cloudVersions.set(key, { updated_at: row.payload.updated_at });
        if ((dirtyVersions.get(key) || 0) === versionsAtStart.get(key)) dirtyVersions.delete(key);
        /* [FIX 96] refresh local reseller-tx sync badges so pickup cards stop
           saying "pending cloud verification" after a verified upload. */
        if (row.entity_type === 'semen_reseller_tx') {
          const item = (farm.semenResellerTx || []).find(x => String(x._ars_cloud_local_id || x.id || '') === row.local_id);
          if (item) { item.sync_status = 'verified'; delete item.sync_last_error; }
        }
      });
      const now = new Date().toISOString();
      window.__arsPendingUnverifiedSave = false;
      window.__arsLastPushError = null;
      if (window.STORE) window.STORE.setItem('ars-last-cloud-sync', now);
      window.__arsLastSuccessfulSyncAt = now;
      return { success: true, count: writable.length, pending: hasDirtyChanges(farmId) };
    } catch (error) {
      window.__arsLastPushError = error.message || String(error); /* [FIX 96] */
      return { success: false, reason: error.message || String(error), pending: true };
    }
  }

  async function saveFarmLogo(farmId, dataUrl) {
    if (!farmId || !dataUrl) return { success: false, reason: 'A farm ID and image are required.' };
    if (window.__arsCloudBaselineReady !== true || window.arsContextReady !== true) {
      return { success: false, reason: 'The verified cloud farm baseline is not ready.' };
    }
    const farm = window.DB && window.DB[farmId];
    if (!farm) return { success: false, reason: 'The verified farm bucket is unavailable.' };
    const key = rowKey(farmId, 'farm_logo', 'logo');
    dirtyVersions.set(key, (dirtyVersions.get(key) || 0) + 1);
    localMutationVersion++;
    const result = await pushFarm(farmId, farm, { dirtyOnly: true });
    if (result.success && window.STORE) window.STORE.setItem('ars-farm-logo-' + farmId, dataUrl);
    return result;
  }

  async function syncFarmRecord(farmId, entityType, payload) {
    if (!farmId || !entityType || !payload || typeof payload !== 'object') {
      return { success: false, reason: 'A farm, entity type, and record are required.' };
    }
    if (window.__arsCloudBaselineReady !== true || window.arsContextReady !== true) {
      return { success: false, reason: 'The verified cloud farm baseline is not ready.' };
    }
    const localId = localIdFor(payload, entityType, 0);
    if (!payload._ars_cloud_local_id) payload._ars_cloud_local_id = localId;
    const key = rowKey(farmId, entityType, localId);
    dirtyVersions.set(key, (dirtyVersions.get(key) || 0) + 1);
    localMutationVersion++;
    const farm = window.DB && window.DB[farmId];
    if (!farm) return { success: false, reason: 'The verified farm bucket is unavailable.' };
    return pushFarm(farmId, farm, { dirtyOnly: true });
  }

  async function verifyFarmSave(farmId, label = 'change') {
    // Directly awaited save verifications share a small lock with the debounced
    // auto-push. This prevents two writers from racing the same dirty farm row.
    window.__arsDirectCloudVerification = (Number(window.__arsDirectCloudVerification) || 0) + 1;
    try {
      const id = String(farmId || window.__arsActiveFarmId || window.farmId || '').trim();
      const localFarm = id && window.DB ? window.DB[id] : null;
      if (!id || !localFarm) return { success: false, reason: 'The verified farm bucket is unavailable.' };
      if (window.__arsCloudBaselineReady !== true || window.arsContextReady !== true) {
        return { success: false, reason: 'The verified cloud baseline is not ready; the change remains safely local.', pending: true };
      }
      try {
        const result = await pushFarm(id, localFarm, { dirtyOnly: true });
        if (result && result.success === false) return { ...result, label };
        return { ...(result || {}), success: true, label };
      } catch (error) {
        return { success: false, reason: error.message || String(error), pending: true, label };
      }
    } finally {
      window.__arsDirectCloudVerification = Math.max(0, (Number(window.__arsDirectCloudVerification) || 1) - 1);
    }
  }

  let lastPullMetaSig = null; /* [REBUILD FIX 72] */

  async function pullFarm(farmId, options = {}) {
    loadSessionOnce();
    if (!token) return { success: false, reason: 'Authentication required.' };
    if (!farmId) return { success: false, reason: 'A validated farm ID is required.' };
    if (window.__arsActiveFarmId && String(window.__arsActiveFarmId) !== String(farmId)) {
      return { success: false, reason: 'Farm context changed; cloud read blocked.' };
    }
    if (hasDirtyChanges(farmId) && options.allowDirty !== true) {
      return { success: false, reason: 'Pending local changes require review before a cloud pull.', pending: true };
    }
    const readVersion = localMutationVersion;

    try {
      const f = ensureFarmObject(farmId);
      const localBefore = clone(f);
      let serverMeta = null;
      let pulledFeedPlanIsCanonical = false;
      try {
        serverMeta = await getFarmMeta(farmId);
        if (serverMeta?.name) f.name = serverMeta.name;
      } catch (_) {
        // The app-record pull remains authoritative for records; retain the
        // existing local label only if the farm metadata endpoint is unavailable.
      }
      const result = await listFarmRows(farmId);
      // A local save may happen while the network read is in flight. Re-check
      // before replacing the local bucket so an older response cannot restore
      // a pre-deduction semen quantity (or any other pending edit).
      if (localMutationVersion !== readVersion || (hasDirtyChanges(farmId) && options.allowDirty !== true)) {
        return { success: false, reason: 'A local change occurred during the cloud read; refresh was safely discarded.', pending: true };
      }
      const rows = result.rows;
      const bucket = {};
      let pulledLogo = null;
      let pulledFeedPlan = null;
      let pulledSettings = null;
      const nextVersions = new Map();

      rows.forEach(row => {
        if (!row || !row.entity_type) return;
        if (String(row.farm_id) !== String(farmId)) throw new Error('Cloud returned a row outside the requested farm scope.');
        const payload = clone(row.payload);
        if (!payload || typeof payload !== 'object') return;
        // Older builds stored transient reseller sync markers in the cloud.
        // A row that is present in the verified cloud dataset is synchronized;
        // remove those stale presentation flags instead of showing a false
        // "pending" state in the reseller profile.
        if (row.entity_type === 'semen_reseller_tx') {
          delete payload.sync_status;
          delete payload.sync_last_attempt_at;
          delete payload.sync_last_error;
        }
        if (!payload._ars_cloud_local_id) payload._ars_cloud_local_id = row.local_id;
        const key = rowKey(farmId, row.entity_type, row.local_id);
        nextVersions.set(key, { updated_at: row.updated_at || payload.updated_at || row.created_at || null });

        if (row.entity_type === 'farm_logo' && payload.dataUrl) { pulledLogo = payload.dataUrl; return; }
        if (row.entity_type === 'feed_plan') {
          // Keep the canonical config row if an older deployment left an
          // additional feed_plan row behind. Never delete the extra row here;
          // simply prevent an arbitrary legacy row from replacing the active
          // feed-consumption state during a pull.
          const canonical = String(row.local_id || '') === 'config';
          if (!pulledFeedPlan || canonical || !pulledFeedPlanIsCanonical) {
            pulledFeedPlan = payload;
            pulledFeedPlanIsCanonical = canonical;
          }
          return;
        }
        if (row.entity_type === 'farm_settings') { pulledSettings = payload; return; }
        const localKey = typeToKey[row.entity_type] || row.entity_type;
        if (!bucket[localKey]) bucket[localKey] = [];
        bucket[localKey].push(payload);
      });

      // Older deployments stored the farm logo in farms.logo_url. Prefer the
      // scoped farm_logo record, but retain that legacy value as a safe fallback.
      if (!pulledLogo && serverMeta?.logo_url) pulledLogo = serverMeta.logo_url;

      /* [REBUILD FIX 72] cheap change detection: compare per-row updated_at
         versions against the previous pull (instead of stringify-ing the whole
         farm every 18 s — that caused noticeable lag on phones). */
      const farmKeys = Array.from(cloudVersions.keys()).filter(key => key.startsWith(`${farmId}:::`));
      let changed = nextVersions.size !== farmKeys.length;
      if (!changed) nextVersions.forEach((value, key) => {
        if (changed) return;
        const old = cloudVersions.get(key);
        if (!old || old.updated_at !== value.updated_at) changed = true;
      });
      const metaSig = JSON.stringify([serverMeta ? serverMeta.name : null, pulledLogo || null, pulledSettings || null, pulledFeedPlan || null]);
      if (!changed && metaSig !== lastPullMetaSig) changed = true;
      lastPullMetaSig = metaSig;

      // Preserve the previous local state as a recovery reference before the
      // cloud-authoritative replacement. It is never uploaded automatically.
      saveLocalRecovery(farmId, localBefore, 'before cloud-authoritative replacement');

      Object.keys(entityMap).forEach(key => { f[key] = Array.isArray(bucket[key]) ? bucket[key] : []; });
      if (pulledLogo) {
        f.logo = pulledLogo;
        f.logo_url = pulledLogo;
      } else {
        delete f.logo;
        delete f.logo_url;
      }
      if (pulledFeedPlan) f.feedPlan = pulledFeedPlan;
      else delete f.feedPlan;
      if (pulledSettings) {
        if (pulledSettings.settings) f.settings = pulledSettings.settings;
        else delete f.settings;
        if (pulledSettings.reminderSettings) f.reminderSettings = pulledSettings.reminderSettings;
        else delete f.reminderSettings;
      } else {
        delete f.settings;
        delete f.reminderSettings;
      }
      if (window.STORE) {
        /* [FIX 86] quota-safe: a full device must never break the pull */
        try { window.STORE.setItem('arswine-db-v1', JSON.stringify(window.DB)); }
        catch (quotaErr) { console.warn('[ARSCloud] localStorage quota exceeded after pull:', quotaErr); window.arsQuotaRecovery && window.arsQuotaRecovery(); }
        if (pulledLogo) window.STORE.setItem('ars-farm-logo-' + farmId, pulledLogo);
        else window.STORE.removeItem('ars-farm-logo-' + farmId);
        window.STORE.setItem('ars-last-cloud-sync', new Date().toISOString());
      }
      if (window.deviceWrite) window.deviceWrite(window.DB);
      if (window.sanitizeFarm) window.sanitizeFarm(f);

      dirtyKeysForFarm(farmId).forEach(key => dirtyVersions.delete(key));
      Array.from(cloudVersions.keys()).filter(key => key.startsWith(`${farmId}:::`)).forEach(key => cloudVersions.delete(key));
      nextVersions.forEach((value, key) => cloudVersions.set(key, value));
      window.__arsCloudBaselineReady = true;
      // The pull replaced the active farm with a verified cloud-authoritative
      // baseline and cleared its dirty rows. Do not leave a stale global marker
      // blocking every future auto-push on this device.
      window.__arsPendingUnverifiedSave = false;
      window.__arsLastSuccessfulSyncAt = new Date().toISOString();
      window.__arsLastSavedFarmById = window.__arsLastSavedFarmById || {};
      window.__arsLastSavedFarmById[farmId] = clone(f);
      if (window.applyCustomLogo) window.applyCustomLogo();
      return { success: true, count: rows.length, cloudTotal: result.expectedTotal, farm: f, changed };
    } catch (error) {
      console.warn('[ARSCloud] pullFarm blocked:', error);
      return { success: false, reason: error.message || String(error) };
    }
  }

  async function getFarmMembers(farmId) {
    try {
      const res = await request('/rest/v1/rpc/get_farm_members', { method: 'POST', body: JSON.stringify({ p_farm_id: farmId }) }, { requireAuth: true });
      return Array.isArray(res) ? res : [];
    } catch (e) {
      console.warn('[ARSCloud] getFarmMembers error:', e);
      return [];
    }
  }

  async function ensureFarmInvitation(farmId, farmName) {
    return request('/rest/v1/rpc/ensure_farm_invitation', { method: 'POST', body: JSON.stringify({ p_farm_id: farmId, p_farm_name: farmName || '' }) }, { requireAuth: true });
  }
  async function regenerateFarmInvitation(farmId, farmName) {
    return request('/rest/v1/rpc/regenerate_farm_invitation', { method: 'POST', body: JSON.stringify({ p_farm_id: farmId, p_farm_name: farmName || '' }) }, { requireAuth: true });
  }
  async function deleteUser(email) {
    return request('/rest/v1/rpc/platform_delete_user', { method: 'POST', body: JSON.stringify({ p_email: email }) }, { requireAuth: true });
  }
  async function purgeTestAccounts() {
    return request('/rest/v1/rpc/platform_purge_test_accounts', { method: 'POST', body: '{}' }, { requireAuth: true });
  }
  /* FIX C3: deletes are now offline-safe. A failed network delete is queued and
     retried by the auto-push loop; the caller's .catch(() => {}) remains safe
     because we only rethrow after the row was queued (or for auth errors, which
     the queue would never be able to flush either and the caller should see). */
  async function deleteAppRecord(farmId, entityType, localId) {
    if (!farmId || !entityType || !localId) return { success: false, reason: 'Missing delete key.' };
    try {
      await request(`/rest/v1/app_records?farm_id=eq.${encodeURIComponent(farmId)}&entity_type=eq.${encodeURIComponent(entityType)}&local_id=eq.${encodeURIComponent(localId)}`, { method: 'DELETE' }, { requireAuth: true });
      pendingDeletes.delete(deleteKeyFor(farmId, entityType, localId));
      return { success: true };
    } catch (error) {
      queuePendingDelete(farmId, entityType, localId);
      if (error.status === 401) throw error; // auth problems need user attention
      return { success: false, reason: error.message || String(error), queued: true };
    }
  }

  async function deleteAppRecordsBatch(farmId, entityType, localIds) {
    const ids = Array.from(new Set((localIds || []).map(id => String(id || '').trim()).filter(Boolean)));
    if (!farmId || !entityType || !ids.length) return { success: false, reason: 'A farm, entity type, and selected IDs are required.' };
    try {
      const deleted = await request('/rest/v1/rpc/platform_delete_app_records', {
        method: 'POST',
        body: JSON.stringify({ p_farm_id: farmId, p_entity_type: entityType, p_local_ids: ids })
      }, { requireAuth: true });
      ids.forEach(id => pendingDeletes.delete(deleteKeyFor(farmId, entityType, id)));
      return { success: true, deleted: Number(deleted || 0), ids };
    } catch (error) {
      ids.forEach(id => queuePendingDelete(farmId, entityType, String(id)));
      if (error.status === 401) throw error;
      return { success: false, reason: error.message || String(error), queued: true, ids };
    }
  }

  /* ── conflict review helpers (FIX C2) ─────────────────────────────────────
     The engine blocks stale writes (safe), but the only previous escape was an
     allowDirty pull that silently discarded the local edit. These helpers give
     the review UI two explicit choices:
       'local'  → adopt the remote version as the new baseline (so the preflight
                  stops flagging it) and keep the local edit dirty; the caller
                  then re-pushes and the local value wins deliberately.
       'remote' → drop the dirty flag so a pull may replace the local value. */
  function resolveConflict(farmId, conflict, mode = 'local') {
    const key = rowKey(farmId, conflict.entity_type, conflict.local_id);
    if (mode === 'remote') {
      dirtyVersions.delete(key);
      return { success: true, mode, key };
    }
    cloudVersions.set(key, { updated_at: conflict.remote_updated_at || cloudVersions.get(key)?.updated_at || new Date().toISOString() });
    return { success: true, mode, key };
  }
  function discardDirtyConflicts(farmId, conflicts) {
    (conflicts || []).forEach(c => dirtyVersions.delete(rowKey(farmId, c.entity_type, c.local_id)));
    return true;
  }

  async function cleanCloudTestRecords(farmId) {
    if (!farmId) return;
    await request(`/rest/v1/app_records?farm_id=eq.${encodeURIComponent(farmId)}&entity_type=eq.sow&or=(local_id.ilike.*verify*,local_id.ilike.*live_sync*,local_id.ilike.*test*)`, { method: 'DELETE' }, { requireAuth: true });
  }

  function sessionInfo() {
    loadSessionOnce();
    return {
      user: clone(session?.user || null),
      expires_at: session?.expires_at || null,
      has_refresh_token: Boolean(session?.refresh_token),
      token_present: Boolean(token),
      last_error: lastSessionError?.message || null
    };
  }

  /* [REBUILD FIX 111] lightweight change probe (~300 bytes) so heartbeats no
     longer re-download the whole farm on every tick — protects the Supabase
     free-plan egress quota. Returns row count + newest updated_at. */
  async function farmSyncHead(farmId) {
    loadSessionOnce();
    const res = await fetch(`${c.url}/rest/v1/app_records?farm_id=eq.${encodeURIComponent(farmId)}&select=updated_at&order=updated_at.desc&limit=1`, {
      headers: {
        apikey: c.anonKey,
        Authorization: `Bearer ${token || c.anonKey}`,
        Prefer: 'count=exact',
        Accept: 'application/json'
      }
    });
    const range = res.headers.get('content-range') || '';
    const count = parseInt(range.split('/').pop() || '0', 10) || 0;
    const body = await res.json().catch(() => []);
    return { ok: res.ok, count, maxUpdated: (Array.isArray(body) && body[0] && body[0].updated_at) || null };
  }

  /* [REBUILD FIX 124] OPTIONAL EDGE HEAD CACHE (Cloudflare KV via _worker.js).
     The "did my farm change?" probe is served from the Cloudflare edge at
     /ars-head instead of Supabase — zero DB egress for unchanged polls.
     Safety rules:
       • auto-detected: if /ars-head is missing or misbehaves, the edge layer
         disables itself for the session and the direct probe is used;
       • read-only cache: real pulls/pushes always go straight to Supabase;
       • writes are fire-and-forget AFTER a successful Supabase write;
       • 60s KV TTL bounds staleness when an older app version writes. */
  let edgeHeadDisabled = false;
  async function edgeHeadGet(farmId) {
    if (edgeHeadDisabled || !farmId) return null;
    try {
      const res = await fetch(`/ars-head?farm=${encodeURIComponent(farmId)}`, { headers: { Accept: 'application/json' } });
      const ct = res.headers.get('content-type') || '';
      if (res.status === 404 && ct.includes('application/json')) {
        const j = await res.json().catch(() => null);
        if (j && j.missing) return null; /* edge is live but empty → caller falls back once */
      }
      if (!res.ok || !ct.includes('application/json')) { edgeHeadDisabled = true; return null; }
      const j = await res.json();
      if (j && j.farm === farmId && typeof j.count === 'number') {
        return { ok: true, count: j.count, maxUpdated: j.maxUpdated || null, edge: true };
      }
      edgeHeadDisabled = true;
      return null;
    } catch (_) { return null; }
  }
  function edgeHeadPut(farmId, head) {
    if (edgeHeadDisabled || !farmId || !head || !head.ok) return;
    try {
      fetch('/ars-head', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ farm: farmId, count: head.count, maxUpdated: head.maxUpdated }),
        keepalive: true
      }).catch(() => {});
    } catch (_) { /* never block sync on the cache */ }
  }

  return {
    farmSyncHead,
    edgeHeadGet,
    edgeHeadPut,
    getAccessToken: () => token, /* [FIX 127] presence auth */
    listSubOrdersAll: async () => {
      try {
        const res = await request('/rest/v1/app_records?select=farm_id,payload&entity_type=eq.sub_order&order=updated_at.desc&limit=200', {}, { requireAuth: true });
        return Array.isArray(res) ? res : [];
      } catch (e) { return []; }
    },
    /* [FIX 154] commerce rows use EXPLICIT targeted writes — never the array
       sync pipeline — so a cloud pull can never wipe a pending local order. */
    upsertCommerceRows: async (farmId, rows) => {
      const body = (rows || []).map(r => ({ farm_id: farmId, entity_type: r._et, local_id: r.id, payload: r, updated_at: new Date().toISOString() }));
      await request('/rest/v1/app_records?on_conflict=farm_id,entity_type,local_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body) }, { requireAuth: true });
    },
    deleteCommerceRow: async (farmId, entityType, localId) => {
      await request(`/rest/v1/app_records?farm_id=eq.${encodeURIComponent(farmId)}&entity_type=eq.${entityType}&local_id=eq.${encodeURIComponent(localId)}`, { method: 'DELETE' }, { requireAuth: true });
    },
    listWorkOrders: async (farmId) => {
      try {
        const res = await request(`/rest/v1/app_records?select=payload&farm_id=eq.${encodeURIComponent(farmId)}&entity_type=eq.work_order&limit=500`, {}, { requireAuth: true });
        return Array.isArray(res) ? res : [];
      } catch (e) { return []; }
    },
    listCommerceRows: async (farmId) => {
      try {
        const res = await request(`/rest/v1/app_records?select=entity_type,payload&farm_id=eq.${encodeURIComponent(farmId)}&entity_type=in.(sub_order,sub_meta,staff_rec,att_rec)&limit=200`, {}, { requireAuth: true });
        return Array.isArray(res) ? res : [];
      } catch (e) { return []; }
    },
    signIn,
    signUp,
    signOut,
    restoreSession,
    getCurrentUser,
    sessionInfo,
    sendPasswordReset,
    captureRecoverySession,
    updatePassword,
    onboard,
    joinFarmWithInvitation,
    hasFarm,
    getFarmMemberships,
    isPlatformAdmin,
    listFarms,
    getFarmMeta,
    getFarmName,
    getFarmRecordCounts,
    overridePigletLineage,
    updateMemberAccess,
    vetReferenceSearch,
    deleteFarm,
    ensureFarmInvitation,
    regenerateFarmInvitation,
    deleteUser,
    purgeTestAccounts,
    deleteAppRecord,
    deleteAppRecordsBatch,
    cleanCloudTestRecords,
    pushFarm,
    rawRequest: request, /* [FIX 106] trial beacons & owner trial board */
    saveFarmLogo,
    syncFarmRecord,
    verifyFarmSave,
    pullFarm,
    getFarmMembers,
    markLocalChanges,
    hasDirtyChanges,
    dirtyKeysForFarm,
    saveLocalRecovery,
    listLocalRecoverySnapshots,
    resolveConflict,
    discardDirtyConflicts,
    flushPendingDeletes,
    pendingDeletesForFarm,
    configured: () => Boolean(c?.url && c?.anonKey),
    entityMap: () => ({ ...entityMap }),
    typeToKey: () => ({ ...typeToKey })
  };
})();
