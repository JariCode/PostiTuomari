import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeDuplicates } from "../src/shared/duplicates.js";
import { classify } from "../src/shared/classify.js";
import { createDefaultRules } from "../src/shared/storage.js";
import { parseImport } from "../src/shared/transfer.js";
import { normalizeRules } from "../src/shared/validate.js";

const R = (raw) => normalizeRules(raw).rules;

test("tuplasääntö: sama sisältö, etusijallinen jää", () => {
  const rules = R([
    { id: "a", category: "Vakuutukset", subjectWords: ["vakuutus", "korvaushakemus"] },
    { id: "b", category: "Vakuutukset", subjectFirst: true, subjectWords: ["korvaushakemus", "vakuutus"] },
    { id: "c", category: "Vakuutukset", subjectWords: ["vakuutus", "korvaushakemus"] },
  ]);
  const a = analyzeDuplicates(rules);
  assert.equal(a.duplicates.length, 1);
  assert.equal(a.duplicates[0].keep.id, "b");
  assert.deepEqual(a.rules.map((r) => r.id), ["b"]);
  assert.equal(a.removedRules, 2);
});

test("eri kategoria, osumatapa tai arvot eivät ole tuplia", () => {
  const rules = R([
    { id: "a", category: "Raha", domains: ["palvelu.example"] },
    { id: "b", category: "Ostokset", domains: ["palvelu.example"] },
    { id: "c", category: "Raha", match: "all", domains: ["palvelu.example"], subjectWords: ["lasku"] },
    { id: "d", category: "Raha", domains: ["palvelu.example", "toinen.example"] },
  ]);
  const a = analyzeDuplicates(rules);
  assert.equal(a.duplicates.length, 0);
  // d:n palvelu.example on päällekkäinen a:n kanssa (sama kategoria, a ensin)
  assert.deepEqual(a.redundant.map((x) => [x.rule.id, x.field, x.values]), [["d", "domains", ["palvelu.example"]]]);
  assert.deepEqual(a.rules.find((r) => r.id === "d").domains, ["toinen.example"]);
});

test("päällekkäiset sanat: etusijasääntö kattaa tavallisen saman kategorian säännön", () => {
  const rules = R([
    { id: "first", category: "Raha", subjectFirst: true, subjectWords: ["lasku", "eräpäivä", "maksumuistutus"] },
    { id: "old", category: "Raha", subjectWords: ["lasku", "eräpäivä", "maksumuistutus", "laina"] },
  ]);
  const a = analyzeDuplicates(rules);
  assert.deepEqual(a.rules.find((r) => r.id === "old").subjectWords, ["laina"]);
  assert.equal(a.removedValues, 3);
  // Etusijasäännön sanoja ei poisteta, vaikka tavallinen sääntö on listassa ennen sitä
  const reversed = analyzeDuplicates([rules[1], rules[0]]);
  assert.deepEqual(reversed.rules.find((r) => r.id === "first").subjectWords, ["lasku", "eräpäivä", "maksumuistutus"]);
});

test("tyhjäksi jäävä sääntö poistetaan", () => {
  const rules = R([
    { id: "a", category: "Raha", domains: ["pankki.example"], subjectWords: ["lasku"] },
    { id: "b", category: "Raha", subjectWords: ["lasku"] },
  ]);
  const a = analyzeDuplicates(rules);
  assert.deepEqual(a.rules.map((r) => r.id), ["a"]);
  assert.equal(a.removedRules, 1);
});

test("siivous ei muuta lajittelun lopputulosta", () => {
  const rules = R([
    { id: "1", category: "Tilit ja tietoturva", subjectFirst: true, subjectWords: ["salasana"] },
    { id: "2", category: "Raha", subjectFirst: true, subjectWords: ["lasku"] },
    { id: "3", category: "Ostokset", domains: ["kauppa.example"] },
    { id: "4", category: "Raha", subjectWords: ["lasku", "laina"] },
    { id: "5", category: "Ostokset", domains: ["kauppa.example"], subjectWords: ["tilaus"] },
    { id: "6", category: "Raha", match: "all", domains: ["palvelu.example"], subjectWords: ["lasku"] },
    { id: "7", category: "Raha", match: "all", domains: ["palvelu.example"], subjectWords: ["lasku"] },
    { id: "8", category: "Uutiskirjeet", domains: ["palvelu.example"] },
    { id: "9", category: "Uutiskirjeet", subjectWords: ["tilaus", "uutiskirje"] },
  ]);
  const cleaned = analyzeDuplicates(rules).rules;
  assert.ok(cleaned.length < rules.length);
  const authors = ["a@kauppa.example", "b@palvelu.example", "c@muu.example", "d@pankki.example"];
  const subjects = ["Lasku", "Laina", "Tilaus 5", "Uutiskirje", "Vaihda salasana", "Hei", "Lasku ja tilaus"];
  for (const author of authors) {
    for (const subject of subjects) {
      assert.equal(classify({ author, subject }, cleaned)?.category, classify({ author, subject }, rules)?.category, `${author} / ${subject}`);
    }
  }
});

test("oletussäännöissä ei ole tuplia eikä päällekkäisyyksiä", () => {
  const a = analyzeDuplicates(createDefaultRules());
  assert.equal(a.removedRules, 0);
  assert.equal(a.removedValues, 0);
});

test("tuonti siivoaa tuplat ja kertoo siitä", () => {
  const parsed = parseImport({
    format: "postituomari",
    version: 1,
    categories: ["Raha"],
    rules: [
      { category: "Raha", domains: ["pankki.example"] },
      { category: "Raha", domains: ["pankki.example"] },
    ],
  });
  assert.equal(parsed.rules.length, 1);
  assert.ok(parsed.warnings.some((w) => w.startsWith("Tuplat siivottiin")));
});
