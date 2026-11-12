// PostiTuomari – taustaskripti.
// Kuuntelijat rekisteröidään heti ylätasolla, jotta MV3:n tapahtumasivu herää niihin.
import { addDefaultRule, api, ensureDefaults, loadState, missingDefaultRules, saveSettings } from "../shared/storage.js";
import { applyImport, parseImport } from "../shared/transfer.js";
import { testAiConnection } from "./ai.js";
import {
  changePassword,
  forgetKey,
  keyStatus,
  lockKey,
  protectKey,
  removeProtection,
  replaceProtectedKey,
  resolveApiKey,
  setPlainKey,
  unlockKey,
} from "./keyStore.js";
import {
  handleMoved,
  handleNewMail,
  listUnsorted,
  loadMemory,
  logAccounts,
  moveToCategory,
  renameCategoryFolders,
  restoreFlagged,
  sortInboxes,
  watchMemory,
} from "./sort.js";

// Oletukset ja muistit ladataan ennen kuin yksikään kuuntelija tekee mitään
const ready = (async () => {
  await ensureDefaults();
  await loadMemory();
  watchMemory();
})();
ready.catch(console.error);

async function sortIfEnabled(reason) {
  await ready;
  const { settings } = await loadState();
  await logAccounts(settings);
  if (!settings.sortOnStartup) {
    console.log(`⏸️ Lajittelu käynnistyksessä on pois päältä (${reason})`);
    return;
  }
  console.log(`▶️ Lajitellaan (${reason})`);
  await sortInboxes();
}

// Thunderbirdin käynnistys
api().runtime.onStartup.addListener(() => {
  sortIfEnabled("käynnistys").catch(console.error);
});

// Asennus, päivitys tai väliaikaisen version lataus
api().runtime.onInstalled.addListener(({ reason }) => {
  sortIfEnabled(reason === "install" ? "asennus" : "päivitys").catch(console.error);
});

// Uusi posti
api().messages.onNewMailReceived.addListener(async (folder, messageList) => {
  await ready;
  await handleNewMail(folder, messageList);
});

// Käyttäjän siirrot
api().messages.onMoved.addListener(async (originalMessages, movedMessages) => {
  await ready;
  await handleMoved(originalMessages, movedMessages);
});

// Viestit asetussivulta ja popupista
api().runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== api().runtime.id) return undefined;

  switch (message?.type) {
    case "sortNow":
      return ready.then(() => sortInboxes());
    case "restoreFlagged":
      return ready.then(() => restoreFlagged({ preview: message.preview === true }));
    case "listUnsorted":
      return ready.then(() => listUnsorted({ limit: 100 }));
    case "moveToCategory":
      if (typeof message.messageId !== "number" || typeof message.category !== "string") {
        return Promise.reject(new Error("Virheellinen pyyntö"));
      }
      return ready.then(() => moveToCategory(message.messageId, message.category));
    case "testAi":
      return ready.then(async () => {
        const state = await loadState();
        return testAiConnection({ ...state, ...(await resolveApiKey(state.settings)) });
      });
    case "renameCategoryFolders":
      if (!isText(message.oldName) || !isText(message.newName)) return Promise.reject(new Error("Virheellinen pyyntö"));
      return ready.then(() => renameCategoryFolders(message.oldName, message.newName));

    // API-avain: tila, avaus, lukitus ja suojaus. Avainta ei koskaan palauteta.
    case "keyStatus":
      return keyStatus();
    case "unlockKey":
      return withPassword(message.password, () => unlockKey(message.password));
    case "lockKey":
      return lockKey().then(keyStatus);
    case "setPlainKey":
      if (!isText(message.apiKey, 300)) return Promise.reject(new Error("Virheellinen API-avain"));
      return setPlainKey(message.apiKey).then(keyStatus);
    case "protectKey":
      return withPassword(message.password, () => protectKey(message.password));
    case "changeKeyPassword":
      return withPassword(message.oldPassword, () =>
        isText(message.newPassword, 200) ? changePassword(message.oldPassword, message.newPassword) : Promise.reject(new Error("Virheellinen salasana"))
      );
    case "replaceProtectedKey":
      if (!isText(message.apiKey, 300)) return Promise.reject(new Error("Virheellinen API-avain"));
      return withPassword(message.password, () => replaceProtectedKey(message.apiKey, message.password));
    case "removeKeyProtection":
      return withPassword(message.password, () => removeProtection(message.password));
    case "forgetKey":
      return forgetKey().then(keyStatus);
    default:
      return undefined;
  }
});

