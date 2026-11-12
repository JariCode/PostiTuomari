import { UNSURE, FLAGGED_LABEL } from "../shared/constants.js";

// RULES, LOCAL_RULES ja LOCAL_SETTINGS tulevat manifestissa ennen tätä ladattavista
// tiedostoista rules.js ja rules.local.js (siirtyvät storage.local:iin vaiheessa 2).

// ===== Asetukset =====
const SETTINGS = {
  dryRun: false, // true = vain kerrotaan, false = siirretään oikeasti
  ai: {
    enabled: true,
    url: "http://localhost:3001/classify",
    batchSize: 50,    // sama kuin backendin MAX_MESSAGES
    timeoutMs: 30000, // kauanko backendin vastausta odotetaan
  },
};

// Omat säännöt ensin, jotta ne voittavat yleiset
const ALL_RULES = [
  ...(typeof LOCAL_RULES !== "undefined" ? LOCAL_RULES : []),
  ...RULES,
];

// Kaikki kategoriat sääntöjen pohjalta – AI saa valita vain näistä
const CATEGORIES = [...new Set(ALL_RULES.map((r) => r.category))];

// ===== Lajiteltavat tilit =====

// Tilien nimet rules.local.js:stä – jos puuttuu, mitään ei lajitella
const INCLUDED_ACCOUNT_NAMES =
  typeof LOCAL_SETTINGS !== "undefined" ? LOCAL_SETTINGS.accounts ?? [] : [];

let includedAccountIds = new Set();

async function loadIncludedAccounts() {
  const accounts = await messenger.accounts.list(false);

  includedAccountIds = new Set(
    accounts
      .filter((a) => INCLUDED_ACCOUNT_NAMES.includes(a.name))
      .map((a) => a.id)
  );

  for (const a of accounts) {
    const status = includedAccountIds.has(a.id) ? "✅ Lajitellaan" : "⏭️ Ohitetaan";
    console.log(`${status}: ${a.name} (${a.id})`);
  }

  if (includedAccountIds.size === 0) {
    console.warn("⚠️ Yhtään tiliä ei ole valittu – lisää tilin nimi rules.local.js:n LOCAL_SETTINGS.accounts-listaan");
  }
}

// ===== Viestilistat =====

// Käy läpi MessageList-olion kaikki sivut
async function* iterateList(list) {
  for (const msg of list.messages) yield msg;

  while (list.id) {
    list = await messenger.messages.continueList(list.id);
    for (const msg of list.messages) yield msg;
  }
}

// Käy läpi kaikki viestit kansiosta
async function* getMessages(folderId) {
  yield* iterateList(await messenger.messages.list(folderId));
}

// ===== Käsin lajitellut =====

// headerMessageId → kansion polku, johon käyttäjä viestin siirsi
let manualMoves = {};

// Laajennuksen itse siirtämät viestit, jotta ne erotetaan käsin siirretyistä
const movingNow = new Set();

async function loadManualMoves() {
  const data = await messenger.storage.local.get("manualMoves");
  manualMoves = data.manualMoves ?? {};
  console.log(`🖐️ Käsin lajiteltuja muistissa: ${Object.keys(manualMoves).length}`);
}

async function saveManualMoves() {
  await messenger.storage.local.set({ manualMoves });
}

function isManual(msg) {
  return Boolean(msg.headerMessageId) && Object.hasOwn(manualMoves, msg.headerMessageId);
}

// ===== Liputetut =====

// Liputettu (tähdellä merkitty) viesti pysyy aina Saapuneissa
function isFlagged(msg) {
  return msg.flagged === true;
}

// ===== Sääntöluokittelu =====

// "Nimi <henkilo@example.com>" → "henkilo@example.com"
function parseEmail(author = "") {
  const match = author.match(/<([^>]+)>/);
  return (match ? match[1] : author).trim().toLowerCase();
}

function getDomain(email) {
  return email.split("@")[1] ?? "";
}

// Osuuko lähettäjän domain sääntöön (myös alidomainit)
function domainMatches(email, domain) {
  const host = getDomain(email);
  return host === domain || host.endsWith("." + domain);
}

// Löytyykö otsikosta jokin säännön sanoista
function subjectMatches(rule, subject) {
  return (rule.subjectWords ?? []).some((w) => subject.includes(w));
}

