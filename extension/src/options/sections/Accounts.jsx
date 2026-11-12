import { useEffect, useState } from "react";
import { api, saveSettings } from "../../shared/storage.js";
import { Notice, Section, Status, useStatus } from "../ui.jsx";

const TYPE_LABELS = { imap: "IMAP", pop3: "POP3", nntp: "Uutisryhmät", rss: "RSS", none: "Paikalliset kansiot", owl: "Exchange", ews: "Exchange" };

export function Accounts({ settings }) {
  const [accounts, setAccounts] = useState(null);
  const { status, run } = useStatus();

  useEffect(() => {
    api().accounts.list(false).then(setAccounts, () => setAccounts([]));
  }, []);

  const selected = new Set(settings.accountIds);

  const toggle = (id, on) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    // Tallennetaan vain olemassa olevat tilit
    const valid = [...next].filter((x) => accounts.some((a) => a.id === x));
    run(() => saveSettings({ accountIds: valid }));
  };

  return (
    <Section id="tilit" title="Tilit" description="Vain valittujen tilien Saapuneet lajitellaan. Tilit tunnistetaan Thunderbirdin tilitunnisteesta, joten nimen vaihto ei haittaa.">
      {accounts === null && <p className="muted">Ladataan tilejä…</p>}
      {accounts?.length === 0 && <Notice kind="warn">Thunderbirdissä ei ole tilejä.</Notice>}
      {accounts && accounts.length > 0 && (
        <div className="checklist">
          {accounts.map((a) => (
            <label key={a.id} className="toggle">
              <input type="checkbox" checked={selected.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
              <span>
                <strong>{a.name}</strong>{" "}
                <span className="badge">{TYPE_LABELS[a.type] ?? a.type}</span>{" "}
                <span className="muted small">{a.id}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {accounts && selected.size === 0 && (
        <Notice kind="info">Yhtään tiliä ei ole valittu, joten mitään ei lajitella.</Notice>
      )}
      <Status status={status} />
    </Section>
  );
}
