/*
 * Egress-fix verification. Loads the real supabase/client.js against a stub
 * Supabase REST endpoint and asserts on the actual URLs it requests.
 *
 * Run: node qa/test-egress-fixes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
function ok(name, cond, extra = '') {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
}

/* ── in-memory localStorage ─────────────────────────────────────────────── */
function makeStore({ failOverBytes = Infinity } = {}) {
  const m = new Map();
  return {
    _map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const s = String(v);
      if (s.length > failOverBytes) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      m.set(k, s);
    },
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

/* ── stub Supabase ──────────────────────────────────────────────────────── */
function makeServer() {
  const requests = [];
  const posts = [];
  // farm_logo payload mirrors client.js buildRows(): { dataUrl, updated_at }
  const state = {
    updatedAt: '2026-08-25T00:00:00.000Z',
    logo: 'data:image/png;base64,' + 'A'.repeat(2_000_000),
    storageFail: false,
    storageUploads: 0,
    rows: [
      { entity_type: 'sow', local_id: 'SOW-1', name: 'A' },
      { entity_type: 'sow', local_id: 'SOW-2', name: 'B' },
      { entity_type: 'boar', local_id: 'BOAR-1', name: 'C' },
    ],
  };

  function allRows() {
    const rows = state.rows.map((r) => {
      const isUrlLogo = r.entity_type === 'farm_logo' && r.__url;
      const rowTs = r.updated_at || state.updatedAt;
      return {
        farm_id: 'FARM-1',
        entity_type: r.entity_type,
        local_id: r.local_id,
        payload: isUrlLogo
          ? { url: state.logoUrl, v: state.logoV || null, updated_at: state.logoUpdatedAt }
          : { ...r, farm_id: 'FARM-1', updated_at: rowTs },
        updated_at: isUrlLogo ? (state.logoUpdatedAt || state.updatedAt) : rowTs,
      };
    });
    const hasLogoRow = rows.some((r) => r.entity_type === 'farm_logo');
    if (state.logo !== null && !hasLogoRow) {
      const logoTs = state.logoUpdatedAt || state.updatedAt;
      rows.push({
        farm_id: 'FARM-1',
        entity_type: 'farm_logo',
        local_id: 'logo',
        payload: { dataUrl: state.logo, updated_at: logoTs },
        updated_at: logoTs,
      });
    }
    return rows;
  }

  function matches(row, filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v.op === 'eq' && String(row[k]) !== v.val) return false;
      if (v.op === 'neq' && String(row[k]) === v.val) return false;
      if (v.op === 'in' && !v.val.includes(String(row[k]))) return false;
    }
    return true;
  }

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const p = u.pathname;
    requests.push({ path: p + u.search, method: init.method || 'GET' });
    if ((init.method || 'GET') === 'POST') posts.push({ path: p + u.search, body: init.body });

    const json = (body, status = 200, headers = {}) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Map(Object.entries({ 'content-type': 'application/json', ...headers })),
      json: async () => body,
    });

    // Supabase Storage endpoint for item #3.
    if (p.startsWith('/storage/v1/object/')) {
      if (state.storageFail) return json({ message: 'bucket not found' }, 400);
      state.storageUploads += 1;
      return json({ Key: p }, 200);
    }

    if (p === '/rest/v1/farms') {
      return json([{ id: 'FARM-1', name: "RM's Hog Farm", logo_url: null }]);
    }

    if (p === '/rest/v1/app_records') {
      const q = u.searchParams;
      const filters = {};
      for (const [key, raw] of q.entries()) {
        if (['farm_id', 'entity_type', 'local_id'].includes(key)) {
          if (raw.startsWith('eq.')) filters[key] = { op: 'eq', val: raw.slice(3) };
          else if (raw.startsWith('neq.')) filters[key] = { op: 'neq', val: raw.slice(4) };
          else if (raw.startsWith('in.')) filters[key] = { op: 'in', val: raw.slice(3).replace(/^\(|\)$/g, '').split(',') };
        }
      }

      if (init.method === 'POST') return json(null, 201);

      let rows = allRows().filter((r) => matches(r, filters));

      // probe: select=updated_at&order=updated_at.desc&limit=1
      if (q.get('select') === 'updated_at') {
        rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        const total = rows.length;
        const page = rows.slice(0, Number(q.get('limit') || 1)).map((r) => ({ updated_at: r.updated_at }));
        return json(page, 200, { 'content-range': `0-${Math.max(page.length - 1, 0)}/${total}` });
      }

      rows.sort((a, b) => `${a.entity_type}${a.local_id}`.localeCompare(`${b.entity_type}${b.local_id}`));
      const total = rows.length;
      const offset = Number(q.get('offset') || 0);
      const limit = Number(q.get('limit') || 1000);
      const page = rows.slice(offset, offset + limit);
      return json(page, 200, { 'content-range': `${offset}-${offset + page.length - 1}/${total}` });
    }

    return json({ message: `unhandled ${p}` }, 404);
  }

  return {
    state,
    requests,
    posts,
    fetchImpl,
    lastFullReads: () => requests.filter((r) => /app_records\?/.test(r.path) && /select=farm_id/.test(r.path)),
    lastProbes: () => requests.filter((r) => /select=updated_at/.test(r.path)),
    reset: () => { requests.length = 0; posts.length = 0; },
  };
}

