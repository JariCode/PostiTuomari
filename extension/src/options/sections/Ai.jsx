import { useEffect, useState } from "react";
import { buildRequestBody, buildUserContent, isSafeToSend } from "../../shared/aiRequest.js";
import { classify, isAiBlocked } from "../../shared/classify.js";
import { PII_LABELS } from "../../shared/pii.js";
import { privacyOptions, toAiMessageDetailed } from "../../shared/privacy.js";
import {
  ADDRESS_BOOK_PERMISSION,
  addressBookNames,
  collectProtectedNames,
  identityNames,
} from "../../shared/protectedNames.js";
import { api, saveSettings } from "../../shared/storage.js";
import { cleanDomain, cleanProtectedWord, LIMITS } from "../../shared/validate.js";
import { sendToBackground } from "../../shared/useStore.js";
import { ApiKey } from "../ApiKey.jsx";
import { ListField } from "../ListField.jsx";
import { Notice, Section, Status, Toggle, useStatus } from "../ui.jsx";

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

function describeCounts(counts) {
  const parts = Object.entries(counts).map(([type, n]) => `${PII_LABELS[type] ?? type} ×${n}`);
  return parts.length ? parts.join(", ") : "ei korvauksia";
}

function Preview({ data }) {
  const [preview, setPreview] = useState(null);
  const { status, run } = useStatus();

  const load = () =>
    run(async () => {
      const { settings, categories } = data;
      if (!settings.accountIds.length) throw new Error("Valitse ensin tili Tilit-osiossa");
      const messages = await latestMessages(settings.accountIds, PREVIEW_COUNT);
      const options = privacyOptions(settings, await collectProtectedNames(settings));
      const detailed = messages.map((m) => toAiMessageDetailed(m, options));
      const aiMessages = detailed.map((d) => d.message);
      const body = JSON.stringify(buildRequestBody(settings.model, categories, aiMessages));
      setPreview({
        content: JSON.stringify(buildUserContent(categories, aiMessages), null, 2),
        body: JSON.stringify(JSON.parse(body), null, 2),
        rows: aiMessages.map((m, i) => ({ id: m.id, reason: sendReason(messages[i], data), counts: describeCounts(detailed[i].counts) })),
        safe: isSafeToSend(body),
        atSigns: (body.match(/@/g) ?? []).length,
      });
    }, null);

  return (
    <div className="card subtle">
      <h3>Näin viimeisimmät {PREVIEW_COUNT} viestiä lähetettäisiin OpenAI:lle</h3>
      <Notice kind="info">
        OpenAI:lle lähtee vain lähettäjän verkkotunnus (ja nimi, jos sallit sen) sekä otsikko. Sähköpostiosoitteet,
        henkilötunnukset, puhelin-, tili-, kortti- ja rekisterinumerot sekä suojatut nimet korvataan merkinnöillä.
        Viestien sisältöä ei lähetetä. Otsikossa voi silti olla muita henkilötietoja.
      </Notice>
      <button type="button" onClick={load}>{preview ? "Päivitä esikatselu" : "Näytä esikatselu"}</button>
      <Status status={status} />
      {preview && (
        <>
          {preview.safe ? (
            <Notice kind="ok">Tarkistus: pyynnössä ei ole sähköpostiosoitteita, henkilötunnuksia eikä korttinumeroita ({preview.atSigns} @-merkkiä).</Notice>
          ) : (
            <Notice kind="danger">Tarkistus löysi osoitteen, henkilötunnuksen tai korttinumeron – tätä pyyntöä ei lähetettäisi.</Notice>
          )}
          <pre aria-label="Lähetettävät viestit">{preview.content}</pre>
          <table className="small">
            <thead>
              <tr><th>id</th><th>Korvattu</th><th>Oikeassa lajittelussa</th></tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.id}><td>{r.id}</td><td>{r.counts}</td><td>{r.reason}</td></tr>
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

// ===== Henkilötietojen suojaus =====

function NameProtection({ settings }) {
  const [own, setOwn] = useState(null);
  const [bookCount, setBookCount] = useState(null);
  const { status, run } = useStatus();

  useEffect(() => {
    identityNames().then(setOwn, () => setOwn([]));
  }, []);

  useEffect(() => {
    if (!settings.protectAddressBook) return setBookCount(null);
    addressBookNames().then((names) => setBookCount(names.length), () => setBookCount(0));
  }, [settings.protectAddressBook]);

  // Oikeus pyydetään vasta, kun käyttäjä kytkee valinnan päälle
  const toggleAddressBook = (on) =>
    run(async () => {
      if (on) {
        const granted = await api().permissions.request(ADDRESS_BOOK_PERMISSION);
        if (!granted) throw new Error("Osoitekirjan lukuoikeutta ei myönnetty");
        await saveSettings({ protectAddressBook: true });
        return "Osoitekirjan nimet suojataan";
      }
      await saveSettings({ protectAddressBook: false });
      await api().permissions.remove(ADDRESS_BOOK_PERMISSION).catch(() => {});
      return "Osoitekirjan nimiä ei enää lueta";
    }, (text) => text);

  return (
    <div className="card subtle">
      <h3>Henkilötietojen suojaus</h3>
      <Toggle
        label="Lähetä lähettäjän nimi tekoälylle"
        description="Pois päältä (suositus) lähettäjästä lähtee vain verkkotunnus, esim. kauppa.example. Yritysten lähettäjänimissä on usein henkilön nimi."
        checked={settings.sendSenderName}
        onChange={(sendSenderName) => run(() => saveSettings({ sendSenderName }))}
      />
      <p className="small">
        <strong>Oma nimesi suojataan automaattisesti</strong> Thunderbirdin tilien tiedoista:{" "}
        {own === null ? "haetaan…" : own.length ? (
          <span className="chips inline">{own.map((n) => <span key={n} className="chip">{n}</span>)}</span>
        ) : (
          "tileillä ei ole nimeä"
        )}
      </p>
      <ListField
        label="Suojattavat nimet ja sanat"
        help="Esim. perheenjäsenten nimet tai muut sanat, joita ei saa lähettää. Yksi per rivi. Korvataan merkinnällä [nimi]."
        values={settings.protectedWords}
        cleaner={cleanProtectedWord}
        allowSpaces
        onSave={(protectedWords) => saveSettings({ protectedWords })}
      />
      <Toggle
        label="Suojaa myös osoitekirjan nimet"
        description="Lukee yhteystietojen nimet Thunderbirdin osoitekirjasta. Thunderbird kysyy luvan, kun kytket tämän päälle. Nimiä ei tallenneta mihinkään."
        checked={settings.protectAddressBook}
        onChange={toggleAddressBook}
      />
      {settings.protectAddressBook && bookCount !== null && <p className="muted small">Osoitekirjasta {bookCount} suojattavaa nimeä.</p>}
      <Status status={status} />
    </div>
  );
}

// ===== Osio =====

export function Ai({ data, keyStatus, setKeyStatus }) {
  const { settings } = data;
  const [model, setModel] = useState(settings.model);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const { status, run } = useStatus();
  const hasKey = keyStatus && keyStatus.state !== "none";

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
        description={hasKey ? null : "Tarvitsee API-avaimen."}
        checked={settings.aiEnabled}
        onChange={(aiEnabled) => run(() => saveSettings({ aiEnabled }), aiEnabled ? "AI käytössä" : "AI pois päältä")}
      />
      {settings.aiEnabled && keyStatus?.state === "none" && <Notice kind="warn">AI on päällä, mutta API-avain puuttuu. Lajittelu käyttää vain sääntöjä.</Notice>}

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

      <ApiKey keyStatus={keyStatus} setKeyStatus={setKeyStatus} />

      <div className="row">
        <button type="button" onClick={testConnection} disabled={!hasKey || testing}>
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

      <NameProtection settings={settings} />

      <ListField
        label="Ilmaiset sähköpostipalvelut"
        help="Näiden palveluiden lähettäjät ovat yksityishenkilöitä: AI:lle kerrotaan vain ”yksityishenkilö (domain)”. Lisää myös paikalliset palveluntarjoajat (esim. posti.example)."
        values={settings.freemailDomains}
        cleaner={cleanDomain}
        onSave={(freemailDomains) => saveSettings({ freemailDomains })}
      />

      <Preview data={data} />
    </Section>
  );
}
