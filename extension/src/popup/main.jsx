import { Component, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../shared/theme.css";
import "./popup.css";
import { Popup } from "./Popup.jsx";

// Virhe näytetään popupissa – ei koskaan tyhjää ikkunaa
function CrashMessage({ error }) {
  return (
    <main className="crash">
      <div className="notice danger">
        <strong>PostiTuomarin popup kaatui.</strong>
        <div className="small">Avaa lisäosan konsoli nähdäksesi lisätiedot (ks. README).</div>
      </div>
      <pre>{String(error?.stack || error?.message || error)}</pre>
    </main>
  );
}

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error("PostiTuomari popup:", error);
  }
  render() {
    return this.state.error ? <CrashMessage error={this.state.error} /> : this.props.children;
  }
}

const container = document.getElementById("root");
const root = createRoot(container);

// Reactin ulkopuoliset virheet (esim. käsittelemätön lupaus) – näytetään vain, jos sivu on vielä tyhjä
function showFatal(error) {
  console.error("PostiTuomari popup:", error);
  if (!container.querySelector("main.popup")) root.render(<CrashMessage error={error} />);
}
window.addEventListener("error", (e) => showFatal(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showFatal(e.reason));

root.render(
  <StrictMode>
    <ErrorBoundary>
      <Popup />
    </ErrorBoundary>
  </StrictMode>
);
