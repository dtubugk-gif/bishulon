// Offline support: the whole app is cached as ONE versioned set on install, so it opens
// without internet and never mixes files from two releases. A new release = bump VERSION.
// The OCR engine (CDN) is cached after its first successful download.
const VERSION = 'bishulon-v1.2.0';
const RUNTIME = 'bishulon-runtime-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'fonts/rubik-hebrew.woff2', 'fonts/rubik-latin.woff2',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'js/app.js', 'js/chef.js', 'js/data/chef-kb.js', 'js/data/seed-recipes.js', 'js/db.js', 'js/icons.js', 'js/import.js',
  'js/dish.js', 'js/lookup.js', 'js/parse.js', 'js/share.js', 'js/shopping.js', 'js/timers.js', 'js/ui.js', 'js/util.js', 'js/voice.js',
  'js/screens/add.js', 'js/screens/chef.js', 'js/screens/cook.js', 'js/screens/discover.js', 'js/screens/editor.js',
  'js/screens/library.js', 'js/screens/plan.js', 'js/screens/recipe.js', 'js/screens/settings.js', 'js/screens/shared.js', 'js/screens/share-setup.js', 'js/screens/shop.js',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' bypasses the browser's HTTP cache, so a fresh release never stores stale files
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bishulon-') && k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range') || req.destination === 'video' || req.destination === 'audio') return; // media needs 206 responses
  const url = new URL(req.url);
  if (url.hostname === 'r.jina.ai') return; // live page reads are never cached

  if (url.origin === location.origin) {
    if (req.mode === 'navigate') {
      // the app is a single page with hash routes: always answer with the cached shell
      const isShell = url.pathname === new URL('./', location).pathname || url.pathname.endsWith('/index.html');
      if (!isShell) return;
      e.respondWith(caches.match('index.html', { cacheName: VERSION }).then((hit) => hit || fetch(req)));
      return;
    }
    e.respondWith(caches.match(req, { ignoreSearch: true, cacheName: VERSION }).then((hit) => hit || fetch(req)));
    return;
  }

  // OCR engine + Hebrew language data: keep after the first good download
  if (/cdn\.jsdelivr\.net|tessdata/.test(url.hostname + url.pathname)) {
    e.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  }
});
