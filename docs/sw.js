// AI Newsfeed service worker — network-first with offline fallback.
// Strategy: always try the network so the app never serves a stale shell;
// cache every successful same-origin response so the app still opens offline.

const CACHE = "ai-newsfeed-v1";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept Firestore/CDN

  event.respondWith(
    fetch(req)
      .then(function (resp) {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, clone); });
        }
        return resp;
      })
      .catch(function () {
        return caches.match(req).then(function (cached) {
          if (cached) return cached;
          if (req.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        });
      })
  );
});
