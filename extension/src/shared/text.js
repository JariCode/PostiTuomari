// Merkkijonojen käsittely ilman regex-"siivouksia". Teksti renderöidään aina Reactilla
// (ei innerHTML:ää), joten nämä eivät ole XSS-suojaus vaan pelkkää muotoilua.

export const QUOTES_AND_SPACE = "\"' \t\r\n";

// Poistaa alusta ja lopusta kaikki annetut merkit
export function trimChars(value, chars) {
  const s = String(value ?? "");
  const set = new Set(chars);
  let start = 0;
  let end = s.length;
  while (start < end && set.has(s[start])) start++;
  while (end > start && set.has(s[end - 1])) end--;
  return s.slice(start, end);
}

// "Nimi <osoite>" → { name: "Nimi", email: "osoite" }. Ilman kulmasulkeita: name on koko teksti.
// Nimi on osa ennen ensimmäistä "<"-merkkiä, osoite kulmasulkeiden välissä.
export function splitAngle(author) {
  const s = String(author ?? "");
  const lt = s.indexOf("<");
  const gt = lt === -1 ? -1 : s.indexOf(">", lt + 1);
  if (lt === -1 || gt === -1) return { name: trimChars(s, QUOTES_AND_SPACE), email: "", bracketed: false };
  return {
    name: trimChars(s.slice(0, lt), QUOTES_AND_SPACE),
    email: s.slice(lt + 1, gt).trim(),
    bracketed: true,
  };
}
