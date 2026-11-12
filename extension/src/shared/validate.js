// Syötteiden tarkistus ja normalisointi. Käytetään asetussivulla, tuonnissa ja
// taustaskriptissä, jotta storage.localissa on aina siistiä dataa.
import { UNSURE } from "./constants.js";
import { DEFAULT_SETTINGS } from "./defaults.js";
import { trimChars } from "./text.js";

export const LIMITS = {
  category: 50,
  categories: 30, // AI:n enum pysyy kohtuullisena
  address: 254,
  domain: 253,
  word: 100,
  listItems: 500,
  rules: 1000,
  model: 64,
  apiKey: 300,
};

const ADDRESS_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const MODEL_RE = /^[A-Za-z0-9._:-]+$/;
// Alkaa kirjaimella tai numerolla (ei "__proto__" tms.)
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function asString(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

// ===== Yksittäiset arvot: palauttavat siistityn arvon tai heittävät virheen =====

export function cleanCategory(value) {
  const name = asString(value).replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Kategorian nimi ei voi olla tyhjä");
  if (name.length > LIMITS.category) throw new Error(`Kategorian nimi on liian pitkä (max ${LIMITS.category})`);
  if (/[/\\]/.test(name)) throw new Error("Kategorian nimessä ei voi olla / tai \\ -merkkiä");
  // Kategoriat lähtevät AI:lle, eikä osoitetarkistus päästäisi @-merkillistä nimeä läpi
  if (name.includes("@")) throw new Error("Kategorian nimessä ei voi olla @-merkkiä");
  if (name.toLowerCase() === UNSURE.toLowerCase()) throw new Error(`"${UNSURE}" on varattu nimi`);
  return name;
}

export function cleanAddress(value) {
  let address = trimChars(asString(value).toLowerCase().replace(/\s+/g, ""), "<>");
  if (address.startsWith("mailto:")) address = address.slice("mailto:".length);
  // Lopullinen tarkistus on tiukka ADDRESS_RE, joten jäljelle ei voi jäädä kulmasulkeita tms.
  if (!address) throw new Error("Osoite ei voi olla tyhjä");
  if (address.length > LIMITS.address) throw new Error("Osoite on liian pitkä");
  if (!ADDRESS_RE.test(address)) throw new Error(`Virheellinen osoite: ${address}`);
  return address;
}

export function cleanDomain(value) {
  // "*.kauppa.example", "@kauppa.example" ja ".kauppa.example." → "kauppa.example"
  const domain = trimChars(asString(value).toLowerCase().replace(/\s+/g, ""), "*@.");
  if (!domain) throw new Error("Domain ei voi olla tyhjä");
  if (domain.length > LIMITS.domain) throw new Error("Domain on liian pitkä");
  if (!DOMAIN_RE.test(domain)) throw new Error(`Virheellinen domain: ${domain}`);
  return domain;
}

// Otsikkosanat verrataan pienillä kirjaimilla, joten tallennetaan pienillä
export function cleanWord(value) {
  const word = asString(value).replace(/\s+/g, " ").trim().toLowerCase();
  if (!word) throw new Error("Otsikkosana ei voi olla tyhjä");
  if (word.length > LIMITS.word) throw new Error(`Otsikkosana on liian pitkä (max ${LIMITS.word})`);
  return word;
}

// Suojattava nimi tai sana (korvataan AI:lle lähtevästä tekstistä merkinnällä [nimi])
export function cleanProtectedWord(value) {
  const word = asString(value).replace(/\s+/g, " ").trim();
  if (word.length < 2) throw new Error("Suojattavan nimen pitää olla vähintään 2 merkkiä");
  if (word.length > LIMITS.word) throw new Error(`Suojattava nimi on liian pitkä (max ${LIMITS.word})`);
  return word;
}

// Tekstikentän sisältö listaksi. Osoitteet ja domainit: erotin rivinvaihto, pilkku,
// puolipiste tai välilyönti. Otsikkosanat: vain rivinvaihto tai pilkku (sanassa voi olla välilyönti).
export function splitList(text, { allowSpaces = false } = {}) {
  const separator = allowSpaces ? /[\n,]+/ : /[\s,;]+/;
  return String(text ?? "")
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ===== Listat =====

// Siistii listan, poistaa tuplat. Virheelliset arvot jätetään pois ja kerätään errors-listaan.
export function cleanList(values, cleaner, label = "") {
  const result = [];
  const errors = [];
  let list = Array.isArray(values) ? values : values == null ? [] : [values];

  // Valtava lista rajataan ennen käsittelyä, ettei haitallinen tiedosto jumita sivua
  if (list.length > LIMITS.listItems) {
    errors.push(`${label || "Lista"}: liian monta arvoa (max ${LIMITS.listItems})`);
    list = list.slice(0, LIMITS.listItems);
  }

  for (const value of list) {
    try {
      const clean = cleaner(value);
      if (!result.includes(clean)) result.push(clean);
    } catch (err) {
      errors.push(label ? `${label}: ${err.message}` : err.message);
    }
  }

  return { values: result, errors };
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ===== Sääntö =====

// Palauttaa { rule, errors }. rule on null, jos sääntöä ei voi käyttää.
export function normalizeRule(raw) {
  const errors = [];
  let category = null;

  try {
    category = cleanCategory(raw?.category);
  } catch (err) {
    errors.push(err.message);
  }

  const addresses = cleanList(raw?.addresses, cleanAddress, "Osoitteet");
  const domains = cleanList(raw?.domains, cleanDomain, "Domainit");
  const subjectWords = cleanList(raw?.subjectWords, cleanWord, "Otsikkosanat");
  errors.push(...addresses.errors, ...domains.errors, ...subjectWords.errors);

  if (!category) return { rule: null, errors };

  // "any" = jokin ehto riittää (oletus, myös vanhoissa tiedostoissa ilman kenttää)
  // "all" = lähettäjän JA jonkin otsikkosanan pitää osua
  const match = raw?.match === "all" ? "all" : "any";

  const rule = {
    id: typeof raw?.id === "string" && ID_RE.test(raw.id) ? raw.id : newId(),
    category,
    match,
    // all-säännöt tarkistetaan aina ensin, joten etusija ei koske niitä
    subjectFirst: match === "any" && raw?.subjectFirst === true,
    addresses: addresses.values,
    domains: domains.values,
    subjectWords: subjectWords.values,
  };

  const hasSender = rule.addresses.length > 0 || rule.domains.length > 0;
  const hasWords = rule.subjectWords.length > 0;

  if (match === "all" && (!hasSender || !hasWords)) {
    errors.push(`Säännössä "${category}" pitää olla sekä lähettäjä (osoite tai domain) että otsikkosana`);
    return { rule: null, errors };
  }
  if (!hasSender && !hasWords) {
    errors.push(`Säännössä "${category}" ei ole yhtään osoitetta, domainia tai otsikkosanaa`);
    return { rule: null, errors };
  }
  return { rule, errors };
}

// Sääntölista: tuplat id:t uusitaan, virheelliset jätetään pois
export function normalizeRules(rawRules) {
  const rules = [];
  const errors = [];
  const ids = new Set();
  const list = Array.isArray(rawRules) ? rawRules : [];
  if (list.length > LIMITS.rules) errors.push(`Liian monta sääntöä (max ${LIMITS.rules}), loput jätettiin pois`);

  list.slice(0, LIMITS.rules).forEach((raw, index) => {
    const { rule, errors: ruleErrors } = normalizeRule(raw);
    errors.push(...ruleErrors.map((e) => `Sääntö ${index + 1}: ${e}`));
    if (!rule) return;
    if (ids.has(rule.id)) rule.id = newId();
    ids.add(rule.id);
    rules.push(rule);
  });

  return { rules, errors };
}

// ===== Kategoriat =====

export function normalizeCategories(rawCategories) {
  const { values, errors } = cleanList(rawCategories, cleanCategory, "Kategoriat");
  // Samannimiset eri kirjainkoolla ovat sama kansio
  const seen = new Set();
  const categories = values.filter((c) => {
    const key = c.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (categories.length > LIMITS.categories) {
    errors.push(`Liian monta kategoriaa (max ${LIMITS.categories})`);
    categories.length = LIMITS.categories;
  }
  return { categories, errors };
}

// ===== AI-kieltolista =====

export function normalizeBlocklist(raw) {
  const addresses = cleanList(raw?.addresses, cleanAddress, "Kieltolistan osoitteet");
  const domains = cleanList(raw?.domains, cleanDomain, "Kieltolistan domainit");
  return {
    blocklist: { addresses: addresses.values, domains: domains.values },
    errors: [...addresses.errors, ...domains.errors],
  };
}

// ===== Asetukset =====

// Yhdistää tallennetut asetukset oletuksiin ja hylkää väärän tyyppiset arvot
export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS };
  const errors = [];
  // Vain tunnetut kentät luetaan; muut (myös __proto__ ja constructor) ohitetaan
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  for (const key of ["dryRun", "sortOnStartup", "sortNewMail", "verboseLog", "aiEnabled", "sendSenderName", "protectAddressBook"]) {
    if (typeof raw[key] === "boolean") s[key] = raw[key];
  }

  if (raw.model !== undefined) {
    const model = asString(raw.model).trim();
    if (model && model.length <= LIMITS.model && MODEL_RE.test(model)) s.model = model;
    else errors.push("Virheellinen mallin nimi");
  }

  if (raw.apiKey !== undefined) {
    const key = asString(raw.apiKey).trim();
    if (key.length <= LIMITS.apiKey && !/\s/.test(key)) s.apiKey = key;
    else errors.push("Virheellinen API-avain");
  }

  if (Array.isArray(raw.accountIds)) {
    s.accountIds = [
      ...new Set(raw.accountIds.slice(0, 100).filter((id) => typeof id === "string" && id.length > 0 && id.length <= 100)),
    ];
  }

  if (raw.protectedWords !== undefined) {
    const words = cleanList(raw.protectedWords, cleanProtectedWord, "Suojattavat nimet");
    s.protectedWords = words.values;
    errors.push(...words.errors);
  }

  if (raw.freemailDomains !== undefined) {
    const freemail = cleanList(raw.freemailDomains, cleanDomain, "Ilmaiset palvelut");
    s.freemailDomains = freemail.values;
    errors.push(...freemail.errors);
  }

  return { settings: s, errors };
}
