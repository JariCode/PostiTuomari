// Lajittelu: säännöt → AI → siirrot. Lisäksi liputettujen palautus Saapuneisiin.
import { FLAGGED_LABEL, UNSURE } from "../shared/constants.js";
import { classify, getDomain, isAiBlocked, parseEmail } from "../shared/classify.js";
import { api, loadState } from "../shared/storage.js";
import { classifyWithAI } from "./ai.js";

const MANUAL_LABEL = "(käsin lajiteltu)";
const NO_RULE_LABEL = "(ei sääntöä)";

// ===== Muistit =====

// manualMoves: headerMessageId → kansion polku, johon käyttäjä viestin siirsi
// aiUnsure:    headerMessageId → aikaleima, AI ei osannut päättää
export const memory = { manualMoves: {}, aiUnsure: {} };

// Laajennuksen itse siirtämät viestit, jotta ne erotetaan käsin siirretyistä
export const movingNow = new Set();

export async function loadMemory() {
  const data = await api().storage.local.get(["manualMoves", "aiUnsure"]);
  memory.manualMoves = data.manualMoves ?? {};
  memory.aiUnsure = data.aiUnsure ?? {};
  console.log(`🖐️ Käsin lajiteltuja muistissa: ${Object.keys(memory.manualMoves).length}`);
  console.log(`❔ Epävarmoja muistissa: ${Object.keys(memory.aiUnsure).length}`);
}

// Asetussivun tyhjennykset ym. päivittyvät muistiin heti
export function watchMemory() {
  api().storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.manualMoves) memory.manualMoves = changes.manualMoves.newValue ?? {};
    if (changes.aiUnsure) memory.aiUnsure = changes.aiUnsure.newValue ?? {};
  });
}

export async function saveManualMoves() {
  await api().storage.local.set({ manualMoves: memory.manualMoves });
}

async function saveAiUnsure() {
  await api().storage.local.set({ aiUnsure: memory.aiUnsure });
}

function isManual(msg) {
  return Boolean(msg.headerMessageId) && Object.hasOwn(memory.manualMoves, msg.headerMessageId);
}

function isKnownUnsure(msg) {
  return Boolean(msg.headerMessageId) && Object.hasOwn(memory.aiUnsure, msg.headerMessageId);
}

// Liputettu (tähdellä merkitty) viesti pysyy aina Saapuneissa
export function isFlagged(msg) {
  return msg.flagged === true;
}

// ===== Tilit ja viestilistat =====

export async function logAccounts(settings) {
  const accounts = await api().accounts.list(false);
  const included = new Set(settings.accountIds);
  for (const a of accounts) {
    console.log(`${included.has(a.id) ? "✅ Lajitellaan" : "⏭️ Ohitetaan"}: ${a.name} (${a.id})`);
  }
  if (included.size === 0) {
    console.warn("⚠️ Yhtään tiliä ei ole valittu – valitse lajiteltavat tilit asetussivulla");
  }
}

// Valittujen tilien Saapuneet
async function getIncludedInboxes(settings) {
  const included = new Set(settings.accountIds);
  const inboxes = await api().folders.query({ specialUse: ["inbox"] });
  return inboxes.filter((i) => included.has(i.accountId));
}

// Käy läpi MessageList-olion kaikki sivut
export async function* iterateList(list) {
  for (const msg of list.messages) yield msg;
  while (list.id) {
    list = await api().messages.continueList(list.id);
    for (const msg of list.messages) yield msg;
  }
}

async function* getMessages(folderId) {
  yield* iterateList(await api().messages.list(folderId));
}

// Kansion liputetut viestit. query on nopeampi; jos se ei toimi, suodatetaan listasta.
async function getFlaggedMessages(folderId) {
  const result = [];
  try {
    for await (const msg of iterateList(await api().messages.query({ folderId, flagged: true }))) {
      if (isFlagged(msg)) result.push(msg);
    }
  } catch {
    for await (const msg of getMessages(folderId)) {
      if (isFlagged(msg)) result.push(msg);
    }
  }
  return result;
}

// ===== Kansiot ja siirto =====

// Välimuisti, ettei kansioita haeta joka viestille uudestaan
const folderCache = new Map();

// Saapuneet → Kategoria (luodaan, jos ei ole)
async function getTargetFolder(inboxId, category) {
  const key = `${inboxId}/${category}`;
  if (folderCache.has(key)) return folderCache.get(key);

  const subFolders = await api().folders.getSubFolders(inboxId, false);
  let target = subFolders.find((f) => f.name === category);

  if (!target) {
    console.log(`📁 Luodaan kansio: ${category}`);
    target = await api().folders.create(inboxId, category);
  }

  folderCache.set(key, target);
  return target;
}

