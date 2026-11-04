// Lähettää äänettömän push-ilmoituksen kaikille puhelimille, joissa Capitals-sovelluksen ilmoitukset ovat päällä.
// Ilmoituksen sisällön valmistelee paivita.mjs (tiedosto ILMOITUS_TIEDOSTO), ja tämä ajetaan vasta,
// kun uusi tulos on tallennettu GitHubiin.
//
// Tarvittavat GitHub Secrets -arvot:
//   FIREBASE_SERVICE_ACCOUNT  Capitals-sovelluksen Firebase-projektin palvelutiliavain (JSON)
//   VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT

import { readFile } from "node:fs/promises";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import webpush from "web-push";

// Avaimista poistetaan välilyönnit, rivinvaihdot ja lainausmerkit, jos niitä tarttui mukaan kopioidessa.
const siivoa = (arvo) => (arvo ?? "").replace(/[\s"'`]/g, "").replace(/=+$/, "");
const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
const VAPID_PUBLIC = siivoa(process.env.VAPID_PUBLIC);
const VAPID_PRIVATE = siivoa(process.env.VAPID_PRIVATE);
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT ?? "").trim().replace(/^["'`]|["'`]$/g, "");
const { ILMOITUS_TIEDOSTO } = process.env;

const arvot = { FIREBASE_SERVICE_ACCOUNT, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT };
const puuttuvat = Object.keys(arvot).filter((n) => !arvot[n]);
if (puuttuvat.length) {
  console.log(`Ilmoitusta ei lähetetty. GitHubin Secrets-kohdasta (Repository secrets) puuttuu: ${puuttuvat.join(", ")}`);
  process.exit(0);
}
if (!VAPID_SUBJECT.startsWith("mailto:") && !VAPID_SUBJECT.startsWith("https://")) {
  console.log("Ilmoitusta ei lähetetty. VAPID_SUBJECT pitää alkaa sanalla mailto: (esim. mailto:etunimi@gmail.com).");
  process.exit(0);
}

const ilmoitus = JSON.parse(await readFile(ILMOITUS_TIEDOSTO, "utf8"));

// Tarkistetaan avainten muoto, jotta virheilmoitus kertoo suoraan, kumpi avain on väärin.
if (!/^[A-Za-z0-9_-]{80,90}$/.test(VAPID_PUBLIC)) {
  console.log(`VAPID_PUBLIC on väärän muotoinen (${VAPID_PUBLIC.length} merkkiä, pitäisi olla 87). Kopioi se uudelleen VAPID-avaimet.txt-tiedostosta.`);
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{40,46}$/.test(VAPID_PRIVATE)) {
  console.log(`VAPID_PRIVATE on väärän muotoinen (${VAPID_PRIVATE.length} merkkiä, pitäisi olla 43). Kopioi se uudelleen VAPID-avaimet.txt-tiedostosta.`);
  process.exit(1);
}
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

const payload = JSON.stringify({
  title: ilmoitus.otsikko,
  body: ilmoitus.teksti,
  tag: `ottelu-${ilmoitus.ottelu}`,
  url: "./",
});

const tilaukset = await db.collection("tilaukset").get();
let lahetetty = 0, poistettu = 0, virheet = 0;

for (const doc of tilaukset.docs) {
  let tilaus;
  try {
    tilaus = JSON.parse(doc.data().sub);
  } catch {
    await doc.ref.delete(); poistettu++;
    continue;
  }
  try {
    // TTL 12 h: jos puhelin on pois päältä, ilmoitus toimitetaan, kun se palaa verkkoon (enintään 12 h).
    await webpush.sendNotification(tilaus, payload, { TTL: 12 * 3600 });
    lahetetty++;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Puhelin on poistanut tilauksen (esim. sovellus poistettu) → siivotaan pois
      await doc.ref.delete(); poistettu++;
    } else {
      virheet++;
      console.log(`Lähetys epäonnistui (${err.statusCode ?? "?"}): ${err.body ?? err.message}`);
    }
  }
}

console.log(`Ilmoitus "${ilmoitus.otsikko}" lähetetty ${lahetetty} laitteeseen. Vanhentuneita poistettu: ${poistettu}. Virheitä: ${virheet}.`);
