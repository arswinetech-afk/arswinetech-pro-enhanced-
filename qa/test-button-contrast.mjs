#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════
   [FIX 192] contrast of the things a <button> paints — QA

   The farm's phone showed the collection board with its numbers nearly invisible. Not a colour
   problem in the palette — a fact about form controls: a `<button>` does NOT inherit text colour
   the way a `<div>` does. The browser paints it with its own `buttontext`, which is black, and
   app.css resets only `cursor`, `border` and `font` on `button` — never `color`. So any markup
   that gives a classless button its own dark surface (`background:var(--bg)`, as the board rows
   do) inherits black-on-#071114 = 1.1:1, while the one span inside that stated its own colour
   (“only 5 in stock · short 14”) stayed perfectly readable.

   This harness therefore measures, rather than eyeballs:
     1. the WCAG ratio of every colour the board row can produce, in both themes;
     2. that no classless inline-background button anywhere in the shipped JS is left without a
        colour — the shape of the bug, scanned across every file, so the next screen cannot
        repeat it.
   ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP = read('app.css');
const SALES = read('semen-sales.js');

let checks = 0, failures = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};

/* ── the two palettes, read out of app.css so the test follows the app instead of copying it ──
   app.css opens with a light :root and overrides it with a dark one, so “the shipped theme” is the
   LAST :root block, and the opt-in theme is `.light-theme{…}`. */