// Laajennuksen oma siirto: merkitään viestit ensin, ettei niitä tulkita käsin siirretyiksi
export async function moveMessages(messages, targetFolder) {
  for (const msg of messages) {
    if (msg.headerMessageId) movingNow.add(msg.headerMessageId);
  }
  try {
    await api().messages.move(messages.map((m) => m.id), targetFolder.id);
  } catch (err) {
    // Epäonnistunut siirto ei laukaise onMovedia → poistetaan merkinnät
    for (const msg of messages) {
      if (msg.headerMessageId) movingNow.delete(msg.headerMessageId);
    }
    throw err;
  }
}

function addToPlan(plan, inboxId, category, msg) {
  const planKey = `${inboxId}|${category}`;
  if (!plan.has(planKey)) plan.set(planKey, []);
  plan.get(planKey).push(msg);
}

function logVerdict(msg, verdict) {
  const target = verdict ? `${verdict.category} (${verdict.reason})` : "— ei sääntöä";
  console.log(`⚖️ ${target} | ${msg.author} | ${msg.subject}`);
}

// ===== Yksi kerrallaan =====

// Lajittelu ja palautus eivät saa ajaa päällekkäin
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// ===== AI-vaihe =====

// Kysyy AI:lta viestit, joille ei löytynyt sääntöä. Palauttaa { verdicts: Map, status }.
// Ei koskaan heitä: virheessä jatketaan pelkillä säännöillä.
async function askAI(messages, state) {
  const { settings } = state;
  if (!settings.aiEnabled) return { verdicts: new Map(), status: "pois päältä" };
  if (!settings.apiKey) return { verdicts: new Map(), status: "API-avain puuttuu" };
  if (messages.length === 0) return { verdicts: new Map(), status: "ei kysyttävää" };

  try {
    console.log(`🤖 Kysytään AI:lta ${messages.length} viestiä...`);
    const { verdicts, problems } = await classifyWithAI(messages, state);

    // Muistiin vain ne, joista AI vastasi nimenomaan "Epävarma" – ei estettyjä eikä epäonnistuneita eriä
    let unsureChanged = false;
    for (const msg of messages) {
      if (verdicts.get(String(msg.id)) === UNSURE && msg.headerMessageId) {
        memory.aiUnsure[msg.headerMessageId] = Date.now();
        unsureChanged = true;
      }
    }
    if (unsureChanged) await saveAiUnsure();

    const status = problems.length ? `osittain: ${[...new Set(problems)].join(", ")}` : "käytössä";
    return { verdicts, status };
  } catch (err) {
    console.warn(`⚠️ AI ei käytettävissä (${err.message}) – jatketaan pelkillä säännöillä`);
    return { verdicts: new Map(), status: `virhe: ${err.message}` };
  }
}

// ===== Saapuneiden lajittelu =====

// Yhteenveto tallennetaan popupia varten (vain määrät, ei viestien tietoja)
export function sortInboxes() {
  return exclusive(async () => {
    const summary = await doSortInboxes();
    await api().storage.local.set({ lastRun: summary });
    return summary;
  });
}

