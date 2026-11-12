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
