# PostiTuomari

PostiTuomari on Thunderbird-laajennus, joka lajittelee Saapuneet-kansion viestit kategoriakansioihin
(esim. *Saapuneet / Raha*, *Saapuneet / Ostokset*) lähettäjän ja otsikon perusteella. Kaikki tapahtuu
Thunderbirdin sisällä: erillistä palvelinta ei tarvita. Valinnainen AI-luokittelu käyttää OpenAI:ta
niille viesteille, joihin mikään oma sääntö ei osu.

- Thunderbird 128 tai uudempi (Manifest V3)
- Asetukset ja säännöt hallitaan asetussivulta, ei koodista
- Oletuksena **kuivaharjoitus**: lajittelu vain kertoo, mihin viestit menisivät

## Miten se toimii

Lajittelu käy läpi valittujen tilien Saapuneet Thunderbirdin käynnistyessä, uuden postin saapuessa ja
työkalupalkin **Lajittele nyt** -painikkeesta.

1. **Ohitetaan** liputetut (tähdellä merkityt) viestit, jotka pysyvät aina Saapuneissa, sekä viestit,
   jotka olet siirtänyt itse (laajennus muistaa ne eikä siirrä niitä takaisin). Roskaposti ei ole
   Saapuneissa, joten sitä ei käsitellä.
2. **Säännöt** tarkistetaan tässä järjestyksessä. Kussakin vaiheessa ensimmäinen osuva sääntö voittaa:
   1. *Lähettäjä + otsikko*: lähettäjän JA otsikkosanan pitää osua
   2. *Otsikko etusijalla*: otsikkosana ratkaisee ennen lähettäjää (esim. tietoturva, laskut)
   3. *Osoite*: tarkka lähettäjäosoite
   4. *Domain*: lähettäjän domain, myös alidomainit
   5. *Otsikkosanat*
3. **AI** (jos käytössä): viestit, joihin mikään sääntö ei osu, luokitellaan OpenAI:lla. Jos AI ei osaa
   päättää, viesti jää Saapuneisiin eikä sitä kysytä uudelleen.
4. **Kansiot**: viestit siirretään kategorian nimiseen Saapuneiden alikansioon, joka luodaan tarvittaessa.

Popupin **Saapuneissa ilman sääntöä** -listasta voit siirtää viestin itse ja luoda samalla säännön
lähettäjästä. Asetussivun yläreunan tilarivi näyttää kuivaharjoituksen, valitut tilit, AI:n tilan ja
sen, onko API-avain asetettu.

### Esimerkki: lähettäjä JA otsikko

Sama lähettäjä `palvelu.example` lähettää sekä laskuja että uutiskirjeitä. Kaksi sääntöä erottaa ne:

| Kategoria    | Milloin sääntö osuu                  | Domainit          | Otsikkosanat |
|--------------|--------------------------------------|-------------------|--------------|
| Raha         | Lähettäjän JA otsikon pitää osua     | `palvelu.example` | `lasku`      |
| Uutiskirjeet | Riittää että jokin osuu              | `palvelu.example` |              |

"Lasku 11/2026" lähettäjältä `info@palvelu.example` menee Rahaan, koska lähettäjä + otsikko -säännöt
tarkistetaan ensin. "Marraskuun uutiset" samalta lähettäjältä menee Uutiskirjeisiin.

### Tuplasäännöt

Jos samoja sääntöjä tai saman kategorian päällekkäisiä sanoja on useampi (esim. tuonnin tai oletussääntöjen
lisäyksen jälkeen), Säännöt-osio näyttää varoituksen ja **Poista tuplat** -toiminnon esikatseluineen.
Siivous poistaa vain sääntöjä ja arvoja, joiden osuman sama kategoria saisi joka tapauksessa aiemmin,
joten lajittelun lopputulos ei muutu. Tuonti ja oletussäännön lisäys siivoavat tuplat automaattisesti.

## Tietoturva ja yksityisyys

- **Mitä OpenAI:lle lähtee:** vain lähettäjän nimi, domain ja otsikko, esim.
  `{"id": "42", "from": "Verkkokauppa (kauppa.example)", "subject": "Tilausvahvistus"}`.
  - Sähköpostiosoitteita ei lähetetä. Osoitteen paikallinen osa (ennen @-merkkiä) jätetään aina pois,
    otsikossa olevat osoitteet korvataan merkinnällä `[osoite]`, ja koko pyyntö tarkistetaan vielä ennen
    lähetystä: jos siinä on osoitteen näköinen merkkijono, pyyntöä ei lähetetä.
  - **Viestien sisältöä ei koskaan lähetetä.**
  - **Otsikossa voi silti olla henkilötietoja** (esim. nimiä tai tilausnumeroita). Lähettäjät, joiden
    viestejä ei saa lähettää, lisätään *Säännöt → Älä koskaan lähetä AI:lle* -listaan.
  - Asetussivun AI-osion esikatselu näyttää täsmälleen sen JSONin, joka viimeisimmistä viesteistä lähtisi.
  - Otsikot ovat AI:lle dataa, eivät ohjeita. Vaikka otsikko yrittäisi ohjailla mallia, pahin seuraus on
    väärä kategoria: vastauksesta hyväksytään vain sallitut kategoriat ja pyydetyt viestit.
