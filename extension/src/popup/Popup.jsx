import { useCallback, useEffect, useState } from "react";
import { APP_NAME, FLAGGED_LABEL } from "../shared/constants.js";
import { domainMatches, getDomain, parseEmail } from "../shared/classify.js";
import { api, loadState, saveRules } from "../shared/storage.js";
import { sendToBackground, useStore } from "../shared/useStore.js";
import { splitAngle } from "../shared/text.js";
import { normalizeRule } from "../shared/validate.js";

const REASONS = {
  unsure: { label: "AI: epävarma", kind: "accent" },
  blocked: { label: "ei AI:lle", kind: "" },
  norule: { label: "ei sääntöä", kind: "" },
};

function formatTime(at) {
  return new Date(at).toLocaleString("fi-FI", { dateStyle: "short", timeStyle: "short" });
}

// "Nimi <osoite>" → { name, email }. Nimi = osa ennen ensimmäistä "<"-merkkiä, ilman regexiä.
// Teksti näytetään Reactilla (ei innerHTML:ää).
function splitSender(author) {
  const email = parseEmail(author);
  const { name } = splitAngle(author);
  return { name: name && name.toLowerCase() !== email ? name : "", email };
}

// ===== Viimeisin ajo =====

export function Summary({ lastRun }) {
  if (!lastRun) return <p className="muted small">Lajittelua ei ole vielä ajettu.</p>;

  const byCategory = {};
  for (const m of lastRun.moves ?? []) byCategory[m.category] = (byCategory[m.category] ?? 0) + m.count;
  const rows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, n]) => sum + n, 0);
  const c = lastRun.counts ?? {};

  return (
    <div className="summary">
      <div className="row">
        <strong>Viimeisin ajo</strong>
        <span className="muted small">{formatTime(lastRun.at)}</span>
        <span className="spacer" />
        <span className={`badge ${lastRun.dryRun ? "" : "warn"}`}>{lastRun.dryRun ? "kuivaharjoitus" : "siirretty"}</span>
      </div>
      <table className="small">
        <tbody>
          {rows.map(([category, count]) => (
            <tr key={category}><td>{category}</td><td className="num">{count}</td></tr>
          ))}
          <tr className="total">
            <th>{lastRun.dryRun ? "Siirtyisi yhteensä" : "Siirtyi yhteensä"}</th>
            <td className="num">{total}</td>
          </tr>
          {c.aiClassified > 0 && (
            <tr><td className="muted">– josta AI luokitteli</td><td className="num muted">{c.aiClassified}</td></tr>
          )}
          <tr><td>{FLAGGED_LABEL} (pysyy Saapuneissa)</td><td className="num">{c.flagged ?? 0}</td></tr>
          <tr><td>Käsin lajiteltu (ei kosketa)</td><td className="num">{c.manual ?? 0}</td></tr>
          <tr>
            <td>
              Jäi Saapuneisiin
              <span className="muted block">ei sääntöä eikä AI-kategoriaa</span>
            </td>
            <td className="num">{c.unmatched ?? 0}</td>
          </tr>
          <tr><td>AI</td><td className="num">{lastRun.ai}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

// ===== Saapuneisiin jääneet =====

async function createSenderRule(author, category, type) {
  const email = parseEmail(author);
  const domain = getDomain(email);
  const { rules, settings } = await loadState();

  if (type === "domain") {
    if (settings.freemailDomains.some((d) => domainMatches(domain, d))) {
      throw new Error("Ilmaiselle sähköpostipalvelulle ei tehdä domain-sääntöä");
    }
    // Tarkka vertailu: sama domain on jo jonkin säännön listalla
    if (rules.some((r) => r.match === "any" && r.domains.some((d) => d === domain))) return "Domainille on jo sääntö";
  } else if (rules.some((r) => r.match === "any" && r.addresses.some((a) => a === email))) {
    return "Osoitteelle on jo sääntö";
  }

  const { rule, errors } = normalizeRule(type === "domain" ? { category, domains: [domain] } : { category, addresses: [email] });
  if (!rule) throw new Error(errors.join(", "));
  await saveRules([...rules, rule]);
  return type === "domain" ? `Sääntö luotu: ${domain} → ${category}` : `Sääntö luotu: osoite → ${category}`;
}

export function UnsortedItem({ item, categories, freemailDomains, onDone }) {
  const [category, setCategory] = useState("");
  const [makeRule, setMakeRule] = useState(false);
  const [ruleType, setRuleType] = useState("address");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { name, email } = splitSender(item.author);
  const freemail = freemailDomains.some((d) => domainMatches(getDomain(email), d));
  const reason = REASONS[item.reason] ?? REASONS.norule;

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendToBackground({ type: "moveToCategory", messageId: item.id, category });
      let note = `Siirretty → ${category}`;
      if (makeRule) {
        try {
          note += `. ${await createSenderRule(item.author, category, freemail ? "address" : ruleType)}`;
        } catch (err) {
          note += `. Sääntöä ei luotu: ${err.message}`;
        }
      }
      onDone(item.id, note);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <li className="item">
      <div className="row">
        <span className="sender grow" title={item.author}>{name || email || "(tuntematon)"}</span>
        <span className={`badge ${reason.kind}`}>{reason.label}</span>
      </div>
      {name && <div className="muted small ellipsis">{email}</div>}
      <div className="subject" title={item.subject}>{item.subject || "(ei otsikkoa)"}</div>
      <div className="row">
        <select aria-label="Kategoria" value={category} onChange={(e) => setCategory(e.target.value)} className="grow">
          <option value="">Valitse kategoria…</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button type="button" className="primary" disabled={!category || busy} onClick={move}>
          {busy ? "…" : "Siirrä"}
        </button>
      </div>
      <div className="row small">
        <label className="inline">
          <input type="checkbox" checked={makeRule} onChange={(e) => setMakeRule(e.target.checked)} />
          Luo sääntö tästä lähettäjästä
        </label>
        {makeRule && (
          <>
            <label className="inline">
              <input type="radio" checked={ruleType === "address" || freemail} onChange={() => setRuleType("address")} />
              osoite
            </label>
            <label className="inline" title={freemail ? "Ilmaiselle palvelulle vain osoitesääntö" : undefined}>
              <input type="radio" disabled={freemail} checked={ruleType === "domain" && !freemail} onChange={() => setRuleType("domain")} />
              domain
            </label>
          </>
        )}
      </div>
      {error && <div className="notice danger small">{error}</div>}
    </li>
  );
}

