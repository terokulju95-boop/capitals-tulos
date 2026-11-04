// Service worker: pitää sovelluksen tallessa puhelimessa ja tunnistaa päivitykset.
//
// TÄRKEÄÄ: Kun sovellukseen tehdään muutoksia (index.html, kuvakkeet tms.), nosta VERSIO-numeroa.
// Silloin puhelin huomaa uuden version ja kysyy, päivitetäänkö sovellus.
const VERSIO = 3;

const VALIMUISTI = `capitals-v${VERSIO}`;
const SOVELLUS = [
  "./",
  "index.html",
  "manifest.json",
  "kuvakkeet/ikoni-192.png",
  "kuvakkeet/ikoni-512.png",
  "kuvakkeet/ikoni-maskable-512.png",
  "kuvakkeet/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  // cache: "reload" ohittaa selaimen oman välimuistin, jotta uusi versio haetaan varmasti GitHubista.
  e.waitUntil(caches.open(VALIMUISTI).then((c) => c.addAll(SOVELLUS.map((u) => new Request(u, { cache: "reload" })))));
  // Ei skipWaiting(): uusi versio odottaa, kunnes käyttäjä painaa "Päivitä".
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((avaimet) => Promise.all(avaimet.filter((a) => a.startsWith("capitals-") && a !== VALIMUISTI).map((a) => caches.delete(a))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "PAIVITA") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // GitHubin ja NHL:n kutsut sekä tulostiedosto kulkevat aina suoraan verkosta.
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/data/")) return;
  // Sovelluksen omat tiedostot puhelimen välimuistista, jos ne löytyvät sieltä.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((osuma) => osuma || fetch(e.request))
  );
});
