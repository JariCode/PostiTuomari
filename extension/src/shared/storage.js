// storage.local: asetukset, kategoriat, säännöt ja muistit.
//
//   settings     – ks. DEFAULT_SETTINGS
//   categories   – kategorioiden järjestetty lista
//   rules        – [{ id, category, match, subjectFirst, addresses, domains, subjectWords }], järjestys merkitsee
//   aiBlocklist  – { addresses, domains }: näitä lähettäjiä ei koskaan lähetetä AI:lle
//   manualMoves  – headerMessageId → kansion polku, johon käyttäjä viestin siirsi
//   aiUnsure     – headerMessageId → aikaleima: AI ei osannut päättää, ei kysytä uudelleen
import { DEFAULT_AI_BLOCKLIST, DEFAULT_CATEGORIES, DEFAULT_RULE_TEMPLATES } from "./defaults.js";
import { normalizeBlocklist, normalizeCategories, normalizeRules, normalizeSettings } from "./validate.js";

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

// Onko oletussääntö jo käytössä: sama id tai sama sisältö (tuodut säännöt saavat uudet id:t)
function sameRule(a, b) {
  const words = (r) => [...r.subjectWords].sort().join("|");
  return (
    a.id === b.id ||
    (a.category === b.category &&
      a.match === b.match &&
      a.subjectFirst === b.subjectFirst &&
      a.addresses.length === 0 &&
      a.domains.length === 0 &&
      words(a) === words(b))
  );
}

// Oletussäännöt, joita tallennetuissa säännöissä ei vielä ole
export async function missingDefaultRules() {
  const { rules } = await loadState();
  return createDefaultRules().filter((d) => !rules.some((r) => sameRule(d, r)));
}

// Lisää yhden oletussäännön olemassa oleviin sääntöihin ilman muiden sääntöjen muuttamista.
// Etusijasääntö lisätään viimeiseksi muiden etusijasääntöjen jälkeen (järjestys niiden kesken säilyy),
// muut sääntöjen loppuun.
export async function addDefaultRule(id) {
  const rule = createDefaultRules().find((r) => r.id === id);
  if (!rule) throw new Error(`Tuntematon oletussääntö: ${id}`);

  const { rules, categories } = await loadState();
  if (rules.some((r) => sameRule(rule, r))) return { added: false, rules: rules.length };

  const next = [...rules];
  if (rule.subjectFirst) {
    const lastFirst = next.reduce((acc, r, i) => (r.subjectFirst ? i : acc), -1);
    next.splice(lastFirst + 1, 0, rule);
  } else {
    next.push(rule);
  }

  const update = { rules: next };
  if (!categories.includes(rule.category)) update.categories = [...categories, rule.category];
  await api().storage.local.set(update);
  return { added: true, rules: next.length };
}

export async function clearMemory(key) {
  if (key !== "manualMoves" && key !== "aiUnsure") throw new Error(`Tuntematon muisti: ${key}`);
  await api().storage.local.set({ [key]: {} });
}