- **Ilmaiset sähköpostipalvelut:** näiden lähettäjistä kerrotaan vain `yksityishenkilö (gmail.com)` ilman
  nimeä. Oletuslistalla ovat yleisimmät kansainväliset palvelut. **Lisää listaan myös paikalliset
  palveluntarjoajat** (esim. `posti.example`) asetussivun AI-osiossa, muuten niiden käyttäjien nimet voivat
  lähteä AI:lle.
- **API-avain** tallennetaan vain paikallisesti, **salaamattomana Thunderbird-profiiliin**. Se ei ole
  viennissä, lokissa eikä virheilmoituksissa, ja asetussivulla siitä näytetään vain neljä viimeistä
  merkkiä. Käytä **rajattua avainta ja budjettirajaa** (alla).
- **Vientitiedosto** sisältää omat sääntösi (osoitteet, domainit). Säilytä se itselläsi, **älä laita sitä
  repoon**. `postituomari-export*.json` on `.gitignore`ssa.
- **Ei telemetriaa.** Ainoa ulkoinen yhteys on `https://api.openai.com`, ja vain kun AI on käytössä.
  Kaikki muu (säännöt, asetukset, muistit) jää koneelle Thunderbirdin `storage.local`-tallennukseen.
- **Loki:** oletuksena lisäosan konsoliin kirjoitetaan vain määriä, kategorioita ja virheitä. Lähettäjät ja
  otsikot näkyvät vain, jos *Yksityiskohtainen loki (vianetsintään)* on päällä.

## Rajatun OpenAI-avaimen luonti

1. Kirjaudu osoitteeseen <https://platform.openai.com> ja luo laajennukselle oma projekti.
2. Aseta projektille budjettiraja projektin asetusten *Limits*-kohdassa (esim. muutama euro kuukaudessa).
3. Luo avain: *API keys → Create new secret key*, valitse projekti ja **Permissions: Restricted**.
4. Aseta ensin *Model capabilities* tilaan **Request**. Palauta sitten kaikki sen alla olevat oikeudet
   tilaan **None**, paitsi **Chat completions** (`/v1/chat/completions`), joka jää tilaan Request.
   Muut oikeudet pysyvät tilassa None.
5. Kopioi avain PostiTuomarin asetussivulle (*AI → API-avain*) ja paina **Testaa yhteys**.

Avaimen voi milloin tahansa poistaa asetussivulta tai mitätöidä OpenAI:n hallinnasta.

## Asennus

1. Rakenna paketti (ks. *Pakkaus*) tai käytä valmista `postituomari-<versio>.xpi`-tiedostoa.
2. Thunderbirdissä: **≡ → Lisäosat ja teemat → ratas (⚙) → Asenna lisäosa tiedostosta…** ja valitse
   `.xpi`-tiedosto. Laajennus käynnistyy jatkossa Thunderbirdin mukana.
3. Avaa asetukset (*Lisäosat ja teemat → PostiTuomari → Asetukset*), valitse lajiteltavat tilit ja
   tarkista säännöt.
4. Kokeile ensin kuivaharjoituksena (*Lajittele nyt* popupista) ja ota se pois päältä vasta, kun
   lopputulos näyttää oikealta.

### Asennus Windowsissa (kun koodi on WSL:ssä)

1. Kopioi `.xpi` Windowsin puolelle, esim. Lataukset-kansioon. Resurssienhallinnassa WSL:n tiedostot
   löytyvät osoitteesta `\\wsl$\<jakelu>\home\<käyttäjä>\…`.
2. Asenna kopio: *Lisäosat ja teemat → ⚙ → Asenna lisäosa tiedostosta…*. **Asennus suoraan WSL-polusta
   voi jäädä väliaikaiseksi.**
3. Varmista pysyvyys: *≡ → Työkalut → Kehittäjätyökalut → Lisäosien vianetsintä* (Debug Add-ons).
   PostiTuomarin pitää näkyä kohdassa **Extensions**, ei **Temporary Extensions**.

### Väliaikaisesta versiosta pysyvään

Väliaikaisen version tallennettu data poistuu, kun se poistetaan, joten vie asetukset ensin
(*Asetukset → Tiedot → Vie JSON-tiedostoksi*), poista väliaikainen versio, asenna `.xpi`, tuo vientitiedosto
(*Tiedot → Tuonti*) ja liitä API-avain uudelleen.

### Päivitys uuteen versioon

