import { test } from "node:test";
import assert from "node:assert/strict";
import { containsEmail, redactEmails, toAiMessage, toAiSender } from "../src/shared/privacy.js";
import { DEFAULT_FREEMAIL_DOMAINS } from "../src/shared/defaults.js";

const FREEMAIL = [...DEFAULT_FREEMAIL_DOMAINS, "posti.example"];

test("tavallinen yritys: nimi ja domain, ei osoitetta", () => {
  const from = toAiSender("Kauppa Oy <tilaukset@kauppa.example>", FREEMAIL);
  assert.equal(from, "Kauppa Oy (kauppa.example)");
  assert.ok(!from.includes("@"));
  assert.ok(!from.includes("tilaukset"));
});

test("lainausmerkit nimen ympäriltä poistetaan", () => {
  assert.equal(toAiSender('"Kauppa Oy" <info@kauppa.example>', FREEMAIL), "Kauppa Oy (kauppa.example)");
});

test("ilmainen palvelu: yksityishenkilö ilman nimeä", () => {
  assert.equal(toAiSender("Henkilö Esimerkki <henkilo@posti.example>", FREEMAIL), "yksityishenkilö (posti.example)");
  assert.ok(new Set(DEFAULT_FREEMAIL_DOMAINS).has("gmail.com"));
  assert.equal(toAiSender("henkilo@posti.example", FREEMAIL), "yksityishenkilö (posti.example)");
  // Alidomain ja isot kirjaimet
  assert.equal(toAiSender("Joku <X@Mail.Posti.Example>", FREEMAIL), "yksityishenkilö (mail.posti.example)");
});

test("nimi, joka on itse osoite, jätetään pois", () => {
  assert.equal(toAiSender("henkilo@kauppa.example <henkilo@kauppa.example>", FREEMAIL), "kauppa.example");
  assert.equal(toAiSender("'info@kauppa.example' <info@kauppa.example>", FREEMAIL), "kauppa.example");
  // Nimessä @-merkki muussa muodossa
  assert.equal(toAiSender("Tuki @ Kauppa <tuki@kauppa.example>", FREEMAIL), "kauppa.example");
});

test("puuttuva nimi: pelkkä osoite tai tyhjä nimi", () => {
  assert.equal(toAiSender("uutiset@lehti.example", FREEMAIL), "lehti.example");
  assert.equal(toAiSender("<uutiset@lehti.example>", FREEMAIL), "lehti.example");
  assert.equal(toAiSender("", FREEMAIL), "tuntematon");
  assert.equal(toAiSender(undefined, FREEMAIL), "tuntematon");
});

test("pelkkä nimi ilman osoitetta säilyy", () => {
  assert.equal(toAiSender("Järjestelmä", FREEMAIL), "Järjestelmä");
});

test("otsikossa oleva osoite korvataan", () => {
  assert.equal(
    redactEmails("Viesti henkilolta henkilo@example.com ja toinen@kauppa.example"),
    "Viesti henkilolta [osoite] ja [osoite]"
  );
  assert.equal(redactEmails("Ei osoitteita tässä"), "Ei osoitteita tässä");
});

test("toAiMessage: id merkkijonona, ei osoitteita, pituusrajat", () => {
  const msg = {
    id: 42,
    author: "Kauppa Oy <tilaukset@kauppa.example>",
    subject: "Tilauksesi – kysy osoitteesta tuki@kauppa.example " + "x".repeat(600),
    body: "tätä ei saa lähettää",
  };
  const out = toAiMessage(msg, FREEMAIL);
  assert.deepEqual(Object.keys(out), ["id", "from", "subject"]);
  assert.equal(out.id, "42");
  assert.ok(out.subject.length <= 500);
  assert.ok(out.subject.includes("[osoite]"));
  assert.equal(containsEmail(JSON.stringify(out)), false);
});

test("containsEmail tunnistaa osoitteet JSONista", () => {
  assert.equal(containsEmail(JSON.stringify({ from: "henkilo@example.com" })), true);
  assert.equal(containsEmail(JSON.stringify({ from: "Kauppa Oy (kauppa.example)" })), false);
  assert.equal(containsEmail("äiti@esimerkki.example"), true);
});
