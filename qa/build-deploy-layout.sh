#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Rebuild the ready-to-upload Cloudflare Pages folder from the repo root.
# Usage: bash qa/build-deploy-layout.sh [OUT_DIR]
# Default OUT_DIR: /home/user/build-deploy/arswinetech-pro-latest
# Layout mirrors index.html / sw.js paths: css/, js/, supabase/, assets/, icons/.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/home/user/build-deploy/arswinetech-pro-latest}"
mkdir -p "$OUT/css" "$OUT/supabase" "$OUT/assets" "$OUT/icons"
rm -rf "$OUT/js"; mkdir -p "$OUT/js"

# root files
for f in index.html manifest.webmanifest sw.js register-sw.js _headers _worker.js README-DEPLOY.md README-EDGE.md; do
  cp "$REPO/$f" "$OUT/$f"
done

# css
cp "$REPO/app.css" "$OUT/css/app.css"

# js = every root module except infra files that live at root / in supabase/
for j in "$REPO"/*.js; do
  b="$(basename "$j")"
  case "$b" in client.js|config.js|sw.js|register-sw.js|_worker.js) continue;; esac
  cp "$j" "$OUT/js/$b"
done

# supabase (config.js + client.js live at repo root, deploy under supabase/)
cp "$REPO/config.js" "$OUT/supabase/config.js"
cp "$REPO/client.js" "$OUT/supabase/client.js"
for s in "$REPO"/supabase/*.sql; do cp "$s" "$OUT/supabase/"; done

# assets (app imagery lives at repo root, deploys under assets/)
for a in arswinetech-logo.png ic-boar.jpg ic-feed.jpg ic-lact.jpg ic-piglets.jpg ic-preg.jpg ic-sow.jpg pig-shadow.jpg semen-bottle.png; do
  [ -f "$REPO/$a" ] && cp "$REPO/$a" "$OUT/assets/$a"
done

# icons
cp "$REPO/icon-192.png" "$OUT/icons/icon-192.png"
cp "$REPO/icon-512.png" "$OUT/icons/icon-512.png"

echo "✔ build-deploy layout ready at $OUT"
