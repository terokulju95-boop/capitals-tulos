// Hakee Washington Capitalsin otteluohjelman NHL:n rajapinnasta ja kirjoittaa tiedostoon data/tulos.json:
//  - viimeisimmän pelatun ottelun joukkueet ja tiedon VOITTO / HÄVIÖ
//  - käynnissä olevan ottelun (jos sellainen on)
//  - seuraavan ottelun
//  - pudotuspelisarjan tilanteen keväällä
// Maalimääriä ei tallenneta, jotta yksittäisten otteluiden lopputulokset eivät paljastu.

import { readFile, writeFile } from "node:fs/promises";

const JOUKKUE = "WSH";
const API = "https://api-web.nhle.com/v1";
const TIEDOSTO = new URL("../data/tulos.json", import.meta.url);

async function hae(polku) {
  const vastaus = await fetch(`${API}${polku}`, {
    headers: { "User-Agent": "capitals-tulos (GitHub Actions)" },
  });
  if (!vastaus.ok) throw new Error(`NHL API ${polku}: HTTP ${vastaus.status}`);
  return vastaus.json();
}

const pelattu = (o) => ["OFF", "FINAL"].includes(o.gameState);
const kaynnissa = (o) => ["LIVE", "CRIT"].includes(o.gameState);
const tulossa = (o) => ["FUT", "PRE"].includes(o.gameState);
// 2 = runkosarja, 3 = pudotuspelit. Harjoitusottelut (1) jätetään pois.
const oikeaOttelu = (o) => o.gameType === 2 || o.gameType === 3;
const aikajarjestys = (a, b) => new Date(a.startTimeUTC) - new Date(b.startTimeUTC);

function joukkue(t) {
  const paikka = t.placeName?.default ?? t.city ?? "";
  const nimi = t.commonName?.default ?? t.name?.default ?? "";
  return {
    lyhenne: t.abbrev,
    nimi: `${paikka} ${nimi}`.trim() || t.abbrev,
    lyhytNimi: nimi || t.abbrev,
    logo: t.logo ?? `https://assets.nhle.com/logos/nhl/svg/${t.abbrev}_light.svg`,
  };
}

const vastustajaOf = (o) => (o.homeTeam.abbrev === JOUKKUE ? o.awayTeam : o.homeTeam);
const omaOf = (o) => (o.homeTeam.abbrev === JOUKKUE ? o.homeTeam : o.awayTeam);
const voitettu = (o) => omaOf(o).score > vastustajaOf(o).score;

function otteluTiedot(o) {
  return {
    id: o.id,
    alkoi: o.startTimeUTC,
    pudotuspeli: o.gameType === 3,
    areena: o.venue?.default ?? null,
    koti: joukkue(o.homeTeam),
    vieras: joukkue(o.awayTeam),
  };
}

// ---------- Haku ----------
const kausi = await hae(`/club-schedule-season/${JOUKKUE}/now`);
let ottelut = (kausi.games ?? []).filter(oikeaOttelu);

// Kauden alussa uudella kaudella ei välttämättä ole vielä pelattuja otteluita: haetaan edellinen kausi mukaan.
if (!ottelut.some(pelattu) && kausi.previousSeason) {
  const edellinen = await hae(`/club-schedule-season/${JOUKKUE}/${kausi.previousSeason}`);
  ottelut = [...(edellinen.games ?? []).filter(oikeaOttelu), ...ottelut];
}
ottelut.sort(aikajarjestys);

const viimeisin = ottelut.filter(pelattu).at(-1) ?? null;
const live = ottelut.find(kaynnissa) ?? null;
const seuraava = ottelut.find(tulossa) ?? null;

let tulos = null;
if (viimeisin) {
  if (typeof omaOf(viimeisin).score !== "number" || typeof vastustajaOf(viimeisin).score !== "number") {
    throw new Error(`Ottelun ${viimeisin.id} tulos puuttuu rajapinnasta.`);
  }
  // Jatkoaika- ja voittolaukaushäviöt ovat häviöitä.
  tulos = voitettu(viimeisin) ? "VOITTO" : "HÄVIÖ";
}

