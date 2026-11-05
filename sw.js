// « à deux. » : service worker (fonctionnement hors ligne)
// - la page : réseau d'abord (toujours la dernière version), sinon la copie en cache ;
// - les bibliothèques versionnées (Firebase, QR code) : cache d'abord, elles ne changent jamais ;
// - la Bible (gros fichier qui ne change pas) : gardée dans son propre cache, conservé entre les versions ;
// - les rappels (notifications sans serveur) : la page prépare la liste, le service worker la relit
//   quand Android le réveille (Periodic Background Sync) et affiche ceux qui sont arrivés ;
// - tout le reste (base Firebase, connexion…) passe sans être touché.
const VERSION = 'adeux-v9';
const BIBLE_CACHE = 'adeux-bible-lsg-1910';
const NOTIF_CACHE = 'adeux-notif';
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
const LIBS = [/^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+\//, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcode-generator\//];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== BIBLE_CACHE && k !== NOTIF_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scopePath = new URL(self.registration.scope).pathname;
  const isApp = url.pathname === scopePath || url.pathname === scopePath + 'index.html';
  if (req.mode === 'navigate' && url.origin === location.origin && isApp) {
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
  if (url.origin === location.origin && url.pathname.endsWith('/bible-lsg-1910.json')) {
    e.respondWith((async () => {
      const cache = await caches.open(BIBLE_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
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

// ─── Rappels, appli fermée ───
const notifUrl = n => new URL(n, self.registration.scope).href;
async function readJSON(cache, n) {
  try { const r = await cache.match(notifUrl(n)); return r ? await r.json() : null; } catch (e) { return null; }
}
async function showDueReminders() {
  const cache = await caches.open(NOTIF_CACHE);
  const data = await readJSON(cache, 'notif-schedule.json');
  if (!data || !data.on || !Array.isArray(data.items)) return;
  // Si l'appli est à l'écran, c'est elle qui prévient.
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (wins.some(w => w.visibilityState === 'visible')) return;
  const shown = (await readJSON(cache, 'notif-shown-sw.json')) || {};
  const pageShown = data.shown || {};
  const now = Date.now();
  const due = data.items.filter(x => x && typeof x.at === 'number' && x.at <= now && x.at > now - 12 * 3600e3 && !shown[x.id] && !pageShown[x.id]);
  for (const x of due) {
    shown[x.id] = now;
    await self.registration.showNotification(String(x.title || 'à deux.'), {
      body: String(x.body || ''), tag: String(x.id), icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', lang: 'fr',
      data: { page: x.page || 'accueil' }
    });
  }
  for (const k of Object.keys(shown)) if (now - shown[k] > 10 * 864e5) delete shown[k];
  if (due.length) await cache.put(notifUrl('notif-shown-sw.json'), new Response(JSON.stringify(shown), { headers: { 'content-type': 'application/json' } }));
}
self.addEventListener('periodicsync', e => {
  if (e.tag === 'adeux-rappels') e.waitUntil(showDueReminders());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const page = (e.notification.data && e.notification.data.page) || 'accueil';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins[0];
    if (w) { try { await w.focus(); } catch (err) {} w.postMessage({ adeuxGo: page }); return; }
    await self.clients.openWindow(new URL('./#' + page, self.registration.scope).href);
  })());
});
