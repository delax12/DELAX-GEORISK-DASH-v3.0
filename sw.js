/* ═══════════════════════════════════════════════════
   DELAX GEO-RISK — Service Worker v5.0
   Place this file at the ROOT of your repo (same level as index.html).
   Vercel will serve it at https://your-domain.com/sw.js automatically.

   Strategy: Cache-first for static assets, network-first for API calls.
   ═══════════════════════════════════════════════════ */

const CACHE_NAME  = 'delax-georisk-v5.2'; // bumped — v5.0 workspace split; index.html lost the equities/portfolio tabs,
                                          // so every returning visitor MUST get the new shell rather than a cached one
                                          // that still references deleted functions.
const CACHE_URLS  = [
  '/',
  '/index.html',
  '/workspace.html',
  '/delax-state.js',
  '/delax-chrome.js',
  '/delax-chrome.css',
  '/dashboard-live.js',
  'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js',
  // globe.gl removed — Fix 2.1 (saves 820KB from precache)
];

/* Install — pre-cache critical assets */
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS)).catch(() => {})
  );
});

/* Activate — clear old caches */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Fetch — network-first for /api/, /_vercel/ and HTML navigations;
   cache-first for static assets only. HTML is network-first so a new
   deploy is always picked up instead of serving a stale cached page. */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = req.url;

  // Shared state module: network-first, because a stale copy can disagree with
  // the page reading it about which structure is selected.
  if (url.endsWith('/delax-state.js') || url.endsWith('/risk-structures.js') ||
      url.endsWith('/delax-chrome.js') || url.endsWith('/delax-chrome.css')) {
    event.respondWith(
      fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Always go to network for API calls and Vercel insights beacons — don't cache
  if (url.includes('/api/') || url.includes('/_vercel/')) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ error: 'Offline — using model estimate' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // HTML navigations + the app shell: network-first, fall back to cache when offline.
  const isHTML = req.mode === 'navigate' || url.endsWith('/') ||
                 url.endsWith('/index.html') || url.endsWith('/workspace.html');
  if (isHTML) {
    event.respondWith(
      fetch(req).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return response;
      }).catch(() => caches.match(req).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  /* ── MODEL & APP SCRIPTS: NETWORK-FIRST ──────────────────────────────────────
     risk-structures.js is the single source of truth for every number on the site.
     Serving it cache-first meant returning visitors ran an OLD model against a NEW
     page — which is exactly how a deployed structure update can appear "not to have
     shipped" (the review stamp rendering as an em-dash was this bug). Any same-origin
     first-party script now goes to the network first and falls back to cache offline.
     Third-party CDN libraries stay cache-first below: they are version-pinned.       */
  const isOwnScript = url.startsWith(self.location.origin) && /\.(js|json)(\?|$)/.test(url);
  if (isOwnScript) {
    event.respondWith(
      fetch(req).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return response;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for third-party/static assets (version-pinned CDN libs, fonts, etc.)
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});
