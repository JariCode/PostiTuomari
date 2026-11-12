import { APP_NAME } from "../shared/constants.js";
import { useStore } from "../shared/useStore.js";
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

export function App() {
  const { data, error } = useStore();

  return (
    <div className="layout">
      <header className="header">
        <h1>{APP_NAME}</h1>
        {data && (
          <span className={`badge ${data.settings.dryRun ? "" : "warn"}`}>
            {data.settings.dryRun ? "Kuivaharjoitus" : "Siirrot käytössä"}
          </span>
        )}
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
            <Ai data={data} />
            <Data data={data} />
          </>
        )}
      </main>
    </div>
  );
}