function Unsorted({ data, refreshKey }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await sendToBackground({ type: "listUnsorted" }));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const done = (id, note) => {
    setList((l) => {
      const item = l.items.find((i) => i.id === id);
      const byReason = { ...l.byReason };
      if (item && byReason[item.reason] > 0) byReason[item.reason]--;
      return { total: l.total - 1, byReason, items: l.items.filter((i) => i.id !== id) };
    });
    setNotes((n) => [note, ...n].slice(0, 3));
  };

  const r = list?.byReason;

  return (
    <div className="unsorted">
      <div className="row">
        <strong>Saapuneissa ilman sääntöä</strong>
        {list && <span className="badge">{list.total}</span>}
        <span className="spacer" />
        <button type="button" className="link small" onClick={load}>Päivitä</button>
      </div>
      {r && list.total > 0 && (
        <div className="row small">
          <span className="badge accent">AI epävarma {r.unsure}</span>
          <span className="badge">ei AI:lle {r.blocked}</span>
          <span className="badge">muut {r.norule}</span>
        </div>
      )}
      <p className="muted small">
        Kaikki Saapuneissa nyt olevat viestit, joihin mikään sääntö ei osu. Luku voi olla suurempi kuin
        ”Jäi Saapuneisiin”: mukana ovat myös viestit, jotka AI luokitteli viime ajossa mutta joita ei siirretty
        (kuivaharjoitus), sekä ajon jälkeen tulleet.
      </p>
      <p className="muted small">
        Valittu siirto tehdään aina (myös kuivaharjoituksessa) ja merkitään käsin lajitelluksi.
      </p>
      {notes.map((n, i) => (
        <div key={i} className="notice ok small">{n}</div>
      ))}
      {error && <div className="notice danger small">{error}</div>}
      {!list && !error && <p className="muted small">Haetaan…</p>}
      {list && list.items.length === 0 && <p className="muted small">Ei luokittelemattomia viestejä.</p>}
      {list && list.items.length > 0 && (
        <ul className="items">
          {list.items.map((item) => (
            <UnsortedItem
              key={item.id}
              item={item}
              categories={data.categories}
              freemailDomains={data.settings.freemailDomains}
              onDone={done}
            />
          ))}
        </ul>
      )}
      {list && list.total > list.items.length && (
        <p className="muted small">Näytetään {list.items.length} uusinta {list.total} viestistä.</p>
      )}
    </div>
  );
}

// ===== Popup =====

export function Popup() {
  const { data, error } = useStore();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const sortNow = async () => {
    setRunning(true);
    setRunError(null);
    try {
      await sendToBackground({ type: "sortNow" });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setRunError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const openOptions = async () => {
    await api().runtime.openOptionsPage();
    window.close();
  };

  if (error) return <main className="popup"><div className="notice danger">{error}</div></main>;
  if (!data) return <main className="popup"><p className="muted">Ladataan…</p></main>;

  const { settings } = data;
  const noAccounts = settings.accountIds.length === 0;

  return (
    <main className="popup">
      <header className="row">
        <strong className="title">{APP_NAME}</strong>
        <span className={`badge ${settings.dryRun ? "" : "warn"}`}>{settings.dryRun ? "Kuivaharjoitus" : "Oikea siirto"}</span>
        <span className="spacer" />
        <button type="button" className="link small" onClick={openOptions}>Asetukset</button>
      </header>

      {noAccounts ? (
        <div className="notice warn small">
          Yhtään tiliä ei ole valittu. <button type="button" className="link" onClick={openOptions}>Valitse tilit asetuksista</button>
        </div>
      ) : (
        <>
          <button type="button" className="primary wide" disabled={running} onClick={sortNow}>
            {running ? "Lajitellaan…" : settings.dryRun ? "Lajittele nyt (kuivaharjoitus)" : "Lajittele nyt"}
          </button>
          <p className="muted small">
            {settings.dryRun
              ? "Kuivaharjoitus: näytetään, mihin viestit menisivät, mutta mitään ei siirretä."
              : "Viestit siirretään kategoriakansioihin. Liputetut ja käsin lajitellut jäävät paikalleen."}
            {" "}AI: {settings.aiEnabled ? (settings.apiKey ? "käytössä" : "avain puuttuu") : "pois päältä"}.
          </p>
          {runError && <div className="notice danger small">{runError}</div>}
        </>
      )}

      <Summary lastRun={data.lastRun} />
      {!noAccounts && <Unsorted data={data} refreshKey={refreshKey} />}
    </main>
  );
}
