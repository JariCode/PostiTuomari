import express from "express";
import cors from "cors";
import OpenAI from "openai";

// ===== Asetukset =====
const PORT = Number(process.env.PORT ?? 3001);
const MODEL = process.env.OPENAI_MODEL;
const UNSURE = "Epävarma";
const MAX_MESSAGES = 50;

if (!process.env.OPENAI_API_KEY || !MODEL) {
  console.error("❌ OPENAI_API_KEY ja OPENAI_MODEL pitää asettaa .env-tiedostoon");
  process.exit(1);
}

const openai = new OpenAI(); // lukee OPENAI_API_KEY:n ympäristöstä

const SYSTEM_PROMPT = `Olet sähköpostin lajittelija.
Saat listan viestejä, joista tiedät vain lähettäjän ja otsikon – et viestin sisältöä.
Valitse jokaiselle viestille täsmälleen yksi kategoria annetusta listasta.
Jos lähettäjä ja otsikko eivät riitä varmaan päätökseen, valitse "${UNSURE}". Älä arvaa.
Palauta jokaiselle viestille sen id muuttamattomana.`;

// ===== Sovellus =====
const app = express();

// Sallitaan vain Thunderbird-laajennus (moz-extension://) ja paikalliset työkalut kuten curl
app.use(
  cors({
    origin: (origin, callback) =>
      callback(null, !origin || origin.startsWith("moz-extension://")),
  })
);
app.use(express.json({ limit: "100kb" }));

// ===== Syötteen tarkistus =====
function validate(body) {
  const { categories, messages } = body ?? {};

  if (!Array.isArray(categories) || categories.length === 0 || categories.length > 30) {
    return "categories: 1–30 kategoriaa";
  }
  if (!categories.every((c) => typeof c === "string" && c.length > 0 && c.length <= 50)) {
    return "categories: virheellinen kategoria";
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return `messages: 1–${MAX_MESSAGES} viestiä`;
  }
  for (const m of messages) {
    if (typeof m?.id !== "string" || typeof m.from !== "string" || typeof m.subject !== "string") {
      return "messages: id, from ja subject pitää olla merkkijonoja";
    }
    if (m.from.length > 300 || m.subject.length > 500) {
      return "messages: liian pitkä kenttä";
    }
  }
  return null;
}

// ===== AI-luokittelu =====
async function classifyWithAI(categories, messages) {
  const allowed = [...categories, UNSURE];

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ categories: allowed, messages }) },
    ],
    // Structured Outputs: malli ei voi palauttaa muuta kuin tämän muotoista JSONia
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "classification",
        strict: true,
        schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  category: { type: "string", enum: allowed },
                },
                required: ["id", "category"],
                additionalProperties: false,
              },
            },
          },
          required: ["results"],
          additionalProperties: false,
        },
      },
    },
  });

  const parsed = JSON.parse(completion.choices[0].message.content);

  // Varmistus: vain pyydetyt id:t ja sallitut kategoriat kelpaavat
  const ids = new Set(messages.map((m) => m.id));
  return parsed.results.filter((r) => ids.has(r.id) && allowed.includes(r.category));
}

// ===== Reitit =====
app.get("/health", (req, res) => {
  res.json({ ok: true, model: MODEL });
});

app.post("/classify", async (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { categories, messages } = req.body;

  try {
    const results = await classifyWithAI(categories, messages);
    console.log(`🤖 Luokiteltu ${results.length}/${messages.length} viestiä`);
    res.json({ results });
  } catch (err) {
    console.error("AI-virhe:", err.message);
    res.status(502).json({ error: "AI-luokittelu epäonnistui" });
  }
});

// Kuunnellaan vain omaa konetta – ei verkkoa
app.listen(PORT, "127.0.0.1", () => {
  console.log(`⚖️ PostiTuomari-backend: http://localhost:${PORT} (malli: ${MODEL})`);
});