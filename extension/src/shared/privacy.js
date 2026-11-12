// Tietosuoja: mitä AI:lle saa lähteä.
// AI:lle ei koskaan lähetetä sähköpostiosoitetta eikä viestin sisältöä.
// Lähettäjästä kerrotaan vain näyttönimi ja domain, otsikosta osoitteet korvataan.
import { domainMatches } from "./classify.js";
import { QUOTES_AND_SPACE, splitAngle, trimChars } from "./text.js";
import { buildNameMatcher, redactPersonalData } from "./pii.js";

export const ADDRESS_PLACEHOLDER = "[osoite]";
export const MAX_FROM = 300;
export const MAX_SUBJECT = 500;
const MAX_NAME = 100;

// Väljä tunnistus: kaikki "jotain@jotain.pääte" -muotoiset merkkijonot,
// myös ei-ASCII-merkit. Mieluummin liikaa kuin liian vähän.
const EMAIL_SOURCE = String.raw`[^\s@<>"'(),;:\[\]]+@[^\s@<>"'(),;:\[\]]+\.[^\s@<>"'(),;:\[\]]{2,}`;

export function redactEmails(text) {
  return String(text ?? "").replace(new RegExp(EMAIL_SOURCE, "gu"), ADDRESS_PLACEHOLDER);
}

export function containsEmail(text) {
  return new RegExp(EMAIL_SOURCE, "u").test(String(text ?? ""));
}

// Erottaa näyttönimen ja osoitteen: "Nimi <osoite>", pelkkä osoite tai pelkkä nimi
function splitAuthor(author) {
  const angle = splitAngle(author);
  if (angle.bracketed) return { name: angle.name, email: angle.email };

  // Ei kulmasulkeita: etsitään osoite tekstistä ja loput on nimi
  const s = String(author ?? "").trim();
  const found = new RegExp(EMAIL_SOURCE, "u").exec(s);
  if (found) return { name: s.slice(0, found.index) + s.slice(found.index + found[0].length), email: found[0] };

  return { name: s, email: "" };
}

function cleanName(raw) {
  const name = trimChars(raw, QUOTES_AND_SPACE).replace(/\s+/g, " ");
  // Nimi, joka on itse osoite tai sisältää @-merkin, jätetään kokonaan pois
  if (!name || name.includes("@")) return "";
  return redactEmails(name).slice(0, MAX_NAME).trim();
}

function cleanDomain(email) {
  const at = email.lastIndexOf("@");
  if (at === -1) return "";
  // Sallitut merkit (a–z, 0–9, piste, viiva) ja reunojen pisteet pois
  return trimChars(email.slice(at + 1).toLowerCase().replace(/[^a-z0-9.-]/g, ""), ".");
}

// Osoitteet → [osoite], määrä laskuriin
function redactEmailsCounted(text, counts) {
  return String(text ?? "").replace(new RegExp(EMAIL_SOURCE, "gu"), () => {
    counts.email = (counts.email ?? 0) + 1;
    return ADDRESS_PLACEHOLDER;
  });
}

// Osoitteet, henkilötiedot ja suojatut nimet pois tekstistä
function redactAll(text, nameMatcher, counts) {
  const { text: clean, counts: found } = redactPersonalData(redactEmailsCounted(text, counts), nameMatcher);
  for (const [k, n] of Object.entries(found)) counts[k] = (counts[k] ?? 0) + n;
  return clean;
}

// Asetukset → anonymisoinnin valinnat
//   freemailDomains: ilmaisten palveluiden domainit
//   sendSenderName: lähetetäänkö lähettäjän nimi (oletus ei: vain verkkotunnus)
//   nameMatcher: suojattavat nimet (buildNameMatcher)
export function privacyOptions(settings, protectedNames = []) {
  return {
    freemailDomains: settings?.freemailDomains ?? [],
    sendSenderName: settings?.sendSenderName === true,
    nameMatcher: buildNameMatcher(protectedNames),
  };
}

// Lähettäjä AI:lle: oletuksena vain verkkotunnus. Kun nimen lähetys on päällä: "Näyttönimi (domain)".
// Ilmaisen palvelun lähettäjä on aina "yksityishenkilö (domain)".
// Osoitteen paikallista osaa (ennen @-merkkiä) ei palauteta koskaan.
export function toAiSenderDetailed(author, options = {}) {
  const { freemailDomains = [], sendSenderName = false, nameMatcher = null } = options;
  const counts = {};
  const { name: rawName, email } = splitAuthor(author);
  const domain = cleanDomain(email);

  if (domain && freemailDomains.some((d) => domainMatches(domain, d))) {
    return { from: `yksityishenkilö (${domain})`, counts };
  }
  if (!sendSenderName) return { from: domain || "tuntematon", counts };

  const name = cleanName(rawName);
  const safeName = name ? redactAll(name, nameMatcher, counts) : "";
  let result;
  if (safeName && domain) result = `${safeName} (${domain})`;
  else if (domain) result = domain;
  else if (safeName) result = safeName;
  else result = "tuntematon";

  return { from: redactEmails(result).slice(0, MAX_FROM), counts };
}

export function toAiSender(author, options = {}) {
  return toAiSenderDetailed(author, options).from;
}

// Yksi viesti siinä muodossa, jossa se lähtisi AI:lle, ja tehdyt korvaukset (esikatselua varten)
export function toAiMessageDetailed(msg, options = {}) {
  const sender = toAiSenderDetailed(msg.author, options);
  const counts = { ...sender.counts };
  const subject = redactAll(msg.subject ?? "", options.nameMatcher ?? null, counts).slice(0, MAX_SUBJECT);
  return { message: { id: String(msg.id), from: sender.from, subject }, counts };
}

export function toAiMessage(msg, options = {}) {
  return toAiMessageDetailed(msg, options).message;
}
