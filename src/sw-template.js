// Sort sim service worker (generated at build: the version and file list are filled in).
// Everything in the build is kept for offline use; pages come from the network when it is
// there (so updates arrive), from the cache when it is not. A new version waits until the
// page asks it to take over (the "Update" button), so a running hall is never swapped mid-way.
const VERSION = '__VERSION__';
const CACHE = `sort-sim-${VERSION}`;
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('sort-sim-') && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
  if (e.data === 'version') e.source?.postMessage({ version: VERSION });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Pages: network first (fresh), the cached app when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          return (await caches.match('./', { ignoreSearch: true, ignoreVary: true })) ?? (await caches.match(req, { ignoreSearch: true, ignoreVary: true })) ?? Response.error();
        }
      })(),
    );
    return;
  }
  // Everything else (hashed scripts, icons): cache first, then the network (and keep a copy).
  e.respondWith(
    (async () => {
      const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })(),
  );
});
