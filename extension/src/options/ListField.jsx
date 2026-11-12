// Lista tekstikenttänä (yksi arvo per rivi). Tarkistaa arvot ennen tallennusta.
import { useEffect, useState } from "react";
import { cleanList, splitList } from "../shared/validate.js";
import { Errors, Status, useStatus } from "./ui.jsx";

export function ListField({ label, help, values, cleaner, allowSpaces = false, onSave, placeholder }) {
  const original = values.join("\n");
  const [text, setText] = useState(original);
  const [errors, setErrors] = useState([]);
  const { status, run } = useStatus();

  // Ulkoinen muutos (esim. tuonti) päivittää kentän, jos käyttäjä ei ole muokannut sitä
  useEffect(() => setText(original), [original]);

  const save = async () => {
    const { values: clean, errors: errs } = cleanList(splitList(text, { allowSpaces }), cleaner);
    setErrors(errs);
    if (errs.length) return;
    const ok = await run(() => onSave(clean));
    if (ok !== undefined) setText(clean.join("\n"));
  };

  return (
    <div className="list-field">
      <label className="field">
        <span>{label}</span>
        {help && <span className="muted small block">{help}</span>}
        <textarea value={text} placeholder={placeholder} spellCheck={false} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="row">
        <button type="button" className="primary" disabled={text === original} onClick={save}>Tallenna</button>
        {text !== original && <button type="button" onClick={() => { setText(original); setErrors([]); }}>Peruuta</button>}
      </div>
      <Errors errors={errors} />
      <Status status={status} />
    </div>
  );
}
