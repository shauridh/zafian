// Strips files the Sites uploader refuses (hidden files and source maps)
// from the build output, so `deploy.json` can point straight at dist/.
// Then generates the PWA service worker for the freshly built assets.
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const DIST = new URL('../dist', import.meta.url).pathname
const CLIENT = join(DIST, 'client')
const SERVICE_WORKER = join(CLIENT, 'sw.js')
const CACHE_PREFIX = 'sabana-pos-shell-'

function clean(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name.startsWith('.') || name.endsWith('.map')) {
      rmSync(path, { recursive: true, force: true })
      continue
    }
    if (statSync(path).isDirectory()) clean(path)
  }
}

function walk(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files.push(...walk(path))
    else files.push(path)
  }
  return files
}

function buildServiceWorker() {
  rmSync(SERVICE_WORKER, { force: true })
  const urls = walk(CLIENT)
    .sort()
    .map((file) => `/${relative(CLIENT, file).split(sep).join('/')}`)
  // '/' adalah shell. '/index.html' sengaja tidak di-precache karena hosting produksi
  // me-redirect-nya ke '/', dan respons redirect tidak boleh memenuhi navigasi offline.
  const precache = ['/', ...urls.filter((url) => url !== '/index.html')]
  // Versi baru setiap build agar cache lama dibersihkan pada activate.
  const version = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const cacheName = `${CACHE_PREFIX}${version}`
  const source = `/* Digenerate otomatis oleh scripts/postbuild.mjs — jangan diedit manual. */
const VERSION = ${JSON.stringify(version)};
const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const CACHE_NAME = CACHE_PREFIX + VERSION;
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function isCacheable(request) {
  if (request.method !== 'GET') return false;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.indexOf('/api/') === 0) return false;
  return true;
}

function offlineShell() {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match('/').then(function (cached) {
      if (cached) return cached;
      return new Response('<!doctype html><html lang="id"><body><h1>Offline</h1><p>Buka aplikasi sekali dengan jaringan untuk menyiapkan shell.</p></body></html>', {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (!isCacheable(request)) return;

  if (request.mode === 'navigate') {
    // Selalu coba jaringan dulu; shell offline berasal dari precache '/', bukan
    // response navigasi yang mungkin sudah melalui redirect hosting.
    event.respondWith(fetch(request).catch(function () {
      return offlineShell();
    }));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(request).then(function (cached) {
        var network = fetch(request).then(function (response) {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        }).catch(function () {
          return null;
        });
        if (cached) return cached;
        return network.then(function (response) {
          return response || new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      });
    })
  );
});
`
  writeFileSync(SERVICE_WORKER, source)
  console.log(`✔ PWA: ${cacheName} • ${precache.length} aset di-precache`)
}

clean(DIST)
buildServiceWorker()
