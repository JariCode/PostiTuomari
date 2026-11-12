# PostiTuomari

PostiTuomari on Thunderbird-laajennus, joka siirtää saapuvan postin kansioihin, esimerkiksi
*Saapuneet / Raha* tai *Saapuneet / Ostokset*. Se päättelee kansion lähettäjästä ja otsikosta omien
sääntöjesi avulla. Jos mikään sääntö ei sovi, laajennus voi halutessasi kysyä tekoälyltä (OpenAI).

- Toimii Thunderbird 128:ssa ja uudemmissa.
- Kaikki asetukset tehdään asetussivulla. Koodia ei tarvitse muokata.
- Aluksi on päällä **kuivaharjoitus**: laajennus vain kertoo, mihin viestit menisivät, eikä siirrä mitään.

## Miten se toimii

Laajennus käy valittujen tilien Saapuneet läpi, kun Thunderbird käynnistyy, kun uutta postia tulee ja
kun painat työkalupalkin **Lajittele nyt** -painiketta.

1. **Näihin ei kosketa:** liputetut (tähdellä merkityt) viestit pysyvät aina Saapuneissa. Myöskään
   viestejä, jotka olet itse siirtänyt, ei siirretä takaisin. Roskapostia ei käsitellä.
2. **Säännöt** tarkistetaan tässä järjestyksessä. Ensimmäinen sopiva sääntö ratkaisee.
   1. *Lähettäjä + otsikko*: sekä lähettäjän että otsikon sanan pitää sopia.
   2. *Otsikko etusijalla*: otsikon sana ratkaisee ennen lähettäjää (esim. tietoturva, laskut).
   3. *Osoite*: tarkka lähettäjän osoite.
   4. *Domain*: lähettäjän verkkotunnus, myös alidomainit.
   5. *Otsikon sanat*.
3. **Tekoäly** (jos otat sen käyttöön): viestit, joihin mikään sääntö ei sovi, luokitellaan OpenAI:lla.
   Jos tekoäly ei ole varma, viesti jää Saapuneisiin, eikä siitä kysytä uudelleen.
4. **Kansiot:** viesti siirretään kategorian nimiseen kansioon Saapuneiden alle. Kansio luodaan
   tarvittaessa.

Popupin **Saapuneissa ilman sääntöä** -listasta voit siirtää viestin itse ja samalla tehdä säännön
lähettäjästä. Asetussivun yläreunasta näet heti, onko kuivaharjoitus päällä, montako tiliä on valittu,
onko tekoäly käytössä ja onko API-avain tallennettu (ja onko se lukossa).

### Esimerkki: lähettäjä JA otsikko

Sama lähettäjä `palvelu.example` lähettää sekä laskuja että uutiskirjeitä. Kaksi sääntöä erottaa ne:

| Kategoria    | Milloin sääntö sopii                 | Domain            | Otsikon sana |
|--------------|--------------------------------------|-------------------|--------------|
| Raha         | Lähettäjän JA otsikon pitää osua     | `palvelu.example` | `lasku`      |
| Uutiskirjeet | Riittää että jokin osuu              | `palvelu.example` |              |

"Lasku 11/2026" menee Rahaan ja "Marraskuun uutiset" Uutiskirjeisiin.

### Kategoriat ja kansiot

- **Uudelleennimeäminen** päivittää säännöt. Lisäksi valittujen tilien Saapuneiden alla oleva samanniminen
  kansio nimetään uudelleen, jos uudella nimellä ei ole jo kansiota. Kuivaharjoituksessa laajennus vain
  kertoo, mitä tekisi.
- **Poisto** poistaa kategorian ja sen säännöt, mutta **ei koske kansioon**: kansio ja sen viestit jäävät.

### Tuplasäännöt

Jos samoja sääntöjä tai päällekkäisiä sanoja on useampi, Säännöt-osio näyttää varoituksen ja
**Poista tuplat** -painikkeen. Ennen poistoa näet, mitä poistetaan. Lajittelun lopputulos ei muutu.

