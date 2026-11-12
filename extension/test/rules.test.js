import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, isAiBlocked } from "../src/shared/classify.js";
import { cleanAddress, cleanDomain, normalizeRule, normalizeSettings } from "../src/shared/validate.js";
import { createDefaultRules } from "../src/shared/storage.js";
import { DEFAULT_CATEGORIES } from "../src/shared/defaults.js";
import { buildExport, parseImport } from "../src/shared/transfer.js";

const rules = [
  { id: "a", category: "Tilit ja tietoturva", subjectFirst: true, addresses: [], domains: [], subjectWords: ["salasana"] },
  { id: "b", category: "Perhe ja ystävät", subjectFirst: false, addresses: ["henkilo@example.com"], domains: [], subjectWords: [] },
  { id: "c", category: "Raha", subjectFirst: false, addresses: [], domains: ["pankki.example"], subjectWords: ["lasku"] },
];

test("luokittelun järjestys: subjectFirst → osoite → domain → otsikko", () => {
  assert.equal(classify({ author: "Pankki <info@pankki.example>", subject: "Vaihda salasana" }, rules).category, "Tilit ja tietoturva");
  assert.equal(classify({ author: "H <henkilo@example.com>", subject: "lasku" }, rules).category, "Perhe ja ystävät");
  assert.equal(classify({ author: "x@posti.pankki.example", subject: "hei" }, rules).reason, "lähettäjä");
  assert.equal(classify({ author: "x@muu.example", subject: "Lasku 5/2026" }, rules).reason, "otsikko");
  assert.equal(classify({ author: "x@muu.example", subject: "hei" }, rules), null);
});

test("AI-kieltolista: osoite ja domain (myös alidomain)", () => {
  const blocklist = { addresses: ["henkilo@example.com"], domains: ["yksityinen.example"] };
  assert.equal(isAiBlocked({ author: "H <henkilo@example.com>" }, blocklist), true);
  assert.equal(isAiBlocked({ author: "a@posti.yksityinen.example" }, blocklist), true);
  assert.equal(isAiBlocked({ author: "a@kauppa.example" }, blocklist), false);
});

test("osoitteet ja domainit pienillä ilman välilyöntejä", () => {
  assert.equal(cleanAddress("  Henkilo @Example.COM "), "henkilo@example.com");
  assert.equal(cleanDomain(" @Kauppa.Example "), "kauppa.example");
  assert.equal(cleanDomain("*.kauppa.example"), "kauppa.example");
  assert.throws(() => cleanAddress("ei-osoite"));
  assert.throws(() => cleanDomain("ei domain"));
  assert.throws(() => cleanDomain(""));
});

test("sääntö ilman ehtoja tai kategoriaa hylätään", () => {
  assert.equal(normalizeRule({ category: "Raha" }).rule, null);
  assert.equal(normalizeRule({ domains: ["kauppa.example"] }).rule, null);
  assert.equal(normalizeRule({ category: "x".repeat(51), domains: ["kauppa.example"] }).rule, null);
  const { rule } = normalizeRule({ category: " Raha ", subjectWords: [" LASKU ", "lasku", ""] });
  assert.deepEqual(rule.subjectWords, ["lasku"]);
  assert.equal(rule.category, "Raha");
});

test("oletussäännöt ja -asetukset", () => {
  const defaults = createDefaultRules();
  assert.ok(defaults.length > 0);
  assert.ok(defaults.every((r) => DEFAULT_CATEGORIES.includes(r.category)));
  assert.ok(defaults.every((r) => r.addresses.length === 0 && r.domains.length === 0));
  for (const c of ["Terveys", "Vakuutukset", "Perhe ja ystävät", "Kehitys", "Työ"]) {
    assert.ok(DEFAULT_CATEGORIES.includes(c), c);
  }
  const { settings } = normalizeSettings({});
  assert.equal(settings.dryRun, true);
  assert.equal(settings.aiEnabled, false);
  assert.deepEqual(settings.accountIds, []);
});

test("vienti ei sisällä API-avainta, tuonti ei tuo sitä", () => {
  const { settings } = normalizeSettings({ apiKey: "testiavain-1234" });
  const exported = buildExport({ settings, categories: ["Raha"], rules: [rules[2]], aiBlocklist: { addresses: [], domains: [] } });
  assert.equal("apiKey" in exported.settings, false);

  const parsed = parseImport({ ...exported, settings: { ...exported.settings, apiKey: "testiavain-1234" } });
  assert.equal(parsed.settings.apiKey, undefined);
  assert.equal(parsed.warnings.length, 1);
});

test("tuonti lisää puuttuvan kategorian ja hylkää virheelliset", () => {
  const parsed = parseImport({
    format: "postituomari",
    version: 1,
    categories: ["Raha"],
    rules: [
      { category: "Ostokset", domains: ["kauppa.example"] },
      { category: "Raha", domains: ["ei kelpaa"] },
    ],
  });
  assert.deepEqual(parsed.categories, ["Raha", "Ostokset"]);
  assert.equal(parsed.rules.length, 1);
  assert.ok(parsed.errors.length > 0);
  assert.throws(() => parseImport({ format: "muu" }));
});

