import { useEffect, useState } from "react";
import { addDefaultRule, missingDefaultRules, saveBlocklist, saveRules } from "../../shared/storage.js";
import { cleanAddress, cleanDomain, normalizeRule, splitList } from "../../shared/validate.js";
import { ListField } from "../ListField.jsx";
import { ConfirmButton, Errors, Notice, Section, Status, useStatus } from "../ui.jsx";

const MATCH_HELP = "Esim. sama lähettäjä lähettää laskuja ja uutiskirjeitä.";

function ruleBadges(rule) {
  return (
    <>
      {rule.match === "all" && <span className="badge accent">lähettäjä + otsikko</span>}
      {rule.subjectFirst && <span className="badge warn">otsikko etusijalla</span>}
    </>
  );
}

function Values({ label, values }) {
  if (!values.length) return null;
  return (
    <div className="values">
      <span className="muted small">{label}:</span>
      <span className="chips">
        {values.map((v) => (
          <span key={v} className="chip">{v}</span>
        ))}
      </span>
    </div>
  );
}

// ===== Säännön muokkaus =====

function RuleEditor({ rule, categories, onSave, onCancel }) {
  const [category, setCategory] = useState(rule.category || categories[0] || "");
  const [match, setMatch] = useState(rule.match ?? "any");
  const [subjectFirst, setSubjectFirst] = useState(rule.subjectFirst ?? false);
  const [addresses, setAddresses] = useState((rule.addresses ?? []).join("\n"));
  const [domains, setDomains] = useState((rule.domains ?? []).join("\n"));
  const [words, setWords] = useState((rule.subjectWords ?? []).join("\n"));
  const [errors, setErrors] = useState([]);

  const submit = (e) => {
    e.preventDefault();
    const { rule: clean, errors: errs } = normalizeRule({
      id: rule.id,
      category,
      match,
      subjectFirst,
      addresses: splitList(addresses),
      domains: splitList(domains),
      subjectWords: splitList(words, { allowSpaces: true }),
    });
    setErrors(errs);
    if (!clean || errs.length) return;
    onSave(clean);
  };

  return (
    <form className="rule-editor card" onSubmit={submit}>
      <h3>{rule.id ? "Muokkaa sääntöä" : "Uusi sääntö"}</h3>

      <label className="field">
        <span>Kategoria</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <fieldset className="field">
        <legend>Milloin sääntö osuu</legend>
        <label className="toggle">
          <input type="radio" name="match" checked={match === "any"} onChange={() => setMatch("any")} />
          <span>Riittää että jokin osuu</span>
        </label>
        <label className="toggle">
          <input type="radio" name="match" checked={match === "all"} onChange={() => setMatch("all")} />
          <span>
            Lähettäjän JA otsikon pitää osua
            <span className="muted small block">{MATCH_HELP} Tarkistetaan ennen muita sääntöjä.</span>
          </span>
        </label>
      </fieldset>

      {match === "any" && (
        <label className="toggle">
          <input type="checkbox" checked={subjectFirst} onChange={(e) => setSubjectFirst(e.target.checked)} />
          <span>
            Otsikko etusijalla
            <span className="muted small block">Otsikkosana ratkaisee ennen lähettäjäsääntöjä (esim. tietoturva, laskut).</span>
          </span>
        </label>
      )}

      <div className="grid-3">
        <label className="field">
          <span>Osoitteet</span>
          <span className="muted small block">Yksi per rivi, esim. henkilo@example.com</span>
          <textarea value={addresses} spellCheck={false} onChange={(e) => setAddresses(e.target.value)} />
        </label>
        <label className="field">
          <span>Domainit</span>
          <span className="muted small block">Yksi per rivi, myös alidomainit, esim. kauppa.example</span>
          <textarea value={domains} spellCheck={false} onChange={(e) => setDomains(e.target.value)} />
        </label>
        <label className="field">
          <span>Otsikkosanat</span>
          <span className="muted small block">Yksi per rivi tai pilkulla erotettuna, osa sanaa riittää</span>
          <textarea value={words} spellCheck={false} onChange={(e) => setWords(e.target.value)} />
        </label>
      </div>

      <Errors errors={errors} />
      <div className="row">
        <button type="submit" className="primary">Tallenna sääntö</button>
        <button type="button" onClick={onCancel}>Peruuta</button>
      </div>
    </form>
  );
}

