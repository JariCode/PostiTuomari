// Muistit (manualMoves, aiUnsure): headerMessageId → merkintä.
// headerMessageId tulee viestin otsakkeesta, eli lähettäjä voi valita sen (esim. "__proto__"),
// joten avaimet asetetaan aina omina ominaisuuksina eikä tavallisella sijoituksella.

export const MAX_MEMORY_ENTRIES = 5000;

// Merkinnän aikaleima. Vanhat manualMoves-merkinnät olivat pelkkä polku → aikaleima 0 (vanhin).
export function entryTime(value) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && typeof value.at === "number") return value.at;
  return 0;
}

export function hasEntry(memory, key) {
  return Boolean(key) && Object.hasOwn(memory, key);
}

export function setEntry(memory, key, value) {
  if (!key) return;
  Object.defineProperty(memory, key, { value, enumerable: true, writable: true, configurable: true });
}

// Pitää enintään max uusinta merkintää. Palauttaa uuden olion.
export function pruneMemory(memory, max = MAX_MEMORY_ENTRIES) {
  const entries = Object.entries(memory ?? {});
  const result = {};
  if (entries.length <= max) {
    for (const [k, v] of entries) setEntry(result, k, v);
    return result;
  }
  entries.sort((a, b) => entryTime(b[1]) - entryTime(a[1]));
  for (const [k, v] of entries.slice(0, max)) setEntry(result, k, v);
  return result;
}
