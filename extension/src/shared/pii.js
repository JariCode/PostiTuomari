// Henkilötietojen tunnistus ja korvaus ennen AI-kutsua.
//   henkilötunnus → [hetu], puhelinnumero → [puhelin], tilinumero (IBAN) → [tilinumero],
//   korttinumero (Luhn) → [kortti], rekisterinumero → [rekisteri], suojattavat nimet → [nimi]
// Mieluummin liikaa kuin liian vähän: väärä osuma vain heikentää luokittelua hieman.

export const PII_TOKENS = {
  hetu: "[hetu]",
  phone: "[puhelin]",
  iban: "[tilinumero]",
  card: "[kortti]",
  plate: "[rekisteri]",
  name: "[nimi]",
};

export const PII_LABELS = {
  email: "sähköposti",
  hetu: "henkilötunnus",
  phone: "puhelin",
  iban: "tilinumero",
  card: "kortti",
  plate: "rekisteri",
  name: "nimi",
};

// Rajat: ei kirjain/numero vieressä (toimii myös ä/ö-merkeillä)
const NB = String.raw`(?<![\p{L}\p{N}])`;
const NA = String.raw`(?![\p{L}\p{N}])`;

// Henkilötunnus: PPKKVV + vuosisatamerkki (+ - A–F U–Y) + 3 numeroa + tarkiste
const HETU_SOURCE = String.raw`${NB}(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}[-+A-FU-Y]\d{3}[0-9ABCDEFHJKLMNPRSTUVWXY]${NA}`;

// Puhelin: +358 / 00358 tai kotimainen 04x / 050, välilyönnit ja viivat sallittu
const PHONE_SOURCE = [
  String.raw`(?<![\p{N}+])(?:\+|00)358[\s-]?(?:\(0\)[\s-]?)?\d(?:[\s-]?\d){5,10}(?!\p{N})`,
  String.raw`(?<!\p{N})0(?:4\d|50)(?:[\s-]?\d){5,8}(?!\p{N})`,
].join("|");

// IBAN-ehdokas: maakoodi + 2 numeroa + 11–30 merkkiä (välilyönnit sallittu)
const IBAN_SOURCE = String.raw`(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}(?![A-Za-z0-9])`;
// Suomalainen tilinumero aina, myös ilman kelvollista tarkistetta
const FI_IBAN_SOURCE = String.raw`(?<![A-Za-z0-9])FI ?\d{2}(?: ?\d){14}(?!\d)`;

// Kortti: 13–19 numeroa, välilyönnit tai viivat sallittu; korvataan vain jos Luhn täsmää
const CARD_SOURCE = String.raw`(?<!\p{N})\d(?:[ -]?\d){12,18}(?!\p{N})`;

// Rekisterinumero: 2–3 isoa kirjainta, viiva, 1–3 numeroa (ABC-123)
const PLATE_SOURCE = String.raw`(?<![\p{L}\p{N}-])[A-ZÅÄÖ]{2,3}-\d{1,3}(?![\p{L}\p{N}-])`;

// ===== Tarkisteet =====

export function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

export function ibanValid(compact) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

// Pisin kelvollinen IBAN ehdokkaan alusta (ehdokas voi jatkua seuraavaan sanaan).
// Palauttaa alkuperäisen merkkijonon pituuden (välilyönteineen) tai 0.
function validIbanPrefixLength(candidate) {
  let compact = "";
  let best = 0;
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] === " ") continue;
    compact += candidate[i];
    if (compact.length >= 15 && ibanValid(compact)) best = i + 1;
  }
  return best;
}

// ===== Korvaus =====

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Nimilistasta yksi regex (pisimmät ensin, koko sana, kirjainkoko ei merkitse)
export function buildNameMatcher(names = []) {
  const clean = [...new Set(names.map((n) => String(n ?? "").trim()).filter((n) => n.length >= 2 && n.length <= 100))];
  if (!clean.length) return null;
  clean.sort((a, b) => b.length - a.length);
  return new RegExp(`${NB}(?:${clean.map(escapeRegex).join("|")})${NA}`, "giu");
}

// Korvaa henkilötiedot tekstistä. Palauttaa { text, counts }.
// nameMatcher: buildNameMatcher(...)-tulos tai null.
export function redactPersonalData(input, nameMatcher = null) {
  const counts = {};
  const bump = (type) => (counts[type] = (counts[type] ?? 0) + 1);
  let text = String(input ?? "");

  text = text.replace(new RegExp(HETU_SOURCE, "giu"), () => (bump("hetu"), PII_TOKENS.hetu));

  text = text.replace(new RegExp(FI_IBAN_SOURCE, "gi"), () => (bump("iban"), PII_TOKENS.iban));
  text = text.replace(new RegExp(IBAN_SOURCE, "g"), (candidate) => {
    const length = validIbanPrefixLength(candidate);
    if (!length) return candidate;
    bump("iban");
    return PII_TOKENS.iban + candidate.slice(length);
  });

  text = text.replace(new RegExp(CARD_SOURCE, "gu"), (candidate) => {
    const digits = candidate.replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return candidate;
    bump("card");
    return PII_TOKENS.card;
  });

  text = text.replace(new RegExp(PHONE_SOURCE, "gu"), () => (bump("phone"), PII_TOKENS.phone));
  text = text.replace(new RegExp(PLATE_SOURCE, "gu"), () => (bump("plate"), PII_TOKENS.plate));

  if (nameMatcher) {
    nameMatcher.lastIndex = 0;
    text = text.replace(nameMatcher, () => (bump("name"), PII_TOKENS.name));
  }

  return { text, counts };
}

// Viimeinen tarkistus: estetään kutsu, jos henkilötunnus tai korttinumero on yhä mukana
export function containsHetuOrCard(text) {
  const s = String(text ?? "");
  if (new RegExp(HETU_SOURCE, "iu").test(s)) return true;
  for (const m of s.match(new RegExp(CARD_SOURCE, "gu")) ?? []) {
    const digits = m.replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}

// Nimistä suojattavat osat: koko nimi ja yli 2-kirjaimiset osat
export function nameParts(fullName) {
  const name = String(fullName ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.includes("@")) return [];
  const parts = name.split(/[\s,]+/).filter((p) => p.length >= 3 && !/^\d+$/.test(p));
  return [...new Set([name, ...parts])];
}
