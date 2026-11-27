// 파노체크 app: works without internet after it was opened once.
// Pages are fetched from the network first (so updates arrive), the saved copy is used when offline.
const CACHE = 'panocheck-v3';
const CORE = ['app.html', 'splash.jpg', 'icon-192.png', 'icon-512.png', 'app.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('.bin') || url.pathname.endsWith('.mp4')) return;   // firmware and guide videos: never cached (videos stream in parts)
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const net = await Promise.race([fetch(req, { cache: 'no-cache' }), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
      if (net && net.ok) cache.put(req, net.clone());
      return net;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('app.html')) || Response.error();
      return Response.error();
    }
  })());
});

// Update news on the phone: the maker's server sends an empty push when a new firmware (or app note) is out,
// then this asks the server what to say. Always shows something (a push must show a notification).
const PUSH_URL = 'https://panocheck-usage.panocheck.workers.dev';
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let m = null;
    try {
      const sub = await self.registration.pushManager.getSubscription();
      let id = '';
      if (sub) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint)); id = [...new Uint8Array(h)].map(v => v.toString(16).padStart(2, '0')).join('').slice(0, 24); }
      const r = await fetch(PUSH_URL + '/push/last?e=' + id, { cache: 'no-store', credentials: 'omit' });
      if (r.ok) m = await r.json();
    } catch (err) {}
    m = m || { title: '파노체크', body: '새 소식이 있어요. 앱을 열어 확인해 주세요.', tag: 'pc-news' };
    await self.registration.showNotification(m.title || '파노체크', { body: m.body || '', tag: m.tag || 'pc-update', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: m.url || 'app.html' } });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || 'app.html', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = all.find(c => c.url.indexOf('app.html') >= 0) || all[0];
    if (app) { try { await app.focus(); } catch (err) {} return; }
    await self.clients.openWindow(url);
  })());
});
self.addEventListener('pushsubscriptionchange', e => {   // the browser renewed the subscription: tell the server again
  e.waitUntil((async () => {
    try {
      const key = (await (await fetch(PUSH_URL + '/push/key')).json()).key;
      const pad = '='.repeat((4 - key.length % 4) % 4), raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
      await fetch(PUSH_URL + '/push/sub', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ sub: sub.toJSON() }) });
    } catch (err) {}
  })());
});