/* ── boot the real client.js ────────────────────────────────────────────── */
function bootClient({ failOverBytes = Infinity } = {}) {
  const store = makeStore({ failOverBytes });
  const server = makeServer();

  const win = {
    localStorage: store,
    sessionStorage: makeStore(),
    STORE: store,
    DB: {},
    ARS_SUPABASE_CONFIG: { url: 'https://stub.supabase.co', anonKey: 'sb_publishable_stub' },
    __arsActiveFarmId: 'FARM-1',
    __arsCloudBaselineReady: true,
    arsContextReady: true,
  };
  // a valid, unexpired session so no refresh round-trip is attempted
  store.setItem('ars-supabase-session-v2', JSON.stringify({
    access_token: 'test-token',
    refresh_token: null,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'u1', email: 't@example.com' },
  }));

  globalThis.window = win;
  globalThis.localStorage = store;
  globalThis.sessionStorage = win.sessionStorage;
  globalThis.fetch = server.fetchImpl;
  // Node 22 ships a getter-only built-in `navigator`; redefine rather than assign.
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  globalThis.document = { querySelector: () => null, activeElement: null };

  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8'), { filename: 'client.js' });
  return { win, store, server, cloud: win.ARSCloud };
}

const heavy = (s) => (s || []).filter((r) => /select=farm_id/.test(r.path));

/* ══ TEST 1: baseline pull downloads the logo, records the version ════════ */
console.log('\n[1] baseline pull (fresh device, no local logo)');
{
  const { server, cloud, win } = bootClient();
  server.reset();
  const res = await cloud.pullFarm('FARM-1', { ifChanged: true });
  ok('pull succeeds', res.success === true, JSON.stringify(res));
  ok('baseline does NOT skip', res.skipped !== true);
  ok('probe = 2 tiny requests (farm version + logo version)', server.lastProbes().length === 2, `got ${server.lastProbes().length}`);
  const full = heavy(server.requests);
  ok('exactly 1 full read issued', full.length === 1, `got ${full.length}`);
  ok('baseline full read INCLUDES the logo', !/entity_type=neq\.farm_logo/.test(full[0]?.path || ''));
  ok('logo applied to local farm bucket', typeof win.DB['FARM-1'].logo === 'string' && win.DB['FARM-1'].logo.length > 100);
  ok('rows landed in bucket', win.DB['FARM-1'].sows.length === 2 && win.DB['FARM-1'].boars.length === 1);
}

/* ══ TEST 2: nothing changed → probe only, no full read ═══════════════════ */
console.log('\n[2] unchanged poll — the egress win');
{
  const { server, cloud, win } = bootClient();
  await cloud.pullFarm('FARM-1', { ifChanged: true });       // baseline
  const before = heavy(server.requests).length;
  server.reset();

  const res = await cloud.pullFarm('FARM-1', { ifChanged: true });
  ok('reports skipped', res.skipped === true && res.unchanged === true, JSON.stringify(res));
  ok('issues the 2-request probe only', server.lastProbes().length === 2, `got ${server.lastProbes().length}`);
  ok('issues ZERO full reads', heavy(server.requests).length === 0);
  ok('local data untouched', win.DB['FARM-1'].sows.length === 2);
  ok('logo untouched', typeof win.DB['FARM-1'].logo === 'string');

  // simulate 200 polls over 8h/18s
  let bytes = 0;
  for (let i = 0; i < 200; i++) {
    server.reset();
    await cloud.pullFarm('FARM-1', { ifChanged: true });
    bytes += server.requests.reduce((n, r) => n + r.path.length, 0);
  }
  console.log(`        200 unchanged polls cost ~${(bytes / 1024).toFixed(0)} KB of request URLs total`);
  ok('200 polls stay tiny', bytes < 200_000, `${bytes} bytes`);
}