// Tuomio: palauttaa { category, reason } tai null
function classify(msg) {
  const email = parseEmail(msg.author);
  const subject = (msg.subject ?? "").toLowerCase();

  // 1. Säännöt, joissa otsikko ohittaa lähettäjän (esim. tietoturva)
  for (const rule of ALL_RULES) {
    if (rule.subjectFirst && subjectMatches(rule, subject)) {
      return { category: rule.category, reason: "otsikko, etusija" };
    }
  }

  // 2. Tarkka lähettäjäosoite
  for (const rule of ALL_RULES) {
    if ((rule.addresses ?? []).includes(email)) {
      return { category: rule.category, reason: "osoite" };
    }
  }

  // 3. Lähettäjän domain
  for (const rule of ALL_RULES) {
    if ((rule.domains ?? []).some((d) => domainMatches(email, d))) {
      return { category: rule.category, reason: "lähettäjä" };
    }
  }

  // 4. Otsikon sanat
  for (const rule of ALL_RULES) {
    if (subjectMatches(rule, subject)) {
      return { category: rule.category, reason: "otsikko" };
    }
  }

  return null;
}

function logVerdict(msg, verdict) {
  const target = verdict ? `${verdict.category} (${verdict.reason})` : "— ei sääntöä";
  console.log(`⚖️ ${target} | ${msg.author} | ${msg.subject}`);
}

// ===== AI-luokittelu =====

// Lähettää viestit backendille erissä. Palauttaa Map: viestin id (merkkijono) → kategoria.
// Backendille lähtee vain id, lähettäjä ja otsikko – ei koskaan viestin sisältöä.
async function classifyWithAI(messages) {
  const verdicts = new Map();
  const { url, batchSize, timeoutMs } = SETTINGS.ai;

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categories: CATEGORIES,
        messages: batch.map((m) => ({
          id: String(m.id),
          from: (m.author ?? "").slice(0, 300),
          subject: (m.subject ?? "").slice(0, 500),
        })),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`backend vastasi ${response.status}`);
    }

    const { results } = await response.json();
    for (const r of results) verdicts.set(r.id, r.category);

    console.log(`🤖 AI-erä ${i / batchSize + 1}: ${results.length}/${batch.length} viestiä`);
  }

  return verdicts;
}

// ===== Kansiot ja siirto =====

// Välimuisti, ettei kansioita haeta joka viestille uudestaan
const folderCache = new Map();

// Saapuneet → Kategoria (luodaan, jos ei ole)
async function getTargetFolder(inboxId, category) {
  const key = `${inboxId}/${category}`;
  if (folderCache.has(key)) return folderCache.get(key);

  const subFolders = await messenger.folders.getSubFolders(inboxId, false);
  let target = subFolders.find((f) => f.name === category);

  if (!target) {
    console.log(`📁 Luodaan kansio: ${category}`);
    target = await messenger.folders.create(inboxId, category);
  }

  folderCache.set(key, target);
  return target;
}

// Laajennuksen oma siirto: merkitään viestit ensin, ettei niitä tulkita käsin siirretyiksi
async function moveMessages(messages, targetFolder) {
  for (const msg of messages) {
    if (msg.headerMessageId) movingNow.add(msg.headerMessageId);
  }
  await messenger.messages.move(messages.map((m) => m.id), targetFolder.id);
}

// Lisää viestin siirtosuunnitelmaan
function addToPlan(plan, inboxId, category, msg) {
  const planKey = `${inboxId}|${category}`;
  if (!plan.has(planKey)) plan.set(planKey, []);
  plan.get(planKey).push(msg);
}

// ===== Lajittelu =====