## Tietoturva ja yksityisyys

### Mitä tekoälylle lähtee

Tekoälylle lähtee vain **lähettäjän verkkotunnus ja viestin otsikko**, esimerkiksi:

```json
{ "id": "42", "from": "kauppa.example", "subject": "Tilausvahvistus" }
```

- **Viestin sisältöä ei lähetetä koskaan.**
- **Lähettäjän nimeä ei lähetetä**, ellei kytke päälle valintaa *Lähetä lähettäjän nimi tekoälylle*.
  Yritysten lähettäjänimissä on usein ihmisen nimi, joten oletus on pois.
- **Ennen lähetystä otsikosta korvataan:**

  | Mitä                                              | Korvataan merkinnällä |
  |---------------------------------------------------|-----------------------|
  | sähköpostiosoite                                  | `[osoite]`            |
  | henkilötunnus                                     | `[hetu]`              |
  | puhelinnumero (+358…, 04x…, 050…)                 | `[puhelin]`           |
  | tilinumero (IBAN)                                 | `[tilinumero]`        |
  | maksukortin numero                                | `[kortti]`            |
  | auton rekisterinumero (esim. ABC-123)             | `[rekisteri]`         |
  | oma nimesi (Thunderbirdin tilien tiedoista)       | `[nimi]`              |
  | *Suojattavat nimet ja sanat* -listan sanat        | `[nimi]`              |
  | osoitekirjan nimet (jos valitset)                 | `[nimi]`              |

- **Viimeinen tarkistus:** jos lähtevässä tiedossa on yhä sähköpostiosoite, henkilötunnus tai kortin
  numero, mitään ei lähetetä.
- **Otsikossa voi silti olla muita henkilötietoja**, joita laajennus ei tunnista. Lähettäjät, joiden
  viestejä ei saa lähettää tekoälylle, lisätään *Säännöt → Älä koskaan lähetä AI:lle* -listaan.
- **Esikatselu:** asetussivun AI-osio näyttää tarkalleen, mitä viidestä uusimmasta viestistä lähtisi ja
  mitä niistä korvattiin.
- Otsikot ovat tekoälylle vain tietoa, eivät ohjeita. Vaikka otsikko yrittäisi ohjailla tekoälyä, pahin
  seuraus on väärä kansio.

### Ilmaiset sähköpostipalvelut

Ilmaisten palveluiden (esim. gmail.com) lähettäjistä kerrotaan vain `yksityishenkilö (gmail.com)`.
Listalla ovat yleisimmät kansainväliset palvelut. **Lisää listaan myös paikalliset palveluntarjoajat**
(esim. `posti.example`) asetussivun AI-osiossa.

### Osoitekirjan nimet

Valinta *Suojaa myös osoitekirjan nimet* lukee yhteystietojesi nimet ja korvaa ne merkinnällä `[nimi]`.
Thunderbird kysyy luvan vasta, kun kytket valinnan päälle. Nimiä ei tallenneta mihinkään. Kun kytket
valinnan pois, lupa poistetaan.

### API-avain

- Ilman salasanaa avain tallennetaan **salaamattomana** Thunderbirdin profiiliin tällä koneella.
- **Salasanasuojaus (suositus):** valitse *AI → Suojaa avain salasanalla*.
  - Avain salataan salasanalla (PBKDF2-SHA256, 600 000 kierrosta, AES-GCM). Salasanaa ei tallenneta.
  - Avain on lukossa jokaisen Thunderbirdin käynnistyksen jälkeen. Avaa se kerran popupin
    **Avaa tekoäly** -kentästä tai asetussivulta. Siihen asti lajittelu käyttää vain sääntöjä.
  - Avattu avain pidetään vain muistissa (`storage.session`). Se häviää, kun Thunderbird suljetaan.
  - Väärästä salasanasta tulee vain ilmoitus "Väärä salasana".
  - Voit vaihtaa salasanan tai poistaa suojauksen (molemmat vaativat nykyisen salasanan).
  - **Jos unohdat salasanan**, valitse *Poista avain* ja syötä avain uudelleen.
