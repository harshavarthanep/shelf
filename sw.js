/* Shelf website — offline support. Bump VERSION when you deploy new files. */
var VERSION = 'shelf-web-2.4.0';
var SHELL = ['./', './index.html', './css/styles.css', './js/boot.js', './js/config.js', './js/core.js', './js/todos.js', './js/store.js', './js/app.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && k.indexOf('shelf-web-') === 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              // logos & sites: let the browser handle them
  if (req.mode === 'navigate') {                                 // network first, offline fallback (keeps share links working)
    e.respondWith(fetch(req).then(function (r) {
      var copy = r.clone();
      if (r.ok) caches.open(VERSION).then(function (c) { c.put('./index.html', copy); });
      return r;
    }).catch(function () { return caches.match('./index.html'); }));
    return;
  }
  e.respondWith(caches.open(VERSION).then(function (c) {        // stale-while-revalidate: instant load, fresh next time
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (r) { if (r.ok) c.put(req, r.clone()); return r; }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});

/* To-do reminders: tapping a notification (or its Snooze / Done button) opens Shelf and passes the action along. */
self.addEventListener('notificationclick', function (e) {
  var id = e.notification && e.notification.data && e.notification.data.id;
  var act = e.action || 'open';
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var c = list.filter(function (w) { return 'focus' in w; })[0];
    if (c) { c.postMessage({ type: 'todo-action', id: id, act: act }); return c.focus(); }
    return self.clients.openWindow('./?todo=' + encodeURIComponent(id || 'today') + (act !== 'open' ? '&act=' + act : ''));
  }));
});
