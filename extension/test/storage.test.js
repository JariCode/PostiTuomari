import { test } from "node:test";
import assert from "node:assert/strict";
import { addDefaultRule, ensureDefaults, loadState, missingDefaultRules } from "../src/shared/storage.js";

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
