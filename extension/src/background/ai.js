// AI-luokittelu suoraan OpenAI:lta. Ainoa ulkoinen yhteys on https://api.openai.com.
// Lähtee vain anonymisoitu lähettäjä (nimi + domain) ja otsikko – ei osoitteita, ei sisältöä.
// API-avainta ei koskaan kirjoiteta lokiin eikä virheilmoituksiin.
import {
  AI_BATCH_SIZE,
  AI_TIMEOUT_MS,
  EMAIL_BLOCKED_MESSAGE,
  OPENAI_URL,
  assertNoEmails,
  buildRequestBody,
  parseAiResponse,
  toAiMessages,
} from "../shared/aiRequest.js";

// HTTP-virhe selkokielelle. Vastauksen runkoa ei lueta, koska siinä voi olla osa avaimesta.
function httpError(status) {
  if (status === 401) return new Error("API-avain ei kelpaa (401)");
  if (status === 403) return new Error("avaimella ei ole oikeutta Chat completionsiin tai malliin (403)");
  if (status === 404) return new Error("mallia ei löydy (404)");
  if (status === 429) return new Error("käyttöraja tai budjetti täynnä (429)");
  return new Error(`OpenAI vastasi ${status}`);
}

function networkError(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return new Error("aikakatkaisu");
  return new Error("verkkovirhe");
}

// Lähettää yhden pyynnön. body on jo tarkistettu JSON-merkkijono.
async function post(apiKey, body) {
  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body,
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      credentials: "omit",
      cache: "no-store",
    });
  } catch (err) {
    throw networkError(err);
  }
  if (!response.ok) throw httpError(response.status);
  try {
    return await response.json();
  } catch {
    throw new Error("vastaus ei ollut JSONia");
  }
}

// Luokittelee viestit erissä. Palauttaa { verdicts: Map id → kategoria, problems: [] }.
// Erä, josta löytyy osoite, jätetään lähettämättä. Verkko- tai HTTP-virhe lopettaa loput erät.
export async function classifyWithAI(messages, { settings, categories }) {
  const verdicts = new Map();
  const problems = [];

  for (let i = 0; i < messages.length; i += AI_BATCH_SIZE) {
    const batchNo = i / AI_BATCH_SIZE + 1;
    const aiMessages = toAiMessages(messages.slice(i, i + AI_BATCH_SIZE), settings.freemailDomains);
    const body = JSON.stringify(buildRequestBody(settings.model, categories, aiMessages));

    try {
      assertNoEmails(body);
    } catch (err) {
      console.error(`⛔ AI-erä ${batchNo}: ${EMAIL_BLOCKED_MESSAGE}`);
      problems.push(err.message);
      continue;
    }

    try {
      const data = await post(settings.apiKey, body);
      const batchVerdicts = parseAiResponse(data, aiMessages.map((m) => m.id), categories);
      for (const [id, category] of batchVerdicts) verdicts.set(id, category);
      console.log(`🤖 AI-erä ${batchNo}: ${batchVerdicts.size}/${aiMessages.length} viestiä`);
    } catch (err) {
      console.warn(`⚠️ AI-erä ${batchNo}: ${err.message}`);
      problems.push(err.message);
      break;
    }
  }

  return { verdicts, problems };
}

// "Testaa yhteys": yksi keksitty viesti samalla pyyntömuodolla kuin oikeassa lajittelussa,
// jolloin samalla varmistuu, että malli tukee Structured Outputsia.
export async function testAiConnection({ settings, categories }) {
  if (!settings.apiKey) return { ok: false, message: "API-avain puuttuu" };

  const sample = [{ id: "1", from: "Verkkokauppa (kauppa.example)", subject: "Tilausvahvistus" }];
  const body = JSON.stringify(buildRequestBody(settings.model, categories, sample));

  try {
    assertNoEmails(body);
    const started = Date.now();
    const data = await post(settings.apiKey, body);
    const verdicts = parseAiResponse(data, ["1"], categories);
    return {
      ok: true,
      message: `Yhteys toimii (${settings.model}, ${Date.now() - started} ms)`,
      sampleCategory: verdicts.get("1") ?? null,
    };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