// ===== Yksi sääntö listassa =====

function RuleCard({ rule, position, onEdit, onDelete, onMove, canUp, canDown, showCategory }) {
  return (
    <li className="rule card">
      <div className="row">
        <span className="badge" title="Järjestys sääntölistassa">#{position}</span>
        {showCategory && <strong>{rule.category}</strong>}
        {ruleBadges(rule)}
        <span className="spacer" />
        {onMove && (
          <>
            <button type="button" className="icon" aria-label="Siirrä ylös" disabled={!canUp} onClick={() => onMove(-1)}>↑</button>
            <button type="button" className="icon" aria-label="Siirrä alas" disabled={!canDown} onClick={() => onMove(1)}>↓</button>
          </>
        )}
        <button type="button" onClick={onEdit}>Muokkaa</button>
        <ConfirmButton danger confirmLabel="Poista sääntö" onConfirm={onDelete}>Poista</ConfirmButton>
      </div>
      <Values label="Osoitteet" values={rule.addresses} />
      <Values label="Domainit" values={rule.domains} />
      <Values label="Otsikkosanat" values={rule.subjectWords} />
    </li>
  );
}

// ===== Puuttuvat oletussäännöt =====

function DefaultRules({ rules }) {
  const [missing, setMissing] = useState(null);
  const { status, run } = useStatus();

  useEffect(() => {
    missingDefaultRules().then(setMissing, () => setMissing([]));
  }, [rules]);

  if (!missing?.length) return null;
  return (
    <div className="card subtle">
      <h3>Oletussäännöt, joita ei ole käytössä</h3>
      <p className="muted small">Lisää yksittäinen oletussääntö muuttamatta omia sääntöjäsi. Se sijoitetaan oletusjärjestyksen mukaiseen kohtaan.</p>
      <ul className="list">
        {missing.map((r) => (
          <li key={r.id} className="list-item">
            <span className="grow">
              <strong>{r.category}</strong> {ruleBadges(r)}{" "}
              <span className="muted small">{r.subjectWords.join(", ")}</span>
            </span>
            <button type="button" onClick={() => run(() => addDefaultRule(r.id), "Oletussääntö lisätty")}>Lisää</button>
          </li>
        ))}
      </ul>
      <Status status={status} />
    </div>
  );
}

// ===== Osio =====

