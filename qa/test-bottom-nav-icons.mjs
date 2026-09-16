#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   [FIX 193] the phone's bottom bar — QA

   The farm's phone showed every tab as a boxed glyph: the neumorphic affordance
   layer lifts EVERY <button> (lift-sm shadow + a 1px inset edge), so the eight
   tabs rendered as eight visible squares, and the "icons" were text glyphs that
   read as beginner work on a pig app — ▦ for Home, ♀ for Sows, ● for Piglets,
   ⊞ for Sales. This harness verifies the redesign statically:

     1. the nav ships eight tabs, each with a hand-drawn 24×24 line SVG
        (sow face, side-view piglet, barn, price tag, bell…) instead of glyphs;
     2. none of the old glyphs survive in the nav block;
     3. app.css styles the bar flat (active = teal pill behind the icon);
     4. neumorphic.css opts the tabs out of the lift AND the press, so the
        squares cannot come back on tap.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('index.html');
const APP = read('app.css');
const NEO = read('neumorphic.css');

let checks = 0, failures = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};

const a = HTML.indexOf('<nav class="bottom-nav"');
const b = HTML.indexOf('</nav>', a);
ok('bottom-nav exists', a > -1 && b > a);
const nav = HTML.slice(a, b);

const pages = [...nav.matchAll(/data-page="([^"]+)"/g)].map(m => m[1]);
ok('eight tabs in order', JSON.stringify(pages) === JSON.stringify(
  ['dashboard', 'sows', 'piglets', 'vaccination', 'barns', 'rfid', 'pos', 'reminders']),
  pages.join(','));

const labels = ['Home', 'Sows', 'Piglets', 'Health', 'Barns', 'Scan', 'Sales', 'Alerts'];
ok('labels kept', labels.every(l => nav.includes(`>${l}</button>`)), 'a tab label changed');

const svgs = [...nav.matchAll(/<span class="bi"><svg viewBox="0 0 24 24"[^>]*stroke="currentColor"/g)];
ok('every tab icon is a 24×24 currentColor line SVG', svgs.length === 8, `${svgs.length}/8`);

const oldGlyphs = ['\u25a6', '\u2640', '\u25cf', '\ud83d\udc89', '\ud83c\udfe2', '\ud83d\udce1', '\u229e', '\u25c9'];
ok('no legacy text glyphs left', oldGlyphs.every(g => !nav.includes(g)),
  oldGlyphs.filter(g => nav.includes(g)).join(' '));

/* pig-app icons: the sow tab draws a snout ellipse with nostrils, the piglet tab a
   side-view body with a tail curl — the shapes a pig farm expects, not a female
   symbol and a dot. */
const sowBtn = nav.slice(nav.indexOf('data-page="sows"'), nav.indexOf('data-page="piglets"'));
const pigBtn = nav.slice(nav.indexOf('data-page="piglets"'), nav.indexOf('data-page="vaccination"'));
ok('Sows icon is a pig face (snout ellipse + nostrils)', /<ellipse[^>]*rx="3"/.test(sowBtn) && (sowBtn.match(/<circle[^>]*fill="currentColor"/g) || []).length >= 4);
ok('Piglets icon is a side-view piglet (closed body path + eye)', /<path d="M5\.4 9\.6/.test(pigBtn) && /<circle cx="16\.6"/.test(pigBtn));

/* the bar must be flat in app.css with a pill for the active tab */
ok('app.css sizes the svg icons', /\.bottom-nav \.bi svg\{width:20px;height:20px/.test(APP));
ok('active tab gets a pill, not a square', /\.bottom-nav button\.active \.bi\{background:rgba\(19,185,173,\.2\)/.test(APP));
ok('bar has no fixed 68px box height', !/\.bottom-nav\{[^}]*height:68px/.test(APP));

/* the squares were the neo lift/edge on every button — the tabs must be opted out,
   including the :active press, or tapping brings the square back */
ok('neumorphic lift excludes the tabs', /\.bottom-nav button \{ box-shadow: none; transform: none; transition: none; \}/.test(NEO));
ok('neumorphic press excludes the tabs', /\.bottom-nav button:active \{ box-shadow: none; transform: none;/.test(NEO));

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