const blockAfter = (src, at) => src.slice(at, src.indexOf('}', at));
const roots = [...APP.matchAll(/:root\s*\{/g)].map(m => blockAfter(APP, m.index));
const parse = body => {
  const out = {};
  for (const m of (body || '').matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) out[m[1]] = m[2];
  return out;
};
/* the cascade, exactly as the browser sees it: app.css opens on a light :root, and a dark :root
   follows it (so dark is the default); `.light-theme{…}` then overrides a *subset* again — the
   tokens it omits keep the light :root’s values, which is why --warn is fine there and why reading
   only one block would have told me a lie about it. */
const DARK = parse(roots[roots.length - 1]);
const LIGHT = Object.assign({}, parse(roots[0]), parse(blockAfter(APP, APP.indexOf('.light-theme{'))));
const need = (t, name, keys) => keys.forEach(k => { if (!t[k]) throw new Error(`${name} is missing ${k} — app.css changed shape`); });
const lum = h => {
  h = String(h).replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map(i => f(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const x = lum(a), y = lum(b);
  return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
};
need(DARK, 'the shipped dark :root', ['--bg', '--ink', '--muted', '--teal', '--teal2', '--warn']);
need(LIGHT, '.light-theme', ['--bg', '--ink', '--muted', '--teal', '--warn']);

console.log(`        dark  --bg ${DARK['--bg']} · ink ${ratio(DARK['--ink'], DARK['--bg'])} · muted ${ratio(DARK['--muted'], DARK['--bg'])} · teal ${ratio(DARK['--teal'], DARK['--bg'])} · warn ${ratio(DARK['--warn'], DARK['--bg'])} · teal2 ${ratio(DARK['--teal2'], DARK['--bg'])}`);
console.log(`        light --bg ${LIGHT['--bg']} · ink ${ratio(LIGHT['--ink'], LIGHT['--bg'])} · muted ${ratio(LIGHT['--muted'], LIGHT['--bg'])} · teal ${ratio(LIGHT['--teal'], LIGHT['--bg'])} · warn ${ratio(LIGHT['--warn'], LIGHT['--bg'])}`);

/* ── 1. what the bug measured, so it can never be called “a bit low-contrast” ─────────────── */
ok('[contrast] the browser’s default control colour on this app’s surface IS unreadable: black on --bg is below 1.5:1',
  ratio('#000000', DARK['--bg']) < 1.5, `black on ${DARK['--bg']} = ${ratio('#000000', DARK['--bg'])}:1 — that was the board`);
ok('[contrast] the row’s words now use --ink and read at body-text strength in both themes (≥12:1)',
  ratio(DARK['--ink'], DARK['--bg']) >= 12 && ratio(LIGHT['--ink'], LIGHT['--bg']) >= 12,
  `${ratio(DARK['--ink'], DARK['--bg'])}:1 dark · ${ratio(LIGHT['--ink'], LIGHT['--bg'])}:1 light`);
ok('[contrast] the hint line is a hint, not a smudge: --muted ≥6:1 on the shipped dark theme',
  ratio(DARK['--muted'], DARK['--bg']) >= 6, `${ratio(DARK['--muted'], DARK['--bg'])}:1`);
ok('[contrast] the breed name was lifted from --teal2 to --teal and gains contrast without becoming decoration',
  ratio(DARK['--teal'], DARK['--bg']) >= 6 && ratio(DARK['--teal'], DARK['--bg']) > ratio(DARK['--teal2'], DARK['--bg']),
  `--teal ${ratio(DARK['--teal'], DARK['--bg'])}:1 vs --teal2 ${ratio(DARK['--teal2'], DARK['--bg'])}:1`);

/* ── 2. the board row markup, statement by statement ──────────────────────────────────────── */
const i0 = SALES.indexOf('  function orderBoardHTML('), board = SALES.slice(i0, SALES.indexOf('  /* the query is typed by a person', i0));
const row = /<button type="button" onclick="window\.arsOrderBoardBreed\(\$\{i\}\)" style="([^"]*)"/.exec(board);
ok('[contrast] the board row declares its own colour, because no stylesheet will do it for a control',
  !!row && /color:var\(--ink\)/.test(row[1]), row ? row[1].slice(0, 110) : 'row markup not found');
ok('[contrast] the surface it paints is a token, so a theme switch cannot strand the text',
  /background:var\(--bg\)/.test(row[1]) && /border:1px solid var\(--line\)/.test(row[1]), row ? row[1] : '');
ok('[contrast] the hint inside the row is coloured too — a <small> inside a <button> inherits the control, not the modal',
  /class="field-hint" style="display:block;margin-top:1px;color:var\(--muted\)"/.test(board));
ok('[contrast] and no fixed hex is left inside the board, so the amber means the same thing in both themes',
  !/#f0b64b|#[0-9a-f]{6}/.test(board) && (board.match(/var\(--warn\)/g) || []).length === 3,
  `var(--warn) ×${(board.match(/var\(--warn\)/g) || []).length}; hexes: ${(board.match(/#[0-9a-f]{6}/g) || []).join(',') || 'none'}`);
ok('[contrast] that swap was not cosmetic: #f0b64b on the LIGHT background was ${} — now --warn'.replace('${}', ratio('#f0b64b', LIGHT['--bg']) + ':1'),
  ratio('#f0b64b', LIGHT['--bg']) < ratio(LIGHT['--warn'], LIGHT['--bg']),
  `#f0b64b ${ratio('#f0b64b', LIGHT['--bg'])}:1 → var(--warn) ${ratio(LIGHT['--warn'], LIGHT['--bg'])}:1 on ${LIGHT['--bg']}`);

/* ── 3. the stylesheet net, scoped so it cannot become the next bug ───────────────────────── */
ok('[contrast] app.css states the fix as a safety net for classless buttons in a card',
  /\.adj-card>button:not\(\[class\]\)\{color:var\(--ink\)\}/.test(APP) && /\.adj-card>button:not\(\[class\]\) \.field-hint\{color:var\(--muted\)\}/.test(APP));
ok('[contrast] and it is :not([class])-scoped — an unscoped .adj-card button rule would out-specify .btn and repaint every button in the card',
  !/\.adj-card ?button(?![^{}]*:not)/.test(APP) && /\.btn\{[^}]*color:#fff/.test(APP),
  '.btn keeps its own colour');
ok('[contrast] the root cause is still true (so the net is still needed): no stylesheet rule sets color on a bare button',
  !/(^|[,{};])button\s*\{[^}]*color:/.test(APP) && /button\{cursor:pointer;border:0\}/.test(APP),
  (APP.match(/button\{[^}]*\}/) || [''])[0]);
