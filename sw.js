// Service worker: makes the app open and scan offline.
// The deploy workflow replaces __BUILD__ with the commit SHA, so every deploy refreshes phones automatically.
const VERSION = 'cartwise-__BUILD__';
const SHELL = [
  './', './index.html', './css/app.css', './js/app.js', './js/core.js',
  './vendor/html5-qrcode.min.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Product photos from Open Food Facts: cache them so items you've scanned show photos offline.
  if (url.hostname.endsWith('openfoodfacts.org') && /\.(jpg|jpeg|png|webp)$/i.test(url.pathname)) {
    e.respondWith(caches.open(VERSION + '-img').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }
      catch (err) { return Response.error(); }
    }));
    return;
  }
  if (url.origin !== location.origin) return;   // API calls go straight to the network

  // App files: serve from cache right away, refresh the cache in the background.
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || Response.error();
  }));
});