- Avain ei ole koskaan viennissä, lokissa eikä virheilmoituksissa. Asetussivulla näkyvät vain sen neljä
  viimeistä merkkiä.
- Käytä **rajattua avainta ja budjettirajaa** (ohje alla).

### Muuta

- **Vientitiedosto** sisältää omat sääntösi (osoitteita, domaineja, suojattavat nimet). Pidä se itselläsi,
  **älä laita sitä repoon**. `postituomari-export*.json` on `.gitignore`ssa.
- **Ei telemetriaa.** Ainoa yhteys ulos on `https://api.openai.com`, ja vain kun tekoäly on käytössä.
  Laajennuksen sisäinen suojaus (CSP) estää kaikki muut verkkoyhteydet.
- **Loki:** lisäosan konsoliin kirjoitetaan oletuksena vain määriä, kategorioita ja virheitä. Lähettäjät
  ja otsikot näkyvät vain, jos *Yksityiskohtainen loki (vianetsintään)* on päällä.

## Rajatun OpenAI-avaimen luonti

1. Kirjaudu osoitteeseen <https://platform.openai.com> ja tee laajennukselle oma projekti.
2. Aseta projektille budjettiraja projektin asetusten *Limits*-kohdassa (esim. muutama euro kuukaudessa).
3. Luo avain: *API keys → Create new secret key*, valitse projekti ja **Permissions: Restricted**.
4. Aseta ensin *Model capabilities* tilaan **Request**. Palauta sitten kaikki sen alla olevat oikeudet
   tilaan **None**, paitsi **Chat completions** (`/v1/chat/completions`), joka jää tilaan Request.
5. Liitä avain asetussivulle (*AI → API-avain*), paina **Testaa yhteys** ja suojaa avain salasanalla.

## Asennus

1. Rakenna paketti (ks. *Pakkaus*) tai käytä valmista `postituomari-<versio>.xpi`-tiedostoa.
2. Thunderbirdissä: **≡ → Lisäosat ja teemat → ratas (⚙) → Asenna lisäosa tiedostosta…** ja valitse
   `.xpi`-tiedosto.
3. Avaa asetukset (*Lisäosat ja teemat → PostiTuomari → Asetukset*), valitse tilit ja tarkista säännöt.
4. Kokeile ensin kuivaharjoituksena (*Lajittele nyt* popupista). Ota kuivaharjoitus pois vasta, kun
   lopputulos näyttää oikealta.

### Asennus Windowsissa (kun koodi on WSL:ssä)

1. Kopioi `.xpi` Windowsin puolelle, esim. Lataukset-kansioon. WSL:n tiedostot löytyvät
   Resurssienhallinnasta osoitteesta `\\wsl$\<jakelu>\home\<käyttäjä>\…`.
2. Asenna kopio: *Lisäosat ja teemat → ⚙ → Asenna lisäosa tiedostosta…*. **Asennus suoraan WSL-polusta
   voi jäädä väliaikaiseksi.**
3. Tarkista: *≡ → Työkalut → Kehittäjätyökalut → Lisäosien vianetsintä*. PostiTuomarin pitää näkyä
   kohdassa **Extensions**, ei **Temporary Extensions**.

### Päivitys uuteen versioon

1. Varmuuden vuoksi: *Asetukset → Tiedot → Vie JSON-tiedostoksi*.
2. Tee uusi paketti: `cd extension && npm run package`.
3. Asenna uusi `.xpi` vanhan päälle (*Asenna lisäosa tiedostosta…*). Vanhaa ei tarvitse poistaa.
4. Tarkista asetussivun yläreunasta, että asetukset ovat ennallaan.