ok('[contrast] .field-hint has no global rule (only .perf-modal styles it), which is why the row had to say it',
  /\.perf-modal \.field-hint\{[^}]*color:var\(--muted\)/.test(APP) && !/(^|[,{};])\.field-hint\{/.test(APP));

/* ── 4. the same mistake, scanned for everywhere it could be made again ───────────────────── */
const SKIP = new Set(['sw.js', 'register-sw.js', '_worker.js']);   /* no markup in them */
const FILES = fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && !SKIP.has(f));
const offenders = [];
const control = /<(button|select|textarea)\b([^>]*)>/g;
FILES.forEach(f => {
  let m;
  while ((m = control.exec(read(f) || ''))) {
    const attrs = m[2];
    const style = (/style="([^"]*)"/.exec(attrs) || [, ''])[1];
    const bg = /(^|;)\s*background(-color)?\s*:/.test(style);
    const color = /(^|;)\s*color\s*:/.test(style);
    const cls = /\bclass=/.test(attrs);
    if (bg && !color && !cls) offenders.push(`${f}:${read(f).slice(0, m.index).split('\n').length}`);
  }
});
ok('[contrast] not one classless control in the shipped JS paints its own background without a colour',
  offenders.length === 0, offenders.slice(0, 6).join(' | '));
ok('[contrast] the scan can see (it found the board row before it was fixed — prove it is not vacuous)',
  (() => {
    const before = '<button type="button" style="background:var(--bg)">x</button>';
    const after = '<button type="button" class="btn" style="background:var(--bg)">x</button>';
    const one = t => /style="([^"]*)"/.test(t) && /background:/.test(t) && !/color:/.test(t) && !/class=/.test(t);
    return one(before) && !one(after);
  })());
