// Service worker dell'app iscritti: rende l'app installabile e apribile anche con rete debole.
// Solo i file dell'interfaccia vanno in cache; i dati (Supabase) arrivano sempre dalla rete.
const VER = "whynot-app-v12";
const SHELL = ["./", "app.css", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "../assets/whynot-app.js", "../assets/supabase-config.js", "../assets/fonts/fonts.css",
  "../assets/fonts/anton-latin.woff2", "../assets/fonts/inter-latin.woff2", "../assets/fonts/permanent-marker-latin.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.origin !== location.origin && !u.hostname.endsWith("jsdelivr.net")) return; // Supabase e il resto: sempre rete
  // rete prima (contenuti sempre aggiornati), cache se offline
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok && (u.origin === location.origin || u.hostname.endsWith("jsdelivr.net"))) {
        const copia = r.clone(); caches.open(VER).then((c) => c.put(e.request, copia));
      }
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match("./")))
  );
});

// ---------- notifiche push ----------
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "WHY NOT Fitness Club", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: d.tag, lang: "it", data: { url: d.url || "./" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope)) return c.focus();
    return clients.openWindow(url);
  }));
});
