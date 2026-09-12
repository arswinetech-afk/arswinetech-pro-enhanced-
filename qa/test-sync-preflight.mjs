/*
 * [FIX 186] Sync-preflight verification.
 *
 * Boots the REAL supabase/client.js (or ./client.js in this flat repo) against a
 * stub Supabase REST endpoint and asserts on the URLs it actually requests —
 * i.e. it proves the egress behaviour, not just that the code parses.
 *
 * Run:  node qa/test-sync-preflight.mjs
 *
 * What must be true after FIX 186:
 *   1. a save after a verified pull sends ONE 300-byte head probe and NO row read
 *   2. once the head moved, the read is narrowed to the rows being written
 *   3. if the narrow read fails, the old whole-farm preflight still runs
 *   4. a genuine remote change to a row we are about to write is still refused
 *   5. a bulk push (>400 dirty rows) keeps using the single full read
 *   6. record counts use the optional RPC when present, the old loop when absent
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = [path.join(ROOT, 'client.js'), path.join(ROOT, 'supabase', 'client.js')].find(p => fs.existsSync(p));
if (!CLIENT) { console.error('client.js not found'); process.exit(1); }

let failures = 0, checks = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};

/* ── stub Supabase ─────────────────────────────────────────────────────────── */
function makeServer({ rpc = true } = {}) {
  const requests = [], posts = [];
  const state = {
    ts: '2026-09-01T00:00:00+00:00',
    narrowFail: false,
    rows: [
      { entity_type: 'sow', local_id: 'SOW-1', name: 'A' },
      { entity_type: 'sow', local_id: 'SOW-2', name: 'B' },
      { entity_type: 'boar', local_id: 'BOAR-1', name: 'C' },
      /* SEED_ROWS=n adds a realistically-sized farm so the byte comparison in [1]
         is measured against a real payload, not a 3-row toy */
      ...Array.from({ length: Number(process.env.SEED_ROWS || 0) }, (_, i) => ({
        entity_type: i % 3 === 0 ? 'transaction' : 'piglet_ledger', local_id: `SEED-${i}`,
        amount: 1000 + i, note: 'seeded ledger row for the egress measurement', date: '2026-09-01'
      }))
    ]
  };
  const allRows = () => state.rows.map(r => {
    const row = { farm_id: 'FARM-1', entity_type: r.entity_type, local_id: r.local_id, updated_at: r.updated_at || state.ts };
    return { ...row, payload: { ...r, farm_id: 'FARM-1', id: r.local_id, updated_at: row.updated_at } };
  });

  async function fetchImpl(url, init = {}) {
    const u = new URL(url), p = u.pathname, q = u.searchParams;
    const method = init.method || 'GET';
    const entry = { path: p + u.search, method, bytes: 0 };
    requests.push(entry);
    if (method === 'POST') posts.push({ path: p + u.search, body: init.body });
    const json = (body, status = 200, headers = {}) => ({
      ok: status >= 200 && status < 300, status,
      headers: new Map(Object.entries({ 'content-type': 'application/json', ...headers })),
      json: async () => { entry.bytes += JSON.stringify(body).length; return body; }
    });

    if (p === '/rest/v1/farms') return json([{ id: 'FARM-1', name: "RM's Hog Farm", logo_url: null }]);
    if (p === '/rest/v1/rpc/ars_farm_record_counts') {
      if (!rpc) return json({ message: 'function ars_farm_record_counts does not exist' }, 404);
      const tally = {};
      allRows().forEach(r => { tally[r.entity_type] = (tally[r.entity_type] || 0) + 1; });
      return json(Object.entries(tally).map(([entity_type, n]) => ({ entity_type, n })));
    }
    if (p !== '/rest/v1/app_records') return json({ message: `unhandled ${p}` }, 404);

    if (method === 'POST' && u.search.includes('on_conflict')) {
      // apply the write so later reads see the new version
      const body = JSON.parse(init.body);
      body.forEach(row => {
        const existing = state.rows.find(r => r.entity_type === row.entity_type && r.local_id === row.local_id);
        if (existing) Object.assign(existing, row.payload, { updated_at: row.updated_at });
        else state.rows.push({ ...row.payload, updated_at: row.updated_at });
      });
      state.ts = body[body.length - 1].updated_at.replace('Z', '+00:00');
      return json(null, 201);
    }

    /* heartbeat / preflight probe: select=updated_at&order=updated_at.desc&limit=1 */
    if (q.get('select') === 'updated_at') {
      const rows = allRows().slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      return json(rows.slice(0, 1).map(r => ({ updated_at: r.updated_at })), 200,
        { 'content-range': `0-0/${rows.length}` });
    }
    /* [FIX 186] narrowed preflight read: select=farm_id,entity_type,local_id,updated_at */
    if (String(q.get('select')).includes('updated_at') && !String(q.get('select')).includes('payload')) {
      if (state.narrowFail) return json({ message: 'syntax error at or near "in"' }, 400);
      const wanted = String(q.get('local_id') || '').replace(/^in\.\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, ''));
      const rows = allRows().filter(r => wanted.includes(r.local_id))
        .map(r => ({ farm_id: r.farm_id, entity_type: r.entity_type, local_id: r.local_id, updated_at: r.updated_at }));
      return json(rows, 200, { 'content-range': `0-${rows.length - 1}/${rows.length}` });
    }
    /* the whole-farm read (pullFarm, or the full preflight fallback) */
    let rows = allRows();
    for (const key of ['entity_type', 'local_id']) {
      const raw = q.get(key);
      if (raw && raw.startsWith('eq.')) rows = rows.filter(r => r[key] === raw.slice(3));
    }
    rows = rows.sort((a, b) => `${a.entity_type}${a.local_id}`.localeCompare(`${b.entity_type}${b.local_id}`));
    const offset = Number(q.get('offset') || 0), limit = Number(q.get('limit') || 1000);
    const page = rows.slice(offset, offset + limit);
    return json(page, 200, { 'content-range': `${offset}-${offset + page.length - 1}/${rows.length}` });
  }
  const readBytes = () => requests.filter(r => r.method === 'GET').reduce((a, r) => a + r.bytes, 0);
  const fullReads = () => requests.filter(r => /select=[^&]*payload/.test(r.path));
  const narrowReads = () => requests.filter(r => /local_id=in\./.test(r.path));
  const probes = () => requests.filter(r => /select=updated_at/.test(r.path));
  return { state, requests, posts, fetchImpl, fullReads, narrowReads, probes, readBytes, reset: () => { requests.length = 0; posts.length = 0; } };
}