// Käy saapuneet läpi, kerää siirtosuunnitelman ja toteuttaa sen (ellei dryRun).
// Palauttaa yhteenvedon.
async function doSortInboxes() {
  const state = await loadState();
  const { settings, rules, aiBlocklist } = state;
  const inboxes = await getIncludedInboxes(settings);

  const stats = {};
  const counts = { flagged: 0, manual: 0, unmatched: 0, aiBlocked: 0, aiKnownUnsure: 0 };
  const unmatchedDomains = {};
  const unmatched = []; // [{ msg, inboxId }]
  const plan = new Map(); // "inboxId|kategoria" → [viestit]
  const inboxNames = new Map();

  // 1. Säännöt – luokitellaan ensin kaikki, ei siirretä kesken listauksen
  for (const inbox of inboxes) {
    const label = `${inbox.name} (${inbox.accountId})`;
    inboxNames.set(inbox.id, label);
    console.log(`📥 ${label}`);

    for await (const msg of getMessages(inbox.id)) {
      // Liputetut pysyvät aina Saapuneissa – ei sääntöjä, ei AI:ta
      if (isFlagged(msg)) {
        stats[FLAGGED_LABEL] = (stats[FLAGGED_LABEL] ?? 0) + 1;
        counts.flagged++;
        continue;
      }

      // Käsin lajiteltuihin ei kosketa
      if (isManual(msg)) {
        stats[MANUAL_LABEL] = (stats[MANUAL_LABEL] ?? 0) + 1;
        counts.manual++;
        continue;
      }

      const verdict = classify(msg, rules);
      logVerdict(msg, verdict);

      const key = verdict ? verdict.category : NO_RULE_LABEL;
      stats[key] = (stats[key] ?? 0) + 1;

      if (verdict) {
        addToPlan(plan, inbox.id, verdict.category, msg);
      } else {
        unmatched.push({ msg, inboxId: inbox.id });
        const domain = getDomain(parseEmail(msg.author)) || "(tuntematon)";
        unmatchedDomains[domain] = (unmatchedDomains[domain] ?? 0) + 1;
      }
    }
  }

  console.log("📊 Säännöt:");
  console.table(stats);

  const top = Object.entries(unmatchedDomains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([domain, count]) => ({ domain, count }));
  if (top.length) {
    console.log("🔍 Eniten luokittelemattomia lähettäjiä:");
    console.table(top);
  }

  // 2. AI niille, joille ei löytynyt sääntöä – paitsi kieltolistalla olevat ja jo epävarmoiksi todetut
  const aiCandidates = unmatched.filter(({ msg }) => {
    if (isAiBlocked(msg, aiBlocklist)) {
      counts.aiBlocked++;
      return false;
    }
    if (isKnownUnsure(msg)) {
      counts.aiKnownUnsure++;
      return false;
    }
    return true;
  });

  const ai = await askAI(aiCandidates.map((u) => u.msg), state);
  const aiStats = {};
  for (const { msg, inboxId } of aiCandidates) {
    const category = ai.verdicts.get(String(msg.id));
    if (!category) continue;
    aiStats[category] = (aiStats[category] ?? 0) + 1;
    console.log(`🤖 ${category} | ${msg.author} | ${msg.subject}`);
    // Epävarmat jäävät Saapuneisiin
    if (category !== UNSURE) addToPlan(plan, inboxId, category, msg);
  }
  if (Object.keys(aiStats).length) {
    console.log("🤖 AI:n tuomiot:");
    console.table(aiStats);
  }

  // Saapuneisiin jäävät, joita ei sääntö eikä AI luokitellut
  const planned = new Set([...plan.values()].flat().map((m) => m.id));
  counts.unmatched = unmatched.filter(({ msg }) => !planned.has(msg.id)).length;

  // 3. Siirrot
  const moves = [...plan].map(([planKey, messages]) => {
    const [inboxId, category] = planKey.split("|");
    return { inbox: inboxNames.get(inboxId), category, count: messages.length };
  });

  const summary = { at: Date.now(), dryRun: settings.dryRun, accounts: inboxes.length, moves, counts, ai: ai.status };

  if (settings.dryRun) {
    console.log("🧪 KUIVAHARJOITUS – näin siirrettäisiin (dryRun: true):");
    console.table(moves);
    return summary;
  }

  console.log("🚚 Siirretään viestit...");
  for (const [planKey, messages] of plan) {
    const [inboxId, category] = planKey.split("|");
    const target = await getTargetFolder(inboxId, category);
    await moveMessages(messages, target);
    console.log(`✅ ${messages.length} viestiä → ${inboxNames.get(inboxId)} / ${category}`);
  }
  console.log("🏁 Valmis");
  return summary;
}

// ===== Uusi posti =====

export async function handleNewMail(folder, messageList) {
  const state = await loadState();
  const { settings, rules, aiBlocklist } = state;

  if (!settings.sortNewMail) return;
  // Vain valitut tilit ja vain saapuneisiin tullut posti
  if (!settings.accountIds.includes(folder.accountId)) return;
  if (!folder.specialUse?.includes("inbox")) return;

  for await (const msg of iterateList(messageList)) {
    // Liputetut pysyvät aina Saapuneissa
    if (isFlagged(msg)) {
      console.log(`⭐ ${FLAGGED_LABEL}, ei siirretä | ${msg.author} | ${msg.subject}`);
      continue;
    }

    const verdict = classify(msg, rules);
    logVerdict(msg, verdict);
    let category = verdict?.category ?? null;

    // Ei sääntöä → kysytään AI:lta (paitsi kieltolistalla olevilta)
    if (!category && !isAiBlocked(msg, aiBlocklist) && !isKnownUnsure(msg)) {
      const ai = await askAI([msg], state);
      const aiCategory = ai.verdicts.get(String(msg.id));
      if (aiCategory) console.log(`🤖 ${aiCategory} | ${msg.author} | ${msg.subject}`);
      if (aiCategory && aiCategory !== UNSURE) category = aiCategory;
    }

    if (!category) continue;

    if (settings.dryRun) {
      console.log(`🧪 KUIVAHARJOITUS – siirrettäisiin → ${category}`);
      continue;
    }

    try {
      const target = await getTargetFolder(folder.id, category);
      await moveMessages([msg], target);
    } catch (err) {
      console.error("Siirto epäonnistui:", err);
    }
  }
}

// ===== Käyttäjän siirrot =====

