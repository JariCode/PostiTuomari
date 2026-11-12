import { useState } from "react";
import { api, clearMemory, loadState } from "../../shared/storage.js";
import { applyImport, buildExport, parseImport } from "../../shared/transfer.js";
import { sendToBackground } from "../../shared/useStore.js";
import { ConfirmButton, Errors, Notice, Section, Status, useStatus } from "../ui.jsx";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Selain lataa tiedoston; API-avain ei ole mukana (buildExport poistaa sen)
async function exportToFile() {
  const data = buildExport(await loadState());
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `postituomari-export-${today()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return data;
}

// ===== Tuonti =====

function ImportPreview({ parsed, accounts, current, onApply, onCancel }) {
  const counts = parsed.rules.reduce((acc, r) => ({ ...acc, [r.category]: (acc[r.category] ?? 0) + 1 }), {});
  const matchedAccounts = parsed.accountNames.filter((n) => accounts.some((a) => a.name === n)).length;

  return (
    <div className="card subtle">
      <h3>Tuonnin esikatselu</h3>
      <p>Tuonti korvaa nykyiset kategoriat, säännöt ja AI-kieltolistan. API-avain säilyy ennallaan.</p>
      <table className="small">
        <tbody>
          <tr><th>Kategoriat</th><td className="num">{parsed.categories.length}</td><td className="muted">nyt {current.categories.length}</td></tr>
          <tr><th>Säännöt</th><td className="num">{parsed.rules.length}</td><td className="muted">nyt {current.rules.length}</td></tr>
          <tr>
            <th>Kieltolista</th>
            <td className="num">{parsed.aiBlocklist.addresses.length + parsed.aiBlocklist.domains.length}</td>
            <td className="muted">nyt {current.aiBlocklist.addresses.length + current.aiBlocklist.domains.length}</td>
          </tr>
          {parsed.accountNames.length > 0 && (
            <tr><th>Tilit nimen perusteella</th><td className="num">{matchedAccounts}/{parsed.accountNames.length}</td><td className="muted">löytyi tästä Thunderbirdistä</td></tr>
          )}
          <tr><th>Asetukset</th><td colSpan={2}>{parsed.settings ? "tuodaan (paitsi API-avain)" : "ei mukana – nykyiset säilyvät"}</td></tr>
        </tbody>
      </table>

      {parsed.settings && parsed.settings.dryRun === false && (
        <Notice kind="warn">Tiedostossa kuivaharjoitus on pois päältä: tuonnin jälkeen lajittelu siirtää viestejä oikeasti.</Notice>
      )}

      <details>
        <summary>Säännöt kategorioittain</summary>
        <table className="small">
          <tbody>
            {parsed.categories.map((c) => (
              <tr key={c}><td>{c}</td><td className="num">{counts[c] ?? 0}</td></tr>
            ))}
          </tbody>
        </table>
      </details>

      {parsed.warnings.length > 0 && (
        <Notice kind="warn">
          <ul>{parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Notice>
      )}
      {parsed.errors.length > 0 && (
        <>
          <p><strong>{parsed.errors.length} virheellistä kohtaa jätetään pois:</strong></p>
          <Errors errors={parsed.errors} />
        </>
      )}

      <div className="row">
        <ConfirmButton className="primary" confirmLabel="Korvaa nykyiset säännöt" prompt="Nykyiset säännöt korvataan." onConfirm={onApply}>
          Tallenna tuonti
        </ConfirmButton>
        <button type="button" onClick={onCancel}>Peruuta</button>
      </div>
    </div>
  );
}

function Import({ data }) {
  const [preview, setPreview] = useState(null);
  const [inputKey, setInputKey] = useState(0);
  const { status, run, setStatus } = useStatus();

  const onFile = (e) =>
    run(async () => {
      setPreview(null);
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_IMPORT_BYTES) throw new Error("Tiedosto on liian suuri (max 2 Mt)");
      let json;
      try {
        json = JSON.parse(await file.text());
      } catch {
        throw new Error("Tiedosto ei ole kelvollista JSONia");
      }
      const parsed = parseImport(json);
      const accounts = await api().accounts.list(false);
      setPreview({ parsed, accounts });
    }, null);

  const reset = () => {
    setPreview(null);
    setInputKey((k) => k + 1);
  };

  const apply = () =>
    run(async () => {
      const result = await applyImport(preview.parsed);
      reset();
      return result;
    }, (r) => `Tuotu: ${r ? `${r.accountIds.length} tiliä valittuna` : ""}`.trim());

  return (
    <div className="stack">
      <h3>Tuonti</h3>
      <label className="field">
        <span>Valitse vientitiedosto (.json)</span>
        <input key={inputKey} type="file" accept="application/json,.json" onChange={onFile} />
      </label>
      {preview && (
        <ImportPreview
          parsed={preview.parsed}
          accounts={preview.accounts}
          current={data}
          onApply={apply}
          onCancel={() => { reset(); setStatus(null); }}
        />
      )}
      <Status status={status} />
    </div>
  );
}

// ===== Liputettujen palautus =====

function RestoreFlagged({ settings }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const { status, run } = useStatus();

  const find = () =>
    run(async () => {
      setBusy(true);
      try {
        setPreview(await sendToBackground({ type: "restoreFlagged", preview: true }));
      } finally {
        setBusy(false);
      }
    }, null);

  const restore = () =>
    run(async () => {
      setBusy(true);
      try {
        const result = await sendToBackground({ type: "restoreFlagged", preview: false });
        setPreview(null);
        return result;
      } finally {
        setBusy(false);
      }
    }, (r) => (r.reportOnly ? "Kuivaharjoitus: viestejä ei siirretty" : `${r.moved} liputettua viestiä palautettu Saapuneisiin`));

  return (
    <div className="stack">
      <h3>Palauta liputetut Saapuneisiin</h3>
      <p className="muted small">
        Etsii valittujen tilien Saapuneiden alikansioista liputetut viestit ja siirtää ne takaisin saman tilin
        Saapuneisiin. Palautusta ei kirjata käsin lajitelluksi.
      </p>
      <button type="button" onClick={find} disabled={busy || !settings.accountIds.length}>
        {busy ? "Etsitään…" : "Palauta liputetut Saapuneisiin"}
      </button>
      {!settings.accountIds.length && <p className="muted small">Valitse ensin tili Tilit-osiossa.</p>}

      {preview && preview.total === 0 && <Notice kind="ok">Alikansioissa ei ole liputettuja viestejä.</Notice>}
      {preview && preview.total > 0 && (
        <div className="card subtle">
          <table className="small">
            <thead>
              <tr><th>Tili</th><th>Kansio</th><th className="num">Liputettuja</th></tr>
            </thead>
            <tbody>
              {preview.folders.map((f, i) => (
                <tr key={i}><td>{f.inbox}</td><td>{f.folder}</td><td className="num">{f.count}</td></tr>
              ))}
            </tbody>
          </table>
          {settings.dryRun ? (
            <Notice kind="info">Kuivaharjoitus on päällä, joten viestejä ei siirretä. Ota kuivaharjoitus pois Yleiset-osiosta palauttaaksesi ne.</Notice>
          ) : (
            <ConfirmButton
              className="primary"
              confirmLabel={`Siirrä ${preview.total} viestiä`}
              prompt="Viestit siirretään takaisin Saapuneisiin."
              onConfirm={restore}
              disabled={busy}
            >
              Palauta {preview.total} viestiä
            </ConfirmButton>
          )}
          <button type="button" onClick={() => setPreview(null)}>Sulje</button>
        </div>
      )}
      <Status status={status} />
    </div>
  );
}

// ===== Osio =====

export function Data({ data }) {
  const { status, run } = useStatus();

  return (
    <Section id="tiedot" title="Tiedot">
      <div className="stack">
        <h3>Vienti</h3>
        <p className="muted small">Asetukset, kategoriat, säännöt ja AI-kieltolista JSON-tiedostoksi. API-avain ei ole mukana.</p>
        <div>
          <button type="button" onClick={() => run(exportToFile, "Vientitiedosto luotu")}>Vie JSON-tiedostoksi</button>
        </div>
      </div>

      <Import data={data} />

      <RestoreFlagged settings={data.settings} />

      <div className="stack">
        <h3>Muistit</h3>
        <div className="row">
          <span className="grow">
            <strong>Käsin lajitellut</strong> <span className="badge">{data.manualCount}</span>
            <span className="muted small block">Viestit, jotka siirsit itse. Lajittelu ei siirrä niitä.</span>
          </span>
          <ConfirmButton
            danger
            disabled={!data.manualCount}
            confirmLabel="Tyhjennä"
            prompt="Seuraava lajittelu voi siirtää näitä viestejä uudelleen."
            onConfirm={() => run(() => clearMemory("manualMoves"), "Käsin lajiteltujen muisti tyhjennetty")}
          >
            Tyhjennä
          </ConfirmButton>
        </div>
        <div className="row">
          <span className="grow">
            <strong>Epävarmat</strong> <span className="badge">{data.unsureCount}</span>
            <span className="muted small block">Viestit, joista AI ei osannut päättää. Niitä ei kysytä uudelleen.</span>
          </span>
          <ConfirmButton
            danger
            disabled={!data.unsureCount}
            confirmLabel="Tyhjennä"
            prompt="Seuraava lajittelu kysyy näitä AI:lta uudelleen."
            onConfirm={() => run(() => clearMemory("aiUnsure"), "Epävarmojen muisti tyhjennetty")}
          >
            Tyhjennä
          </ConfirmButton>
        </div>
      </div>
      <Status status={status} />
    </Section>
  );
}
