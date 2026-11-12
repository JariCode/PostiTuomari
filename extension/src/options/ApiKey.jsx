// API-avain ja valinnainen salasanasuojaus. Kaikki avaintoiminnot tehdään taustaskriptissä;
// sivulle palautetaan vain tila ja avaimen 4 viimeistä merkkiä.
import { useState } from "react";
import { MIN_PASSWORD } from "../shared/keyVault.js";
import { LIMITS } from "../shared/validate.js";
import { sendToBackground } from "../shared/useStore.js";
import { ConfirmButton, Notice, Status, useStatus } from "./ui.jsx";

const NOTE =
  "Ilman salasanasuojausta avain tallennetaan salaamattomana Thunderbird-profiiliin tällä koneella. Käytä rajattua avainta ja aseta projektille budjettiraja.";

function PasswordInput({ label, value, onChange, autoComplete = "current-password" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="password" value={value} maxLength={200} autoComplete={autoComplete} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// Yksi lomake: kentät + lähetys, joka tyhjentää salasanat onnistuessaan
function useForm(initial) {
  const [values, setValues] = useState(initial);
  const set = (key) => (v) => setValues((s) => ({ ...s, [key]: v }));
  const reset = () => setValues(initial);
  return { values, set, reset };
}

function KeyField({ value, onChange, placeholder }) {
  return (
    <input
      type="password"
      value={value}
      maxLength={LIMITS.apiKey}
      autoComplete="off"
      spellCheck={false}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ===== Ei suojausta =====

function PlainKey({ keyStatus, setKeyStatus, run }) {
  const key = useForm({ apiKey: "" });
  const protect = useForm({ password: "", confirm: "" });
  const [showProtect, setShowProtect] = useState(false);
  const hasKey = keyStatus.state === "plain";

  const saveKey = async (e) => {
    e.preventDefault();
    const next = await run(() => sendToBackground({ type: "setPlainKey", apiKey: key.values.apiKey.trim() }), "API-avain tallennettu");
    if (next) {
      setKeyStatus(next);
      key.reset();
    }
  };

  const protectKey = async (e) => {
    e.preventDefault();
    const { password, confirm } = protect.values;
    if (password !== confirm) return run(async () => Promise.reject(new Error("Salasanat eivät täsmää")), null);
    const next = await run(() => sendToBackground({ type: "protectKey", password }), "Avain suojattu salasanalla");
    if (next) {
      setKeyStatus(next);
      protect.reset();
      setShowProtect(false);
    }
  };

  return (
    <>
      <form onSubmit={saveKey}>
        <label className="field">
          <span>API-avain</span>
          <span className="muted small block">
            {hasKey ? <>Tallennettu avain: <code>••••{keyStatus.last4}</code> (ei suojattu)</> : "Avainta ei ole tallennettu."}
          </span>
          <KeyField value={key.values.apiKey} onChange={key.set("apiKey")} placeholder={hasKey ? "Korvaa uudella avaimella" : "Liitä OpenAI-avain"} />
        </label>
        <p className="muted small">{NOTE}</p>
        <div className="row">
          <button type="submit" className="primary" disabled={!key.values.apiKey.trim()}>Tallenna avain</button>
          {hasKey && (
            <ConfirmButton danger confirmLabel="Poista avain" onConfirm={() => run(() => sendToBackground({ type: "forgetKey" }).then(setKeyStatus), "API-avain poistettu")}>
              Poista avain
            </ConfirmButton>
          )}
        </div>
      </form>

      {hasKey && !showProtect && (
        <div>
          <button type="button" onClick={() => setShowProtect(true)}>Suojaa avain salasanalla</button>
        </div>
      )}
      {hasKey && showProtect && (
        <form className="card subtle" onSubmit={protectKey}>
          <h3>Suojaa avain salasanalla</h3>
          <p className="muted small">
            Avain salataan (PBKDF2-SHA256, 600 000 kierrosta, AES-GCM). Salasanaa ei tallenneta. Avain avataan kerran
            Thunderbirdin käynnistyksen jälkeen popupista; siihen asti lajittelu toimii pelkillä säännöillä.
            Unohtunutta salasanaa ei voi palauttaa – silloin avain syötetään uudelleen.
          </p>
          <PasswordInput label={`Salasana (vähintään ${MIN_PASSWORD} merkkiä)`} value={protect.values.password} onChange={protect.set("password")} autoComplete="new-password" />
          <PasswordInput label="Salasana uudelleen" value={protect.values.confirm} onChange={protect.set("confirm")} autoComplete="new-password" />
          <div className="row">
            <button type="submit" className="primary" disabled={protect.values.password.length < MIN_PASSWORD}>Suojaa</button>
            <button type="button" onClick={() => { protect.reset(); setShowProtect(false); }}>Peruuta</button>
          </div>
        </form>
      )}
    </>
  );
}

// ===== Suojattu =====

function ProtectedKey({ keyStatus, setKeyStatus, run }) {
  const [mode, setMode] = useState(null); // "unlock" | "password" | "replace" | "remove"
  const form = useForm({ password: "", newPassword: "", confirm: "", apiKey: "" });
  const locked = keyStatus.state === "locked";

  const close = () => {
    form.reset();
    setMode(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = form.values;
    let message;
    let ok;
    if (mode === "unlock") {
      message = { type: "unlockKey", password: v.password };
      ok = "Avain avattu tämän käynnistyksen ajaksi";
    } else if (mode === "password") {
      if (v.newPassword !== v.confirm) return run(async () => Promise.reject(new Error("Uudet salasanat eivät täsmää")), null);
      message = { type: "changeKeyPassword", oldPassword: v.password, newPassword: v.newPassword };
      ok = "Salasana vaihdettu";
    } else if (mode === "replace") {
      message = { type: "replaceProtectedKey", apiKey: v.apiKey.trim(), password: v.password };
      ok = "Avain vaihdettu";
    } else {
      message = { type: "removeKeyProtection", password: v.password };
      ok = "Suojaus poistettu – avain on taas tallennettu salaamattomana";
    }
    const next = await run(() => sendToBackground(message), ok);
    if (next) {
      setKeyStatus(next);
      close();
    }
  };

  return (
    <div className="stack">
      <div>
        <strong>API-avain</strong>{" "}
        <span className="muted small">
          suojattu salasanalla, <code>••••{keyStatus.last4}</code>
        </span>{" "}
        <span className={`badge ${locked ? "warn" : ""}`}>{locked ? "lukossa" : "avattu"}</span>
      </div>
      {locked && <Notice kind="info">Avain on lukossa: lajittelu käyttää vain sääntöjä, kunnes avaat sen tässä tai popupista.</Notice>}
      {!keyStatus.sessionStorage && (
        <Notice kind="warn">
          Thunderbird ei tarjoa istuntotallennusta, joten avattu avain pysyy vain taustaskriptin muistissa ja pitää avata
          uudelleen, kun Thunderbird pysäyttää joutilaan taustaskriptin.
        </Notice>
      )}

      {!mode && (
        <div className="row">
          {locked ? (
            <button type="button" className="primary" onClick={() => setMode("unlock")}>Avaa avain</button>
          ) : (
            <button type="button" onClick={() => run(() => sendToBackground({ type: "lockKey" }).then(setKeyStatus), "Avain lukittu")}>Lukitse nyt</button>
          )}
          <button type="button" onClick={() => setMode("password")}>Vaihda salasana</button>
          <button type="button" onClick={() => setMode("replace")}>Vaihda avain</button>
          <button type="button" onClick={() => setMode("remove")}>Poista suojaus</button>
          <ConfirmButton
            danger
            confirmLabel="Poista avain"
            prompt="Avain ja suojaus poistetaan. Käytä tätä myös, jos salasana on unohtunut."
            onConfirm={() => run(() => sendToBackground({ type: "forgetKey" }).then(setKeyStatus), "API-avain poistettu")}
          >
            Poista avain
          </ConfirmButton>
        </div>
      )}

      {mode && (
        <form className="card subtle" onSubmit={submit}>
          <h3>
            {{ unlock: "Avaa avain", password: "Vaihda salasana", replace: "Vaihda avain", remove: "Poista salasanasuojaus" }[mode]}
          </h3>
          {mode === "replace" && (
            <label className="field">
              <span>Uusi API-avain</span>
              <KeyField value={form.values.apiKey} onChange={form.set("apiKey")} placeholder="Liitä uusi OpenAI-avain" />
            </label>
          )}
          <PasswordInput label={mode === "password" ? "Nykyinen salasana" : "Salasana"} value={form.values.password} onChange={form.set("password")} />
          {mode === "password" && (
            <>
              <PasswordInput label={`Uusi salasana (vähintään ${MIN_PASSWORD} merkkiä)`} value={form.values.newPassword} onChange={form.set("newPassword")} autoComplete="new-password" />
              <PasswordInput label="Uusi salasana uudelleen" value={form.values.confirm} onChange={form.set("confirm")} autoComplete="new-password" />
            </>
          )}
          {mode === "remove" && <p className="muted small">{NOTE}</p>}
          <div className="row">
            <button type="submit" className="primary" disabled={!form.values.password}>
              {{ unlock: "Avaa", password: "Vaihda salasana", replace: "Vaihda avain", remove: "Poista suojaus" }[mode]}
            </button>
            <button type="button" onClick={close}>Peruuta</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ApiKey({ keyStatus, setKeyStatus }) {
  const { status, run } = useStatus();
  if (!keyStatus) return <p className="muted small">Ladataan avaimen tilaa…</p>;
  return (
    <div className="stack">
      {keyStatus.protected ? (
        <ProtectedKey keyStatus={keyStatus} setKeyStatus={setKeyStatus} run={run} />
      ) : (
        <PlainKey keyStatus={keyStatus} setKeyStatus={setKeyStatus} run={run} />
      )}
      <Status status={status} />
    </div>
  );
}
