// storage.local: asetukset, kategoriat, säännöt ja muistit.
//
//   settings     – ks. DEFAULT_SETTINGS
//   categories   – kategorioiden järjestetty lista
//   rules        – [{ id, category, match, subjectFirst, addresses, domains, subjectWords }], järjestys merkitsee
//   aiBlocklist  – { addresses, domains }: näitä lähettäjiä ei koskaan lähetetä AI:lle
//   manualMoves  – headerMessageId → kansion polku, johon käyttäjä viestin siirsi
//   aiUnsure     – headerMessageId → aikaleima: AI ei osannut päättää, ei kysytä uudelleen
import { DEFAULT_AI_BLOCKLIST, DEFAULT_CATEGORIES, DEFAULT_RULE_TEMPLATES } from "./defaults.js";
import { analyzeDuplicates, sameContent } from "./duplicates.js";
import { cleanCategory, normalizeBlocklist, normalizeCategories, normalizeRules, normalizeSettings } from "./validate.js";

export const SCHEMA_VERSION = 1;

export function api() {
  return globalThis.messenger ?? globalThis.browser;
}

export function createDefaultRules() {
  return normalizeRules(DEFAULT_RULE_TEMPLATES).rules;
}

// Ensiasennus ja päivitys: täydentää puuttuvat avaimet, ei koske olemassa oleviin
export async function ensureDefaults() {
  const local = api().storage.local;
  const current = await local.get(["schemaVersion", "settings", "categories", "rules", "aiBlocklist", "manualMoves", "aiUnsure"]);
  const missing = {};

  if (current.settings === undefined) missing.settings = normalizeSettings({}).settings;
  else missing.settings = normalizeSettings(current.settings).settings; // uudet asetuskentät oletusarvoilla

  if (current.categories === undefined) missing.categories = [...DEFAULT_CATEGORIES];
  if (current.rules === undefined) missing.rules = createDefaultRules();
  if (current.aiBlocklist === undefined) missing.aiBlocklist = { ...DEFAULT_AI_BLOCKLIST };
  if (current.manualMoves === undefined) missing.manualMoves = {};
  if (current.aiUnsure === undefined) missing.aiUnsure = {};
  if (current.schemaVersion !== SCHEMA_VERSION) missing.schemaVersion = SCHEMA_VERSION;

  const firstInstall = current.settings === undefined;
  await local.set(missing);
  return { firstInstall };
}

// Lukee lajittelun tarvitseman tilan siistittynä
export async function loadState() {
  const data = await api().storage.local.get(["settings", "categories", "rules", "aiBlocklist"]);
  return {
    settings: normalizeSettings(data.settings ?? {}).settings,
    categories: normalizeCategories(data.categories ?? DEFAULT_CATEGORIES).categories,
    rules: normalizeRules(data.rules ?? []).rules,
    aiBlocklist: normalizeBlocklist(data.aiBlocklist ?? DEFAULT_AI_BLOCKLIST).blocklist,
  };
}

export async function saveSettings(patch) {
  const { settings: current } = await loadState();
  const { settings, errors } = normalizeSettings({ ...current, ...patch });
  if (errors.length) throw new Error(errors.join("\n"));
  await api().storage.local.set({ settings });
  return settings;
}

export async function saveCategories(rawCategories) {
  const { categories, errors } = normalizeCategories(rawCategories);
  if (errors.length) throw new Error(errors.join("\n"));
  await api().storage.local.set({ categories });
  return categories;
}

export async function saveRules(rawRules) {
  const { rules, errors } = normalizeRules(rawRules);
  if (errors.length) throw new Error(errors.join("\n"));
  await api().storage.local.set({ rules });
  return rules;
}

export async function saveBlocklist(raw) {
  const { blocklist, errors } = normalizeBlocklist(raw);
  if (errors.length) throw new Error(errors.join("\n"));
  await api().storage.local.set({ aiBlocklist: blocklist });
  return blocklist;
}

// ===== Oletussäännöt =====

// Kattaako olemassa oleva sääntö r oletussäännön d: sama id, tai sama kategoria, osumatapa ja
// etusija ja kaikki d:n arvot ovat r:ssä (tuodut säännöt saavat uudet id:t).
function covers(r, d) {
  if (r.id === d.id) return true;
  if (r.category !== d.category || r.match !== d.match || r.subjectFirst !== d.subjectFirst) return false;
  return ["addresses", "domains", "subjectWords"].every((f) => d[f].every((v) => r[f].includes(v)));
}

// Oletussäännöt, joita ei vielä ole käytössä.
// upgrade: true = sama sääntö on jo olemassa ilman etusijaa (tai etusijalla) ja se korvataan.
export async function missingDefaultRules() {
  const { rules } = await loadState();
  return createDefaultRules()
    .filter((d) => !rules.some((r) => covers(r, d)))
    .map((d) => ({ ...d, upgrade: rules.some((r) => sameContent(r, d)) }));
}

