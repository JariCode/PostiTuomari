// Tietosuoja: mitä AI:lle saa lähteä.
// AI:lle ei koskaan lähetetä sähköpostiosoitetta eikä viestin sisältöä.
// Lähettäjästä kerrotaan vain näyttönimi ja domain, otsikosta osoitteet korvataan.
import { domainMatches } from "./classify.js";

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
  const s = String(author ?? "").trim();

  const bracketed = s.match(/^(.*?)\s*<([^<>]*)>\s*$/);
  if (bracketed) return { name: bracketed[1], email: bracketed[2].trim() };

  const found = s.match(new RegExp(EMAIL_SOURCE, "u"));
  if (found) return { name: s.replace(found[0], ""), email: found[0] };

  return { name: s, email: "" };
}

function cleanName(raw) {
  const name = String(raw ?? "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Nimi, joka on itse osoite tai sisältää @-merkin, jätetään kokonaan pois
  if (!name || name.includes("@")) return "";
  return redactEmails(name).slice(0, MAX_NAME).trim();
}

function cleanDomain(email) {
  const at = email.lastIndexOf("@");
  if (at === -1) return "";
  return email.slice(at + 1).toLowerCase().replace(/[^a-z0-9.-]/g, "").replace(/^\.+|\.+$/g, "");
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
