# Deploy ARSwineTech Pro to Cloudflare Pages

This folder is the **ready-to-upload build** of ARSwineTech Pro. All asset paths
match `index.html` / `sw.js` (`css/`, `js/`, `supabase/`, `assets/`, `icons/`).

## What's inside
```
/
├── index.html
├── manifest.webmanifest
├── sw.js                  # service worker (offline-first, cache v108)
├── register-sw.js
├── _headers               # Cloudflare Pages headers (SW allowed, no-cache code)
├── css/app.css
├── js/…                   # all feature modules
├── supabase/config.js     # your Supabase project settings (already filled in)
├── supabase/client.js     # auth + cloud sync engine
├── assets/…  icons/…
└── README-DEPLOY.md
```

## Upload to Cloudflare Pages (dashboard)
1. **Cloudflare dashboard → Workers & Pages → Create → Pages → Upload assets.**
   (Alternatively: **Add → Pages → Upload assets.**)
2. Project name, e.g. `arswinetech-pro`.
3. Drag this folder **or** (if the UI only offers a zip) unzip this zip to a
   folder and drag the folder. (Cloudflare's drag-and-drop accepts a folder;
   the zip exists so you can transfer it from another machine.)
4. **Production branch**: optional; set deployment to `main`.
5. Click **Deploy**. Pages will serve it at
   `https://<project-name>.pages.dev` (HTTPS — required for the PWA).

## Connect the GitHub branch instead (auto-publish on every push)

The repo root is a **flat** working layout (`app.css`, `semen-sales.js`, `config.js` … all
side by side), but `index.html` and `sw.js` ask for `css/`, `js/`, `supabase/`, `assets/`,
`icons/`. So Cloudflare **must run the layout build** — pointing Pages at the repo root with
no build command publishes a page that 404s every script.

**Workers & Pages → Create → Pages → Connect to Git → pick this repo**, then:

| Cloudflare field | What to put |
|---|---|
| Project name | `arswinetech-pro` (this becomes `arswinetech-pro.pages.dev`) |
| Production branch | `arena/01a0e080-arswinetech-pro-enhanced` |
| Framework preset | **None** |
| Build command | `bash qa/build-deploy-layout.sh dist` |
| Build output directory | `dist` |
| Root directory (advanced) | leave empty (`/`) |
| Environment variables | none required — Supabase keys are already in `config.js` |

Nothing else is needed: the build script writes `dist/` in the exact shape `index.html`
expects, copies `_headers` and `_worker.js` into it, and **fails the build** if any path
`index.html` references is missing — so a broken release never reaches a phone.

Optional, one time, for the edge head cache (see `README-EDGE.md`):
**Settings → Functions → KV namespace bindings → Add**, variable name `ARS_HEADS`, bound to a
KV namespace you create (e.g. `ars-head-cache`). Without it the app silently uses the direct
Supabase probe.

After it is connected, publishing an update is just `git push` to that branch. Bump
`window.ARS_APP_VERSION` in `config.js` and `CACHE_NAME` in `sw.js` on each release so the
service worker replaces the old shell on every installed phone.

## After deploying
* **Open the site and sign in** — your Supabase project is already wired:
  * Project URL: `https://hgmrltewkxjmhlqevjrp.supabase.co`
  * Publishable key: `sb_publishable_NWmfAur6bNoulNv0anC-nQ_11CkOtCT`
* **Install the PWA**: on Android Chrome → "Add to Home Screen" / "Install app".
* **Testing offline**: load once, then DevTools → Network → Offline → reload →
  the shell + data still load, and sync shows "Offline … saved locally".
* To update later: rebuild this folder from the repo with
  `qa/build-deploy-layout.sh`, bump `CACHE_NAME` inside `sw.js`, and re-upload.
* **Self-download link:** after you zip the build, drop the zip into this folder
  too (the build script's companion step does this). Your team can then always
  fetch the latest build from `https://<your-pages-domain>/arswinetech-pro-latest.zip`
  — no GitHub account needed, works on any phone browser.

## Notes
* The `_headers` file keeps `sw.js` uncached at the edge (so updates land) while
  the app's own service worker handles offline caching.
* Auth, RLS and all farm data stay in **your** Supabase project — nothing is
  stored on Cloudflare beyond the static files.
