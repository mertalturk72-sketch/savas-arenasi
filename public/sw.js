// Service worker: oyunun tamamını önbelleğe alır, böylece uygulama
// internetsizken de açılır ve çevrimdışı modda oynanabilir.
//
// Strateji: "önce önbellek, arkada tazele" (stale-while-revalidate).
// Oyuncu beklemez; yeni sürüm arka planda inip bir sonraki açılışta devreye girer.

// Sürüm damgası. `npm run build:www` bu satırı dosya içeriklerinin özetiyle
// değiştirir; böylece oyun her güncellendiğinde telefondaki önbellek
// kendiliğinden yenilenir, kimse eski sürümde takılı kalmaz.
const VERSION = 'dev-4';
const CACHE = `savas-arenasi-${VERSION}`;

// Uygulamanın çalışması için gereken her şey.
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/main.js',
  'js/net.js',
  'js/local.js',
  'js/game.js',
  'js/render.js',
  'js/input.js',
  'js/audio.js',
  '/shared/constants.js',
  '/shared/physics.js',
  '/shared/protocol.js',
  '/shared/binary.js',
  '/shared/sim/hub.js',
  '/shared/sim/lobby.js',
  '/shared/sim/game.js',
  '/shared/sim/map.js',
  '/shared/sim/bot.js',
  'textures/grass.jpg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Tek tek ekliyoruz: bir dosya eksikse kurulumun tamamı çökmesin.
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await cache.put(url, res);
      } catch { /* çevrimdışı kurulumda atlanır */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // dış kaynaklara karışma
  if (url.pathname === '/health') return;              // sunucu durumu hep taze olsun

  // Sayfa gezintisi: çevrimdışıysa önbellekteki index.html ile aç
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('index.html', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('index.html'))
          || (await cache.match('./'))
          || new Response('Çevrimdışı', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (cached) {
      network;                    // arka planda tazele, sonucu bekleme
      return cached;
    }
    const res = await network;
    return res || new Response('', { status: 504 });
  })());
});
