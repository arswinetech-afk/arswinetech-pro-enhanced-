// ARSwineTech Pro service worker — rebuild
// Strategy notes (fixes a deployment-skew flaw in the original):
//   • HTML / JS / CSS / manifest  → NETWORK-FIRST, falling back to cache when offline.
//     The original used cache-first for *everything* except navigation, so an old cached
//     script could run against a brand-new index.html (old JS + new DOM = boot crashes).
//   • Icons / images / fonts      → cache-first (content rarely changes).
//   • Bump CACHE_NAME on every release; activate() purges older caches.
const CACHE_NAME = 'arswinetech-pro-v148-trial-signup-2026-08-29';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/trial.js',
  './js/reminder-engine.js',
  './js/sow-tools.js',
  './js/pedigree.js',
  './js/lineage.js',
  './js/sidebar.js',
  './js/registration-security.js',
  './js/drilldown.js',
  './js/modal-layer.js',
  './js/medicine.js',
  './js/piglet-ledger.js',
  './js/ble-scale.js',
  './js/batch-performance.js',
  './js/reservations.js',
  './js/cull.js',
  './js/logo-custom.js',
  './js/reservation-summary-edit.js',
  './js/qrcode-generator.js',
  './js/html2canvas.min.js',
  './js/reservation-certificate.js',
  './js/vet-library.js',
  './js/medicine-inventory.js',
  './js/boar-registry.js',
  './js/fattener-center.js',
  './js/feeding-guide.js',
  './js/batch-costing.js',
  './js/piglet-care.js',
  './js/vaccination-center.js',
  './js/rfid-scanner.js',
  './js/barn-movements.js',
  './js/semen-sales.js',
  './js/farm-admin.js',
  './js/invite-share.js',
  './js/financial-statements.js',
  './js/production-control.js',
  './js/collapsible-content.js',
  './js/batch-delete.js',
  './js/foster-batch.js',
  './js/ai-vet-search.js',
  './js/sow-monitoring.js',
  './js/zxing.min.js',
  './js/register-sw.js',
  './supabase/config.js',
  './supabase/client.js',
  './assets/arswinetech-logo.png',
  './assets/semen-bottle.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const CODE = /\.(html|js|css|webmanifest|json)$|\/$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const fromNetworkThenCache = () =>
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')));

  if (event.request.mode === 'navigate' || CODE.test(url.pathname)) {
    // Code and documents: always prefer the freshest copy; use cache only when offline.
    event.respondWith(fromNetworkThenCache());
    return;
  }

  // Static media: cache-first, then network (and cache same-origin successes).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