// ---------- Pudotuspelisarja ----------
// Sarja lasketaan pelatuista pudotuspeliotteluista saman vastustajan kanssa.
// Sarjan vastustajaksi valitaan käynnissä olevan tai seuraavan pudotuspeliottelun vastustaja,
// muuten viimeisimmän pudotuspeliottelun vastustaja.
let sarja = null;
const sarjaOttelu = [live, seuraava].find((o) => o && o.gameType === 3) ?? (viimeisin?.gameType === 3 ? viimeisin : null);
// Kun seuraavana on jo runkosarjaa (uusi kausi), viime kevään sarjaa ei enää näytetä.
const uusiKausiAlkamassa = !live && seuraava?.gameType === 2;
if (sarjaOttelu && !uusiKausiAlkamassa) {
  const vastustaja = vastustajaOf(sarjaOttelu);
  const kausiId = sarjaOttelu.season;
  const sarjanOttelut = ottelut.filter(
    (o) => o.gameType === 3 && pelattu(o) && vastustajaOf(o).abbrev === vastustaja.abbrev && (!kausiId || o.season === kausiId)
  );
  sarja = {
    vastustaja: joukkue(vastustaja).lyhytNimi,
    voitot: sarjanOttelut.filter(voitettu).length,
    tappiot: sarjanOttelut.filter((o) => !voitettu(o)).length,
  };
}

const data = {
  tulos,
  ottelu: viimeisin ? otteluTiedot(viimeisin) : null,
  kaynnissa: live ? otteluTiedot(live) : null,
  seuraava: seuraava ? otteluTiedot(seuraava) : null,
  sarja,
};

// ---------- Tallennus ja ilmoitus ----------
// Tiedosto kirjoitetaan vain, kun tieto muuttuu. Muuten GitHubiin ei synny turhia tallennuksia.
const vanhaTeksti = await readFile(TIEDOSTO, "utf8").catch(() => "");
let vanha = null;
try { vanha = JSON.parse(vanhaTeksti); } catch {}

const uusiTeksti = JSON.stringify(data, null, 2) + "\n";
if (uusiTeksti === vanhaTeksti) {
  console.log("Ei muutoksia.");
  process.exit(0);
}
await writeFile(TIEDOSTO, uusiTeksti);
console.log(
  `Päivitetty. Viimeisin: ${data.ottelu ? `${data.ottelu.koti.nimi} – ${data.ottelu.vieras.nimi} (${tulos})` : "-"}` +
    ` | Käynnissä: ${data.kaynnissa ? "kyllä" : "ei"} | Seuraava: ${data.seuraava?.alkoi ?? "-"}` +
    (sarja ? ` | Sarja ${sarja.voitot}–${sarja.tappiot} vs ${sarja.vastustaja}` : "")
);

// Uusi pelattu ottelu → valmistellaan push-ilmoitus. Workflow lähettää sen vasta, kun tallennus GitHubiin onnistuu,
// joten sama ottelu ilmoitetaan vain kerran, vaikka hakuja tehdään kymmenen minuutin välein.
const ilmoitusTiedosto = process.env.ILMOITUS_TIEDOSTO;
const uusiOttelu = data.ottelu && data.tulos && data.ottelu.id !== vanha?.ottelu?.id;
const tuore = data.ottelu && Date.now() - new Date(data.ottelu.alkoi) < 24 * 36e5;
if (ilmoitusTiedosto && uusiOttelu && tuore) {
  const o = data.ottelu;
  const ilmoitus = {
    otsikko: `Capitals – ${data.tulos}`,
    teksti: `${o.koti.nimi} – ${o.vieras.nimi}`,
    ottelu: o.id,
  };
  await writeFile(ilmoitusTiedosto, JSON.stringify(ilmoitus));
  console.log(`Ilmoitus valmisteltu: ${ilmoitus.otsikko} | ${ilmoitus.teksti}`);
}
