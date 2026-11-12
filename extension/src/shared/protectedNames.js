// Suojattavat nimet: korvataan AI:lle lähtevästä tekstistä merkinnällä [nimi].
//   1. Käyttäjän oma nimi Thunderbirdin tilien identiteeteistä (koko nimi, etunimi, sukunimi)
//   2. Asetussivun "Suojattavat nimet ja sanat" -lista
//   3. Valinnaisesti osoitekirjan nimet (vaatii addressBooks-oikeuden, pyydetään vasta kun käyttäjä
//      kytkee valinnan päälle)
// Nimet luetaan aina Thunderbirdistä eikä niitä tallenneta mihinkään.
import { nameParts } from "./pii.js";
import { api } from "./storage.js";

export const ADDRESS_BOOK_PERMISSION = { permissions: ["addressBooks"] };
const MAX_NAMES = 5000;

export async function identityNames() {
  const names = [];
  try {
    for (const account of await api().accounts.list(false)) {
      for (const identity of account.identities ?? []) names.push(...nameParts(identity.name));
    }
  } catch {
    // Ei tilejä tai ei oikeutta → ei identiteettinimiä
  }
  return names;
}

// vCardista FN- ja N-kentät (MV3-osoitekirja palauttaa vCardin)
function namesFromVCard(vCard) {
  const names = [];
  const unfolded = String(vCard ?? "").replace(/\r?\n[ \t]/g, "");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).split(";")[0].toUpperCase();
    const value = line.slice(colon + 1).replace(/\\([,;\\])/g, "$1");
    if (key === "FN") names.push(...nameParts(value));
    if (key === "N") {
      const [last, first] = value.split(";");
      names.push(...nameParts(`${first ?? ""} ${last ?? ""}`));
    }
  }
  return names;
}

function namesFromContact(contact) {
  if (contact?.vCard) return namesFromVCard(contact.vCard);
  const p = contact?.properties ?? {};
  return [...nameParts(p.DisplayName), ...nameParts(`${p.FirstName ?? ""} ${p.LastName ?? ""}`)];
}

export async function hasAddressBookPermission() {
  try {
    return await api().permissions.contains(ADDRESS_BOOK_PERMISSION);
  } catch {
    return false;
  }
}

export async function addressBookNames() {
  if (!(await hasAddressBookPermission())) return [];
  const names = [];
  try {
    const contactsApi = api().addressBooks?.contacts ?? api().contacts;
    const books = await api().addressBooks.list(false);
    for (const book of books) {
      for (const contact of (await contactsApi.list(book.id)) ?? []) {
        names.push(...namesFromContact(contact));
        if (names.length > MAX_NAMES) return names.slice(0, MAX_NAMES);
      }
    }
  } catch {
    // Osoitekirja ei käytettävissä → jatketaan ilman
  }
  return names;
}

// Kaikki suojattavat nimet asetusten mukaan
export async function collectProtectedNames(settings) {
  const names = [...(await identityNames()), ...(settings?.protectedWords ?? [])];
  if (settings?.protectAddressBook) names.push(...(await addressBookNames()));
  return [...new Set(names)].slice(0, MAX_NAMES);
}

export const _test = { namesFromVCard, namesFromContact };
