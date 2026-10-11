// Service Worker（アプリとしてインストールできるようにするための仕組み）。
// ・教材のファイル: まずネットワークから最新を取り、取れないときだけ保存分を使う
//   → push した変更が、次に開いたときすぐ反映される
// ・vendor/ のライブラリ（Pyodide など。大きくて中身が変わらない）: 保存分を優先する
//   → 2 回目以降の起動が速くなる

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const APP_CACHE = 'perlin-terrain-app-' + VERSION;
// vendor/ のライブラリを入れ替えたときは、この名前を変える
const VENDOR_CACHE = 'perlin-terrain-vendor-pyodide314.0.7-three0.186.1-cm5.65.21';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('perlin-terrain-') && n !== APP_CACHE && n !== VENDOR_CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request) {
  const cache = await caches.open(VENDOR_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') cache.put(request.url, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (res.ok && res.type === 'basic') cache.put(request.url, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request.url);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/vendor/')) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request));
});
