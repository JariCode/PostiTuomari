// Asetussivun pienet käyttöliittymäpalat
import { useCallback, useEffect, useRef, useState } from "react";

export function Section({ id, title, description, children }) {
  return (
    <section id={id} className="card section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {description && <p className="muted">{description}</p>}
      <div className="stack">{children}</div>
    </section>
  );
}

export function Toggle({ label, description, checked, onChange, disabled }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        {description && <span className="muted small block">{description}</span>}
      </span>
    </label>
  );
}

export function Notice({ kind = "info", children }) {
  return (
    <div className={`notice ${kind}`} role={kind === "danger" ? "alert" : undefined}>
      {children}
    </div>
  );
}

// Virheet listana (esim. syötteiden tarkistus)
export function Errors({ errors }) {
  if (!errors?.length) return null;
  return (
    <Notice kind="danger">
      <ul>
        {errors.slice(0, 20).map((e, i) => (
          <li key={i}>{e}</li>
        ))}
        {errors.length > 20 && <li>…ja {errors.length - 20} muuta</li>}
      </ul>
    </Notice>
  );
}

// Kaksivaiheinen painike: ensin painike, sitten "Vahvista / Peruuta"
export function ConfirmButton({ children, prompt, confirmLabel = "Vahvista", onConfirm, danger, disabled, className = "" }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={`${danger ? "danger" : ""} ${className}`} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }
  return (
    <span className="confirm row">
      {prompt && <span className={danger ? "danger-text" : ""}>{prompt}</span>}
      <button
        type="button"
        className={danger ? "danger solid" : "primary"}
        onClick={async () => {
          setAsking(false);
          await onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" onClick={() => setAsking(false)}>
        Peruuta
      </button>
    </span>
  );
}

// Tallennuksen tila: run(fn, "Tallennettu") näyttää onnistumisen tai virheen
export function useStatus() {
  const [status, setStatus] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = useCallback(async (fn, successText = "Tallennettu") => {
    clearTimeout(timer.current);
    try {
      const result = await fn();
      if (successText) {
        setStatus({ kind: "ok", text: typeof successText === "function" ? successText(result) : successText });
        timer.current = setTimeout(() => setStatus(null), 4000);
      }
      return result;
    } catch (err) {
      setStatus({ kind: "danger", text: err?.message ?? String(err) });
      return undefined;
    }
  }, []);

  return { status, setStatus, run };
}

export function Status({ status }) {
  if (!status) return null;
  return (
    <div className={`notice ${status.kind}`} role="status" aria-live="polite">
      {status.text.split("\n").map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