// ===== Lähettäjä JA otsikko (match: "all") =====

const mixed = [
  { id: "all", category: "Raha", match: "all", subjectFirst: false, addresses: [], domains: ["palvelu.example"], subjectWords: ["lasku"] },
  { id: "dom", category: "Uutiskirjeet", match: "any", subjectFirst: false, addresses: [], domains: ["palvelu.example"], subjectWords: [] },
];

test("all: sama domain + otsikkosana → all-säännön kategoria", () => {
  const v = classify({ author: "Palvelu <info@palvelu.example>", subject: "Lasku 11/2026" }, mixed);
  assert.equal(v.category, "Raha");
  assert.equal(v.reason, "lähettäjä + otsikko");
});

test("all: sama domain ilman sanaa → domain-säännön kategoria", () => {
  const v = classify({ author: "Palvelu <info@palvelu.example>", subject: "Marraskuun uutiset" }, mixed);
  assert.equal(v.category, "Uutiskirjeet");
  assert.equal(v.reason, "lähettäjä");
});

test("all: ei osu pelkällä otsikolla eikä pelkällä lähettäjällä", () => {
  const onlyAll = [mixed[0]];
  assert.equal(classify({ author: "x@muu.example", subject: "Lasku" }, onlyAll), null);
  assert.equal(classify({ author: "info@palvelu.example", subject: "Uutiset" }, onlyAll), null);
});

test("all: tarkistetaan ennen subjectFirst-sääntöjä, keskenään järjestyksessä", () => {
  const rules = [
    { id: "f", category: "Tilit ja tietoturva", match: "any", subjectFirst: true, addresses: [], domains: [], subjectWords: ["lasku"] },
    { id: "a1", category: "Raha", match: "all", subjectFirst: false, addresses: ["laskutus@palvelu.example"], domains: [], subjectWords: ["lasku"] },
    { id: "a2", category: "Ostokset", match: "all", subjectFirst: false, addresses: [], domains: ["palvelu.example"], subjectWords: ["lasku"] },
  ];
  assert.equal(classify({ author: "laskutus@palvelu.example", subject: "Lasku" }, rules).category, "Raha");
  assert.equal(classify({ author: "muu@palvelu.example", subject: "Lasku" }, rules).category, "Ostokset");
  assert.equal(classify({ author: "muu@toinen.example", subject: "Lasku" }, rules).category, "Tilit ja tietoturva");
});

test("laskusana etusijalla ohittaa toisen kategorian domain-säännön (oletussäännöt)", () => {
  const rules = [
    ...createDefaultRules(),
    { id: "kauppa", category: "Ostokset", match: "any", subjectFirst: false, addresses: [], domains: ["kauppa.example"], subjectWords: [] },
  ];
  assert.equal(classify({ author: "info@kauppa.example", subject: "Lasku tilauksesta" }, rules).category, "Raha");
  assert.equal(classify({ author: "info@kauppa.example", subject: "Uutuudet" }, rules).category, "Ostokset");
  // "laina" on tavallinen otsikkosana: domain voittaa
  assert.equal(classify({ author: "info@kauppa.example", subject: "Laina-aika" }, rules).category, "Ostokset");
});

test("all vaatii lähettäjän ja otsikkosanan; vanha sääntö ilman match-kenttää on any", () => {
  assert.equal(normalizeRule({ category: "Raha", match: "all", domains: ["palvelu.example"] }).rule, null);
  assert.equal(normalizeRule({ category: "Raha", match: "all", subjectWords: ["lasku"] }).rule, null);
  const { rule } = normalizeRule({ category: "Raha", match: "all", subjectFirst: true, domains: ["palvelu.example"], subjectWords: ["lasku"] });
  assert.equal(rule.match, "all");
  assert.equal(rule.subjectFirst, false);
  assert.equal(normalizeRule({ category: "Raha", domains: ["palvelu.example"] }).rule.match, "any");
  assert.equal(normalizeRule({ category: "Raha", match: "jotain", domains: ["palvelu.example"] }).rule.match, "any");
});

test("vienti ja tuonti säilyttävät match-kentän", () => {
  const exported = buildExport({
    settings: normalizeSettings({}).settings,
    categories: ["Raha"],
    rules: [mixed[0]],
    aiBlocklist: { addresses: [], domains: [] },
  });
  const parsed = parseImport(JSON.parse(JSON.stringify(exported)));
  assert.equal(parsed.rules[0].match, "all");
});

test("oletuksissa laskut etusijalla ja laina tavallisena", () => {
  const defaults = createDefaultRules();
  const laskut = defaults.find((r) => r.id === "default-raha-laskut");
  assert.equal(laskut.subjectFirst, true);
  assert.deepEqual(laskut.subjectWords, ["lasku", "eräpäivä", "maksumuistutus"]);
  const raha = defaults.find((r) => r.id === "default-raha");
  assert.equal(raha.subjectFirst, false);
  assert.deepEqual(raha.subjectWords, ["laina"]);
  assert.equal(new Set(defaults.map((r) => r.id)).size, defaults.length);
});