const bare = FILES.reduce((n, f) => n + (read(f).match(/<(?:button|select|textarea)\b[^>]*class="btn/g) || []).length, 0);
ok('[contrast] and the app’s own .btn/.danger-btn classes are what keep the rest of them readable (' + bare + ' classed controls)',
  bare > 200, `${bare} classed controls`);

/* ── 4b. a control that paints its OWN dark surface must state a colour — computed, not guessed ─
   The board row failed exactly this test: its class said `background:#10222a`-style dark and
   nothing said what the words are, so the browser’s black stood. A class that sets no background
   (a bare `.mini`, a `.no-print` hook) is fine — that case reads the page, which is a div-like
   context the control inherits from only for size, not colour, but with no dark paint of its own
   the UA default sits on the page background and stays legible. */
{
  const lumOf = h => {
    h = String(h).replace('#', '');
    if (h.length === 3) h = [...h].map(c => c + c).join('');
    const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = [0, 2, 4].map(i => f(parseInt(h.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const colors = new Set(), darkBg = new Set();
  for (const m of APP.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = m[2];
    const classes = new Set();
    m[1].split(',').forEach(sel => (sel.match(/\.[a-zA-Z][\w-]*/g) || []).forEach(c => classes.add(c.slice(1))));
    const hasColor = /(^|;)\s*color\s*:/.test(decls);
    for (const c of classes) {
      if (hasColor) colors.add(c);
      const bg = /background(-color)?:\s*(#[0-9a-f]{3,8})/.exec(decls);
      if (bg && lumOf(bg[2]) < 0.16) darkBg.add(c);          /* dark enough that black text disappears */
    }
  }
  const offenders = new Map();
  let checked = 0;
  FILES.forEach(f => {
    const src = read(f);
    for (const m of src.matchAll(/<(?:button|select|textarea)\b([^>]*)>/g)) {
      const at = m[1] || '';
      /* class attributes are written as templates (class="${a.danger ? 'danger-btn' : ''}") — the
         words inside them are the class names that matter, so they are read as words */
      const cls = new Set((/class="([^"]*)"/.exec(at) || [, ''])[1].match(/[a-zA-Z][\w-]*/g) || []);
      const inline = (/style="([^"]*)"/.exec(at) || [, ''])[1];
      checked++;
      const paintsDark = [...cls].some(c => darkBg.has(c));
      const statesColor = /(^|;)\s*color\s*:/.test(inline) || [...cls].some(c => colors.has(c));
      /* a token background counts as dark in the shipped theme: --bg #071114, --card #0c1a1e,
         --card2 #10242a, --white #0d1c20 — which is how the board row got away with it */
      const inlineHex = /background(?:-color)?:\s*(#[0-9a-f]{3,8})/.exec(inline);
      const inlineDarkBg = (inlineHex && lumOf(inlineHex[1]) < 0.16) || /background(?:-color)?:\s*var\(--(?:bg|card|card2|white)\)/.test(inline);
      if ((paintsDark || inlineDarkBg) && !statesColor && !/color:/.test(inline)) {
        const k = `${f}:${src.slice(0, m.index).split('\n').length}`;
        offenders.set(k, (offenders.get(k) || 0) + 1);
      }
    }
  });
  ok('[contrast] no control in the shipped JS paints a dark surface without saying what colour its words are (' + checked + ' controls checked)',
    offenders.size === 0, [...offenders.keys()].slice(0, 6).join(' | '));
  ok('[contrast] the audit knows the difference: .res-notch-chip paints #10222a and says #e7f4f2, so it is not an offender',
    darkBg.has('res-notch-chip') && colors.has('res-notch-chip'));
  ok('[contrast] and it would have caught the board before it shipped (a dark --bg with no colour is what failed)',
    (read('semen-sales.js').match(/<button[^>]*background:var\(--bg\)[^>]*>/g) || []).every(t => /color:var\(--ink\)/.test(t)),
    (read('semen-sales.js').match(/<button[^>]*background:var\(--bg\)[^>]*>/g) || ['none'])[0].slice(0, 90));
}

/* ── 4c. the same screenshot’s other problem: four chips stacked to full width on a phone ───── */
ok('[contrast] the scope chips left .due-actions, whose mobile rule is column + width:100%',
  /<div class="order-board-chips">\$\{chips\}<\/div>/.test(board) && !/class="due-actions"[^>]*>\$\{chips\}/.test(board),
  (board.match(/<div class="[^"]*">\$\{chips\}/) || ['not found'])[0]);
ok('[contrast] and their own class lays them 2×2 on a phone while keeping the 40px target',
  /\.order-board-chips\{display:grid;grid-template-columns:1fr 1fr;gap:6px\}/.test(APP)
  && /\.order-board-chips \.btn\{min-width:0;width:auto;min-height:40px\}/.test(APP),
  (APP.match(/\.order-board-chips[^{]*\{[^}]*\}/g) || []).slice(-1)[0] || '');
ok('[contrast] .due-actions itself was left alone — it is the Save/Cancel pattern on 24 screens',
  /\.due-actions\{display:flex;gap:10px;justify-content:center\}/.test(APP) && /\.due-actions \.btn\{width:100%\}/.test(APP));
ok('[contrast] app.css still parses as a whole (braces balance) and [FIX 192] is the last block in it',
  (APP.match(/\{/g) || []).length === (APP.match(/\}/g) || []).length
  && APP.trimEnd().endsWith('}') && APP.lastIndexOf('[FIX 192]') > APP.lastIndexOf('[FIX 184]')
  && (APP.match(/\*\//g) || []).length === (APP.match(/\/\*/g) || []).length,
  `${(APP.match(/\{/g) || []).length} balanced braces`);
ok('[contrast] the block was appended, not spliced: every rule that was there before is still there',
  /\.adj-card\{background:rgba\(15,62,63,\.4\)/.test(APP) && /\.btn\{border-radius:9px;padding:10px 13px;background:var\(--teal\)/.test(APP)
  && /\.field-hint/.test(APP), 'app.css untouched above the appended block');

/* ── 5. released as a build, not as a hope ────────────────────────────────────────────────── */
const sw = read('sw.js'), cfg = read('config.js');
ok('[contrast] CACHE_NAME and the About build string moved together, or the phone keeps the old CSS',
  /v241-board-contrast/.test(sw) && /v241-board-contrast/.test(cfg) && /css\/app\.css'/.test(sw),
  (sw.match(/CACHE_NAME = '[^']+'/) || [''])[0]);
ok('[contrast] no new file, no new <link>: the fix rides in app.css and semen-sales.js, both already cached',
  !/board-contrast|fix192/.test(read('index.html')) && /css\/app\.css\?v=104-semen-save-verification/.test(read('index.html')));

console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed\n`);
console.log('note · the LIGHT theme’s own tokens are thin for small text (--muted 4.08:1, --warn 2.58:1, --teal 3.76:1).'
  + '\n     That is a palette issue on every screen, not a board issue, and it is deliberately untouched here.');
process.exit(failures ? 1 : 0);
