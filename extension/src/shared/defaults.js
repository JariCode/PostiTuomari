// Oletusasetukset ja -säännöt ensiasennukseen.
// Vain yleisiä kategorioita ja otsikkosanoja – ei lähettäjiä, domaineja tai brändejä.

// Yleiset ilmaiset sähköpostipalvelut: näiden lähettäjät ovat yksityishenkilöitä,
// joten AI:lle kerrotaan vain "yksityishenkilö (<domain>)" ilman nimeä.
export const DEFAULT_FREEMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "protonmail.com",
  "proton.me",
];

export const DEFAULT_SETTINGS = {
  dryRun: true,
  sortOnStartup: true,
  sortNewMail: true,
  verboseLog: false, // true = lokiin myös lähettäjät ja otsikot (vianetsintään)
  aiEnabled: false,
  model: "gpt-4.1-mini",
  apiKey: "",
  accountIds: [], // oletuksena yhtään tiliä ei lajitella
  freemailDomains: DEFAULT_FREEMAIL_DOMAINS,
};

// Kategorioiden järjestys asetussivulla ja AI:n vaihtoehdoissa
export const DEFAULT_CATEGORIES = [
  "Tilit ja tietoturva",
  "Työ",
  "Työnhaku",
  "Kehitys",
  "Opiskelu",
  "Perhe ja ystävät",
  "Terveys",
  "Viranomaiset",
  "Vakuutukset",
  "Raha",
  "Asuminen",
  "Matkat",
  "Ostokset",
  "Harrastukset",
  "Uutiskirjeet",
];

// Sääntöjen järjestys merkitsee: ensimmäinen osuva sääntö voittaa kussakin vaiheessa.
//   0. match: "all" → lähettäjän JA otsikkosanan pitää osua (tarkistetaan ensin)
//   1. subjectFirst-säännöt → otsikko ratkaisee ennen lähettäjää
//   2. tarkka lähettäjäosoite (addresses)
//   3. lähettäjän domain, myös alidomainit (domains)
//   4. otsikon sanat (subjectWords)
// Kiinteät id:t, jotta yksittäisen oletussäännön voi lisätä myöhemmin (addDefaultRule).
export const DEFAULT_RULE_TEMPLATES = [
  {
    id: "default-tietoturva",
    category: "Tilit ja tietoturva",
    subjectFirst: true,
    subjectWords: [
      "salasana", "password", "vahvistuskoodi", "verification code",
      "kirjautuminen", "sign-in", "new login", "ssh", "2fa",
      "security alert", "tietoturva",
    ],
  },
  {
    // Ennen laskusääntöä: "vakuutuslasku" ja "Lasku: kotivakuutus" menevät Vakuutuksiin
    id: "default-vakuutukset",
    category: "Vakuutukset",
    subjectFirst: true,
    subjectWords: ["vakuutus", "vahinkoilmoitus", "korvaushakemus"],
  },
  {
    // Laskut ratkaisevat ennen lähettäjää: kaupan tai palvelun lasku menee Rahaan, ei lähettäjän kategoriaan
    id: "default-raha-laskut",
    category: "Raha",
    subjectFirst: true,
    subjectWords: ["lasku", "eräpäivä", "maksumuistutus"],
  },
  {
    id: "default-tyonhaku",
    category: "Työnhaku",
    subjectWords: [
      "työhakemus", "hakemuksesi", "haastattelu", "rekrytoi",
      "job application", "your application", "työpaikka",
    ],
  },
  { id: "default-opiskelu", category: "Opiskelu", subjectWords: ["kurssi", "opinnot"] },
  {
    id: "default-terveys",
    category: "Terveys",
    subjectWords: ["ajanvaraus", "laboratorio", "resepti", "lääkäri", "hammaslääkäri"],
  },
  { id: "default-viranomaiset", category: "Viranomaiset", subjectWords: ["verotus", "verokortti", "veropäätös"] },
  { id: "default-raha", category: "Raha", subjectWords: ["laina"] },
  {
    id: "default-asuminen",
    category: "Asuminen",
    subjectWords: ["asumisoikeus", "asuntonäyttö", "vuokra", "isännöitsijä", "sähkösopimus"],
  },
  {
    id: "default-matkat",
    category: "Matkat",
    subjectWords: ["lentolippu", "matkavaraus", "flight", "booking confirmation"],
  },
  {
    id: "default-ostokset",
    category: "Ostokset",
    subjectWords: ["tilausvahvistus", "tilauksesi", "order confirmation", "kuitti", "receipt", "lähetys"],
  },
  { id: "default-harrastukset", category: "Harrastukset", subjectWords: ["jäsenmaksu", "treenit", "kilpailu"] },
  // Alimpana, koska sanat ovat yleisiä
  {
    id: "default-uutiskirjeet",
    category: "Uutiskirjeet",
    subjectWords: ["uutiskirje", "newsletter", "tarjous", "kampanja", "alennus", "webinaari", "webinar"],
  },
];

// Lähettäjät, joiden viestejä ei koskaan lähetetä AI:lle
export const DEFAULT_AI_BLOCKLIST = { addresses: [], domains: [] };
