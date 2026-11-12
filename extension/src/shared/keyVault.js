// API-avaimen salaus salasanalla: PBKDF2-SHA256 (600 000 kierrosta, satunnainen 16 tavun suola)
// → AES-GCM 256 (satunnainen 12 tavun IV). Salasanaa ei tallenneta.
// Tallennettava "holvi" sisältää vain salatun avaimen, suolan, IV:n ja avaimen 4 viimeistä merkkiä.

export const VAULT_VERSION = 1;
export const PBKDF2_ITERATIONS = 600000;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;
export const WRONG_PASSWORD = "Väärä salasana";

const AAD = new TextEncoder().encode("postituomari-api-key-v1");

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("Salaus ei ole käytettävissä tässä ympäristössä");
  return s;
}

function toBase64(bytes) {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function checkPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    throw new Error(`Salasanan pitää olla vähintään ${MIN_PASSWORD} merkkiä`);
  }
  if (password.length > MAX_PASSWORD) throw new Error("Salasana on liian pitkä");
}

async function deriveKey(password, salt, iterations) {
  const base = await subtle().importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptApiKey(apiKey, password) {
  if (typeof apiKey !== "string" || !apiKey) throw new Error("API-avain puuttuu");
  checkPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const data = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, new TextEncoder().encode(apiKey));
  return {
    v: VAULT_VERSION,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(data),
    last4: apiKey.slice(-4),
  };
}

export function isVault(vault) {
  return (
    vault !== null &&
    typeof vault === "object" &&
    vault.v === VAULT_VERSION &&
    Number.isInteger(vault.iterations) &&
    vault.iterations >= PBKDF2_ITERATIONS &&
    vault.iterations <= 10_000_000 &&
    ["salt", "iv", "data"].every((k) => typeof vault[k] === "string" && vault[k].length > 0 && vault[k].length < 2000)
  );
}

// Väärä salasana (tai muutettu holvi) → aina sama virhe, ei vihjeitä
export async function decryptApiKey(vault, password) {
  if (!isVault(vault)) throw new Error("Tallennettu avain on vioittunut – syötä avain uudelleen");
  if (typeof password !== "string" || !password || password.length > MAX_PASSWORD) throw new Error(WRONG_PASSWORD);
  try {
    const key = await deriveKey(password, fromBase64(vault.salt), vault.iterations);
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: fromBase64(vault.iv), additionalData: AAD },
      key,
      fromBase64(vault.data)
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error(WRONG_PASSWORD);
  }
}
