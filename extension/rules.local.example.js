// MALLIPOHJA. Kopioi tämä tiedostoksi rules.local.js ja täytä omilla tiedoilla.
// rules.local.js on .gitignoressa, joten se ei päädy GitHubiin.

// Vain nämä tilit lajitellaan (tilin nimi kuten Thunderbirdin kansiopuussa)
const LOCAL_SETTINGS = {
  accounts: ["oma.osoite@example.com"],
};

const LOCAL_RULES = [
  {
    category: "Perhe ja ystävät",
    addresses: ["henkilo@example.com"],
  },
  {
    category: "Raha",
    domains: ["pankki.example"],
  },
];