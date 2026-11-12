// API-avaimen hallinta taustaskriptissä.
//   Ilman suojausta: avain on settings.apiKey (storage.local, salaamaton).
//   Salasanasuojaus: storage.localissa vain salattu holvi (apiKeyVault). Avattu avain pidetään
//   storage.sessionissa (tyhjenee, kun Thunderbird suljetaan; säilyy taustaskriptin pysähdyksen yli).
//   Jos storage.session puuttuu, avain pidetään taustaskriptin muistissa (pitää avata uudelleen,
//   kun Thunderbird pysäyttää joutilaan taustaskriptin).
// Avainta ei koskaan palauteta asetussivulle tai popupille, eikä sitä kirjoiteta lokiin.
import { checkPassword, decryptApiKey, encryptApiKey, isVault } from "../shared/keyVault.js";
import { api, loadState, saveSettings } from "../shared/storage.js";
import { LIMITS } from "../shared/validate.js";

const SESSION_KEY = "unlockedApiKey";
let memoryKey = null;

function sessionArea() {
  return api().storage.session ?? null;
}

export async function getVault() {
  const { apiKeyVault } = await api().storage.local.get("apiKeyVault");
  return isVault(apiKeyVault) ? apiKeyVault : null;
}

async function getUnlocked() {
  const area = sessionArea();
  if (area) {
    try {
      const data = await area.get(SESSION_KEY);
      if (typeof data[SESSION_KEY] === "string") return data[SESSION_KEY];
    } catch {
      // storage.session ei käytettävissä → muisti
    }
  }
  return memoryKey;
}

async function setUnlocked(key) {
  memoryKey = null;
  const area = sessionArea();
  if (area) {
    try {
      if (key) await area.set({ [SESSION_KEY]: key });
      else await area.remove(SESSION_KEY);
      return;
    } catch {
      // → muisti
    }
  }
  memoryKey = key || null;
}

function cleanKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) throw new Error("API-avain puuttuu");
  if (key.length > LIMITS.apiKey || /\s/.test(key)) throw new Error("Virheellinen API-avain");
  return key;
}

// { apiKey, keyState }: keyState = "none" | "plain" | "locked" | "unlocked"
export async function resolveApiKey(settings) {
  if (await getVault()) {
    const key = await getUnlocked();
    return key ? { apiKey: key, keyState: "unlocked" } : { apiKey: "", keyState: "locked" };
  }
  return settings.apiKey ? { apiKey: settings.apiKey, keyState: "plain" } : { apiKey: "", keyState: "none" };
}

// Tila asetussivulle ja popupille – ei koskaan itse avainta
export async function keyStatus() {
  const { settings } = await loadState();
  const vault = await getVault();
  const { keyState } = await resolveApiKey(settings);
  return {
    state: keyState,
    protected: Boolean(vault),
    last4: vault ? vault.last4 ?? "" : settings.apiKey.slice(-4),
    sessionStorage: Boolean(sessionArea()),
  };
}

// Tallentaa avaimen ilman suojausta (vain kun suojaus ei ole päällä)
export async function setPlainKey(apiKey) {
  if (await getVault()) throw new Error("Avain on suojattu – vaihda avain salasanan kanssa");
  await saveSettings({ apiKey: cleanKey(apiKey) });
}

// Suojaa nykyisen avaimen. Holvi tallennetaan ennen kuin selväkielinen avain poistetaan.
export async function protectKey(password) {
  checkPassword(password);
  const { settings } = await loadState();
  if (await getVault()) throw new Error("Avain on jo suojattu");
  if (!settings.apiKey) throw new Error("Tallenna ensin API-avain");
  const vault = await encryptApiKey(settings.apiKey, password);
  await api().storage.local.set({ apiKeyVault: vault });
  await setUnlocked(settings.apiKey);
  await saveSettings({ apiKey: "" });
}

export async function unlockKey(password) {
  const vault = await getVault();
  if (!vault) throw new Error("Avain ei ole suojattu");
  await setUnlocked(await decryptApiKey(vault, password));
}

export async function lockKey() {
  await setUnlocked(null);
}

export async function changePassword(oldPassword, newPassword) {
  checkPassword(newPassword);
  const vault = await getVault();
  if (!vault) throw new Error("Avain ei ole suojattu");
  const key = await decryptApiKey(vault, oldPassword);
  await api().storage.local.set({ apiKeyVault: await encryptApiKey(key, newPassword) });
  await setUnlocked(key);
}

// Vaihtaa suojatun avaimen uuteen samalla salasanalla (salasana tarkistetaan ensin)
export async function replaceProtectedKey(apiKey, password) {
  const key = cleanKey(apiKey);
  const vault = await getVault();
  if (!vault) throw new Error("Avain ei ole suojattu");
  await decryptApiKey(vault, password);
  await api().storage.local.set({ apiKeyVault: await encryptApiKey(key, password) });
  await setUnlocked(key);
}

// Poistaa suojauksen: avain takaisin salaamattomaksi (vaatii salasanan)
export async function removeProtection(password) {
  const vault = await getVault();
  if (!vault) throw new Error("Avain ei ole suojattu");
  const key = await decryptApiKey(vault, password);
  await saveSettings({ apiKey: key });
  await api().storage.local.remove("apiKeyVault");
  await setUnlocked(null);
}

// Unohtunut salasana tai avaimen poisto: kaikki avaintiedot pois
export async function forgetKey() {
  await api().storage.local.remove("apiKeyVault");
  await setUnlocked(null);
  await saveSettings({ apiKey: "" });
}
