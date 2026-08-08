import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PocketLedgerProvider } from "./store";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container is missing.");

createRoot(container).render(
  <StrictMode>
    <PocketLedgerProvider>
      <App />
    </PocketLedgerProvider>
  </StrictMode>,
);
