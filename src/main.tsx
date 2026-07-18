import "./utils/tauri-console-filter";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { scan } from "react-scan";
import App from "./App.tsx";
import { traceWindowOpen } from "./features/window/utils/window-open-diagnostics.ts";

scan({
  enabled: import.meta.env.VITE_REACT_SCAN === "true",
});

traceWindowOpen("frontend:entry");

const renderStartedAt = performance.now();
traceWindowOpen("reactRender:start");
createRoot(document.getElementById("root")!).render(<App />);
traceWindowOpen("reactRender:scheduled", {
  durationMs: Math.round((performance.now() - renderStartedAt) * 100) / 100,
});
