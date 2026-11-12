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
   1. *Lähettäjä + otsikko*: lähettäjän JA otsikkosanan pitää osua (esim. sama lähettäjä lähettää
      laskuja ja uutiskirjeitä)
   2. *Otsikko etusijalla*: otsikkosana ratkaisee ennen lähettäjää (esim. tietoturva, laskut)
   3. *Osoite*: tarkka lähettäjäosoite
   4. *Domain*: lähettäjän domain, myös alidomainit
   5. *Otsikkosanat*
3. **AI** (jos käytössä): viestit, joihin mikään sääntö ei osu, luokitellaan OpenAI:lla. Jos AI ei osaa
   päättää, viesti jää Saapuneisiin eikä sitä kysytä uudelleen.
4. **Kansiot**: viestit siirretään kategorian nimiseen Saapuneiden alikansioon, joka luodaan tarvittaessa.

Popupin **Epävarmat**-listasta voit siirtää Saapuneisiin jääneen viestin itse ja luoda samalla säännön
lähettäjästä.

## Yksityisyys

- OpenAI:lle lähtee **vain lähettäjän nimi, domain ja otsikko**, esim.
  `{"id": "42", "from": "Verkkokauppa (kauppa.example)", "subject": "Tilausvahvistus"}`.
- **Sähköpostiosoitteita ei lähetetä.** Osoitteen paikallinen osa (ennen @-merkkiä) jätetään aina pois,
  otsikossa olevat osoitteet korvataan merkinnällä `[osoite]`, ja koko pyyntö tarkistetaan vielä ennen
  lähetystä: jos siinä on osoitteen näköinen merkkijono, pyyntöä ei lähetetä.
- Ilmaisten sähköpostipalveluiden (esim. gmail.com) lähettäjistä kerrotaan vain
  `yksityishenkilö (gmail.com)` ilman nimeä. Lista on muokattavissa.
- **Viestien sisältöä ei koskaan lähetetä.** Otsikossa voi silti olla henkilötietoja.
- Lähettäjät, joita ei koskaan lähetetä AI:lle, voi lisätä kieltolistaan.
- Asetussivun AI-osiossa näet täsmälleen sen JSONin, joka viimeisimmistä viesteistä lähtisi.
- Kaikki muu (säännöt, asetukset, muistit) jää koneelle Thunderbirdin `storage.local`-tallennukseen.
  Ainoa ulkoinen yhteys on `https://api.openai.com`.
- **API-avain** tallennetaan vain paikallisesti, salaamattomana Thunderbird-profiiliin. Se ei ole
  viennissä eikä lokeissa. Käytä rajattua avainta ja budjettirajaa (alla).

## Rajatun OpenAI-avaimen luonti

1. Kirjaudu osoitteeseen <https://platform.openai.com> ja luo laajennukselle oma projekti
   (*Projects → Create project*).
2. Aseta projektille budjettiraja: *Settings → Limits → Project budget* (esim. muutama euro kuukaudessa).
3. Luo avain: *API keys → Create new secret key*, valitse projekti ja **Permissions: Restricted**.
4. Aseta ensin *Model capabilities* -kohta tilaan **Request**. Palauta sitten kaikki muut sen alla olevat
   oikeudet tilaan **None**, paitsi **Chat completions** (`/v1/chat/completions`), joka jää tilaan
   Request. Muut oikeudet pysyvät tilassa None.
5. Kopioi avain ja liitä se PostiTuomarin asetussivulle (*AI → API-avain*). Paina **Testaa yhteys**.

Avaimen voi milloin tahansa poistaa asetussivulta tai mitätöidä OpenAI:n hallinnasta.

## Asennus

1. Rakenna paketti (ks. *Pakkaus*) tai käytä valmista `postituomari-<versio>.xpi`-tiedostoa.
2. Thunderbirdissä: **≡ → Lisäosat ja teemat → ratas (⚙) → Asenna lisäosa tiedostosta…** ja valitse
   `.xpi`-tiedosto. Laajennus käynnistyy jatkossa Thunderbirdin mukana.
3. Avaa asetukset (*Lisäosat → PostiTuomari → Asetukset*), valitse lajiteltavat tilit ja tarkista säännöt.
4. Kokeile ensin kuivaharjoituksena (*Lajittele nyt* popupista) ja ota se pois päältä vasta, kun
   lopputulos näyttää oikealta.

### Väliaikaisesta versiosta pysyvään

Väliaikaisen version tallennettu data poistuu, kun se poistetaan, joten:

1. Väliaikaisessa versiossa: *Asetukset → Tiedot → Vie JSON-tiedostoksi*.
2. Poista väliaikainen versio: *≡ → Työkalut → Kehittäjätyökalut → Lisäosien vianetsintä
   (Debug Add-ons) → PostiTuomari → Poista* (tai käynnistä Thunderbird uudelleen).
3. Asenna `.xpi` yllä olevan ohjeen mukaan.
4. Pysyvässä versiossa: *Asetukset → Tiedot → Tuonti* ja valitse vientitiedosto. Liitä API-avain
   uudelleen, koska se ei ole viennissä.

## Kehitys

Vaatii Node.js 20 tai uudemman.

```bash
cd extension
npm install
npm run dev      # rakentaa extension/dist/:iin ja päivittää aina, kun lähdekoodi muuttuu
npm test         # yksikkötestit (Noden oma testiajuri)
npm run build    # kertarakennus
```

Lataa kehitysversio Thunderbirdiin: *≡ → Työkalut → Kehittäjätyökalut → Lisäosien vianetsintä →
Lataa väliaikainen lisäosa…* ja valitse `extension/dist/manifest.json`. Muutosten jälkeen paina
*Lataa uudelleen*.

### Rakenne

```
extension/
  public/manifest.json     manifest ja kuvake (kopioidaan distiin sellaisenaan)
  src/background/          taustaskripti: lajittelu, AI-kutsut, tapahtumat (yksi IIFE-tiedosto)
  src/options/             asetussivu (React)
  src/popup/               työkalupalkin popup (React)
  src/shared/              yhteinen logiikka: luokittelu, tallennus, tarkistukset, anonymisointi
  scripts/                 build ja pakkaus
  test/                    yksikkötestit
```

### Vianetsintä

Avaa lisäosan konsoli: *Lisäosien vianetsintä → PostiTuomari → Tarkastele (Inspect)*. Konsolissa on
apuvälineitä, esim.:

```js
await postiTuomari.status()            // tila määrinä
await postiTuomari.sortNow()           // lajittele nyt
await postiTuomari.restoreFlagged({ preview: true })
await postiTuomari.missingDefaultRules()
await postiTuomari.openPopupInTab()    // popup omaan välilehteen, sen virheet näkyvät tässä konsolissa
```

Oikean popupin konsoli: valitse työkalujen ⋯-valikosta *Disable Popup Auto-Hide*, avaa popup ja valitse
kehysvalitsimesta `popup/index.html`.

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
  "categories": ["Raha", "Ostokset"],
  "rules": [
    { "category": "Ostokset", "match": "any", "domains": ["kauppa.example"] },
    { "category": "Raha", "match": "all", "domains": ["palvelu.example"], "subjectWords": ["lasku"] },
    { "category": "Perhe ja ystävät", "addresses": ["henkilo@example.com"] }
  ],
  "aiBlocklist": { "addresses": [], "domains": [] }
}
```

`match` on `"any"` (oletus) tai `"all"`. Tuonti näyttää esikatselun ennen tallennusta. API-avain ei ole
koskaan mukana.
