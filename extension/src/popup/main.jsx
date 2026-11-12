import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { APP_NAME } from "../shared/constants.js";

// Väliaikainen popup – varsinainen sisältö tulee vaiheessa 5
function Popup() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "0.75rem", minWidth: "16rem" }}>
      <strong>{APP_NAME}</strong>
      <p>Popup on tulossa.</p>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Popup />
  </StrictMode>
);
