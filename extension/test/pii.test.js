import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNameMatcher, containsHetuOrCard, ibanValid, luhnValid, nameParts, redactPersonalData } from "../src/shared/pii.js";
import { privacyOptions, toAiMessageDetailed, toAiSender } from "../src/shared/privacy.js";
import { assertSafeToSend, PII_BLOCKED_MESSAGE } from "../src/shared/aiRequest.js";
import { _test as namesTest } from "../src/shared/protectedNames.js";

const redact = (text, names) => redactPersonalData(text, names ? buildNameMatcher(names) : null);

// Esimerkkiarvot: DVV:n esimerkkihenkilötunnus, standardi testikortti, IBAN-esimerkit
test("henkilötunnus kaikilla vuosisatamerkeillä", () => {
  for (const hetu of ["131052-308T", "131052+308T", "010101A123N", "010101B123N", "010101F123N", "010190Y123N", "010190U123N", "131052-308t"]) {
    const r = redact(`Ajanvaraus ${hetu} vahvistettu`);
    assert.equal(r.text, "Ajanvaraus [hetu] vahvistettu", hetu);
    assert.equal(r.counts.hetu, 1);
  }
});

test("henkilötunnus: väärät osumat", () => {
  for (const text of ["Tilaus 131352-308T", "Viite 320152-308T", "Koodi 131052-30", "Laskunro 1310523084"]) {
    assert.equal(redact(text).counts.hetu, undefined, text);
  }
});

test("puhelinnumerot", () => {
  const cases = [
    "Soita +358 40 123 4567",
    "Soita +358401234567",
    "Soita 00358 40 123 4567",
    "Soita +358 (0)40 123 4567",
    "Soita 040 123 4567",
    "Soita 0401234567",
    "Soita 050-123 4567",
    "Soita 045 1234567",
  ];
  for (const text of cases) assert.equal(redact(text).text, "Soita [puhelin]", text);
});

test("puhelin: väärät osumat", () => {
  for (const text of ["Tilaus 040123", "Lasku 11/2026", "Päivä 12.11.2026", "Summa 1 234,50 €", "Hinta 0,50 €", "Versio 4.0.1"]) {
    assert.equal(redact(text).text, text, text);
  }
});

test("tilinumerot (IBAN)", () => {
  assert.ok(ibanValid("FI2112345600000785"));
  assert.equal(redact("Tili FI21 1234 5600 0007 85 eräpäivä").text, "Tili [tilinumero] eräpäivä");
  assert.equal(redact("Tili FI2112345600000785").text, "Tili [tilinumero]");
  assert.equal(redact("Tili fi21 1234 5600 0007 85").text, "Tili [tilinumero]");
  // Suomalainen tilinumero korvataan, vaikka tarkiste olisi väärä (kirjoitusvirhe)
  assert.equal(redact("Tili FI00 1234 5600 0007 85").text, "Tili [tilinumero]");
  // Muut maat vain kelvollisella tarkisteella; perässä oleva sana ei estä tunnistusta
  assert.equal(redact("IBAN DE89 3704 0044 0532 0130 00 ABC").text, "IBAN [tilinumero] ABC");
  assert.equal(redact("Koodi DE00 3704 0044 0532 0130 00").counts.iban, undefined);
});

test("korttinumerot Luhn-tarkistuksella", () => {
  assert.ok(luhnValid("4111111111111111"));
  assert.equal(redact("Kortti 4111 1111 1111 1111 veloitettu").text, "Kortti [kortti] veloitettu");
  assert.equal(redact("Kortti 4111-1111-1111-1111").text, "Kortti [kortti]");
  assert.equal(redact("Kortti 4111111111111111").text, "Kortti [kortti]");
  assert.equal(redact("Amex 3782 822463 10005").text, "Amex [kortti]");
});

test("kortti: tilausnumero ilman Luhnia ei muutu", () => {
  const order = "1234567890123";
  assert.equal(luhnValid(order), false);
  assert.equal(redact(`Tilaus ${order} lähetetty`).text, `Tilaus ${order} lähetetty`);
  assert.equal(redact("Seuranta 1234 5678 9012 3456").text, "Seuranta 1234 5678 9012 3456");
  // Liian lyhyt tai pitkä
  assert.equal(redact("Viite 411111111111").counts.card, undefined);
});