/* ══ TEST 3: remote edit detected → full pull happens ═════════════════════ */
console.log('\n[3] remote UPDATE is still detected');
{
  const { server, cloud, win } = bootClient();
  await cloud.pullFarm('FARM-1', { ifChanged: true });
  server.reset();

  server.state.updatedAt = '2026-08-26T09:00:00.000Z';   // another device edits
  server.state.rows.push({ entity_type: 'sow', local_id: 'SOW-3', name: 'D' });

  const res = await cloud.pullFarm('FARM-1', { ifChanged: true });
  ok('does not skip', res.skipped !== true);
  ok('issues a full read', heavy(server.requests).length === 1);
  ok('new row appears locally', win.DB['FARM-1'].sows.length === 3);
}

/* ══ TEST 4: CRITICAL — remote DELETE with unchanged max(updated_at) ══════ */
console.log('\n[4] CRITICAL: remote DELETE where max(updated_at) does not move');
{
  const { server, cloud, win } = bootClient();
  await cloud.pullFarm('FARM-1', { ifChanged: true });
  ok('starts with 3 rows', win.DB['FARM-1'].sows.length + win.DB['FARM-1'].boars.length === 3);
  server.reset();

  // delete a row WITHOUT bumping updated_at — a naive delta query misses this
  server.state.rows = server.state.rows.filter((r) => r.local_id !== 'BOAR-1');

  const res = await cloud.pullFarm('FARM-1', { ifChanged: true });
  ok('count-only change is NOT skipped', res.skipped !== true);
  ok('full read happens', heavy(server.requests).length === 1);
  ok('deleted row is gone locally', win.DB['FARM-1'].boars.length === 0, `boars=${win.DB['FARM-1'].boars.length}`);
}

/* ══ TEST 5: logo excluded from recurring pulls, but never lost ═══════════ */
console.log('\n[5] logo excluded from recurring pulls, preserved locally');
{
  const { server, cloud, win } = bootClient();
  await cloud.pullFarm('FARM-1', { ifChanged: true });        // baseline: gets logo
  const logoBefore = win.DB['FARM-1'].logo;
  const logoTs = server.state.logoUpdatedAt || server.state.updatedAt;
  server.reset();

  // Change a DATA row only (the logo row's updated_at stays put), so the poll
  // must re-read the farm but has no reason to re-download the logo blob.
  server.state.rows[0] = { ...server.state.rows[0], updated_at: '2026-08-27T00:00:00.000Z' };
  const res = await cloud.pullFarm('FARM-1', { ifChanged: true });
  const full = heavy(server.requests);
  ok('full read happened', full.length === 1);
  ok('full read EXCLUDES farm_logo (logo unchanged)', /entity_type=neq\.farm_logo/.test(full[0].path), full[0].path);
  ok('logo PRESERVED, not deleted', win.DB['FARM-1'].logo === logoBefore);
  ok('stored logo blob not wiped', win.STORE.getItem('ars-farm-logo-FARM-1') === logoBefore);
  void logoTs;
}

/* ══ TEST 6: explicit pull still fetches everything (back-compat) ═════════ */
console.log('\n[6] pullFarm() without ifChanged is unchanged behaviour');
{
  const { server, cloud } = bootClient();
  await cloud.pullFarm('FARM-1', { ifChanged: true });
  server.reset();
  const res = await cloud.pullFarm('FARM-1');               // no options
  ok('does not skip', res.skipped !== true);
  ok('issues NO probe', server.lastProbes().length === 0);
  const full = heavy(server.requests);
  ok('issues a full read', full.length === 1);
  ok('full read INCLUDES logo (no exclusion)', !/neq\.farm_logo/.test(full[0].path));
}

