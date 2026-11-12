import { test } from "node:test";
import assert from "node:assert/strict";
import { QUOTES_AND_SPACE, splitAngle, trimChars } from "../src/shared/text.js";
import { cleanAddress } from "../src/shared/validate.js";

test("trimChars poistaa vain reunoilta", () => {
  assert.equal(trimChars(`  "Kauppa 'Oy'"  `, QUOTES_AND_SPACE), "Kauppa 'Oy");
  assert.equal(trimChars("...kauppa.example..", "."), "kauppa.example");
  assert.equal(trimChars('""', QUOTES_AND_SPACE), "");
  assert.equal(trimChars(undefined, "."), "");
});

test("splitAngle: nimi ennen ensimmäistä <-merkkiä", () => {
  assert.deepEqual(splitAngle('"Kauppa Oy" <info@kauppa.example>'), { name: "Kauppa Oy", email: "info@kauppa.example", bracketed: true });
  assert.deepEqual(splitAngle("<info@kauppa.example>"), { name: "", email: "info@kauppa.example", bracketed: true });
  assert.deepEqual(splitAngle("info@kauppa.example"), { name: "info@kauppa.example", email: "", bracketed: false });
  // Sisäkkäiset tai rikkinäiset kulmasulkeet eivät kaada eivätkä jätä osoitetta nimeen
  assert.equal(splitAngle("A <<b@kauppa.example>>").name, "A");
  assert.equal(splitAngle("Nimi <ei loppua").bracketed, false);
});

test("cleanAddress: kulmasulkeet ja mailto pois", () => {
  assert.equal(cleanAddress("<Henkilo@Example.com>"), "henkilo@example.com");
  assert.equal(cleanAddress("mailto:henkilo@example.com"), "henkilo@example.com");
  assert.throws(() => cleanAddress("<<>>"));
});