test("rekisterinumerot", () => {
  assert.equal(redact("Huolto ABC-123 valmis").text, "Huolto [rekisteri] valmis");
  assert.equal(redact("Auto XY-1").text, "Auto [rekisteri]");
  assert.equal(redact("Katsastus ÅÄÖ-12").text, "Katsastus [rekisteri]");
  for (const text of ["COVID-19 ohje", "ISO-9001 sertifikaatti", "abc-123", "ABCD-123", "ABC-1234", "Tuote X-1"]) {
    assert.equal(redact(text).counts.plate, undefined, text);
  }
});

test("suojattavat nimet: koko sana, kirjainkoko ei merkitse, pisin ensin", () => {
  const names = nameParts("Teemu Testaaja");
  assert.deepEqual(names, ["Teemu Testaaja", "Teemu", "Testaaja"]);
  const r = redact("Hei Teemu Testaaja ja teemu, tervetuloa", names);
  assert.equal(r.text, "Hei [nimi] ja [nimi], tervetuloa");
  assert.equal(r.counts.name, 2);
  // Ei osu sanan osaan
  assert.equal(redact("Teemupäivä ja Testaajat", names).text, "Teemupäivä ja Testaajat");
  // Erikoismerkit nimessä eivät riko regexiä
  assert.equal(redact("Kiitos (A+B) Oy", ["(A+B)"]).text, "Kiitos [nimi] Oy");
  assert.equal(buildNameMatcher([]), null);
  assert.deepEqual(nameParts("henkilo@example.com"), []);
});

test("lähettäjä: oletuksena vain verkkotunnus, nimi vain luvalla ja suojattuna", () => {
  const author = "Teemu Testaaja / Kauppa Oy <teemu@kauppa.example>";
  assert.equal(toAiSender(author, { freemailDomains: [] }), "kauppa.example");
  const opts = privacyOptions({ freemailDomains: [], sendSenderName: true }, ["Teemu Testaaja"]);
  assert.equal(toAiSender(author, opts), "[nimi] / Kauppa Oy (kauppa.example)");
  assert.equal(toAiSender("Asiakaspalvelu 040 123 4567 <info@kauppa.example>", opts), "Asiakaspalvelu [puhelin] (kauppa.example)");
});

test("toAiMessageDetailed: korvaukset esikatseluun", () => {
  const options = privacyOptions({ freemailDomains: [], sendSenderName: false }, ["Teemu"]);
  const { message, counts } = toAiMessageDetailed(
    { id: 7, author: "Palvelu <info@palvelu.example>", subject: "Teemu, lasku FI21 1234 5600 0007 85, soita 040 123 4567, kysy info@palvelu.example" },
    options
  );
  assert.equal(message.from, "palvelu.example");
  assert.equal(message.subject, "[nimi], lasku [tilinumero], soita [puhelin], kysy [osoite]");
  assert.deepEqual(counts, { email: 1, iban: 1, phone: 1, name: 1 });
});

test("viimeinen tarkistus estää hetun ja kortin", () => {
  assert.equal(containsHetuOrCard('{"subject":"131052-308T"}'), true);
  assert.equal(containsHetuOrCard('{"subject":"4111 1111 1111 1111"}'), true);
  assert.equal(containsHetuOrCard('{"subject":"Tilaus 1234567890123"}'), false);
  assert.throws(() => assertSafeToSend('{"subject":"131052-308T"}'), new RegExp(PII_BLOCKED_MESSAGE));
  assert.doesNotThrow(() => assertSafeToSend('{"subject":"[hetu] ja [kortti]"}'));
});

test("osoitekirjan vCard-nimet", () => {
  const vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Teemu Testaaja\r\nN:Testaaja;Teemu;;;\r\nEMAIL:teemu@kauppa.example\r\nEND:VCARD";
  assert.deepEqual([...new Set(namesTest.namesFromVCard(vcard))].sort(), ["Teemu", "Teemu Testaaja", "Testaaja"]);
  assert.deepEqual(
    namesTest.namesFromContact({ properties: { DisplayName: "Esimerkki Henkilö" } }).sort(),
    ["Esimerkki", "Esimerkki Henkilö", "Henkilö"]
  );
});
