#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   [FIX 197] the December-that-filtered-November bug — QA

   Production Forecast: picking "December 2026" in the month dropdown filtered
   Timeframe 2026-11. Cause: option values (and the Next-Month filter, and the
   reservations +90d expected-month) were read with toISOString(), which
   renders UTC — and a locally-built "1st of month, 00:00" on a UTC+8 phone is
   the previous month at 16:00Z. This test EXECUTES the shipped localYM helper
   from app.js under three timezones and asserts the month key never slips;
   then statically asserts no toISOString month-key derivation survives.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP = read('app.js');
const RES = read('reservations.js');

let checks = 0, failures = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};

const def = (APP.match(/const localYM = [^\n]+/) || [])[0];
ok('localYM helper exists in app.js', !!def);

/* run the REAL shipped helper in child processes pinned to each timezone */
const probe = `${def};console.log(localYM(new Date(2026, 11, 1)) + ' ' + localYM(new Date(2026, 0, 1)) + ' ' + localYM(new Date(2027, 11, 31)));`;
for (const tz of ['Asia/Manila', 'UTC', 'America/New_York']) {
  let out = '';
  try {
    out = execFileSync(process.execPath, ['-e', probe], { env: { ...process.env, TZ: tz } }).toString().trim();
  } catch (e) { out = 'exec failed: ' + e.message; }
  ok(`localYM never slips under ${tz}`, out === '2026-12 2026-01 2027-12', out);
}

/* demonstrate the OLD derivation was the culprit under Manila (documentation) */
const oldProbe = `const d = new Date(2026, 11, 1); console.log(d.toISOString().slice(0, 7));`;
const oldOut = execFileSync(process.execPath, ['-e', oldProbe], { env: { ...process.env, TZ: 'Asia/Manila' } }).toString().trim();
ok('old toISOString derivation reproduces the reported 2026-11', oldOut === '2026-11', oldOut);

ok('month options use localYM', APP.includes('const val = localYM(dObj);'));
ok('Next-Month filter uses localYM', APP.includes('const nextYM = localYM(d);'));
ok('app.js has no toISOString month keys left', !APP.includes('toISOString().slice(0, 7)'));
ok('reservations +90d expected month no longer UTC-shifts', !RES.includes('d.toISOString().slice(0, 7)'));

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