export function Rules({ rules, categories, aiBlocklist }) {
  const [view, setView] = useState("category"); // "category" | "order"
  const [editing, setEditing] = useState(null); // sääntö tai {} uudelle
  const [filter, setFilter] = useState("");
  const { status, run } = useStatus();

  const save = (next, text = "Säännöt tallennettu") => run(() => saveRules(next), text);

  const saveRule = async (rule) => {
    const exists = rules.some((r) => r.id === rule.id);
    const next = exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule];
    const ok = await save(next, exists ? "Sääntö tallennettu" : "Sääntö lisätty listan loppuun");
    if (ok) setEditing(null);
  };

  const remove = (id) => save(rules.filter((r) => r.id !== id), "Sääntö poistettu");

  const move = (index, delta) => {
    const next = [...rules];
    const to = index + delta;
    [next[index], next[to]] = [next[to], next[index]];
    save(next, null);
  };

  const needle = filter.trim().toLowerCase();
  const visible = (r) =>
    !needle ||
    r.category.toLowerCase().includes(needle) ||
    [...r.addresses, ...r.domains, ...r.subjectWords].some((v) => v.includes(needle));

  const position = new Map(rules.map((r, i) => [r.id, i + 1]));
  const orphans = rules.filter((r) => !categories.includes(r.category));

  return (
    <Section id="saannot" title="Säännöt">
      <details className="help">
        <summary>Miten säännöt tarkistetaan</summary>
        <ol className="small">
          <li><strong>Lähettäjä + otsikko</strong>: lähettäjän JA otsikkosanan pitää osua. {MATCH_HELP}</li>
          <li><strong>Otsikko etusijalla</strong>: otsikkosana ratkaisee ennen lähettäjää (esim. tietoturva, laskut).</li>
          <li><strong>Osoite</strong>: tarkka lähettäjäosoite.</li>
          <li><strong>Domain</strong>: lähettäjän domain, myös alidomainit.</li>
          <li><strong>Otsikkosanat</strong>: osa otsikosta, kirjainkoolla ei väliä.</li>
        </ol>
        <p className="small muted">Jokaisessa vaiheessa ensimmäinen osuva sääntö voittaa, joten järjestys merkitsee. Järjestystä muutetaan Tarkistusjärjestys-näkymässä. Jos mikään sääntö ei osu, kysytään AI:lta (jos käytössä), muuten viesti jää Saapuneisiin.</p>
      </details>

      <div className="row">
        <div className="segmented" role="group" aria-label="Näkymä">
          <button type="button" className={view === "category" ? "active" : ""} onClick={() => setView("category")}>Kategorioittain</button>
          <button type="button" className={view === "order" ? "active" : ""} onClick={() => setView("order")}>Tarkistusjärjestys</button>
        </div>
        <input type="search" placeholder="Hae säännöistä" aria-label="Hae säännöistä" value={filter} onChange={(e) => setFilter(e.target.value)} className="search" />
        <span className="spacer" />
        <button type="button" className="primary" disabled={!categories.length} onClick={() => setEditing({})}>Uusi sääntö</button>
      </div>

      {editing && (
        <RuleEditor rule={editing} categories={categories} onSave={saveRule} onCancel={() => setEditing(null)} />
      )}
      <Status status={status} />

      {orphans.length > 0 && (
        <Notice kind="warn">{orphans.length} sääntöä käyttää kategoriaa, jota ei ole kategorialistalla. Lisää kategoria tai muokkaa sääntöä.</Notice>
      )}

      {view === "category" &&
        [...categories, ...new Set(orphans.map((r) => r.category))].map((category) => {
          const list = rules.filter((r) => r.category === category && visible(r));
          if (!list.length) return null;
          return (
            <div key={category} className="rule-group">
              <h3>{category} <span className="badge">{list.length}</span></h3>
              <ul className="rules">
                {list.map((r) => (
                  <RuleCard key={r.id} rule={r} position={position.get(r.id)} onEdit={() => setEditing(r)} onDelete={() => remove(r.id)} />
                ))}
              </ul>
            </div>
          );
        })}

      {view === "order" && (
        <ul className="rules">
          {rules.map((r, i) =>
            visible(r) ? (
              <RuleCard
                key={r.id}
                rule={r}
                position={i + 1}
                showCategory
                onEdit={() => setEditing(r)}
                onDelete={() => remove(r.id)}
                onMove={(delta) => move(i, delta)}
                canUp={i > 0}
                canDown={i < rules.length - 1}
              />
            ) : null
          )}
        </ul>
      )}

      {rules.length === 0 && <p className="muted">Ei sääntöjä.</p>}

      <DefaultRules rules={rules} />

      <div className="card subtle">
        <h3>Älä koskaan lähetä AI:lle</h3>
        <p className="muted small">
          Näiden lähettäjien viestejä ei lähetetä AI:lle. Jos mikään sääntö ei osu, viesti jää Saapuneisiin.
        </p>
        <div className="grid-2">
          <ListField
            label="Osoitteet"
            values={aiBlocklist.addresses}
            cleaner={cleanAddress}
            placeholder="henkilo@example.com"
            onSave={(addresses) => saveBlocklist({ ...aiBlocklist, addresses })}
          />
          <ListField
            label="Domainit"
            values={aiBlocklist.domains}
            cleaner={cleanDomain}
            placeholder="example.com"
            onSave={(domains) => saveBlocklist({ ...aiBlocklist, domains })}
          />
        </div>
      </div>
    </Section>
  );
}
