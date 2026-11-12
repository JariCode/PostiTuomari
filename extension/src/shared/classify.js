// Sääntöluokittelu: puhtaita funktioita ilman Thunderbird-rajapintoja.

// "Nimi <henkilo@example.com>" → "henkilo@example.com"
export function parseEmail(author = "") {
  const match = String(author ?? "").match(/<([^>]+)>/);
  return (match ? match[1] : String(author ?? "")).trim().toLowerCase();
}

export function getDomain(email) {
  return String(email ?? "").split("@")[1] ?? "";
}

// Osuuko domain listan domainiin (myös alidomainit)
export function domainMatches(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

function senderDomainMatches(email, domain) {
  return domainMatches(getDomain(email), domain);
}

// Löytyykö otsikosta jokin säännön sanoista
function subjectMatches(rule, subject) {
  return (rule.subjectWords ?? []).some((w) => subject.includes(w));
}

// Tuomio: palauttaa { category, reason, ruleId } tai null
export function classify(msg, rules) {
  const email = parseEmail(msg.author);
  const subject = (msg.subject ?? "").toLowerCase();

  // 1. Säännöt, joissa otsikko ohittaa lähettäjän (esim. tietoturva)
  for (const rule of rules) {
    if (rule.subjectFirst && subjectMatches(rule, subject)) {
      return { category: rule.category, reason: "otsikko, etusija", ruleId: rule.id };
    }
  }

  // 2. Tarkka lähettäjäosoite
  for (const rule of rules) {
    if ((rule.addresses ?? []).includes(email)) {
      return { category: rule.category, reason: "osoite", ruleId: rule.id };
    }
  }

  // 3. Lähettäjän domain
  for (const rule of rules) {
    if ((rule.domains ?? []).some((d) => senderDomainMatches(email, d))) {
      return { category: rule.category, reason: "lähettäjä", ruleId: rule.id };
    }
  }

  // 4. Otsikon sanat
  for (const rule of rules) {
    if (subjectMatches(rule, subject)) {
      return { category: rule.category, reason: "otsikko", ruleId: rule.id };
    }
  }

  return null;
}

// Onko lähettäjä "Älä koskaan lähetä AI:lle" -listalla
export function isAiBlocked(msg, blocklist) {
  const email = parseEmail(msg.author);
  if ((blocklist?.addresses ?? []).includes(email)) return true;
  return (blocklist?.domains ?? []).some((d) => senderDomainMatches(email, d));
}
