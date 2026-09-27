# FIX 199 — the two new reseller panels open on demand (collapsed by default)

Build: `v248-collapsible-reseller-insights-2026-09-27` · files: `semen-sales.js`,
`app.css`, `config.js`, `sw.js`, `qa/build-deploy-layout.sh`, `README-DEPLOY.md`,
`releases/arswinetech-pro-latest.zip`
Verification: `node qa/test-reseller-insights.mjs` → 92/92 · every other suite in `qa/` green.

## What was asked

The FIX 198 panels were welcome but they push the real work down the page. Both should be
**collapsed by default** and expand when the user asks:

1. **Top Resellers of the Month** on the Semen Reseller Center page.
2. **Performance summary** inside every reseller profile.

## How they behave now

| | collapsed (default) | expanded |
|---|---|---|
| Leaderboard | one bar: `🏆 Leaderboard · Top Resellers of the Month` + `🥇 <leader> · <value> <metric> · <month>` + a **Show** pill | month picker, Rank-by tabs, podium, *Why #N*, the rest of the table, the method footnote |
| Profile summary | one bar: `📊 Performance summary · <period label>` + `<net> net bottles · <n>% returned · <net sales>` + a **Show** pill | period chips, custom date range, KPI tiles, split bar, money, breed mix, return reasons |

* The header is a real `<button>` carrying `aria-expanded` and `aria-controls`, so it works
  with a keyboard and a screen reader; the caret rotates off `aria-expanded`, not a class.
* **Nothing is thrown away.** The body is rendered into the DOM and hidden with the `hidden`
  attribute — the same "keep every record, change only what is visible" rule
  `collapsible-content.js` already follows for long lists. Print, find-in-page after expand,
  and the QA harness all still see the full markup.
* The collapsed bar is never a dead end: it states the one fact you would have opened the
  panel for (who leads / this period's net bottles, return rate and net sales).

## State

* Leaderboard: `rsTopState.open` (page-session). Month, metric and the picked reseller are
  unchanged and still survive a re-render.
* Profile: `rsSumState[resellerId].open`, **per reseller** — opening Jo's summary does not
  open anybody else's. Switching period (This month / Last month / Custom) keeps it open;
  it was already open, since the chips live inside the body.

## Animation

`rsAnimateCountUps()` now runs **only when the panel is open**, and a toggle re-renders the
panel rather than merely unhiding it — so the podium rise, the crown, the bar fills and the
count-ups play at the moment they become visible instead of being spent on a hidden node.
The HTML always carries the final value, so a panel that never animates is still correct.
`prefers-reduced-motion` still switches every animation off.

## Deploy bug found and fixed while wiring auto-publish

`index.html` loads `js/register-sw.js` and `sw.js` precaches `./js/register-sw.js`, but
`qa/build-deploy-layout.sh` excluded `register-sw.js` from `js/` and copied it to the build
root only. Every published build therefore 404'd on it and **never registered the service
worker** — no offline shell, no update-on-reload. The script now copies it to both places and,
at the end, **fails the build** if any local path `index.html` references is missing from the
output. All 64 `APP_SHELL` entries resolve in the rebuilt layout.

## Cloudflare Pages ↔ GitHub

`README-DEPLOY.md` gained the exact field values for "Connect to Git": build command
`bash qa/build-deploy-layout.sh dist`, output directory `dist`, production branch
`arena/01a0e080-arswinetech-pro-enhanced`, framework preset None. The flat repo root cannot be
served directly — the layout build is what makes `css/`, `js/`, `supabase/`, `assets/`,
`icons/` exist.

## Tests added (section [7] of `qa/test-reseller-insights.mjs`)

1. the board ships `rtop is-collapsed` with `id="rtopBody" hidden`;
2. the collapsed bar names the leader (`🥇 Randy Sedeno · 23 net bottles sold · September 2026`);
3. the collapsed board still holds the podium and *Why #1* in the DOM;
4. toggling opens it (`is-open`, `aria-expanded="true"`, podium + method visible) and closes it;
5. every profile summary ships collapsed, with a period preview;
6. toggling one profile opens only that one, and a period switch does not close it.
