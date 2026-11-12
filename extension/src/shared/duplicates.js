// Tuplasäännöt ja päällekkäiset arvot. Siivous ei koskaan muuta lajittelun lopputulosta:
// poistetaan vain säännöt ja arvot, joiden osuman sama kategoria saisi joka tapauksessa aiemmin.
//
//   Tuplasääntö:     sama kategoria + osumatapa + osoitteet + domainit + otsikkosanat
//                    (etusija ei vaikuta). Jäljelle jää etusijallinen, muuten ensimmäinen.
//   Päällekkäinen:   arvo, joka on myös toisessa saman kategorian "any"-säännössä,
//                    joka tarkistetaan aina ensin (etusijallinen tai aiempi samassa vaiheessa).

const FIELDS = ["addresses", "domains", "subjectWords"];
export const FIELD_LABELS = { addresses: "osoite", domains: "domain", subjectWords: "otsikkosana" };

export function ruleSignature(rule) {
  const sorted = (list) => [...list].sort().join("\u0001");
  return [rule.category.toLowerCase(), rule.match ?? "any", ...FIELDS.map((f) => sorted(rule[f] ?? []))].join("\u0002");
}

// Onko sääntö a sisällöltään sama kuin b (etusijaa lukuun ottamatta)
export function sameContent(a, b) {
  return ruleSignature(a) === ruleSignature(b);
}

function findDuplicateRules(rules) {
  const groups = new Map();
  for (const rule of rules) {
    const key = ruleSignature(rule);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rule);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const keep = g.find((r) => r.subjectFirst) ?? g[0];
      return { keep, remove: g.filter((r) => r !== keep) };
    });
}

// Tarkistetaanko S aina ennen R:ää kentässä field
function checkedBefore(s, r, field, index) {
  if (field === "subjectWords" && s.subjectFirst !== r.subjectFirst) return s.subjectFirst;
  return index.get(s.id) < index.get(r.id);
}

function findRedundantValues(rules) {
  const index = new Map(rules.map((r, i) => [r.id, i]));
  const result = [];
  const anyRules = rules.filter((r) => (r.match ?? "any") === "any");

  for (const r of anyRules) {
    for (const field of FIELDS) {
      const values = (r[field] ?? []).filter((v) =>
        anyRules.some(
          (s) => s !== r && s.category === r.category && (s[field] ?? []).includes(v) && checkedBefore(s, r, field, index)
        )
      );
      if (values.length) result.push({ rule: r, field, values });
    }
  }
  return result;
}

// Analyysi: { duplicates: [{ keep, remove }], redundant: [{ rule, field, values }], rules: siivottu lista, removedRules, removedValues }
export function analyzeDuplicates(rules) {
  const duplicates = findDuplicateRules(rules);
  const removeIds = new Set(duplicates.flatMap((d) => d.remove.map((r) => r.id)));
  const afterDuplicates = rules.filter((r) => !removeIds.has(r.id));

  const redundant = findRedundantValues(afterDuplicates);
  const strip = new Map(); // rule.id → { field → Set(values) }
  for (const { rule, field, values } of redundant) {
    if (!strip.has(rule.id)) strip.set(rule.id, {});
    strip.get(rule.id)[field] = new Set(values);
  }

  let emptied = 0;
  const cleaned = [];
  for (const rule of afterDuplicates) {
    const s = strip.get(rule.id);
    if (!s) {
      cleaned.push(rule);
      continue;
    }
    const next = { ...rule };
    for (const field of FIELDS) {
      if (s[field]) next[field] = rule[field].filter((v) => !s[field].has(v));
    }
    // Sääntö, josta ei jää mitään, poistetaan kokonaan
    if (FIELDS.every((f) => next[f].length === 0)) {
      emptied++;
      continue;
    }
    cleaned.push(next);
  }

  return {
    duplicates,
    redundant,
    rules: cleaned,
    removedRules: removeIds.size + emptied,
    removedValues: redundant.reduce((n, r) => n + r.values.length, 0),
  };
}

export function hasDuplicates(rules) {
  const a = analyzeDuplicates(rules);
  return a.duplicates.length > 0 || a.redundant.length > 0;
}
