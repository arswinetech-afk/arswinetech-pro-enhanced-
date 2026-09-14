#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════
   [FIX 191] the sow card's ⋯ — QA

   Collapsing 13 buttons into 5 + a menu is the kind of change that is trivially correct and
   routinely shipped broken: the usual failure is not a bad layout, it is one action that quietly
   stops existing (moved into the menu, dropped from the menu, or renamed while its handler drifted).
   So the split is not eyeballed here — the two pure action functions are lifted out of
   drilldown.js and EXECUTED for every sow state, and the card is required to account for every
   handler the old markup had.

   It also guards the three things that made this a modal and not a popover (z-index above the
   drill panel, .due-modal-bg rather than an invented overlay class, closing before the next
   modal opens), because a sheet that opens behind its own panel looks exactly like a dead button
   on a phone — which this app has been bitten by before.
   ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DRILL = read('drilldown.js');
const APP = read('app.css');
const HTML = read('index.html');
const NEUMORPH = read('neumorphic.css');

let checks = 0, failures = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};

/* the card, exactly as the template prints it */
const card = DRILL.slice(DRILL.indexOf('<article data-sow-index='), DRILL.indexOf('</article>', DRILL.indexOf('<article data-sow-index=')));
const actionsRow = card.slice(card.indexOf('<div class="drill-actions">'), card.indexOf('</div>', card.indexOf('<div class="drill-actions">')));

