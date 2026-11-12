// Tietosuoja: mitä AI:lle saa lähteä.
// AI:lle ei koskaan lähetetä sähköpostiosoitetta eikä viestin sisältöä.
// Lähettäjästä kerrotaan vain näyttönimi ja domain, otsikosta osoitteet korvataan.
import { domainMatches } from "./classify.js";
import { QUOTES_AND_SPACE, splitAngle, trimChars } from "./text.js";

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

// Lähettäjä AI:lle muodossa "Näyttönimi (domain)" tai "yksityishenkilö (domain)".
// Osoitteen paikallista osaa (ennen @-merkkiä) ei palauteta koskaan.
export function toAiSender(author, freemailDomains = []) {
  const { name: rawName, email } = splitAuthor(author);
  const domain = cleanDomain(email);

  if (domain && freemailDomains.some((d) => domainMatches(domain, d))) {
    return `yksityishenkilö (${domain})`;
  }

  const name = cleanName(rawName);
  let result;
  if (name && domain) result = `${name} (${domain})`;
  else if (domain) result = domain;
  else if (name) result = name;
  else result = "tuntematon";

  return redactEmails(result).slice(0, MAX_FROM);
}

// Yksi viesti siinä muodossa, jossa se lähtisi AI:lle
export function toAiMessage(msg, freemailDomains = []) {
  return {
    id: String(msg.id),
    from: toAiSender(msg.author, freemailDomains),
    subject: redactEmails(msg.subject ?? "").slice(0, MAX_SUBJECT),
  };
}
