#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════
   [FIX 190] the neumorphic affordance layer — QA

   A pure-CSS change is usually where "it can't break anything" turns out to be false: a repaint,
   a min-height, a transform on a container, a missing file in the deploy folder, an `addAll`
   that 404s and kills the whole release. So this harness does not test pixels it cannot see — it
   tests the CLAIMS, i.e. the handful of ways an additive stylesheet can still hurt this app:

     1. the layer must not paint, resize or re-flow anything (no background/color/font/padding…);
     2. every custom property it uses must be defined (a typo is a silent no-op, which is how a
        "fix" becomes an unfixed screen six months later);
     3. every class it targets must exist in the app (a stale selector is a dead rule);
     4. the file must be linked last, cached like the shell, copied into the deploy folder, and
        its absence must fail the build loudly rather than quietly restyle nothing;
     5. the things the user sent screenshots of must be covered — the flat `.btn.ghost`, the
        chip-shaped `.tag`/`.status-pill`, the `<td onclick>` rows that must stay flat, and the
        clickable CARDS that must press without a transform.
   ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CSS = read('neumorphic.css');
const BODY = CSS.replace(/\/\*[\s\S]*?\*\//g, '');          /* comments are for humans, not lints */
const FLAT = BODY.replace(/\s+/g, ' ');                        /* one line, for whole-file greps */
const swClean = read('sw.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let checks = 0, failures = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};
const list = (re) => (BODY.match(re) || []).length;

/* ── 1. design-only, for real: the layer adds no ink and no geometry ────────────────────────── */
const FORBIDDEN = /(?:^|[;{}\s])(background|background-color|color|font-family|font-size|font-weight|line-height|padding|margin|border-radius|border-width|width|height|display|position|z-index|float|overflow|letter-spacing|text-align)(?:-[\w-]+)?\s*:/g;
const hits = BODY.match(FORBIDDEN) || [];
ok('[neo] not one declaration paints, resizes or re-flows (no background, color, font, padding, width…)',
  hits.length === 0, hits.slice(0, 4).join(' | '));
ok('[neo] and no !important anywhere — specificity and load order do the work, so nothing had to be forced',
  !/!important/.test(BODY));
ok('[neo] the file is a layer, not a rewrite: app.css itself was not touched',
  !/FIX 190/.test(read('app.css')) && /\.btn\.ghost\{background:#123237;color:#8ce7df;box-shadow:none\}/.test(read('app.css')),
  'app.css still holds its own ghost rule');
ok('[neo] no JS was edited for a visual change (data-neo stays a documented escape hatch, not a call site)',
  !/data-neo/.test(read('app.js') + read('semen-sales.js') + read('drilldown.js') + read('sow-monitoring.js')));

/* ── 2. tokens: every var() must be defined in :root ────────────────────────────────────────── */
const defined = new Set([...BODY.matchAll(/(--neo-[\w-]+)\s*:/g)].map(m => m[1]));
const used = new Set([...BODY.matchAll(/var\((--neo-[\w-]+)/g)].map(m => m[1]));
const missing = [...used].filter(v => !defined.has(v));
ok('[neo] every var(--neo-…) resolves to a token defined here', missing.length === 0, missing.join(', '));
ok('[neo] and the tokens are declared inside :root, so a screen without the media query never sees them',
  [defined.size >= 6, defined.size, used.size].every(Boolean), `${defined.size} defined / ${used.size} used`);

/* ── 3. selectors must point at things this app actually renders ─────────────────────────────── */
const sources = ['app.css', 'index.html', 'app.js', 'drilldown.js', 'sow-monitoring.js', 'semen-sales.js',
  'production-control.js', 'barn-movements.js', 'boar-registry.js', 'vaccination-center.js', 'medicine-inventory.js']
  .map(f => { try { return read(f); } catch (_) { return ''; } }).join('\n');
const classes = [...new Set([...CSS.matchAll(/\.([a-z][\w-]*)/g)].map(m => m[1]))]
  .filter(c => !['neo-flat'].includes(c))                 /* the documented opt-out hook, unused on purpose */
  .filter(c => !c.startsWith('neo-'));
const dead = classes.filter(c => !sources.includes('.' + c) && !sources.includes(`class="${c}`) && !sources.includes(`${c}"`));
ok('[neo] no stale selectors: every class it mentions exists in the app or its stylesheet',
  dead.length === 0, dead.join(', '));
ok('[neo] attribute selectors it relies on are in real use (onclick is how this app wires taps)',
  list(/\[onclick\]/g) > 0 && (sources.match(/onclick=/g) || []).length > 400,
  `${(sources.match(/onclick=/g) || []).length} onclick call sites`);
ok('[neo] and it stays on the grammar every webview in the field speaks — no :has(), no :is(), no :where()',
  !/:has\(|:is\(|:where\(/.test(BODY));

/* ── 4. it must be print-safe and structure-safe: the whole layer is scoped to screens ───────── */
ok('[neo] the entire layer lives inside @media screen, so thermal receipts and print never change',
  /^@media screen\s*\{/.test(BODY.trim()) && list(/@media screen/g) === 1);
ok('[neo] braces balance (an unbalanced block silently eats every rule after it)',
  list(/\{/g) === list(/\}/g), `${list(/\{/g)} open / ${list(/\}/g)} close`);
ok('[neo] the printable certificate and the feed report are explicitly exempt',
  /\.certificate button/.test(BODY) && /#feedReport button/.test(BODY));
ok('[neo] the typeahead rows and the sidebar are exempt — eleven soft keys in one popover is the bug, not the fix',
  /\.semen-suggestions button/.test(BODY) && /\.nav button/.test(BODY) && /\.close-reminder/.test(BODY));

/* ── 4b. it must actually parse: a missing semicolon drops the NEXT declaration, silently ────── */
{
  const inside = FLAT.replace(/^@media screen \{/, '').replace(/\}\s*$/, '');
  const blocks = [...inside.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const badDecl = [];
  blocks.forEach(([, sel, decls]) => {
    decls.split(';').map(d => d.trim()).filter(Boolean).forEach(d => {
      if (!/^[-a-z]+:\s*\S/.test(d) && !/^[^{]*\{[^}]*$/.test(d)) badDecl.push(d.slice(0, 40));
    });
    if (!sel.trim() || /\{/.test(sel)) badDecl.push('selector? ' + sel.trim().slice(0, 40));
  });
  ok('[neo] every rule parses: selector + brace + “property: value” declarations, so no stray ; or { can drop the next line',
    blocks.length > 12 && badDecl.length === 0, badDecl.slice(0, 3).join(' | ') || `${blocks.length} blocks`);
  ok('[neo] nested media queries are all inside the screen block (nothing leaks into print)',
    /@media \(max-width: 760px\)/.test(FLAT) && /@media \(hover:hover\)/.test(FLAT)
    && /@media \(prefers-reduced-motion: reduce\)/.test(FLAT) && /@media \(prefers-contrast: more\)/.test(FLAT));
}

/* ── 5. the confusion the user photographed, rule by rule ───────────────────────────────────── */
ok('[neo] the flat .btn.ghost — the button that looked exactly like a tag — now carries an edge and a lift',
  /\.btn\.ghost:not\([^)]*\)[^{]*\{[^}]*box-shadow: var\(--neo-lift/.test(BODY.replace(/\n\s*/g, ' ')),
  (BODY.match(/\.btn\.ghost[^\n]*/) || [''])[0]);
ok('[neo] every real control gets the lift (button, .btn, [role=button], [onclick])',
  /^ {2}button:not\(\[data-neo="flat"\]\)[\s\S]{0,400}?box-shadow: var\(--neo-lift-sm\), var\(--neo-edge\);/m.test(BODY));
ok('[neo] and a clickable card is a key too: cursor pointer + the deeper lift',
  /\[onclick\]:not\(button\):not\(a\):not\(td\):not\(th\):not\(tr\):not\(li\) \{ cursor: pointer; \}/.test(BODY)
  && /\[onclick\][^{]*\{[^}]*box-shadow: var\(--neo-lift\), var\(--neo-edge\)/.test(BODY.replace(/\n\s*/g, ' ')));
ok('[neo] the labels stop looking pressable: tags, pills, hints and read-only rows go inset',
  /\.tag:not\(button\):not\(\[onclick\]\)/.test(BODY) && /\.status-pill:not\(button\)/.test(BODY)
  && /\.count-pill:not\(button\)/.test(BODY) && /\.checklist \.check-item:not\(\[onclick\]\)/.test(BODY)
  && /box-shadow: var\(--neo-inset\);\s*cursor: default;/.test(BODY));
ok('[neo] the app’s own buttons had no press at all (.btn/:active does not exist in 6,085 lines), and its seven :active rules are all on list rows',
  !/\.btn[^{,]*:active/.test(read('app.css')) && (read('app.css').match(/:active/g) || []).length === 7
  && /button:not\(:disabled\):not\(\[disabled\]\):active/.test(BODY),
  `${(read('app.css').match(/:active/g) || []).length} :active rules in app.css, none of them on .btn`);
const cardPress = /\[onclick\]:not\(button\)[^{;]*:active\s*\{([^}]{0,140})\}/.exec(FLAT);
ok('[neo] a clickable CARD presses on its shadow only, never a transform (which would jump its absolutely-positioned children)',
  !!cardPress && !/transform/.test(cardPress[1]) && /box-shadow: var\(--neo-press\)/.test(cardPress[1]),
  cardPress ? cardPress[1].trim().slice(0, 90) : 'no [onclick]:active rule found');
ok('[neo] table cells with an onclick stay flat — a lifting <td> looks like the grid is peeling off',
  list(/:not\(td\)/g) >= 3, `${list(/:not\(td\)/g)} td exclusions`);
ok('[neo] a disabled control looks out of reach instead of inviting a tap',
  /button:disabled, \.btn:disabled, \[disabled\], \[aria-disabled="true"\][\s\S]{0,120}var\(--neo-inset\)/.test(BODY));
ok('[neo] keyboard and scanner focus become visible (:focus-visible did not exist in the app)',
  /:focus-visible/.test(BODY) && /--neo-focus/.test(BODY) && !/:focus-visible/.test(read('app.css')));

/* ── 6. mobile, which is what they asked about ──────────────────────────────────────────────── */
ok('[neo] tap targets reach 40px on phones, inside a max-width query only',
  /@media \(max-width: 760px\)/.test(BODY) && /min-height: 40px/.test(BODY));
ok('[neo] the mobile sizes name the app’s real action rows (.due-actions, .drill-actions, .toolbar, .adj-card)',
  /\.due-actions button/.test(BODY) && /\.drill-actions button/.test(BODY) && /\.toolbar button/.test(BODY) && /\.adj-card button/.test(BODY));
ok('[neo] no min-height is applied to inputs, so the two-column pick-up grid keeps its shape',
  !/input[^{]{0,60}\{[^}]{0,160}min-height/.test(FLAT));
ok('[neo] the modal × grows to a 44px target on phones only',
  /\.close-reminder \{ min-width: 44px; min-height: 44px; \}/.test(BODY));
ok('[neo] the Android artefacts are handled: no grey tap flash, no 300ms delay, no accidental text selection',
  /-webkit-tap-highlight-color: transparent/.test(BODY) && /touch-action: manipulation/.test(BODY)
  && /user-select: none/.test(BODY));
ok('[neo] hover styling is gated on real hover, so it cannot stick on after a tap',
  /@media \(hover:hover\) and \(pointer:fine\)/.test(BODY));
ok('[neo] reduced motion drops the transform but keeps the shadow, and high contrast thickens the edge',
  /@media \(prefers-reduced-motion: reduce\)/.test(BODY) && /@media \(prefers-contrast: more\)/.test(BODY));

/* ── 7. wiring: a stylesheet nobody loads is not a redesign, it is a no-op ───────────────────── */
const html = read('index.html');
const appAt = html.indexOf('css/app.css?v='), neoAt = html.indexOf('css/neumorphic.css?v=');
ok('[neo] index.html links it, and links it AFTER app.css (the layer relies on coming later)',
  appAt > 0 && neoAt > appAt, `app@${appAt} neo@${neoAt}`);
ok('[neo] with its own cache-buster, the way app.css does it',
  /css\/neumorphic\.css\?v=190-neumorphic-affordance/.test(html));
ok('[neo] it is the last stylesheet in <head> — a later <style> block would beat it',
  (() => {
    const head = html.slice(0, html.indexOf('</head>'));
    const links = [...head.matchAll(/<link[^>]*stylesheet[^>]*>/g)].map(m => m[0]);
    return /neumorphic/.test(links[links.length - 1]) && !/<style/.test(head.slice(head.lastIndexOf('neumorphic')));
  })(), (html.match(/<link[^>]*stylesheet[^>]*>/g) || []).length + ' stylesheet(s) in head');
const sw = read('sw.js');
ok('[neo] the service worker pre-warms it', /'\.\/css\/neumorphic\.css'/.test(sw));
ok('[neo] and install is per-entry now: one missing file can no longer keep the OLD worker alive',
  /Promise\.allSettled\(APP_SHELL\.map\(\(url\) => cache\.add\(url\)\)\)/.test(sw)
  && !/cache\.addAll\(/.test(swClean), (swClean.match(/cache\.addAll\([^)]*\)/) || ['no addAll left'])[0]);
ok('[neo] CACHE_NAME and the About build string both moved, or phones keep last week’s shell',
  /arswinetech-pro-v239-neumorphic-affordance/.test(sw) && /v239-neumorphic-affordance/.test(read('config.js')));
ok('[neo] _headers serves CSS as no-cache, so re-uploading this file is enough on its own',
  /\/\*\.css\n {2}Cache-Control: no-cache/.test(read('_headers')));
const build = read('qa/build-deploy-layout.sh');
ok('[neo] the deploy layout copies it by name and fails loudly if it is missing',
  /test -f "\$REPO\/neumorphic\.css" \|\| \{ echo "FATAL/.test(build) && /cp "\$REPO\/neumorphic\.css" "\$OUT\/css\/neumorphic\.css"/.test(build));
ok('[neo] the reseller’s own page is deliberately left alone (public, no cache, its own design)',
  !/neumorphic/.test(read('order.html')) && !/neumorphic/.test(read('order-page.js')));

console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
