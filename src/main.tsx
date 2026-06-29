import { createRoot } from "react-dom/client";
import "./styles.css";
import { scan } from "react-scan";
import App from "./App.tsx";
import { initializeAppBootstrap } from "./bootstrap/initialize-app-bootstrap";
import { ToastProvider } from "./features/layout/contexts/toast-context.tsx";
import { DialogServiceProvider } from "./features/dialogs/services/dialog-service.tsx";
import { traceWindowOpen } from "./features/window/utils/window-open-diagnostics.ts";

scan({
  enabled: import.meta.env.VITE_REACT_SCAN === "true",
});

traceWindowOpen("frontend:entry");

const bootstrapStartedAt = performance.now();
void initializeAppBootstrap()
  .then(() => {
    traceWindowOpen("frontend:asyncBootstrap:end", {
      durationMs: Math.round((performance.now() - bootstrapStartedAt) * 100) / 100,
    });
  })
  .catch((error) => {
    traceWindowOpen("frontend:asyncBootstrap:error", {
      durationMs: Math.round((performance.now() - bootstrapStartedAt) * 100) / 100,
      error: error instanceof Error ? error.message : String(error),
    });
  });

const renderStartedAt = performance.now();
traceWindowOpen("reactRender:start");
createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <DialogServiceProvider>
      <App />
    </DialogServiceProvider>
  </ToastProvider>,
);
traceWindowOpen("reactRender:scheduled", {
  durationMs: Math.round((performance.now() - renderStartedAt) * 100) / 100,
});
