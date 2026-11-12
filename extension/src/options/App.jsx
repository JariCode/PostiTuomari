import { APP_NAME } from "../shared/constants.js";
import { useKeyStatus, useStore } from "../shared/useStore.js";
import { Accounts } from "./sections/Accounts.jsx";
import { Ai } from "./sections/Ai.jsx";
import { Categories } from "./sections/Categories.jsx";
import { Data } from "./sections/Data.jsx";
import { General } from "./sections/General.jsx";
import { Rules } from "./sections/Rules.jsx";
import { Notice } from "./ui.jsx";

const SECTIONS = [
  ["yleiset", "Yleiset"],
  ["tilit", "Tilit"],
  ["kategoriat", "Kategoriat"],
  ["saannot", "Säännöt"],
  ["ai", "AI"],
  ["tiedot", "Tiedot"],
];

// Tilarivi sivun yläreunassa: tärkeimmät asetukset yhdellä silmäyksellä
const KEY_LABELS = { none: "ei", plain: "asetettu", locked: "suojattu, lukossa", unlocked: "suojattu, avattu" };

export function StatusLine({ settings, keyStatus }) {
  const accounts = settings.accountIds.length;
  const keyState = keyStatus?.state ?? (settings.apiKey ? "plain" : "none");
  const usable = keyState === "plain" || keyState === "unlocked";
  const ai = !settings.aiEnabled ? "pois" : usable ? "päällä" : keyState === "locked" ? "päällä, avain lukossa" : "päällä, avain puuttuu";
  return (
    <div className="status-line" role="status">
      <a href="#yleiset" className={`badge ${settings.dryRun ? "" : "warn"}`}>
        Kuivaharjoitus: {settings.dryRun ? "päällä" : "pois – siirrot käytössä"}
      </a>
      <a href="#tilit" className={`badge ${accounts ? "" : "warn"}`}>Tilejä valittu: {accounts}</a>
      <a href="#ai" className={`badge ${settings.aiEnabled && !usable ? "warn" : ""}`}>AI: {ai}</a>
      <a href="#ai" className="badge">API-avain: {KEY_LABELS[keyState]}</a>
      {settings.verboseLog && <a href="#yleiset" className="badge warn">Yksityiskohtainen loki päällä</a>}
    </div>
  );
}

export function App() {
  const { data, error } = useStore();
  const { status: keyStatus, setStatus: setKeyStatus } = useKeyStatus();

  return (
    <div className="layout">
      <header className="header">
        <h1>{APP_NAME}</h1>
        {data && <StatusLine settings={data.settings} keyStatus={keyStatus} />}
      </header>

      <nav className="nav" aria-label="Osiot">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>{label}</a>
        ))}
      </nav>

      <main className="main">
        {error && <Notice kind="danger">Asetusten lataus epäonnistui: {error}</Notice>}
        {!data && !error && <p className="muted">Ladataan…</p>}
        {data && (
          <>
            <General settings={data.settings} />
            <Accounts settings={data.settings} />
            <Categories categories={data.categories} rules={data.rules} />
            <Rules rules={data.rules} categories={data.categories} aiBlocklist={data.aiBlocklist} />
            <Ai data={data} keyStatus={keyStatus} setKeyStatus={setKeyStatus} />
            <Data data={data} />
          </>
        )}
      </main>
    </div>
  );
}
