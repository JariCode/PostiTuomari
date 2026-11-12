import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { classifyWithAI, testAiConnection } from "../src/background/ai.js";
import { EMAIL_BLOCKED_MESSAGE, OPENAI_URL, buildRequestBody, parseAiResponse } from "../src/shared/aiRequest.js";
import { containsEmail } from "../src/shared/privacy.js";

const categories = ["Raha", "Ostokset"];
const settings = { apiKey: "testiavain", model: "gpt-4.1-mini", freemailDomains: ["posti.example"], sendSenderName: true };
const state = { settings, categories };

let calls;
let reply;
const quiet = { log: console.log, warn: console.warn, error: console.error };

beforeEach(() => {
  calls = [];
  reply = (body) => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ results: body.__results }) } }],
    }),
  });
  console.log = console.warn = console.error = () => {};
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const ids = JSON.parse(body.messages[1].content).messages.map((m) => m.id);
    return reply({ __results: ids.map((id) => ({ id, category: "Raha" })) });
  };
});

function restoreConsole() {
  Object.assign(console, quiet);
}

const msg = (id, author, subject) => ({ id, author, subject });

test("pyyntö: oikea osoite, avain vain headerissa, ei osoitteita rungossa", async () => {
  const { verdicts, problems } = await classifyWithAI(
    [msg(1, "Kauppa Oy <tilaukset@kauppa.example>", "Lasku – kysy tuki@kauppa.example"), msg(2, "Henkilö <h@posti.example>", "Hei")],
    state
  );
  restoreConsole();

  assert.deepEqual(problems, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENAI_URL);
  assert.equal(calls[0].init.headers.Authorization, "Bearer testiavain");
  assert.ok(!calls[0].init.body.includes("testiavain"));
  assert.equal(containsEmail(calls[0].init.body), false);
  assert.ok(!calls[0].init.body.includes("@"));

  const sent = JSON.parse(calls[0].body.messages[1].content).messages;
  assert.deepEqual(sent, [
    { id: "1", from: "Kauppa Oy (kauppa.example)", subject: "Lasku – kysy [osoite]" },
    { id: "2", from: "yksityishenkilö (posti.example)", subject: "Hei" },
  ]);
  assert.equal(calls[0].body.temperature, 0);
  assert.equal(calls[0].body.response_format.json_schema.strict, true);
  assert.deepEqual(calls[0].body.response_format.json_schema.schema.properties.results.items.properties.category.enum, [
    "Raha", "Ostokset", "Epävarma",
  ]);
  assert.equal(verdicts.get("1"), "Raha");
});

test("erät 50 viestin kokoisia", async () => {
  const many = Array.from({ length: 120 }, (_, i) => msg(i + 1, "Kauppa <a@kauppa.example>", `Tilaus ${i}`));
  const { verdicts } = await classifyWithAI(many, state);
  restoreConsole();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => JSON.parse(c.body.messages[1].content).messages.length), [50, 50, 20]);
  assert.equal(verdicts.size, 120);
});

test("osoite pyynnössä → erää ei lähetetä", async () => {
  // Kategoria, jossa on osoite, ohittaisi anonymisoinnin – tarkistus estää lähetyksen
  const { verdicts, problems } = await classifyWithAI([msg(1, "Kauppa <a@kauppa.example>", "Lasku")], {
    settings,
    categories: ["Raha", "vuoto@kauppa.example"],
  });
  restoreConsole();
  assert.equal(calls.length, 0);
  assert.equal(verdicts.size, 0);
  assert.deepEqual(problems, [EMAIL_BLOCKED_MESSAGE]);
});

test("vastauksesta hyväksytään vain pyydetyt id:t ja sallitut kategoriat", () => {
  const data = {
    choices: [{
      message: {
        content: JSON.stringify({
          results: [
            { id: "1", category: "Raha" },
            { id: "1", category: "Ostokset" },
            { id: "2", category: "Keksitty" },
            { id: "99", category: "Raha" },
            { id: "3", category: "Epävarma" },
          ],
        }),
      },
    }],
  };
  const verdicts = parseAiResponse(data, ["1", "2", "3"], categories);
  assert.deepEqual([...verdicts], [["1", "Raha"], ["3", "Epävarma"]]);
  assert.throws(() => parseAiResponse({ choices: [{ message: { content: "ei json" } }] }, ["1"], categories));
  assert.throws(() => parseAiResponse({}, ["1"], categories));
});

test("HTTP-virhe: ei kaadu, ei avainta virheessä, loput erät jätetään", async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: false, status: 401, json: async () => ({ error: { message: "Incorrect API key provided: testiavain" } }) };
  };
  const many = Array.from({ length: 60 }, (_, i) => msg(i + 1, "Kauppa <a@kauppa.example>", "Tilaus"));
  const { verdicts, problems } = await classifyWithAI(many, state);
  restoreConsole();
  assert.equal(calls.length, 1);
  assert.equal(verdicts.size, 0);
  assert.equal(problems.length, 1);
  assert.ok(!problems[0].includes("testiavain"));
});

test("verkkovirhe ja aikakatkaisu", async () => {
  globalThis.fetch = async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    throw err;
  };
  const { problems } = await classifyWithAI([msg(1, "a@kauppa.example", "x")], state);
  restoreConsole();
  assert.deepEqual(problems, ["aikakatkaisu"]);
});

test("yhteystesti", async () => {
  let result = await testAiConnection(state);
  assert.equal(result.ok, true);
  assert.equal(result.sampleCategory, "Raha");

  result = await testAiConnection({ settings: { ...settings, apiKey: "" }, categories });
  restoreConsole();
  assert.equal(result.ok, false);
});

test("pyynnön runko ilman viestejä ei sisällä osoitteita", () => {
  const body = JSON.stringify(buildRequestBody("gpt-4.1-mini", categories, []));
  assert.equal(containsEmail(body), false);
});
