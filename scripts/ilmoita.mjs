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

const { FIREBASE_SERVICE_ACCOUNT, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, ILMOITUS_TIEDOSTO } = process.env;

if (!FIREBASE_SERVICE_ACCOUNT || !VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT) {
  console.log("Ilmoitusten avaimia ei ole asetettu GitHubin Secrets-kohtaan. Ilmoitusta ei lähetetty.");
  process.exit(0);
}

const ilmoitus = JSON.parse(await readFile(ILMOITUS_TIEDOSTO, "utf8"));

initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

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
