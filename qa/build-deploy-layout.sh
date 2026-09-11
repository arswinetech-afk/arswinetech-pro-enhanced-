#!/usr/bin/env bash
# ============================================================================
# ARSwineTech Pro — build the deploy-ready folder from the flat source repo.
#
# The source repository is intentionally FLAT (all files at the root), but the
# deployed PWA (index.html + sw.js APP_SHELL) expects a structured layout:
#     css/app.css  js/*.js  supabase/*.js  assets/*.png  icons/*.png
# This script rebuilds that layout into ./dist (or $1) so the uploaded site and
# the service worker can never disagree about where a file lives — the flaw that
# previously made sw.js's cache.addAll() 404 and killed offline support.
#
# Usage:   bash qa/build-deploy-layout.sh [out-dir]     (default: dist)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/dist}"

cd "$ROOT"
rm -rf "$OUT"
mkdir -p "$OUT"

# Root-level files ship as-is.
for f in index.html manifest.webmanifest sw.js register-sw.js _headers; do
  [ -f "$f" ] && cp "$f" "$OUT/"
done

# Collect every referenced path from index.html (src/href, minus query/fragment)
# and from sw.js's APP_SHELL ('./…' entries). These are the files the browser and
# the service worker will actually request, so they define the deploy layout.
refs() {
  { grep -oE '(src|href)="[^"]+"' index.html | sed -E 's/^(src|href)="//; s/"$//; s/[?#].*$//';
    grep -oE "'\./[^']+'" sw.js | sed "s/'//g; s|^\./||"; } \
    | grep -E '^(css|js|supabase|assets|icons)/' | sort -u
}

while IFS= read -r rel; do
  base="$(basename "$rel")"
  # The flat source holds every referenced file by basename at the root.
  if [ ! -f "$base" ]; then
    echo "ERROR: '$rel' referenced by index.html/sw.js but source '$base' is missing." >&2
    exit 1
  fi
  mkdir -p "$OUT/$(dirname "$rel")"
  cp "$base" "$OUT/$rel"
done < <(refs)

# ----------------------------------------------------------------------------
# Validate: every index.html reference and every sw.js APP_SHELL entry must now
# exist in the output. Fail loudly rather than shipping a SW that cannot install.
# ----------------------------------------------------------------------------
missing=0
while IFS= read -r rel; do
  [ -f "$OUT/$rel" ] || { echo "MISSING in $OUT: $rel" >&2; missing=1; }
done < <(refs)
for rel in index.html manifest.webmanifest sw.js; do
  [ -f "$OUT/$rel" ] || { echo "MISSING in $OUT: $rel" >&2; missing=1; }
done
[ "$missing" -eq 0 ] || { echo "Build aborted: unresolved references." >&2; exit 1; }

# ----------------------------------------------------------------------------
# Bump CACHE_NAME so every release invalidates the previous cache. Embed the UTC
# date plus the git short-SHA (or a timestamp if not a git checkout).
# ----------------------------------------------------------------------------
SHA="$(git rev-parse --short HEAD 2>/dev/null || date -u +%H%M%S)"
STAMP="$(date -u +%Y-%m-%d)-$SHA"
sed -i -E "s|const CACHE_NAME = '[^']*';|const CACHE_NAME = 'arswinetech-pro-$STAMP';|" "$OUT/sw.js"

echo "✓ Deploy layout written to $OUT"
echo "  cache name : arswinetech-pro-$STAMP"
echo "  files      : $(find "$OUT" -type f | wc -l | tr -d ' ')"
echo
echo "Upload the contents of $OUT to Cloudflare Pages (Workers & Pages → Pages → Upload assets)."