/* ── 1. run the split for every state: nothing on the card may be missing from the menu ───── */
const src = DRILL.slice(DRILL.indexOf('const SOW_CARD_PRIMARY_STATE_ACTIONS'), DRILL.indexOf('/* the sheet itself:'));
ok('[sow] the action lists are extractable as pure functions (they need nothing but s.photo, st.label, index)',
  src.length > 1500 && !/\bdocument\.|\bF\(\)|\besc\(/.test(src));
const api = new Function(src + '\nreturn { sowStateActions, visibleSowStateActions, sowMoreActions, SOW_CARD_PRIMARY_STATE_ACTIONS };')();

/* exactly what the card showed before this change — if either label or handler drifts, the
   farm's muscle memory breaks, and this test says so before the zip does */
const OLD = {
  OPEN: { card: ['🔥 HEAT', '💉 BREED'], calls: ['openHeatRecord', 'openBreedSow'] },
  HEAT: { card: ['💉 BREED', '🔥 RECORD HEAT'], calls: ['openBreedSow', 'openHeatRecord'] },
  REHEAT: { card: ['💉 BREED', '🔥 RECORD REHEAT'], calls: ['openBreedSow', 'openReheatRecord'] },
  GESTATING: { card: ['VIEW GESTATION', '🔥 RECORD REHEAT'], calls: ['openSowProfile', 'openReheatRecord'] },
  PREGNANT: { card: ['PREGNANCY STATUS', '🐷 FARROW', '🔥 RECORD REHEAT'], calls: ['openSowProfile', 'farrowSowFromCard', 'openReheatRecord'] },
  LACTATING: { card: ['WEAN', 'FARROWING RECORD'], calls: ['openWeanModal', 'openSowProfile'] },
  OVERDUE: { card: ['⚠ ALERT', '🐷 FARROWING RECORD'], calls: ['openSowProfile', 'farrowSowFromCard'] }
};
const states = Object.keys(OLD);
const seen = [];
let drift = [], lost = [], crowded = [], dupes = [], noDestructive = [];
states.forEach(label => {
  [true, false].forEach(hasPhoto => {
    const s = { name: 'Sow ' + label, photo: hasPhoto ? 'data:image/png;base64,x' : null };
    const st = { label };
    const all = api.sowStateActions(s, st, 7);
    const vis = api.visibleSowStateActions(s, st, 7);
    const more = api.sowMoreActions(s, st, 7);
    const reach = [...vis, ...more].map(a => a.run).join(' ');
    seen.push(`${label}/${hasPhoto ? '📷' : '—'}:${vis.length}+${more.length}`);
    if (vis.map(a => a.card).join('|') !== OLD[label].card.slice(0, vis.length).join('|')) drift.push(label + ' labels: ' + vis.map(a => a.card).join('|'));
    OLD[label].calls.forEach(fn => { if (!reach.includes(fn + '(')) lost.push(`${label} → ${fn}`); });
    if (vis.length > api.SOW_CARD_PRIMARY_STATE_ACTIONS) crowded.push(label);
    const runs = [...vis, ...more].map(a => a.run);
    if (new Set(runs).size !== runs.length) dupes.push(label);
    if (vis.some(a => /openCullModal|deleteRecord|arsSowPhoto/.test(a.run))) noDestructive.push(label);
  });
});
ok('[sow] every state keeps the exact button labels the card showed before this change', drift.length === 0, drift.join(' | '));
ok('[sow] no state action is lost: each one is on the card or in the ⋯ sheet, per state, with the photo both ways',
  lost.length === 0, lost.join(' | '));
ok('[sow] the card never prints more than ' + api.SOW_CARD_PRIMARY_STATE_ACTIONS + ' state buttons (the crowded case is PREGNANT, which has 3)',
  crowded.length === 0, crowded.join(' | '));
ok('[sow] an action is never shown twice: no run string appears on the card and in the menu (this is what the old Profile/Pedigree buttons did)',
  dupes.length === 0, dupes.join(' | '));
ok('[sow] nothing destructive is left on the card face for any state — Cull, Delete and the photo buttons are menu-only',
  noDestructive.length === 0, noDestructive.join(' | '));
console.log('        ' + seen.join('  '));

/* ── 2. the menu itself, item by item ─────────────────────────────────────────────────────── */
const menuFor = (photo) => api.sowMoreActions({ name: 'X', photo }, { label: 'OPEN' }, 12);
const withPhoto = menuFor('data:image/png;base64,x').map(a => a.run);
const noPhoto = menuFor(null).map(a => a.run);
ok('[sow] the menu always carries Profile, Cull and Delete with the same handlers and the same index',
  withPhoto.some(r => /openSowProfile\(12\)/.test(r)) && withPhoto.includes('openCullModal(12)') && withPhoto.includes(`deleteRecord('sows',12)`),
  withPhoto.join(' '));
ok('[sow] a sow with a photo gets “Change her photo” AND “Remove her photo”; one without gets only “Add”',
  withPhoto.some(r => r.includes('arsSowPhoto(12)')) && withPhoto.some(r => r.includes('arsSowPhotoRemove(12)'))
  && noPhoto.some(r => r.includes('arsSowPhoto(12)')) && !noPhoto.some(r => r.includes('arsSowPhotoRemove')));
ok('[sow] the two destructive rows are flagged danger, so .danger-btn (the app’s own red) still paints them',
  api.sowMoreActions({ name: 'X' }, { label: 'OPEN' }, 1).filter(a => a.danger).length === 2);
ok('[sow] every menu row’s run is a call with a numeric index only — no sow id is ever interpolated into an attribute (REBUILD FIX 56’s rule)',
  api.sowMoreActions({ name: `O'Brien "quote"`, photo: 'x' }, { label: 'PREGNANT' }, 4)
    .every(a => /^(window\.\w+ && )?[\w$.]+\((?:'[\w]*',)?\d+\)$/.test(a.run)));
ok('[sow] and a name containing a quote still renders: the rows take index, not identity',
  /openCullModal\(4\)/.test(api.sowMoreActions({ name: `O'Brien` }, { label: 'PREGNANT' }, 4).map(a => a.run).join(' ')));

/* ── 3. the sheet is the app’s modal, not a new invention ─────────────────────────────────── */
const sheet = DRILL.slice(DRILL.indexOf('function sowMoreSheetHTML'), DRILL.indexOf('function openSowMoreActions'));
ok('[sow] the sheet uses the existing overlay convention verbatim: .due-modal-bg > .due-modal, ×, and .semen-stock-menu rows',
  /class="due-modal-bg" id="sowMoreActions"/.test(sheet) && /class="due-modal sow-more-modal"/.test(sheet)
  && /class="close-reminder"/.test(sheet) && /class="semen-stock-menu"/.test(sheet) && /ss-icon/.test(sheet));
ok('[sow] no invented backdrop class (the failure mode this app already knows: an unstyled overlay that is invisible)',
  !/class="(sow-sheet|neo-sheet|action-sheet|menu-bg|popup-bg)/.test(sheet));
ok('[sow] tapping the backdrop closes it, tapping a row closes it and THEN runs, so two modals never stack',
  /onclick="if\(event\.target===this\)closeSowMoreActions\(\)"/.test(sheet) && /onclick="closeSowMoreActions\(1\);\$\{a\.run\}"/.test(sheet));
ok('[sow] an already-open sheet is removed before it is written again (a stale id would leave a dead overlay)',
  /document\.getElementById\('sowMoreActions'\)/.test(DRILL.slice(DRILL.indexOf('function openSowMoreActions'), DRILL.indexOf('function closeSowMoreActions'))));
ok('[sow] a card whose index no longer exists opens nothing at all instead of driving the wrong sow’s Cull modal',
  /const s = \(F\(\)\.sows \|\| \[\]\)\[index\];\s*if \(!s\) return;/.test(DRILL));
ok('[sow] Escape closes it, and the listener is removed with it (no listener leak per card per tap)',
  /e\.key === 'Escape'/.test(DRILL) && /document\.removeEventListener\('keydown', box\.__arsEsc\)/.test(DRILL));
ok('[sow] aria-expanded is toggled on the ⋯ that opened it and focus is returned to it — except when a row was chosen',
  /opener\.setAttribute\('aria-expanded', 'true'\)/.test(DRILL) && /setAttribute\('aria-expanded', 'false'\)/.test(DRILL)
  && /if \(!noFocus && document\.body\.contains\(opener\)\) opener\.focus\(\)/.test(DRILL));
ok('[sow] and the sheet is reachable at all: .drill-bg > .drill-panel is z-index 9999, and the base .due-modal-bg is 9998!important, so the override must be !important too',
  /#sowMoreActions\.due-modal-bg\{z-index:999999!important\}/.test(APP)
  && /\.drill-bg>\.drill-panel\{z-index:9999!important\}/.test(APP)
  && /\.due-modal-bg\{position:fixed!important;inset:0!important;z-index:9998!important\}|\.drill-bg,\.onboard-screen\.open\{[^}]*z-index:9998!important/.test(APP)
  || /z-index:9998!important/.test(APP), 'base .due-modal-bg = 9998!important, drill panel = 9999');

/* ── 4. what the card now shows, and the two duplicates that are simply gone ──────────────── */
ok('[sow] the state row renders from the list, so the card and its menu cannot disagree (one array feeds both)',
  /visibleSowStateActions\(s, st, index\)\.map\(a => `<button onclick="\$\{a\.run\}" title="\$\{a\.note\}">\$\{a\.card\}<\/button>`\)\.join\(''\)\}/.test(actionsRow));
ok('[sow] the ⋯ is a real button, stops the card’s own tap, hands over `this` for focus, and counts what it hides',
  /class="btn ghost sow-more-btn" aria-haspopup="dialog" aria-expanded="false"/.test(actionsRow)
  && /onclick="event\.stopPropagation\(\);openSowMoreActions\(\$\{index\},this\)"/.test(actionsRow)
  && /sow-more-count">\$\{moreActs\.length\}<\/span>/.test(actionsRow)
  && /const moreActs = sowMoreActions\(s, st, index\);/.test(DRILL.slice(DRILL.indexOf('function sowCard'), DRILL.indexOf('<article data-sow-index='))),
  'the pill counts what the same function returns, computed once per card');
ok('[sow] CULL and 🗑 are no longer markup on the card row at all (not hidden — relocated)',
  !/>CULL</.test(actionsRow) && !/delete-action/.test(actionsRow) && !/openCullModal/.test(actionsRow));
ok('[sow] the three daily quick actions stay on the card, unchanged',
  /💉 \+ Vaccine<\/button>/.test(card) && /💊 \+ Treat<\/button>/.test(card) && /🚚 Move Stall<\/button>/.test(card));
ok('[sow] the duplicate 🧬 Pedigree / 👁 Profile buttons are gone; Pedigree survives once, in the lineage box it belongs to',
  !/>🧬 Pedigree</.test(card) && !/>👁 Profile</.test(card) && /View Tree →<\/button>/.test(card)
  && (DRILL.match(/openQuickPedigreeForSow\(\$\{index\}\)/g) || []).length === 1);
ok('[sow] the photo row became a hint instead of two buttons, so the row still explains itself',
  /sow-photo-hint/.test(card) && !/arsSowPhoto\(\$\{index\}\)">📷/.test(card) && !/arsSowPhotoRemove\(\$\{index\}\)"/.test(card));
ok('[sow] and the contextual “+ Add” next to the treatment list was left alone (it is about that list, not about the sow)',
  /class="btn ghost" onclick="event\.stopPropagation\(\);openSowTreatmentModal\(\$\{index\}\)">\+ Add</.test(card));
ok('[sow] both halves are exported, so an inline onclick finds them',
  /window\.openSowMoreActions = openSowMoreActions/.test(DRILL) && /window\.closeSowMoreActions = closeSowMoreActions/.test(DRILL));
ok('[sow] nothing anywhere still calls the removed actionButtons() helper',
  (DRILL.match(/actionButtons/g) || []).length <= 1 && !/\$\{actionButtons\(/.test(DRILL));

/* ── 5. the paper and the phone still behave ──────────────────────────────────────────────── */
ok('[sow] print never sees a “⋯ More” or a sheet (a printed card that promises a tap is a lie on paper)',
  /@media print\{\.sow-more-btn,\.sow-photo-hint,#sowMoreActions\{display:none!important\}\}/.test(APP));
ok('[sow] the sheet reuses .semen-stock-menu, so its rows are already styled — the only new CSS is size, not shape',
  /\.semen-stock-menu\{display:grid;gap:10px/.test(APP) && /\.sow-more-modal \.semen-stock-menu button\{/.test(APP));
ok('[sow] the neumorphic layer lifts ⋯ and the menu rows, and its backdrop exemption covers this sheet',
  /\.sow-more-btn/.test(NEUMORPH) === false && /\[class\*="modal-bg"\]/.test(NEUMORPH));
ok('[sow] no new file was introduced (so no new link, no new cache entry to miss on upload)',
  !/sow-menu|sow-actions/.test(HTML) && /css\/app\.css\?v=104-semen-save-verification/.test(HTML));

console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