Päivitys säilyttää kaiken: asetukset, säännöt, kategoriat, API-avaimen (myös salasanasuojatun) ja
muistit. Uudet asetukset saavat oletusarvon. Jos *Lajittele Thunderbirdin käynnistyessä* on päällä,
päivitys lajittelee kerran.

**Muutos versiossa 1.1:** lähettäjän nimeä ei enää lähetetä tekoälylle oletuksena. Jos haluat entisen
toiminnan, kytke *Lähetä lähettäjän nimi tekoälylle* päälle.

### Väliaikaisesta versiosta pysyvään

Väliaikaisen version tiedot katoavat, kun se poistetaan. Vie siis asetukset ensin, poista väliaikainen
versio, asenna `.xpi`, tuo vientitiedosto (*Tiedot → Tuonti*) ja syötä API-avain uudelleen.

### Työkalupalkin painike

Jos PostiTuomarin painiketta ei näy: napsauta työkalupalkkia hiiren oikealla, ota työkalupalkki
näkyviin ja valitse **Mukauta…**. Vedä PostiTuomari-painike työkalupalkkiin.

## Vianetsintä

Lisäosan konsoli: *≡ → Työkalut → Kehittäjätyökalut → Lisäosien vianetsintä → PostiTuomari →
Tarkastele (Inspect)*.

- **"Stopped" on normaalia.** Thunderbird pysäyttää laajennuksen taustaosan, kun sillä ei ole tekemistä,
  ja käynnistää sen uudelleen uuden postin, popupin tai asetussivun avautuessa.
- **Oikea sivu konsolissa:** konsolin yläreunan valikosta valitaan, mitä tarkastellaan: taustaosa
  (lajittelu, tekoäly, apuvälineet) vai asetussivu tai popup.
- **Yksityiskohtainen loki:** kytke *Yleiset → Yksityiskohtainen loki (vianetsintään)* päälle, niin näet
  jokaisen viestin lähettäjän, otsikon ja päätöksen. Kytke se pois, kun olet valmis.
- **Popupin virheet:** popup näyttää kaatuessaan virheilmoituksen. Avaa popup välilehteen:
  `await postiTuomari.openPopupInTab()`.
- **Verkkorajauksen testi:** taustaosan konsolissa
  `await fetch("https://example.com")` pitää epäonnistua (CSP-virhe), ja
  `(await fetch("https://api.openai.com/v1/models")).status` pitää palauttaa 401 (yhteys sallittu, avainta
  ei lähetetty).

Taustaosan konsolin apuvälineet:

```js
await postiTuomari.status()            // tila määrinä
await postiTuomari.keyStatus()         // API-avaimen tila (ei itse avainta)
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
npm run dev      # rakentaa extension/dist/:iin ja päivittää aina, kun koodi muuttuu
npm test         # yksikkötestit
npm run build    # kertarakennus
```

Kehitysversio Thunderbirdiin: *Lisäosien vianetsintä → Lataa väliaikainen lisäosa…* ja valitse
`extension/dist/manifest.json`.

### Rakenne

```
extension/
  public/manifest.json     manifest (oikeudet, CSP) ja kuvake
  src/background/          taustaosa: lajittelu, tekoäly, API-avaimen säilytys
  src/options/             asetussivu (React)
  src/popup/               työkalupalkin popup (React)
  src/shared/              yhteinen logiikka: säännöt, tallennus, tarkistukset,
                           henkilötietojen suojaus, salaus, tuplat
  scripts/                 build ja pakkaus
  test/                    yksikkötestit
```

Riippuvuudet on lukittu tarkkoihin versioihin. Ennen julkaisua: `npm audit` (tavoite 0 haavoittuvuutta).

## Pakkaus

```bash
cd extension
npm run package
```

Tekee repon juureen tiedoston `postituomari-<versio>.xpi` (gitignoressa).

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

`match` on `"any"` (oletus) tai `"all"`. Tuonti näyttää esikatselun ennen tallennusta. API-avain ei ole
koskaan mukana.
