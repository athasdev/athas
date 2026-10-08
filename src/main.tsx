import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App.tsx";
import { parseDetachedWindowUrl } from "./features/window/detached/detached-window-protocol";
import { useBootstrapPhaseStore } from "./features/bootstrap/stores/bootstrap-phase.store.ts";
import { installDevelopmentPerformanceMeasureCleanup } from "@/features/bootstrap/services/performance-measure-retention.ts";
import { recordStartupMilestone } from "@/features/bootstrap/services/startup-performance.ts";
import { initializeFrontendTerminalSession } from "@/features/terminal/services/frontend-terminal-session.ts";
import { traceWindowOpen } from "@/features/window/services/window-open-diagnostics.ts";

if (import.meta.env.DEV) {
  installDevelopmentPerformanceMeasureCleanup();
}

traceWindowOpen("frontend:entry");
recordStartupMilestone("frontend:entry");

const renderStartedAt = performance.now();
traceWindowOpen("reactRender:start");

// Startup phases are documented in features/bootstrap/services/initialize-app-bootstrap.ts.
void import("@/features/bootstrap/services/initialize-app-bootstrap.ts")
  .then(({ startSettingsLoad }) => startSettingsLoad())
  // The settings step of the app bootstrap reports the failure; the work waiting on the settings
  // runs on the defaults rather than never.
  .catch(() => useBootstrapPhaseStore.getState().actions.reachPhase("settings-ready"));

if (!parseDetachedWindowUrl(new URL(window.location.href))) {
  // Terminals wait for this before they start; the workbench does not.
  void initializeFrontendTerminalSession().catch((error) => {
    console.warn("Failed to clean up stale terminal sessions:", error);
  });
}

createRoot(document.getElementById("root")!).render(<App />);
traceWindowOpen("reactRender:scheduled", {
  durationMs: Math.round((performance.now() - renderStartedAt) * 100) / 100,
});
recordStartupMilestone("react:scheduled");
