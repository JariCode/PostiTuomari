import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCategory,
  addDefaultRule,
  deleteCategory,
  ensureDefaults,
  loadState,
  missingDefaultRules,
  renameCategory,
} from "../src/shared/storage.js";

// storage.local-vale
function mockStorage(initial = {}) {
  const store = structuredClone(initial);
  globalThis.messenger = {
    storage: {
      local: {
        get: async (keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
        },
        set: async (obj) => Object.assign(store, structuredClone(obj)),
      },
    },
  };
  return store;
}

test("addDefaultRule lisää laskusäännön etusijasääntöjen perään, muut säilyvät", async () => {
  const store = mockStorage({
    rules: [
      { id: "oma", category: "Ostokset", domains: ["kauppa.example"] },
      { id: "t", category: "Tilit ja tietoturva", subjectFirst: true, subjectWords: ["salasana"] },
      { id: "r", category: "Raha", subjectWords: ["lasku", "eräpäivä", "maksumuistutus", "laina"] },
    ],
    categories: ["Ostokset", "Tilit ja tietoturva"],
  });

  assert.ok((await missingDefaultRules()).some((r) => r.id === "default-raha-laskut"));

  const result = await addDefaultRule("default-raha-laskut");
  assert.equal(result.added, true);
  assert.deepEqual(store.rules.map((r) => r.id), ["oma", "t", "default-raha-laskut", "r"]);
  assert.ok(store.categories.includes("Raha"));

  // Toinen kerta ei lisää uudelleen
  assert.equal((await addDefaultRule("default-raha-laskut")).added, false);
  assert.ok(!(await missingDefaultRules()).some((r) => r.id === "default-raha-laskut"));
  await assert.rejects(() => addDefaultRule("tuntematon"));
});

test("addDefaultRule: Vakuutukset menee laskusäännön edelle", async () => {
  const store = mockStorage({
    rules: [
      { id: "t", category: "Tilit ja tietoturva", subjectFirst: true, subjectWords: ["salasana"] },
      { id: "default-raha-laskut", category: "Raha", subjectFirst: true, subjectWords: ["lasku", "eräpäivä", "maksumuistutus"] },
      { id: "oma", category: "Ostokset", domains: ["kauppa.example"] },
    ],
    categories: ["Raha"],
  });
  assert.equal((await addDefaultRule("default-vakuutukset")).added, true);
  assert.deepEqual(store.rules.map((r) => r.id), ["t", "default-vakuutukset", "default-raha-laskut", "oma"]);
});

test("kategorian nimeäminen päivittää säännöt, poisto poistaa säännöt", async () => {
  const store = mockStorage({
    categories: ["Raha", "Ostokset"],
    rules: [
      { id: "a", category: "Raha", domains: ["pankki.example"] },
      { id: "b", category: "Ostokset", domains: ["kauppa.example"] },
    ],
  });
  assert.deepEqual(await renameCategory("Raha", " Talous "), { renamedRules: 1 });
  assert.deepEqual(store.categories, ["Talous", "Ostokset"]);
  assert.equal(store.rules[0].category, "Talous");
  await assert.rejects(() => renameCategory("Talous", "ostokset"));
  await assert.rejects(() => addCategory("OSTOKSET"));

  assert.deepEqual(await deleteCategory("Ostokset"), { deletedRules: 1 });
  assert.deepEqual(store.categories, ["Talous"]);
  assert.equal(store.rules.length, 1);
});

test("ensiasennus: oletukset, eikä olemassa olevia sääntöjä muuteta", async () => {
  const store = mockStorage({ rules: [{ id: "oma", category: "Raha", domains: ["pankki.example"] }] });
  await ensureDefaults();
  assert.equal(store.rules.length, 1);
  assert.equal(store.settings.dryRun, true);
  const { rules } = await loadState();
  assert.equal(rules[0].match, "any");

  mockStorage({});
  await ensureDefaults();
  assert.ok((await loadState()).rules.some((r) => r.id === "default-raha-laskut"));
});
