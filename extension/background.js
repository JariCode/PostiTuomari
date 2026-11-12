// ===== Asetukset =====
const SETTINGS = {
  dryRun: true,                // true = vain kerrotaan, false = siirretään oikeasti
  parentFolder: "PostiTuomari", // kansio, jonka alle kategoriat luodaan
};

// Omat säännöt ensin, jotta ne voittavat yleiset
const ALL_RULES = [
  ...(typeof LOCAL_RULES !== "undefined" ? LOCAL_RULES : []),
  ...RULES,
];

// ===== Viestien luku =====

// Käy läpi kaikki viestit kansiosta (API palauttaa ne sivuina)
async function* getMessages(folderId) {
  let page = await messenger.messages.list(folderId);
  for (const msg of page.messages) yield msg;

  while (page.id) {
    page = await messenger.messages.continueList(page.id);
    for (const msg of page.messages) yield msg;
  }
}

// ===== Luokittelu =====

// "Nimi <osoite@domain.fi>" → "osoite@domain.fi"
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

// ===== Kansiot =====

// Välimuisti, ettei kansioita haeta joka viestille uudestaan
const folderCache = new Map();

// Hakee alikansion nimellä tai luo sen, jos sitä ei ole
async function findOrCreateSubfolder(parentId, name) {
  const subFolders = await messenger.folders.getSubFolders(parentId, false);
  const existing = subFolders.find((f) => f.name === name);
  if (existing) return existing;

  console.log(`📁 Luodaan kansio: ${name}`);
  return messenger.folders.create(parentId, name);
}

// Tili → PostiTuomari → Kategoria
async function getTargetFolder(accountId, category) {
  const key = `${accountId}/${category}`;
  if (folderCache.has(key)) return folderCache.get(key);

  const account = await messenger.accounts.get(accountId);
  const parent = await findOrCreateSubfolder(account.rootFolder.id, SETTINGS.parentFolder);
  const target = await findOrCreateSubfolder(parent.id, category);

  folderCache.set(key, target);
  return target;
}

// ===== Lajittelu =====

// Käy saapuneet läpi, kerää siirtosuunnitelman ja toteuttaa sen (ellei dryRun)
async function sortInboxes() {
  const inboxes = await messenger.folders.query({ specialUse: ["inbox"] });
  const stats = {};
  const unmatchedDomains = {};
  const plan = new Map(); // "accountId|kategoria" → [viesti-id:t]

  // 1. Luokitellaan ensin kaikki – ei siirretä kesken listauksen
  for (const inbox of inboxes) {
    console.log(`📥 ${inbox.name} (${inbox.accountId})`);

    for await (const msg of getMessages(inbox.id)) {
      const verdict = classify(msg);
      logVerdict(msg, verdict);

      const key = verdict ? verdict.category : "(ei sääntöä)";
      stats[key] = (stats[key] ?? 0) + 1;

      if (verdict) {
        const planKey = `${inbox.accountId}|${verdict.category}`;
        if (!plan.has(planKey)) plan.set(planKey, []);
        plan.get(planKey).push(msg.id);
      } else {
        const domain = getDomain(parseEmail(msg.author)) || "(tuntematon)";
        unmatchedDomains[domain] = (unmatchedDomains[domain] ?? 0) + 1;
      }
    }
  }

  console.table(stats);

  const top = Object.entries(unmatchedDomains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([domain, count]) => ({ domain, count }));
  console.log("🔍 Eniten luokittelemattomia lähettäjiä:");
  console.table(top);

  // 2. Siirrot
  const summary = [...plan].map(([planKey, ids]) => {
    const [accountId, category] = planKey.split("|");
    return { accountId, category, count: ids.length };
  });

  if (SETTINGS.dryRun) {
    console.log("🧪 KUIVAHARJOITUS – näin siirrettäisiin (dryRun: true):");
    console.table(summary);
    return;
  }

  console.log("🚚 Siirretään viestit...");
  for (const [planKey, ids] of plan) {
    const [accountId, category] = planKey.split("|");
    const target = await getTargetFolder(accountId, category);
    await messenger.messages.move(ids, target.id);
    console.log(`✅ ${ids.length} viestiä → ${SETTINGS.parentFolder}/${category} (${accountId})`);
  }
  console.log("🏁 Valmis");
}

sortInboxes().catch(console.error);

// ===== Uusi posti =====
messenger.messages.onNewMailReceived.addListener(async (folder, messageList) => {
  // Lajitellaan vain saapuneisiin tullut posti (ei esim. roskapostia)
  if (!folder.specialUse?.includes("inbox")) return;

  for (const msg of messageList.messages) {
    const verdict = classify(msg);
    logVerdict(msg, verdict);

    if (verdict && !SETTINGS.dryRun) {
      try {
        const target = await getTargetFolder(folder.accountId, verdict.category);
        await messenger.messages.move([msg.id], target.id);
      } catch (err) {
        console.error("Siirto epäonnistui:", err);
      }
    }
  }
});