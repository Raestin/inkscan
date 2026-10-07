const CACHE = 'inkscan-v1';
const SHELL = ['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','cards.json',
  'tesseract.min.js','worker.min.js','tesseract-core-simd-lstm.wasm.js','tesseract-core-lstm.wasm.js','eng.traineddata.gz'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Lorcast + fonts go straight to the network
  if (e.request.mode === 'navigate' || u.pathname.endsWith('/index.html')) {
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