// Käy saapuneet läpi, kerää siirtosuunnitelman ja toteuttaa sen (ellei dryRun)
async function sortInboxes() {
  const allInboxes = await messenger.folders.query({ specialUse: ["inbox"] });
  const inboxes = allInboxes.filter((i) => includedAccountIds.has(i.accountId));

  const stats = {};
  const unmatchedDomains = {};
  const unmatched = [];         // [{ msg, inboxId }] – viestit ilman sääntöä
  const plan = new Map();       // "inboxId|kategoria" → [viestit]
  const inboxNames = new Map(); // inboxId → "Saapuneet (account1)"

  // 1. Säännöt – luokitellaan ensin kaikki, ei siirretä kesken listauksen
  for (const inbox of inboxes) {
    const label = `${inbox.name} (${inbox.accountId})`;
    inboxNames.set(inbox.id, label);
    console.log(`📥 ${label}`);

    for await (const msg of getMessages(inbox.id)) {
      // Liputetut pysyvät aina Saapuneissa – ei sääntöjä, ei AI:ta
      if (isFlagged(msg)) {
        stats[FLAGGED_LABEL] = (stats[FLAGGED_LABEL] ?? 0) + 1;
        continue;
      }

      // Käsin lajiteltuihin ei kosketa
      if (isManual(msg)) {
        stats["(käsin lajiteltu)"] = (stats["(käsin lajiteltu)"] ?? 0) + 1;
        continue;
      }

      const verdict = classify(msg);
      logVerdict(msg, verdict);

      const key = verdict ? verdict.category : "(ei sääntöä)";
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
  console.log("🔍 Eniten luokittelemattomia lähettäjiä:");
  console.table(top);

  // 2. AI niille, joille ei löytynyt sääntöä
  if (SETTINGS.ai.enabled && unmatched.length > 0) {
    console.log(`🤖 Kysytään AI:lta ${unmatched.length} viestiä...`);

    try {
      const aiVerdicts = await classifyWithAI(unmatched.map((u) => u.msg));
      const aiStats = {};

      for (const { msg, inboxId } of unmatched) {
        const category = aiVerdicts.get(String(msg.id)) ?? UNSURE;
        aiStats[category] = (aiStats[category] ?? 0) + 1;
        console.log(`🤖 ${category} | ${msg.author} | ${msg.subject}`);

        // Epävarmat jäävät Saapuneisiin
        if (category !== UNSURE) addToPlan(plan, inboxId, category, msg);
      }

      console.log("🤖 AI:n tuomiot:");
      console.table(aiStats);
    } catch (err) {
      console.warn(`⚠️ AI ei käytettävissä (${err.message}) – jatketaan pelkillä säännöillä`);
    }
  }

  // 3. Siirrot
  const summary = [...plan].map(([planKey, messages]) => {
    const [inboxId, category] = planKey.split("|");
    return { inbox: inboxNames.get(inboxId), category, count: messages.length };
  });

  if (SETTINGS.dryRun) {
    console.log("🧪 KUIVAHARJOITUS – näin siirrettäisiin (dryRun: true):");
    console.table(summary);
    return;
  }

  console.log("🚚 Siirretään viestit...");
  for (const [planKey, messages] of plan) {
    const [inboxId, category] = planKey.split("|");
    const target = await getTargetFolder(inboxId, category);
    await moveMessages(messages, target);
    console.log(`✅ ${messages.length} viestiä → ${inboxNames.get(inboxId)} / ${category}`);
  }
  console.log("🏁 Valmis");
}

// ===== Käynnistys =====
async function init() {
  await loadIncludedAccounts(); // mitkä tilit lajitellaan
  await loadManualMoves();      // muisti ladataan ennen lajittelua
  await sortInboxes();
}

init().catch(console.error);

// ===== Uusi posti =====
messenger.messages.onNewMailReceived.addListener(async (folder, messageList) => {
  // Vain valitut tilit ja vain saapuneisiin tullut posti
  if (!includedAccountIds.has(folder.accountId)) return;
  if (!folder.specialUse?.includes("inbox")) return;

  for (const msg of messageList.messages) {
    // Liputetut pysyvät aina Saapuneissa
    if (isFlagged(msg)) {
      console.log(`⭐ ${FLAGGED_LABEL}, ei siirretä | ${msg.author} | ${msg.subject}`);
      continue;
    }

    const verdict = classify(msg);
    logVerdict(msg, verdict);

    let category = verdict?.category ?? null;

    // Ei sääntöä → kysytään AI:lta
    if (!category && SETTINGS.ai.enabled) {
      try {
        const aiVerdicts = await classifyWithAI([msg]);
        const aiCategory = aiVerdicts.get(String(msg.id)) ?? UNSURE;
        console.log(`🤖 ${aiCategory} | ${msg.author} | ${msg.subject}`);
        if (aiCategory !== UNSURE) category = aiCategory;
      } catch (err) {
        console.warn(`⚠️ AI ei käytettävissä (${err.message})`);
      }
    }

    if (category && !SETTINGS.dryRun) {
      try {
        const target = await getTargetFolder(folder.id, category);
        await moveMessages([msg], target);
      } catch (err) {
        console.error("Siirto epäonnistui:", err);
      }
    }
  }
});

// ===== Käyttäjän siirrot =====
messenger.messages.onMoved.addListener(async (originalMessages, movedMessages) => {
  let changed = false;

  for await (const msg of iterateList(movedMessages)) {
    if (!msg.headerMessageId) continue;

    // Laajennuksen oma siirto → ei muisteta
    if (movingNow.delete(msg.headerMessageId)) continue;

    // Käyttäjän siirto → muistetaan, ettei lajittelu siirrä sitä takaisin
    manualMoves[msg.headerMessageId] = msg.folder?.path ?? "";
    changed = true;
    console.log(`🖐️ Käsin siirretty, muistetaan: "${msg.subject}" → ${msg.folder?.name}`);
  }

  if (changed) await saveManualMoves();
});