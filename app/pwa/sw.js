/* Rainform PWA service worker
 * - App shell (the single-file app) is cached so the scene works fully offline.
 * - ALL /api/* traffic is intentionally NEVER cached: live weather must stay
 *   live. Those requests simply bypass the service worker.
 * - Navigation: network-first (gets a fresh single-file build when deployed),
 *   falls back to the cached shell when offline.
 */
'use strict';
const CACHE = 'rainform-shell-v1';
const SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './favicon.png',
  './icons/icon-64.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let u;
  try { u = new URL(req.url); } catch (e) { return; }
  if (u.origin !== self.location.origin) return;        // external APIs: browser handles CORS
  if (u.pathname.indexOf('/api/') >= 0 || u.pathname === '/ws') return;  // never cache live data

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(async () => (await caches.match('./index.html')) ||
        (await caches.match('./offline.html')) ||
        new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
