import { useState } from "react";
import { addCategory, deleteCategory, moveCategory, renameCategory } from "../../shared/storage.js";
import { LIMITS } from "../../shared/validate.js";
import { sendToBackground } from "../../shared/useStore.js";
import { ConfirmButton, Notice, Section, Status, useStatus } from "../ui.jsx";

// Uudelleennimeämisen tulos: säännöt ja kansiot
function describeRename(r) {
  const lines = [r.renamedRules ? `Nimetty uudelleen, ${r.renamedRules} sääntöä päivitetty` : "Nimetty uudelleen"];
  const f = r.folders?.folders ?? [];
  const count = (action) => f.filter((x) => x.action === action).length;
  if (count("rename")) lines.push(r.folders.dryRun ? `Kuivaharjoitus: ${count("rename")} kansiota nimettäisiin uudelleen` : `${count("rename")} kansiota nimetty uudelleen`);
  if (count("exists")) lines.push(`${count("exists")} tilillä uudella nimellä on jo kansio – vanhaa ei nimetty`);
  if (count("error")) lines.push(`${count("error")} kansion nimeäminen epäonnistui`);
  if (f.length && f.every((x) => x.action === "missing")) lines.push("Vanhannimistä kansiota ei ollut");
  return lines.join("\n");
}

export function Categories({ categories, rules }) {
  const { status, run } = useStatus();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(null); // { name, value }

  const usage = (name) => rules.filter((r) => r.category === name).length;

  const add = async (e) => {
    e.preventDefault();
    const ok = await run(() => addCategory(newName), `Kategoria lisätty: ${newName.trim()}`);
    if (ok) setNewName("");
  };

  const saveRename = async (e) => {
    e.preventDefault();
    const { name, value } = editing;
    if (value.trim() === name) return setEditing(null);
    const result = await run(async () => {
      const renamed = await renameCategory(name, value);
      // Samanniminen kansio valittujen tilien Saapuneiden alla (kuivaharjoituksessa vain raportti)
      const folders = await sendToBackground({ type: "renameCategoryFolders", oldName: name, newName: renamed.newName });
      return { ...renamed, folders };
    }, describeRename);
    if (result) setEditing(null);
  };

  return (
    <Section
      id="kategoriat"
      title="Kategoriat"
      description="Kategoriasta tulee kansio Saapuneiden alle. AI saa valita vain näistä kategorioista."
    >
      <Notice kind="info">
        Uudelleennimeäminen päivittää säännöt ja nimeää valittujen tilien Saapuneiden alla olevan samannimisen
        kansion, jos uudella nimellä ei ole jo kansiota (kuivaharjoituksessa vain kerrotaan, mitä tehtäisiin).
        Poisto ei koske Thunderbirdin kansioihin: kansio ja sen viestit jäävät paikalleen.
      </Notice>

      <ol className="list">
        {categories.map((name, i) => {
          const count = usage(name);
          return (
            <li key={name} className="list-item">
              {editing?.name === name ? (
                <form className="row grow" onSubmit={saveRename}>
                  <input
                    type="text"
                    aria-label="Uusi nimi"
                    value={editing.value}
                    maxLength={LIMITS.category}
                    autoFocus
                    onChange={(e) => setEditing({ name, value: e.target.value })}
                  />
                  <button type="submit" className="primary">Tallenna</button>
                  <button type="button" onClick={() => setEditing(null)}>Peruuta</button>
                  {count > 0 && <span className="muted small">{count} sääntöä päivitetään</span>}
                </form>
              ) : (
                <>
                  <span className="grow">
                    <strong>{name}</strong>{" "}
                    <span className="badge">{count === 0 ? "ei sääntöjä" : `${count} ${count === 1 ? "sääntö" : "sääntöä"}`}</span>
                  </span>
                  <button type="button" className="icon" aria-label={`Siirrä ${name} ylös`} disabled={i === 0} onClick={() => run(() => moveCategory(name, -1), null)}>↑</button>
                  <button type="button" className="icon" aria-label={`Siirrä ${name} alas`} disabled={i === categories.length - 1} onClick={() => run(() => moveCategory(name, 1), null)}>↓</button>
                  <button type="button" onClick={() => setEditing({ name, value: name })}>Nimeä</button>
                  <ConfirmButton
                    danger
                    prompt={`${count > 0 ? `${count} ${count === 1 ? "sääntö käyttää" : "sääntöä käyttää"} tätä kategoriaa ja ${count === 1 ? "se poistetaan" : "ne poistetaan"} myös. ` : ""}Thunderbirdin kansioon ei kosketa.`}
                    confirmLabel={count > 0 ? `Poista kategoria ja ${count} sääntöä` : "Poista"}
                    onConfirm={() =>
                      run(() => deleteCategory(name), (r) => (r.deletedRules ? `Poistettu, myös ${r.deletedRules} sääntöä` : "Poistettu"))
                    }
                  >
                    Poista
                  </ConfirmButton>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <form className="row" onSubmit={add}>
        <input
          type="text"
          aria-label="Uusi kategoria"
          placeholder="Uusi kategoria"
          value={newName}
          maxLength={LIMITS.category}
          onChange={(e) => setNewName(e.target.value)}
          className="grow"
        />
        <button type="submit" className="primary" disabled={!newName.trim() || categories.length >= LIMITS.categories}>
          Lisää
        </button>
      </form>
      {categories.length >= LIMITS.categories && <Notice kind="warn">Enintään {LIMITS.categories} kategoriaa.</Notice>}
      <Status status={status} />
    </Section>
  );
}
