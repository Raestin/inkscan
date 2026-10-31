const CACHE = 'inkscan-v20';
const IMGS = 'inkscan-img';
const SHELL = ['./','index.html','safety.js?v=20','catalog.js?v=20','legality.js?v=20','games.js?v=20','app.js?v=20','app.css?v=20','manifest.webmanifest','icon-192.png','icon-512.png','cards.json','finish-quotes.json','promo-catalog.json','core-rules.json','no-image.svg',
  'tesseract.min.js','worker.min.js','tesseract-core-simd-lstm.wasm.js','tesseract-core-lstm.wasm.js','eng.traineddata.gz'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); });
// No forced takeover of open scanning tabs. A new worker waits for the normal browser lifecycle.
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('inkscan-v') && k !== CACHE).map(k => caches.delete(k))))); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // card art: keep every image you've looked at, so it shows offline next time
  if (u.hostname === 'cards.lorcast.io' || u.hostname === 'cards.scryfall.io' || (u.hostname === 'optcgapi.com' && u.pathname.startsWith('/media/'))) {
    e.respondWith(caches.open(IMGS).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }))));
    return;
  }
  if (u.origin !== location.origin) return; // Lorcast API and fonts go straight to the network
  if (e.request.mode === 'navigate' || /\/(index\.html|app\.js|app\.css|catalog\.js|legality\.js|games\.js|onepiece-cards\.json|core-rules\.json|finish-quotes\.json|promo-catalog\.json)$/.test(u.pathname)) {
    // no-cache: always revalidate with the server, so a fresh release is never hidden behind the 10-minute HTTP cache
    e.respondWith(fetch(e.request, {cache: 'no-cache'}).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
