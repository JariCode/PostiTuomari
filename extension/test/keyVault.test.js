import { test } from "node:test";
import assert from "node:assert/strict";
import { PBKDF2_ITERATIONS, WRONG_PASSWORD, decryptApiKey, encryptApiKey, isVault } from "../src/shared/keyVault.js";

const KEY = "testiavain-0123456789-abcdef";
const PASSWORD = "oikea-salasana";

// storage.local + storage.session -vale keyStore-testeihin
function mockMessenger({ session = true } = {}) {
  const local = {};
  const sessionStore = {};
  const area = (store) => ({
    get: async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
    },
    set: async (obj) => Object.assign(store, structuredClone(obj)),
    remove: async (key) => {
      for (const k of [key].flat()) delete store[k];
    },
  });
  globalThis.messenger = { storage: { local: area(local), ...(session ? { session: area(sessionStore) } : {}) } };
  return { local, sessionStore };
}

test("salaus ja purku", async () => {
  const vault = await encryptApiKey(KEY, PASSWORD);
  assert.ok(isVault(vault));
  assert.ok(vault.iterations >= 600000);
  assert.equal(vault.iterations, PBKDF2_ITERATIONS);
  assert.equal(vault.kdf, "PBKDF2-SHA256");
  assert.equal(vault.last4, KEY.slice(-4));
  assert.equal(await decryptApiKey(vault, PASSWORD), KEY);
  // Avain ei näy holvissa selväkielisenä (paitsi 4 viimeistä merkkiä)
  assert.ok(!JSON.stringify(vault).includes(KEY.slice(0, -4)));
});

test("satunnainen suola ja IV: sama avain salautuu eri tavalla", async () => {
  const a = await encryptApiKey(KEY, PASSWORD);
  const b = await encryptApiKey(KEY, PASSWORD);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
});

test("väärä salasana ja muutettu holvi: sama virhe, ei vihjeitä", async () => {
  const vault = await encryptApiKey(KEY, PASSWORD);
  await assert.rejects(() => decryptApiKey(vault, "väärä-salasana"), { message: WRONG_PASSWORD });
  await assert.rejects(() => decryptApiKey(vault, ""), { message: WRONG_PASSWORD });
  const tampered = { ...vault, data: vault.data.slice(0, -4) + (vault.data.endsWith("AAAA") ? "BBBB" : "AAAA") };
  await assert.rejects(() => decryptApiKey(tampered, PASSWORD), { message: WRONG_PASSWORD });
  await assert.rejects(() => decryptApiKey({ ...vault, iterations: 1000 }, PASSWORD), /vioittunut/);
});

test("liian lyhyt salasana hylätään", async () => {
  await assert.rejects(() => encryptApiKey(KEY, "lyhyt"), /vähintään 8/);
});

test("avainvarasto: suojaus, lukitus, avaus, vaihto ja poisto", async () => {
  const { local, sessionStore } = mockMessenger();
  const ks = await import("../src/background/keyStore.js");

  await ks.setPlainKey(KEY);
  assert.equal((await ks.keyStatus()).state, "plain");

  await ks.protectKey(PASSWORD);
  // storage.localissa ei selväkielistä avainta missään muodossa
  assert.ok(!JSON.stringify(local).includes(KEY));
  assert.equal(local.settings.apiKey, "");
  assert.ok(isVault(local.apiKeyVault));
  let status = await ks.keyStatus();
  assert.deepEqual([status.state, status.protected, status.last4, status.sessionStorage], ["unlocked", true, KEY.slice(-4), true]);
  assert.equal("apiKey" in status, false);

  // Thunderbirdin uudelleenkäynnistys tyhjentää storage.sessionin → lukossa
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  assert.deepEqual(await ks.resolveApiKey(local.settings), { apiKey: "", keyState: "locked" });

  await assert.rejects(() => ks.unlockKey("väärä-salasana"), { message: WRONG_PASSWORD });
  await ks.unlockKey(PASSWORD);
  assert.deepEqual(await ks.resolveApiKey(local.settings), { apiKey: KEY, keyState: "unlocked" });

  await ks.lockKey();
  assert.equal((await ks.keyStatus()).state, "locked");

  // Salasanan vaihto vaatii vanhan
  await assert.rejects(() => ks.changePassword("väärä-salasana", "uusi-salasana"), { message: WRONG_PASSWORD });
  await ks.changePassword(PASSWORD, "uusi-salasana");
  await ks.lockKey();
  await assert.rejects(() => ks.unlockKey(PASSWORD), { message: WRONG_PASSWORD });
  await ks.unlockKey("uusi-salasana");

  // Avaimen vaihto salasanalla
  await ks.replaceProtectedKey("toinen-testiavain-9999", "uusi-salasana");
  assert.equal((await ks.resolveApiKey(local.settings)).apiKey, "toinen-testiavain-9999");
  assert.ok(!JSON.stringify(local).includes("toinen-testiavain"));

  // Tavallista tallennusta ei sallita suojauksen ollessa päällä
  await assert.rejects(() => ks.setPlainKey(KEY), /suojattu/);

  // Suojauksen poisto vaatii salasanan → avain takaisin salaamattomaksi
  await assert.rejects(() => ks.removeProtection("väärä-salasana"), { message: WRONG_PASSWORD });
  await ks.removeProtection("uusi-salasana");
  assert.equal(local.apiKeyVault, undefined);
  assert.equal(local.settings.apiKey, "toinen-testiavain-9999");
  assert.equal((await ks.keyStatus()).state, "plain");

  // Unohtunut salasana: kaikki pois
  await ks.protectKey(PASSWORD);
  await ks.forgetKey();
  assert.equal((await ks.keyStatus()).state, "none");
  assert.equal(local.apiKeyVault, undefined);
  assert.deepEqual(sessionStore, {});
});
