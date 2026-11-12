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
//   1. subjectFirst-säännöt → otsikko ratkaisee ennen lähettäjää
//   2. tarkka lähettäjäosoite (addresses)
//   3. lähettäjän domain, myös alidomainit (domains)
//   4. otsikon sanat (subjectWords)
export const DEFAULT_RULE_TEMPLATES = [
  {
    category: "Tilit ja tietoturva",
    subjectFirst: true,
    subjectWords: [
      "salasana", "password", "vahvistuskoodi", "verification code",
      "kirjautuminen", "sign-in", "new login", "ssh", "2fa",
      "security alert", "tietoturva",
    ],
  },
  {
    category: "Työnhaku",
    subjectWords: [
      "työhakemus", "hakemuksesi", "haastattelu", "rekrytoi",
      "job application", "your application", "työpaikka",
    ],
  },
  { category: "Opiskelu", subjectWords: ["kurssi", "opinnot"] },
  {
    category: "Terveys",
    subjectWords: ["ajanvaraus", "laboratorio", "resepti", "lääkäri", "hammaslääkäri"],
  },
  { category: "Viranomaiset", subjectWords: ["verotus", "verokortti", "veropäätös"] },
  // Ennen Rahaa, ettei "vakuutuslasku" osu ensin sanaan "lasku"
  { category: "Vakuutukset", subjectWords: ["vakuutus", "vahinkoilmoitus", "korvaushakemus"] },
  { category: "Raha", subjectWords: ["lasku", "eräpäivä", "maksumuistutus", "laina"] },
  {
    category: "Asuminen",
    subjectWords: ["asumisoikeus", "asuntonäyttö", "vuokra", "isännöitsijä", "sähkösopimus"],
  },
  { category: "Matkat", subjectWords: ["lentolippu", "matkavaraus", "flight", "booking confirmation"] },
  {
    category: "Ostokset",
    subjectWords: ["tilausvahvistus", "tilauksesi", "order confirmation", "kuitti", "receipt", "lähetys"],
  },
  { category: "Harrastukset", subjectWords: ["jäsenmaksu", "treenit", "kilpailu"] },
  // Alimpana, koska sanat ovat yleisiä
  {
    category: "Uutiskirjeet",
    subjectWords: ["uutiskirje", "newsletter", "tarjous", "kampanja", "alennus", "webinaari", "webinar"],
  },
];

// Lähettäjät, joiden viestejä ei koskaan lähetetä AI:lle
export const DEFAULT_AI_BLOCKLIST = { addresses: [], domains: [] };