// Lisää yhden oletussäännön olemassa oleviin sääntöihin.
// - Jos sama sääntö on jo olemassa eri etusijalla, se korvataan (ei tuplaa).
// - Sijainti oletusjärjestyksen mukaan: ennen seuraavaa samaan vaiheeseen kuuluvaa oletussääntöä,
//   joka on jo käytössä (esim. Vakuutukset ennen laskusääntöä). Muuten etusijasääntö viimeisen
//   etusijasäännön perään ja muut loppuun.
// - Lopuksi poistetaan tuplat ja päällekkäiset arvot (lopputulos lajittelussa ei muutu).
export async function addDefaultRule(id) {
  const defaults = createDefaultRules();
  const index = defaults.findIndex((r) => r.id === id);
  if (index === -1) throw new Error(`Tuntematon oletussääntö: ${id}`);
  const rule = defaults[index];

  const { rules, categories } = await loadState();
  if (rules.some((r) => covers(r, rule))) return { added: false, upgraded: false, rules: rules.length, removedRules: 0, removedValues: 0 };

  const upgraded = rules.some((r) => sameContent(r, rule));
  const next = rules.filter((r) => !sameContent(r, rule));
  let position = -1;
  for (const later of defaults.slice(index + 1).filter((d) => d.subjectFirst === rule.subjectFirst)) {
    position = next.findIndex((r) => covers(r, later));
    if (position !== -1) break;
  }

  if (position !== -1) {
    next.splice(position, 0, rule);
  } else if (rule.subjectFirst) {
    const lastFirst = next.reduce((acc, r, i) => (r.subjectFirst ? i : acc), -1);
    next.splice(lastFirst + 1, 0, rule);
  } else {
    next.push(rule);
  }

  const cleanup = analyzeDuplicates(next);
  const update = { rules: cleanup.rules };
  if (!categories.includes(rule.category)) update.categories = [...categories, rule.category];
  await api().storage.local.set(update);
  return {
    added: true,
    upgraded,
    rules: cleanup.rules.length,
    removedRules: cleanup.removedRules,
    removedValues: cleanup.removedValues,
  };
}

// Poistaa tuplasäännöt ja päällekkäiset arvot
export async function removeDuplicateRules() {
  const { rules } = await loadState();
  const cleanup = analyzeDuplicates(rules);
  await api().storage.local.set({ rules: cleanup.rules });
  return { removedRules: cleanup.removedRules, removedValues: cleanup.removedValues };
}

// ===== Kategoriat =====

function sameName(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

export async function addCategory(name) {
  const clean = cleanCategory(name);
  const { categories } = await loadState();
  if (categories.some((c) => sameName(c, clean))) throw new Error("Samanniminen kategoria on jo olemassa");
  return saveCategories([...categories, clean]);
}

// Nimeää kategorian ja päivittää sitä käyttävät säännöt. Thunderbirdin kansiota ei nimetä uudelleen.
export async function renameCategory(oldName, newName) {
  const clean = cleanCategory(newName);
  const { categories, rules } = await loadState();
  if (!categories.includes(oldName)) throw new Error("Kategoriaa ei löydy");
  if (categories.some((c) => c !== oldName && sameName(c, clean))) {
    throw new Error("Samanniminen kategoria on jo olemassa");
  }
  const renamedRules = rules.filter((r) => r.category === oldName).length;
  await api().storage.local.set({
    categories: categories.map((c) => (c === oldName ? clean : c)),
    rules: rules.map((r) => (r.category === oldName ? { ...r, category: clean } : r)),
  });
  return { renamedRules, newName: clean };
}

// Poistaa kategorian ja sitä käyttävät säännöt (asetussivu varoittaa ja kysyy ensin)
export async function deleteCategory(name) {
  const { categories, rules } = await loadState();
  const deletedRules = rules.filter((r) => r.category === name).length;
  await api().storage.local.set({
    categories: categories.filter((c) => c !== name),
    rules: rules.filter((r) => r.category !== name),
  });
  return { deletedRules };
}

export async function moveCategory(name, delta) {
  const { categories } = await loadState();
  const from = categories.indexOf(name);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= categories.length) return categories;
  const next = [...categories];
  [next[from], next[to]] = [next[to], next[from]];
  return saveCategories(next);
}

// ===== Muistit =====

export async function clearMemory(key) {
  if (key !== "manualMoves" && key !== "aiUnsure") throw new Error(`Tuntematon muisti: ${key}`);
  await api().storage.local.set({ [key]: {} });
}
