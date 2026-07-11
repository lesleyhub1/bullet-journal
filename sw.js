/*
  Service Worker — Bullet Journal PWA
  ------------------------------------------------------------------
  iOS Safari notes baked into this strategy:
  - iOS evicts caches under storage pressure, so we treat the cache as
    disposable and re-populate it on activate/fetch rather than relying
    on it as a source of truth (IndexedDB is the source of truth).
  - iOS does not support the Background Sync API, so there is no
    background sync registration here — everything writes to IndexedDB
    synchronously from the page instead.
  - We bump CACHE_VERSION whenever a static asset changes so old
    caches are cleaned up on activate.
*/

const CACHE_VERSION = "bujo-v1";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch(() => {
        // Individual missing assets (e.g. icons not yet generated) should
        // not block installation of the rest of the shell.
      })
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GET requests. Never intercepts
// cross-origin requests (e.g. Google Fonts) — those go straight to network
// so we don't risk serving a stale, opaque, or CORS-broken response.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
