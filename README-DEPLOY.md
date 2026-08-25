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

## After deploying
* **Open the site and sign in** — your Supabase project is already wired:
  * Project URL: `https://hgmrltewkxjmhlqevjrp.supabase.co`
  * Publishable key: `sb_publishable_NWmfAur6bNoulNv0anC-nQ_11CkOtCT`
* **Install the PWA**: on Android Chrome → "Add to Home Screen" / "Install app".
* **Testing offline**: load once, then DevTools → Network → Offline → reload →
  the shell + data still load, and sync shows "Offline … saved locally".
* To update later: rebuild this folder from the repo with
  `qa/build-deploy-layout.sh`, bump `CACHE_NAME` inside `sw.js`, and re-upload.

## Notes
* The `_headers` file keeps `sw.js` uncached at the edge (so updates land) while
  the app's own service worker handles offline caching.
* Auth, RLS and all farm data stay in **your** Supabase project — nothing is
  stored on Cloudflare beyond the static files.
