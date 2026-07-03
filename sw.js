/* sw.js — cache-first service worker for the app shell.
   Bump CACHE_VERSION on every release to push updates to installed clients. */

const CACHE_VERSION = 'earnit-v1.3.0';
const ASSETS = [
  '.',
  'index.html',
  'style.css',
  'logic.js',
  'db.js',
  'app.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Best-effort daily reminder (periodic background sync — Chrome on Android, installed PWA)
self.addEventListener('periodicsync', e => {
  if (e.tag === 'earnit-reminder') {
    e.waitUntil(self.registration.showNotification('Earn It', {
      body: 'Daily check-in — mark your habits and log how today felt \u{1F4AA}',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'earnit-reminder',
    }));
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      return clients.openWindow('.');
    })
  );
});

self.addEventListener('fetch', e => {
  // Only handle same-origin GETs; anything else (e.g. future API calls) goes straight to the network
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached =>
      cached ||
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(e.request, copy));
        return res;
      })
    )
  );
});