function isText(value, max = 100) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

// Salasanaa vaativat toiminnot: tyyppitarkistus ja lopuksi uusi tila (ei avainta)
function withPassword(password, fn) {
  if (!isText(password, 200)) return Promise.reject(new Error("Väärä salasana"));
  return ready.then(fn).then(keyStatus);
}

// ===== Apuvälineet kehitykseen ja testaukseen (Debug Add-ons → Inspect → konsoli) =====
// Esim. await postiTuomari.accounts()
//       await postiTuomari.setAccounts(["account1"])
//       await postiTuomari.restoreFlagged({ preview: true })
const debugTools = {
  async accounts() {
    const { settings } = await loadState();
    const accounts = await api().accounts.list(false);
    return accounts.map((a) => ({ id: a.id, name: a.name, selected: settings.accountIds.includes(a.id) }));
  },
  async setAccounts(accountIds) {
    return (await saveSettings({ accountIds })).accountIds;
  },
  async setDryRun(dryRun) {
    return (await saveSettings({ dryRun: dryRun === true })).dryRun;
  },
  // AI päälle/pois. Avain asetetaan asetussivulla (ei konsolissa, ettei se jää historiaan).
  async setAiEnabled(aiEnabled) {
    return (await saveSettings({ aiEnabled: aiEnabled === true })).aiEnabled;
  },
  testAi: async () => {
    const state = await loadState();
    return testAiConnection({ ...state, ...(await resolveApiKey(state.settings)) });
  },
  keyStatus: () => keyStatus(),
  // Oletussäännöt, joita ei vielä ole käytössä (id + kategoria), ja yksittäisen lisäys
  async missingDefaultRules() {
    return (await missingDefaultRules()).map((r) => ({ id: r.id, category: r.category, subjectFirst: r.subjectFirst }));
  },
  addDefaultRule: (id) => addDefaultRule(id),
  // Popup omaan välilehteen vianetsintää varten (virheet näkyvät tässä konsolissa)
  openPopupInTab: () => api().tabs.create({ url: api().runtime.getURL("popup/index.html") }),
  sortNow: () => sortInboxes(),
  restoreFlagged: (options) => restoreFlagged(options),
  // Tuonti vientitiedoston sisällöstä (objekti tai JSON-merkkijono). Palauttaa vain määrät.
  async importData(data) {
    const parsed = parseImport(typeof data === "string" ? JSON.parse(data) : data);
    const result = await applyImport(parsed);
    return {
      categories: parsed.categories.length,
      rules: parsed.rules.length,
      blocklist: parsed.aiBlocklist.addresses.length + parsed.aiBlocklist.domains.length,
      accounts: result.accountIds.length,
      unmatchedAccounts: result.unmatchedAccounts,
      errors: parsed.errors.length,
      warnings: parsed.warnings.length,
    };
  },
  // Tilanne määrinä – ei sääntöjen sisältöä eikä avainta
  async status() {
    const { settings, categories, rules, aiBlocklist } = await loadState();
    const { manualMoves, aiUnsure } = await api().storage.local.get(["manualMoves", "aiUnsure"]);
    return {
      dryRun: settings.dryRun,
      sortOnStartup: settings.sortOnStartup,
      sortNewMail: settings.sortNewMail,
      aiEnabled: settings.aiEnabled,
      apiKey: (await resolveApiKey(settings)).keyState, // none | plain | locked | unlocked
      accounts: settings.accountIds.length,
      categories: categories.length,
      rules: rules.length,
      blocklist: aiBlocklist.addresses.length + aiBlocklist.domains.length,
      manualMoves: Object.keys(manualMoves ?? {}).length,
      aiUnsure: Object.keys(aiUnsure ?? {}).length,
    };
  },
};

// Jokainen apuväline odottaa, että oletukset ja muistit on ladattu
globalThis.postiTuomari = Object.fromEntries(
  Object.entries(debugTools).map(([name, fn]) => [name, async (...args) => (await ready, fn(...args))])
);
