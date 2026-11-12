import { useState } from "react";
import { buildRequestBody, buildUserContent, toAiMessages } from "../../shared/aiRequest.js";
import { classify, isAiBlocked } from "../../shared/classify.js";
import { containsEmail } from "../../shared/privacy.js";
import { api, saveSettings } from "../../shared/storage.js";
import { cleanDomain, LIMITS } from "../../shared/validate.js";
import { ListField } from "../ListField.jsx";
import { sendToBackground } from "../useStore.js";
import { ConfirmButton, Notice, Section, Status, Toggle, useStatus } from "../ui.jsx";

const MODEL_SUGGESTIONS = ["gpt-4.1-mini", "gpt-4.1-nano", "gpt-4.1", "gpt-4o-mini"];
const PREVIEW_COUNT = 5;

// ===== Viimeisimmät viestit esikatseluun =====

async function* iterateList(list) {
  for (const msg of list.messages) yield msg;
  while (list.id) {
    list = await api().messages.continueList(list.id);
    for (const msg of list.messages) yield msg;
  }
}

async function collect(list) {
  const result = [];
  for await (const msg of iterateList(list)) result.push(msg);
  return result;
}

// Valittujen tilien Saapuneista uusimmat viestit
async function latestMessages(accountIds, count) {
  const inboxes = (await api().folders.query({ specialUse: ["inbox"] })).filter((i) => accountIds.includes(i.accountId));
  const all = [];
  for (const inbox of inboxes) {
    let messages = [];
    try {
      // Ensin viime viikot, ettei koko Saapuneita tarvitse käydä läpi
      messages = await collect(await api().messages.query({ folderId: inbox.id, fromDate: new Date(Date.now() - 30 * 864e5) }));
    } catch {
      messages = [];
    }
    if (messages.length < count) messages = await collect(await api().messages.list(inbox.id));
    all.push(...messages);
  }
  return all.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, count);
}

// Lähetettäisiinkö viesti AI:lle oikeassa lajittelussa
function sendReason(msg, { rules, aiBlocklist, manualMoves, aiUnsure }) {
  if (msg.flagged) return "ei lähetetä: liputettu";
  if (msg.headerMessageId && Object.hasOwn(manualMoves, msg.headerMessageId)) return "ei lähetetä: käsin lajiteltu";
  const verdict = classify(msg, rules);
  if (verdict) return `ei lähetetä: sääntö osuu (${verdict.category})`;
  if (isAiBlocked(msg, aiBlocklist)) return "ei lähetetä: kieltolistalla";
  if (msg.headerMessageId && Object.hasOwn(aiUnsure, msg.headerMessageId)) return "ei lähetetä: jo todettu epävarmaksi";
  return "lähetettäisiin";
}