/* ── boot the real client.js ───────────────────────────────────────────────── */
function boot({ rpc = true } = {}) {
  const store = (() => { const m = new Map(); return {
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i], get length() { return m.size } }; })();
  const server = makeServer({ rpc });
  const win = {
    localStorage: store, sessionStorage: store, STORE: store, DB: {},
    ARS_SUPABASE_CONFIG: { url: 'https://stub.supabase.co', anonKey: 'sb_publishable_stub' },
    __arsActiveFarmId: 'FARM-1', __arsCloudBaselineReady: true, arsContextReady: true
  };
  store.setItem('ars-supabase-session-v2', JSON.stringify({
    access_token: 'test-token', refresh_token: null,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 't@example.com' }
  }));
  globalThis.window = win;
  globalThis.localStorage = store;
  globalThis.sessionStorage = store;
  globalThis.STORE = store;              // client.js also reads a bare STORE global
  globalThis.F = () => win.DB['FARM-1'];
  globalThis.fetch = server.fetchImpl;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  globalThis.document = { querySelector: () => null, activeElement: null };
  vm.runInThisContext(fs.readFileSync(CLIENT, 'utf8'), { filename: path.basename(CLIENT) });
  return { win, server, cloud: win.ARSCloud };
}

/* save a local edit the way app.js does: mutate the bucket, mark it dirty, push */
function editOneSow(win, cloud, name) {
  const farm = win.DB['FARM-1'];
  const previous = JSON.parse(JSON.stringify(farm));
  farm.sows[0].name = name;
  cloud.markLocalChanges('FARM-1', previous, farm);
  win.__arsLastSavedFarmById = { 'FARM-1': JSON.parse(JSON.stringify(farm)) };
  return farm;
}

