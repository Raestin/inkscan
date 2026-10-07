const CACHE = 'inkscan-v2';
const IMGS = 'inkscan-img';
const SHELL = ['./','index.html','app.js?v=2','app.css?v=2','manifest.webmanifest','icon-192.png','icon-512.png','cards.json',
  'tesseract.min.js','worker.min.js','tesseract-core-simd-lstm.wasm.js','tesseract-core-lstm.wasm.js','eng.traineddata.gz'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('inkscan-v') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // card art: keep every image you've looked at, so it shows offline next time
  if (u.hostname === 'cards.lorcast.io') {
    e.respondWith(caches.open(IMGS).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }))));
    return;
  }
  if (u.origin !== location.origin) return; // Lorcast API and fonts go straight to the network
  if (e.request.mode === 'navigate' || /\/(index\.html|app\.js|app\.css)$/.test(u.pathname)) {
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
