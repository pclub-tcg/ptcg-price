/* P’CLUB App 離線快取：網頁和行情資料先上網抓最新的（抓不到才用快取），圖片和字型先用快取。
   競標、市集、LINE 登入等 API（其他網域、POST）一律不經過這裡。 */
const V = "pclub-v1";
const CORE = ["./", "index.html", "auction.html", "market.html", "manifest.webmanifest", "app/icon-192.png"];
const IMG_MAX = 400;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== V + "-img").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(c) {
  const ks = await c.keys();
  for (let i = 0; i < ks.length - IMG_MAX; i++) await c.delete(ks[i]);
}

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  const same = u.origin === location.origin;
  const font = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!same && !font) return;

  if (font || (same && /\.(png|jpe?g|webp|gif|svg|woff2?)$/i.test(u.pathname))) {
    e.respondWith(caches.open(V + "-img").then(async c => {
      const hit = await c.match(r);
      if (hit) return hit;
      const res = await fetch(r);
      if (res.ok || res.type === "opaque") { c.put(r, res.clone()); trim(c); }
      return res;
    }));
    return;
  }
  // 網頁、JSON：先抓最新
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
    return res;
  }).catch(async () => (await caches.match(r, { ignoreSearch: r.mode === "navigate" })) ||
    (r.mode === "navigate" ? caches.match("./") : Response.error())));
});