console.log(`\n[FIX 186] sync preflight — using ${path.relative(ROOT, CLIENT)}\n`);

/* ── 1 · after a verified pull, a save must not read any rows ─────────────── */
console.log('[1] save right after a verified pull (nothing else changed)');
{
  const { win, server, cloud } = boot();
  const pull = await cloud.pullFarm('FARM-1');
  ok('baseline pull succeeds', pull.success === true, JSON.stringify(pull));
  ok('baseline pull is a full read, paginated at 1000 rows (that is the point of a pull)',
    server.fullReads().length >= 1, `got ${server.fullReads().length}`);
  server.reset();
  editOneSow(win, cloud, 'Renamed-A');
  const push = await cloud.pushFarm('FARM-1', win.DB['FARM-1'], { dirtyOnly: true });
  ok('push succeeds', push.success === true && push.count === 1, JSON.stringify(push));
  ok('NO whole-farm read during the push', server.fullReads().length === 0, `got ${server.fullReads().length}`);
  ok('NO narrowed read either (head matched)', server.narrowReads().length === 0);
  ok('exactly one 300-byte head probe', server.probes().length === 1, `got ${server.probes().length}`);
  ok('the edit was actually written', server.posts.length === 1 && /Renamed-A/.test(server.posts[0].body));
  ok('preflight mode reported as head', win.__arsPushPreflight === 'head', String(win.__arsPushPreflight));
  const got = server.readBytes();
  ok('read bytes for the save are under 1 KB', got < 1024, `got ${got} bytes`);
  console.log(`        requests: ${server.requests.length}, bytes downloaded by this save: ${got}`);
}

/* ── 2 · a remote change narrows the read, still no whole-farm download ───── */
console.log('\n[2] another device wrote something in between');
{
  const { win, server, cloud } = boot();
  await cloud.pullFarm('FARM-1');
  /* a foreign insert with its own newer timestamp moves the farm head without
     ageing the row we are about to write — so there must be NO conflict */
  server.state.rows.push({ entity_type: 'transaction', local_id: 'TX-9', amount: 500, updated_at: '2026-09-02T00:00:00+00:00' });
  server.reset();
  editOneSow(win, cloud, 'Renamed-A2');
  const push = await cloud.pushFarm('FARM-1', win.DB['FARM-1'], { dirtyOnly: true });
  ok('push still succeeds (no false conflict)', push.success === true, JSON.stringify(push));
  ok('narrowed read used for the dirty row', server.narrowReads().length === 1, `got ${server.narrowReads().length}`);
  ok('still NO whole-farm read', server.fullReads().length === 0);
  ok('narrow read asks for the id being written', /SOW-1/.test(server.narrowReads()[0]?.path || ''));
  ok('preflight mode reported as targeted', win.__arsPushPreflight === 'targeted', String(win.__arsPushPreflight));
}