/* ══ TEST 7: pushFarm preflight is scoped, not a full-farm download ═══════ */
console.log('\n[7] pushFarm preflight scoped to the dirty keys');
{
  const { server, cloud, win } = bootClient();
  await cloud.pullFarm('FARM-1', { ifChanged: true });
  server.reset();

  win.DB['FARM-1'].sows[0].name = 'renamed';
  cloud.markLocalChanges('FARM-1',
    { sows: [{ ...win.DB['FARM-1'].sows[0], name: 'A' }] },
    { sows: win.DB['FARM-1'].sows });

  const res = await cloud.pushFarm('FARM-1', win.DB['FARM-1'], { dirtyOnly: true });
  const reads = heavy(server.requests);
  ok('push succeeded', res.success === true, JSON.stringify(res.reason || res));
  ok('preflight issued exactly 1 read', reads.length === 1, `got ${reads.length}`);
  ok('preflight is scoped by entity_type', /entity_type=in\.\(/.test(reads[0].path), reads[0].path);
  ok('preflight is scoped by local_id', /local_id=in\.\(/.test(reads[0].path), reads[0].path);
  ok('preflight does NOT download the logo blob', reads[0].path.length < 500, `${reads[0].path.length} chars`);
  ok('a POST write was sent', server.requests.some((r) => r.method === 'POST'));
}

/* ══ TEST 8: only the first page asks for count=exact ═════════════════════ */
console.log('\n[8] count=exact requested once, not per page');
{
  const { server, cloud } = bootClient();
  server.reset();
  await cloud.pullFarm('FARM-1', { ifChanged: true });
  const full = heavy(server.requests);
  const withCount = full.filter((r) => r.path.includes('offset=0'));
  ok('first page present', withCount.length === 1);
  ok('no extra pages requested for a small farm', full.length === 1);
}

/* ══ TEST 9: localStorage quota no longer throws out of save() ════════════ */
console.log('\n[9] quota guard — 2 MB logo inside window.DB');
{
  // fail any single item over ~4 MB, i.e. the real browser quota pressure
  const { cloud, store, win } = bootClient({ failOverBytes: 4_000_000 });
  win.DB['FARM-1'] = { sows: [], logo: 'data:image/png;base64,' + 'A'.repeat(3_500_000) };
  win.DB['FARM-2'] = { sows: [], logo: 'data:image/png;base64,' + 'B'.repeat(3_500_000) };

  let threw = false;
  let saved = false;
  try { saved = window.ARSPersistDbSafely(); } catch (e) { threw = true; }
  ok('persistDbSafely does NOT throw', threw === false);
  ok('something was persisted', saved === true);
  const blob = store.getItem('arswine-db-v1');
  ok('fallback stripped the logo blobs', blob && !blob.includes('AAAA'), `len=${blob?.length}`);
  ok('record data survived the fallback', blob && blob.includes('FARM-1'));
}

/* ══ ITEM #3 — Storage-backed logos ═════════════════════════════════════ */
const LOGO_POST = (server) => server.posts.find((p) => p.path.includes('on_conflict') && String(p.body).includes('farm_logo'));
const logoRows = (server) => {
  const post = LOGO_POST(server);
  if (!post) return [];
  return JSON.parse(post.body).filter((r) => r.entity_type === 'farm_logo');
};

console.log('\n[10] saveFarmLogo uploads bytes to Storage, syncs a small reference row');
{
  const { server, cloud, win } = bootClient();
  win.STORE.setItem('ars-logo-migrated-FARM-1', 'pre');  // stop the baseline pull's auto-migration from skewing counts
  await cloud.pullFarm('FARM-1', { ifChanged: true });
  server.reset();
  const dataUrl = 'data:image/png;base64,' + 'B'.repeat(50_000);

  const res = await cloud.saveFarmLogo('FARM-1', dataUrl);
  ok('save succeeds', res.success === true, JSON.stringify(res.reason || res));
  ok('reports storage:true', res.storage === true);
  ok('Storage received exactly 1 upload', server.state.storageUploads === 1, `got ${server.state.storageUploads}`);
  const rows = logoRows(server);
  ok('synced a farm_logo row', rows.length === 1);
  ok('row carries url, not dataUrl', rows[0] && rows[0].payload.url && !rows[0].payload.dataUrl);
  const p = JSON.stringify(rows[0].payload);
  ok('reference row is tiny (<400 B)', p.length < 400, `${p.length} B`);
  ok('deterministic per-farm object path', server.requests.some((r) => r.path.includes('/storage/v1/object/farm-logos/FARM-1/logo')));
}

console.log('\n[11] pull of a Storage reference keeps DB blob small');
{
  const { server, cloud, win } = bootClient();
  server.state.logo = null;   // suppress the auto legacy dataUrl row
  server.state.logoUrl = 'https://stub.supabase.co/storage/v1/object/public/farm-logos/FARM-1/logo?v=2026';
  server.state.logoV = '2026';
  server.state.logoUpdatedAt = '2026-09-10T00:00:00.000Z';
  server.state.rows.push({ entity_type: 'farm_logo', local_id: 'logo', __url: true });

  const res = await cloud.pullFarm('FARM-1');
  ok('pull succeeds', res.success === true);
  ok('logo is the Storage URL', String(win.DB['FARM-1'].logo).startsWith('https://'));
  ok('logo_storage reference recorded', win.DB['FARM-1'].logo_storage?.url === server.state.logoUrl);
  const blob = win.STORE.getItem('arswine-db-v1') || '';
  ok('persisted DB blob has no base64 image', !blob.includes('data:image'));
  ok('DB blob is small (<50 KB)', blob.length < 50_000, `${blob.length} B`);
}

console.log('\n[12] legacy dataUrl pull still applies + migrates in background');
{
  const { server, cloud, win } = bootClient();   // state.logo is a dataUrl by default
  const res = await cloud.pullFarm('FARM-1');
  ok('legacy logo applied locally', String(win.DB['FARM-1'].logo).startsWith('data:image'));
  await new Promise((r) => setTimeout(r, 1900));  // migration timer is 1500ms
  ok('background migration uploaded to Storage', server.state.storageUploads >= 1, `got ${server.state.storageUploads}`);
  ok('migration flag recorded', Boolean(win.STORE.getItem('ars-logo-migrated-FARM-1')));
  const rows = logoRows(server);
  ok('migrated row is the small reference form', rows.length === 1 && rows[0].payload.url && !rows[0].payload.dataUrl);
}

console.log('\n[13] Storage unavailable -> graceful legacy fallback');
{
  const { server, cloud, win } = bootClient();
  await cloud.pullFarm('FARM-1', { ifChanged: true });
  server.reset();
  server.state.storageFail = true;
  const dataUrl = 'data:image/png;base64,' + 'C'.repeat(50_000);
  const res = await cloud.saveFarmLogo('FARM-1', dataUrl);
  ok('save still succeeds', res.success === true, JSON.stringify(res.reason || res));
  ok('reports storage:false (fallback)', res.storage === false);
  ok('no Storage upload accepted', server.state.storageUploads === 0);
  const rows = logoRows(server);
  ok('fell back to base64 row', rows.length === 1 && Boolean(rows[0].payload.dataUrl));
}

console.log('\n[14] MULTI-DEVICE: a second device receives a logo replaced elsewhere');
{
  const { server, cloud, win } = bootClient();
  server.state.logo = null;
  server.state.logoUrl = 'https://stub.supabase.co/storage/v1/object/public/farm-logos/FARM-1/logo?v=V1';
  server.state.logoV = 'V1';
  server.state.logoUpdatedAt = '2026-09-01T00:00:00.000Z';
  server.state.rows.push({ entity_type: 'farm_logo', local_id: 'logo', __url: true });

  await cloud.pullFarm('FARM-1', { ifChanged: true });       // device B baseline -> V1
  ok('device B baseline shows V1', String(win.DB['FARM-1'].logo).endsWith('v=V1'));
  server.reset();

  // Device A replaces the logo (new object version + new updated_at).
  server.state.logoUrl = 'https://stub.supabase.co/storage/v1/object/public/farm-logos/FARM-1/logo?v=V2';
  server.state.logoV = 'V2';
  server.state.logoUpdatedAt = '2026-09-02T00:00:00.000Z';

  const res = await cloud.pullFarm('FARM-1', { ifChanged: true });
  ok('change poll not skipped', res.skipped !== true);
  const full = heavy(server.requests);
  ok('logo row fetched on the changed poll', full.length >= 1 && !/neq\.farm_logo/.test(full[0].path), full[0]?.path);
  ok('device B now shows V2', String(win.DB['FARM-1'].logo).endsWith('v=V2'), win.DB['FARM-1'].logo);
}

console.log(`\n${'─'.repeat(60)}`);
console.log(failures === 0
  ? `ALL ${checks} CHECKS PASSED`
  : `${failures} of ${checks} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
