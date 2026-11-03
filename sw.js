// Kevyt service worker, jota Chrome vaatii asennettavalta sovellukselta.
// Tulosta ei tallenneta välimuistiin, joten sovellus näyttää aina tuoreimman tiedon.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request));
});
