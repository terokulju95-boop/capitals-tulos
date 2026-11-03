// Hakee Washington Capitalsin viimeisimmän pelatun ottelun NHL:n rajapinnasta
// ja kirjoittaa tiedostoon data/tulos.json vain tiedon voitosta tai häviöstä.
// Maalimääriä ei tallenneta, jotta lopputulos ei paljastu.

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
// 2 = runkosarja, 3 = pudotuspelit. Harjoitusottelut (1) jätetään pois.
const oikeaOttelu = (o) => o.gameType === 2 || o.gameType === 3;

function viimeisinPelattu(otteluohjelma) {
  const ottelut = (otteluohjelma.games ?? []).filter((o) => pelattu(o) && oikeaOttelu(o));
  ottelut.sort((a, b) => new Date(a.startTimeUTC) - new Date(b.startTimeUTC));
  return ottelut.at(-1);
}

function joukkue(t) {
  const paikka = t.placeName?.default ?? t.city ?? "";
  const nimi = t.commonName?.default ?? t.name?.default ?? "";
  return {
    lyhenne: t.abbrev,
    nimi: `${paikka} ${nimi}`.trim() || t.abbrev,
    logo: t.logo ?? `https://assets.nhle.com/logos/nhl/svg/${t.abbrev}_light.svg`,
  };
}

const kausi = await hae(`/club-schedule-season/${JOUKKUE}/now`);
let ottelu = viimeisinPelattu(kausi);

// Kauden alussa tai kesätauolla voi olla, ettei uudella kaudella ole vielä pelattuja otteluita.
if (!ottelu && kausi.previousSeason) {
  ottelu = viimeisinPelattu(await hae(`/club-schedule-season/${JOUKKUE}/${kausi.previousSeason}`));
}
if (!ottelu) {
  console.log("Pelattuja otteluita ei löytynyt, tiedostoa ei muutettu.");
  process.exit(0);
}

const kotona = ottelu.homeTeam.abbrev === JOUKKUE;
const oma = kotona ? ottelu.homeTeam : ottelu.awayTeam;
const vastustaja = kotona ? ottelu.awayTeam : ottelu.homeTeam;
if (typeof oma.score !== "number" || typeof vastustaja.score !== "number") {
  throw new Error(`Ottelun ${ottelu.id} tulos puuttuu rajapinnasta.`);
}

// Jatkoaika- ja voittolaukaushäviöt ovat häviöitä.
const tulos = {
  tulos: oma.score > vastustaja.score ? "VOITTO" : "HÄVIÖ",
  ottelu: {
    id: ottelu.id,
    alkoi: ottelu.startTimeUTC,
    pudotuspeli: ottelu.gameType === 3,
    areena: ottelu.venue?.default ?? null,
    koti: joukkue(ottelu.homeTeam),
    vieras: joukkue(ottelu.awayTeam),
  },
};

const uusi = JSON.stringify(tulos, null, 2) + "\n";
const vanha = await readFile(TIEDOSTO, "utf8").catch(() => "");
if (uusi === vanha) {
  console.log("Ei uutta ottelua.");
} else {
  await writeFile(TIEDOSTO, uusi);
  console.log(`Päivitetty: ${tulos.ottelu.koti.nimi} – ${tulos.ottelu.vieras.nimi}`);
}