function Preview({ data }) {
  const [preview, setPreview] = useState(null);
  const { status, run } = useStatus();

  const load = () =>
    run(async () => {
      const { settings, categories } = data;
      if (!settings.accountIds.length) throw new Error("Valitse ensin tili Tilit-osiossa");
      const messages = await latestMessages(settings.accountIds, PREVIEW_COUNT);
      const aiMessages = toAiMessages(messages, settings.freemailDomains);
      const body = JSON.stringify(buildRequestBody(settings.model, categories, aiMessages));
      setPreview({
        content: JSON.stringify(buildUserContent(categories, aiMessages), null, 2),
        body: JSON.stringify(JSON.parse(body), null, 2),
        reasons: aiMessages.map((m, i) => ({ id: m.id, reason: sendReason(messages[i], data) })),
        blocked: containsEmail(body),
        atSigns: (body.match(/@/g) ?? []).length,
      });
    }, null);

  return (
    <div className="card subtle">
      <h3>Näin viimeisimmät {PREVIEW_COUNT} viestiä lähetettäisiin OpenAI:lle</h3>
      <Notice kind="info">
        OpenAI:lle lähtee vain lähettäjän nimi, domain ja otsikko. Sähköpostiosoitteita ja viestien sisältöä ei lähetetä.
        Otsikossa voi olla henkilötietoja.
      </Notice>
      <button type="button" onClick={load}>{preview ? "Päivitä esikatselu" : "Näytä esikatselu"}</button>
      <Status status={status} />
      {preview && (
        <>
          {preview.blocked ? (
            <Notice kind="danger">Tarkistus löysi sähköpostiosoitteen – tätä pyyntöä ei lähetettäisi.</Notice>
          ) : (
            <Notice kind="ok">Tarkistus: pyynnössä ei ole sähköpostiosoitteita ({preview.atSigns} @-merkkiä).</Notice>
          )}
          <pre aria-label="Lähetettävät viestit">{preview.content}</pre>
          <table className="small">
            <thead>
              <tr><th>id</th><th>Oikeassa lajittelussa</th></tr>
            </thead>
            <tbody>
              {preview.reasons.map((r) => (
                <tr key={r.id}><td>{r.id}</td><td>{r.reason}</td></tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary>Koko pyyntö (ohjeet ja vastausmuoto mukaan lukien)</summary>
            <p className="muted small">
              Lähetetään osoitteeseen https://api.openai.com/v1/chat/completions. API-avain kulkee vain
              Authorization-otsakkeessa, ei pyynnön rungossa.
            </p>
            <pre>{preview.body}</pre>
          </details>
        </>
      )}
    </div>
  );
}

// ===== API-avain =====

function ApiKey({ settings }) {
  const [value, setValue] = useState("");
  const { status, run } = useStatus();
  const hasKey = Boolean(settings.apiKey);

  const save = async (e) => {
    e.preventDefault();
    const key = value.trim();
    if (!key) return;
    const ok = await run(() => saveSettings({ apiKey: key }), "API-avain tallennettu");
    if (ok) setValue("");
  };

  return (
    <form onSubmit={save} className="field">
      <label className="field">
        <span>API-avain</span>
        <span className="muted small block">
          {hasKey ? <>Tallennettu avain: <code>••••{settings.apiKey.slice(-4)}</code></> : "Avainta ei ole tallennettu."}
        </span>
        <input
          type="password"
          value={value}
          maxLength={LIMITS.apiKey}
          autoComplete="off"
          spellCheck={false}
          placeholder={hasKey ? "Korvaa uudella avaimella" : "Liitä OpenAI-avain"}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <p className="muted small">
        Avain tallennetaan salaamattomana Thunderbird-profiiliin tällä koneella. Käytä rajattua avainta ja aseta
        projektille budjettiraja.
      </p>
      <div className="row">
        <button type="submit" className="primary" disabled={!value.trim()}>Tallenna avain</button>
        {hasKey && (
          <ConfirmButton danger confirmLabel="Poista avain" onConfirm={() => run(() => saveSettings({ apiKey: "" }), "API-avain poistettu")}>
            Poista avain
          </ConfirmButton>
        )}
      </div>
      <Status status={status} />
    </form>
  );
}

// ===== Osio =====

export function Ai({ data }) {
  const { settings } = data;
  const [model, setModel] = useState(settings.model);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const { status, run } = useStatus();

  const saveModel = (e) => {
    e.preventDefault();
    run(() => saveSettings({ model: model.trim() }), "Malli tallennettu");
  };

  const testConnection = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await sendToBackground({ type: "testAi" }));
    } catch (err) {
      setTest({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section
      id="ai"
      title="AI"
      description="Viestit, joihin mikään sääntö ei osu, voidaan luokitella OpenAI:n avulla. Jos AI ei osaa päättää, viesti jää Saapuneisiin."
    >
      <Toggle
        label="AI-luokittelu käytössä"
        description={settings.apiKey ? null : "Tarvitsee API-avaimen."}
        checked={settings.aiEnabled}
        onChange={(aiEnabled) => run(() => saveSettings({ aiEnabled }), aiEnabled ? "AI käytössä" : "AI pois päältä")}
      />
      {settings.aiEnabled && !settings.apiKey && <Notice kind="warn">AI on päällä, mutta API-avain puuttuu. Lajittelu käyttää vain sääntöjä.</Notice>}

      <form className="field" onSubmit={saveModel}>
        <label className="field">
          <span>Malli</span>
          <span className="muted small block">Mallin pitää tukea Structured Outputsia (JSON Schema).</span>
          <div className="row">
            <input type="text" list="models" value={model} maxLength={LIMITS.model} spellCheck={false} onChange={(e) => setModel(e.target.value)} className="grow" />
            <button type="submit" disabled={model.trim() === settings.model || !model.trim()}>Tallenna malli</button>
          </div>
          <datalist id="models">
            {MODEL_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      </form>
      <Status status={status} />

      <ApiKey settings={settings} />

      <div className="row">
        <button type="button" onClick={testConnection} disabled={!settings.apiKey || testing}>
          {testing ? "Testataan…" : "Testaa yhteys"}
        </button>
        <span className="muted small">Lähettää yhden keksityn esimerkkiviestin samassa muodossa kuin lajittelu.</span>
      </div>
      {test && (
        <Notice kind={test.ok ? "ok" : "danger"}>
          {test.message}
          {test.ok && test.sampleCategory && <> – esimerkkiviesti luokiteltiin: {test.sampleCategory}</>}
        </Notice>
      )}

      <ListField
        label="Ilmaiset sähköpostipalvelut"
        help="Näiden palveluiden lähettäjät ovat yksityishenkilöitä: AI:lle kerrotaan vain ”yksityishenkilö (domain)” ilman nimeä."
        values={settings.freemailDomains}
        cleaner={cleanDomain}
        onSave={(freemailDomains) => saveSettings({ freemailDomains })}
      />

      <Preview data={data} />
    </Section>
  );
}
