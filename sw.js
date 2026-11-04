// « à deux. » : service worker (fonctionnement hors ligne)
// - la page : réseau d'abord (toujours la dernière version), sinon la copie en cache ;
// - les bibliothèques versionnées (Firebase, QR code) : cache d'abord, elles ne changent jamais ;
// - tout le reste (base Firebase, connexion…) passe sans être touché.
const VERSION = 'adeux-v1';
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
const LIBS = [/^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+\//, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcode-generator\//];

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
  if (req.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) cache.put('./', res.clone());
        return res;
      } catch (err) {
        return (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }
  if (LIBS.some(r => r.test(req.url))) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
  }
});
