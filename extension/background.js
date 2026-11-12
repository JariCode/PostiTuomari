// Omat säännöt ensin, jotta ne voittavat yleiset
const ALL_RULES = [
  ...(typeof LOCAL_RULES !== "undefined" ? LOCAL_RULES : []),
  ...RULES,
];

// Käy läpi kaikki viestit kansiosta (API palauttaa ne sivuina)
async function* getMessages(folderId) {
  let page = await messenger.messages.list(folderId);
  for (const msg of page.messages) yield msg;

  while (page.id) {
    page = await messenger.messages.continueList(page.id);
    for (const msg of page.messages) yield msg;
  }
}

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

// Kuivaharjoitus: käy saapuneet läpi ja kertoo mihin viestit menisivät
async function judgeInboxes() {
  const inboxes = await messenger.folders.query({ specialUse: ["inbox"] });
  const stats = {};
  const unmatchedDomains = {};

  for (const inbox of inboxes) {
    console.log(`📥 ${inbox.name} (${inbox.accountId})`);

    for await (const msg of getMessages(inbox.id)) {
      const verdict = classify(msg);
      logVerdict(msg, verdict);

      const key = verdict ? verdict.category : "(ei sääntöä)";
      stats[key] = (stats[key] ?? 0) + 1;

      if (!verdict) {
        const domain = getDomain(parseEmail(msg.author)) || "(tuntematon)";
        unmatchedDomains[domain] = (unmatchedDomains[domain] ?? 0) + 1;
      }
    }
  }

  console.table(stats);

  // 30 yleisintä domainia, joille ei ole sääntöä
  const top = Object.entries(unmatchedDomains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([domain, count]) => ({ domain, count }));

  console.log("🔍 Eniten luokittelemattomia lähettäjiä:");
  console.table(top);
}

judgeInboxes().catch(console.error);

// Uusi posti
messenger.messages.onNewMailReceived.addListener((folder, messageList) => {
  for (const msg of messageList.messages) {
    logVerdict(msg, classify(msg));
  }
});