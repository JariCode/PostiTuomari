// Yleiset lajittelusäännöt – vain kategoriat ja yleiset otsikkosanat.
// Lähettäjät ja domainit kuuluvat tiedostoon rules.local.js (ei Gitissä).
//
// Järjestys:
//   1. Säännöt, joissa subjectFirst: true → otsikko ratkaisee ennen lähettäjää
//   2. Tarkka lähettäjäosoite (addresses)
//   3. Lähettäjän domain (myös alidomainit)
//   4. Otsikon sanat
// Omat säännöt tarkistetaan jokaisessa vaiheessa ennen näitä.
const RULES = [
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
  {
    category: "Opiskelu",
    subjectWords: ["kurssi", "opinnot"],
  },
  {
    category: "Terveys",
    subjectWords: ["ajanvaraus", "laboratorio", "resepti", "lääkäri", "hammaslääkäri"],
  },
  {
    category: "Viranomaiset",
    subjectWords: ["verotus", "verokortti", "veropäätös"],
  },
  {
    category: "Raha",
    subjectWords: ["lasku", "eräpäivä", "maksumuistutus", "laina"],
  },
  {
    category: "Asuminen",
    subjectWords: ["asumisoikeus", "asuntonäyttö", "vuokra", "isännöitsijä", "sähkösopimus"],
  },
  {
    category: "Matkat",
    subjectWords: ["lentolippu", "matkavaraus", "flight", "booking confirmation"],
  },
  {
    category: "Ostokset",
    subjectWords: ["tilausvahvistus", "tilauksesi", "order confirmation", "kuitti", "receipt", "lähetys"],
  },
  {
    category: "Harrastukset",
    subjectWords: ["jäsenmaksu", "treenit", "kilpailu"],
  },
  {
    // Alimpana, koska sanat ovat yleisiä
    category: "Uutiskirjeet",
    subjectWords: ["uutiskirje", "newsletter", "tarjous", "kampanja", "alennus", "webinaari", "webinar"],
  },
];