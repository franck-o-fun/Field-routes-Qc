// Keeps the app shell available with a weak signal. Bump VERSION after each upload.
const VERSION = "field-routes-2";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "config.js",
  "stores.js", "template.js",
  "leaflet.js", "leaflet.css", "exceljs.min.js", "jszip.min.js",
  "icon-180.png", "icon-192.png", "manifest.webmanifest"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // maps, geocoder, router: always live
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