1. Varmuudeksi: *Asetukset → Tiedot → Vie JSON-tiedostoksi*.
2. Rakenna uusi paketti: `cd extension && npm run package`.
3. Asenna uusi `.xpi` vanhan päälle (*Lisäosat ja teemat → ⚙ → Asenna lisäosa tiedostosta…*). Vanhaa ei
   tarvitse poistaa.
4. Tarkista asetussivun tilarivistä, että asetukset ovat ennallaan.

Päivitys säilyttää kaiken: asetukset, säännöt, kategoriat, API-avaimen ja muistit (käsin lajitellut,
epävarmat). Tallennus on sidottu laajennuksen tunnisteeseen, ja uudet asetuskentät saavat oletusarvon
muuttamatta vanhoja. Jos *Lajittele Thunderbirdin käynnistyessä* on päällä, päivitys ajaa lajittelun kerran.

### Työkalupalkin painike

Jos PostiTuomarin painiketta ei näy: napsauta työkalupalkkia hiiren oikealla, ota työkalupalkki näkyviin
ja valitse **Mukauta…**. Vedä PostiTuomari-painike työkalupalkkiin.

## Vianetsintä

Lisäosan konsoli: *≡ → Työkalut → Kehittäjätyökalut → Lisäosien vianetsintä → PostiTuomari →
Tarkastele (Inspect)*.

- **Taustaskripti "Stopped" on normaalia.** Thunderbird pysäyttää MV3-taustaskriptin, kun se on joutilas,
  ja herättää sen uuteen postiin, popupiin ja asetussivuun.
- **Konsolin konteksti:** konsolin yläreunan kehys- tai kontekstivalikosta valitaan, mitä sivua tarkastellaan:
  taustasivu (lajittelu, AI, apuvälineet) vai asetussivu tai popup (niiden omat virheet).
- **Yksityiskohtainen loki:** ota *Yleiset → Yksityiskohtainen loki (vianetsintään)* päälle, jos haluat
  nähdä jokaisen viestin lähettäjän, otsikon ja tuomion. Ota se pois, kun vianetsintä on valmis.
- **Popupin virheet:** popup näyttää kaatuessaan virheilmoituksen. Helpoin tapa nähdä sen konsoli on avata
  popup välilehteen: `await postiTuomari.openPopupInTab()`. Oikean popupin konsolia varten valitse
  työkalujen ⋯-valikosta *Disable Popup Auto-Hide*, avaa popup ja valitse kehysvalitsimesta
  `popup/index.html`.

Taustasivun konsolin apuvälineet:

```js
await postiTuomari.status()            // tila määrinä
await postiTuomari.sortNow()           // lajittele nyt
await postiTuomari.restoreFlagged({ preview: true })
await postiTuomari.missingDefaultRules()
await postiTuomari.openPopupInTab()
```

## Kehitys

Vaatii Node.js 20 tai uudemman.

```bash
cd extension
npm install
npm run dev      # rakentaa extension/dist/:iin ja päivittää aina, kun lähdekoodi muuttuu
npm test         # yksikkötestit (Noden oma testiajuri)
npm run build    # kertarakennus
```

Lataa kehitysversio Thunderbirdiin: *Lisäosien vianetsintä → Lataa väliaikainen lisäosa…* ja valitse
`extension/dist/manifest.json`. Muutosten jälkeen paina *Lataa uudelleen*.

### Rakenne

```
extension/
  public/manifest.json     manifest ja kuvake (kopioidaan distiin sellaisenaan)
  src/background/          taustaskripti: lajittelu, AI-kutsut, tapahtumat (yksi IIFE-tiedosto)
  src/options/             asetussivu (React)
  src/popup/               työkalupalkin popup (React)
  src/shared/              yhteinen logiikka: luokittelu, tallennus, tarkistukset, anonymisointi, tuplat
  scripts/                 build ja pakkaus
  test/                    yksikkötestit
```

Riippuvuudet on lukittu tarkkoihin versioihin. Ennen julkaisua: `npm audit` (tavoite 0 haavoittuvuutta).

## Pakkaus

```bash
cd extension
npm run package
```

Tekee repon juureen tiedoston `postituomari-<versio>.xpi` (gitignoressa). Versio tulee tiedostosta
`extension/public/manifest.json`.

## Tuonti- ja vientimuoto

```json
{
  "format": "postituomari",
  "version": 1,
  "categories": ["Raha", "Uutiskirjeet", "Perhe ja ystävät"],
  "rules": [
    { "category": "Raha", "match": "all", "domains": ["palvelu.example"], "subjectWords": ["lasku"] },
    { "category": "Uutiskirjeet", "match": "any", "domains": ["palvelu.example"] },
    { "category": "Perhe ja ystävät", "addresses": ["henkilo@example.com"] }
  ],
  "aiBlocklist": { "addresses": [], "domains": [] }
}
```

`match` on `"any"` (oletus, myös jos kenttä puuttuu) tai `"all"`. Tuonti näyttää esikatselun ennen
tallennusta, hylkää virheelliset arvot ja rajaa koot. API-avain ei ole koskaan mukana.
