// Офлайн-режим: после первого открытия ночник работает без интернета.
// При изменении файлов увеличьте номер версии, чтобы телефоны получили обновление.
const CACHE = 'nightlight-v3';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/sound.js',
  'js/synth-worker.js',
  'js/store.js',
  'js/wake.js',
  'js/mic.js',
  'js/journal.js',
  'fonts/comfortaa-cyrillic.woff2',
  'fonts/comfortaa-latin.woff2',
  'fonts/nunito-cyrillic.woff2',
  'fonts/nunito-latin.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'media/keepawake.mp4',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' — берём свежие файлы с сервера, а не из кэша браузера.
  const requests = ASSETS.map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Safari запрашивает видео кусками (Range) и ждёт ответ 206.
async function rangeResponse(request, response) {
  const buf = await response.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  const start = m && m[1] ? Number(m[1]) : 0;
  const end = m && m[2] ? Math.min(Number(m[2]), buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

// Сначала отдаём из кэша (быстро и без сети), а в фоне обновляем кэш.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = request.mode === 'navigate' ? 'index.html' : request;
    const cached = await cache.match(key, { ignoreSearch: true });
    const plain = request.headers.has('range') || request.mode === 'navigate';
    const network = fetch(plain ? request.url : request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.status === 200) cache.put(key, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return request.headers.has('range') ? rangeResponse(request, cached) : cached;
    }
    const res = await network;
    if (res && request.headers.has('range')) return rangeResponse(request, res);
    return res || new Response('Нет сети', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
