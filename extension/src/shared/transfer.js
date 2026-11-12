// Vienti ja tuonti JSON-muodossa. API-avain ei koskaan kuulu vientiin eikä tuontiin.
//
// Muoto:
// {
//   "format": "postituomari", "version": 1, "exportedAt": "...",
//   "settings": { ...ilman apiKeytä },            (valinnainen)
//   "accountNames": ["Tilin nimi"],               (valinnainen, muutetaan tuonnissa accountId:ksi)
//   "categories": ["Raha", ...],
//   "rules": [{ id, category, subjectFirst, addresses, domains, subjectWords }],
//   "aiBlocklist": { "addresses": [], "domains": [] }
// }
import { api } from "./storage.js";
import { normalizeBlocklist, normalizeCategories, normalizeRules, normalizeSettings } from "./validate.js";

export const EXPORT_FORMAT = "postituomari";
export const EXPORT_VERSION = 1;

export function buildExport({ settings, categories, rules, aiBlocklist }) {
  const { apiKey: _omit, ...safeSettings } = settings;
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: safeSettings,
    categories,
    rules,
    aiBlocklist,
  };
}

// Tarkistaa tuotavan datan. Virheelliset kohdat jätetään pois ja kerrotaan errors-listassa,
// jotta käyttäjä näkee esikatselussa, mitä tallennettaisiin.
export function parseImport(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Tiedosto ei ole PostiTuomarin vientitiedosto");
  }
  if (data.format !== EXPORT_FORMAT) throw new Error("Tuntematon tiedostomuoto");
  if (data.version !== EXPORT_VERSION) throw new Error(`Tuntematon versio: ${data.version}`);

  const errors = [];
  const warnings = [];

  const cats = normalizeCategories(data.categories ?? []);
  errors.push(...cats.errors);
  const categories = cats.categories;

  const rulesResult = normalizeRules(data.rules ?? []);
  errors.push(...rulesResult.errors);
  const rules = rulesResult.rules;

  // Säännön kategoria puuttuu listasta → lisätään loppuun
  for (const rule of rules) {
    const existing = categories.find((c) => c.toLowerCase() === rule.category.toLowerCase());
    if (existing) {
      rule.category = existing;
    } else {
      categories.push(rule.category);
      warnings.push(`Kategoria "${rule.category}" lisättiin, koska sääntö käyttää sitä`);
    }
  }

  const block = normalizeBlocklist(data.aiBlocklist ?? {});
  errors.push(...block.errors);

  let settings = null;
  if (data.settings && typeof data.settings === "object") {
    const { apiKey, ...rest } = data.settings;
    if (apiKey) warnings.push("Tiedostossa oli API-avain – sitä ei tuoda");
    const result = normalizeSettings(rest);
    errors.push(...result.errors);
    settings = { ...result.settings };
    delete settings.apiKey;
  }

  const accountNames = Array.isArray(data.accountNames)
    ? data.accountNames.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim())
    : [];

  return { categories, rules, aiBlocklist: block.blocklist, settings, accountNames, errors, warnings };
}

// Tallentaa tuonnin. Tilit valitaan nimen perusteella vain tuonnissa – tallennukseen menee accountId.
export async function applyImport(parsed) {
  const local = api().storage.local;
  const { settings: current } = await local.get("settings");
  const base = normalizeSettings(current ?? {}).settings;

  const settings = parsed.settings ? { ...base, ...parsed.settings, apiKey: base.apiKey } : { ...base };

  let unmatchedAccounts = [];
  if (parsed.accountNames.length) {
    const accounts = await api().accounts.list(false);
    const ids = accounts.filter((a) => parsed.accountNames.includes(a.name)).map((a) => a.id);
    unmatchedAccounts = parsed.accountNames.filter((n) => !accounts.some((a) => a.name === n));
    settings.accountIds = [...new Set([...(settings.accountIds ?? []), ...ids])];
  }

  // Tilit, joita ei ole tässä Thunderbirdissä, jätetään pois
  const accounts = await api().accounts.list(false);
  settings.accountIds = settings.accountIds.filter((id) => accounts.some((a) => a.id === id));

  await local.set({
    settings: normalizeSettings(settings).settings,
    categories: parsed.categories,
    rules: parsed.rules,
    aiBlocklist: parsed.aiBlocklist,
  });

  return { accountIds: settings.accountIds, unmatchedAccounts: unmatchedAccounts.length };
}
