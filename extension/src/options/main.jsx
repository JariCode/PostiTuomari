import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { APP_NAME } from "../shared/constants.js";

// Väliaikainen sivu – varsinainen asetussivu tulee vaiheessa 4
function Options() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>{APP_NAME} – asetukset</h1>
      <p>Asetussivu on tulossa.</p>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Options />
  </StrictMode>
);