/* ── 3 · a genuine concurrent edit of the SAME row is still refused ───────── */
console.log('\n[3] conflict: the row we are writing changed on the server');
{
  const { win, server, cloud } = boot();
  await cloud.pullFarm('FARM-1');
  server.state.rows[0].name = 'Other-Device-Wins';
  server.state.rows[0].updated_at = '2026-09-03T00:00:00+00:00';
  server.state.ts = '2026-09-03T00:00:00+00:00';
  server.reset();
  editOneSow(win, cloud, 'Mine');
  const push = await cloud.pushFarm('FARM-1', win.DB['FARM-1'], { dirtyOnly: true });
  ok('push refused', push.success === false);
  ok('conflict surfaced for that row', (push.conflicts || []).some(c => c.entity_type === 'sow' && c.local_id === 'SOW-1'), JSON.stringify(push.conflicts));
  ok('nothing was written', server.posts.length === 0);
}

/* ── 4 · narrow read unsupported by the server → old behaviour, still safe ── */
console.log('\n[4] narrowed read unavailable (older PostgREST) → full preflight fallback');
{
  const { win, server, cloud } = boot();
  await cloud.pullFarm('FARM-1');
  server.state.narrowFail = true;
  server.state.rows.push({ entity_type: 'transaction', local_id: 'TX-8', amount: 10, updated_at: '2026-09-04T00:00:00+00:00' });
  server.reset();
  editOneSow(win, cloud, 'Fallback-Ok');
  const push = await cloud.pushFarm('FARM-1', win.DB['FARM-1'], { dirtyOnly: true });
  ok('push still succeeds via the fallback', push.success === true, JSON.stringify(push));
  ok('fell back to the whole-farm read', server.fullReads().length >= 1, `got ${server.fullReads().length}`);
  ok('preflight mode reported as full-fallback', win.__arsPushPreflight === 'full-fallback', String(win.__arsPushPreflight));
}

/* ── 5 · bulk push keeps the single full read (cheaper than N chunks) ─────── */
console.log('\n[5] bulk save (>400 dirty rows)');
{
  const { win, server, cloud } = boot();
  await cloud.pullFarm('FARM-1');
  /* move the head so the fast path is not taken — this is the case where the
     client must choose between 450 ids in a URL and one full read */
  server.state.rows.push({ entity_type: 'transaction', local_id: 'TX-7', amount: 1, updated_at: '2026-09-05T00:00:00+00:00' });
  server.reset();
  const farm = win.DB['FARM-1'];
  const previous = JSON.parse(JSON.stringify(farm));
  for (let i = 0; i < 450; i++) farm.sows.push({ id: `NEW-${i}`, name: `Sow ${i}`, _ars_cloud_local_id: `NEW-${i}` });
  cloud.markLocalChanges('FARM-1', previous, farm);
  const push = await cloud.pushFarm('FARM-1', farm, { dirtyOnly: true });
  ok('bulk push succeeds', push.success === true && push.count === 450, JSON.stringify({ ...push, conflicts: undefined }));
  ok('used the full read, not 450 ids in a URL', server.fullReads().length >= 1 && server.narrowReads().length === 0,
    `full=${server.fullReads().length} narrow=${server.narrowReads().length}`);
}

/* ── 6 · optional record-count RPC, with graceful absence ─────────────────── */
console.log('\n[6] record counts (diagnostics panel)');
{
  const { server, cloud } = boot({ rpc: true });
  server.reset();
  const viaRpc = await cloud.getFarmRecordCounts('FARM-1');
  ok('RPC used', server.requests.some(r => r.path.includes('ars_farm_record_counts')));
  ok('one request, not 37', server.requests.length === 1, `got ${server.requests.length}`);
  ok('counts keyed by farm bucket key', viaRpc.sows === 2 && viaRpc.boars === 1, JSON.stringify(viaRpc));
  const off = boot({ rpc: false });
  off.server.reset();
  const viaLoop = await off.cloud.getFarmRecordCounts('FARM-1');
  ok('falls back to the per-type loop when the RPC is absent', off.server.requests.length > 20, `got ${off.server.requests.length}`);
  ok('fallback returns the same numbers', viaLoop.sows === 2 && viaLoop.boars === 1, JSON.stringify(viaLoop));
}

console.log(`\n${failures ? 'FAIL' : 'OK'} — ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