export async function handleMoved(originalMessages, movedMessages) {
  let changed = false;

  for await (const msg of iterateList(movedMessages)) {
    if (!msg.headerMessageId) continue;

    // Laajennuksen oma siirto → ei muisteta
    if (movingNow.delete(msg.headerMessageId)) continue;

    // Käyttäjän siirto → muistetaan, ettei lajittelu siirrä sitä takaisin
    memory.manualMoves[msg.headerMessageId] = msg.folder?.path ?? "";
    changed = true;
    console.log(`🖐️ Käsin siirretty, muistetaan: "${msg.subject}" → ${msg.folder?.name}`);
  }

  if (changed) await saveManualMoves();
}

// ===== Saapuneisiin jääneet (popupin Epävarmat) =====

function messageTime(msg) {
  const t = msg.date instanceof Date ? msg.date.getTime() : Date.parse(msg.date);
  return Number.isFinite(t) ? t : 0;
}

// Valittujen tilien Saapuneiden viestit, joihin mikään sääntö ei osu (uusimmat ensin).
// reason: "unsure" = AI ei osannut päättää, "blocked" = ei AI:lle, "norule" = ei sääntöä
export async function listUnsorted({ limit = 100 } = {}) {
  const { settings, rules, aiBlocklist } = await loadState();
  const inboxes = await getIncludedInboxes(settings);
  const items = [];

  for (const inbox of inboxes) {
    for await (const msg of getMessages(inbox.id)) {
      if (isFlagged(msg) || isManual(msg) || classify(msg, rules)) continue;
      items.push({
        id: msg.id,
        author: msg.author ?? "",
        subject: msg.subject ?? "",
        date: messageTime(msg),
        inbox: `${inbox.name} (${inbox.accountId})`,
        reason: isAiBlocked(msg, aiBlocklist) ? "blocked" : isKnownUnsure(msg) ? "unsure" : "norule",
      });
    }
  }

  items.sort((a, b) => b.date - a.date);
  return { total: items.length, items: items.slice(0, limit) };
}

// Käyttäjän valinta popupista: viesti kategoriakansioon ja muistiin käsin lajiteltuna.
// Tehdään myös kuivaharjoituksessa, koska käyttäjä valitsee kansion itse.
export function moveToCategory(messageId, category) {
  return exclusive(async () => {
    const { categories } = await loadState();
    if (!categories.includes(category)) throw new Error("Tuntematon kategoria");

    const msg = await api().messages.get(messageId);
    if (!msg) throw new Error("Viestiä ei löydy");
    if (!msg.folder?.specialUse?.includes("inbox")) throw new Error("Viesti ei ole enää Saapuneissa");

    const target = await getTargetFolder(msg.folder.id, category);
    await moveMessages([msg], target);

    if (msg.headerMessageId) {
      memory.manualMoves[msg.headerMessageId] = target.path ?? "";
      delete memory.aiUnsure[msg.headerMessageId];
      await api().storage.local.set({ manualMoves: memory.manualMoves, aiUnsure: memory.aiUnsure });
    }
    console.log(`🖐️ Siirretty popupista → ${category}`);
    return { folder: target.name };
  });
}

// ===== Liputettujen palautus =====

// Etsii valittujen tilien Saapuneiden välittömistä alikansioista liputetut viestit
// ja siirtää ne takaisin saman tilin Saapuneisiin.
//   preview: true → vain raportoi (esikatselu ennen vahvistusta)
//   kuivaharjoituksessa vain raportoi aina
// Siirto käyttää moveMessagesia (movingNow), joten sitä ei kirjata käsin siirroksi.
export function restoreFlagged({ preview = false } = {}) {
  return exclusive(async () => {
    const { settings } = await loadState();
    const reportOnly = preview || settings.dryRun;
    const inboxes = await getIncludedInboxes(settings);

    const folders = [];
    let total = 0;
    let moved = 0;

    for (const inbox of inboxes) {
      const subFolders = await api().folders.getSubFolders(inbox.id, false);

      for (const sub of subFolders) {
        const flagged = await getFlaggedMessages(sub.id);
        if (flagged.length === 0) continue;

        folders.push({ inbox: `${inbox.name} (${inbox.accountId})`, folder: sub.name, count: flagged.length });
        total += flagged.length;

        if (!reportOnly) {
          await moveMessages(flagged, inbox);
          moved += flagged.length;
          console.log(`⭐ ${flagged.length} liputettua ${sub.name} → ${inbox.name}`);
        }
      }
    }

    const result = { preview, dryRun: settings.dryRun, reportOnly, folders, total, moved };
    console.log(reportOnly ? "⭐ Liputetut alikansioissa (ei siirretty):" : "⭐ Liputetut palautettu Saapuneisiin:");
    console.table(folders);
    return result;
  });
}
