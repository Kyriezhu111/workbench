/* 离线缓存：让工作台在没网、电脑关机时也能打开。
   策略：联网优先 —— 每次打开都取服务器上的最新版，只有断网才回退到缓存。
   （最早用的是缓存优先，结果手机上一路显示旧界面，见 lessons。） */
var CACHE = 'workbench-v2-4';
var FILES = ['./', './index.html', './app.js?v=4', './data.js?v=4', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if ((e.request.url || '').indexOf('http') !== 0) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html') || caches.match('./');
      });
    })
  );
});
