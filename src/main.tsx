import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App.tsx";
import { parseDetachedWindowUrl } from "./features/window/detached/detached-window-protocol";
import { installDevelopmentPerformanceMeasureCleanup } from "./features/bootstrap/performance-measure-retention.ts";
import { recordStartupMilestone } from "./features/bootstrap/startup-performance.ts";
import { initializeFrontendTerminalSession } from "./features/terminal/utils/frontend-terminal-session.ts";
import { traceWindowOpen } from "./features/window/utils/window-open-diagnostics.ts";

if (import.meta.env.DEV) {
  installDevelopmentPerformanceMeasureCleanup();
}

traceWindowOpen("frontend:entry");
recordStartupMilestone("frontend:entry");

const renderStartedAt = performance.now();
traceWindowOpen("reactRender:start");

const terminalSessionReady = (
  parseDetachedWindowUrl(new URL(window.location.href))
    ? Promise.resolve()
    : initializeFrontendTerminalSession()
).catch((error) => {
  console.warn("Failed to clean up stale terminal sessions:", error);
});

createRoot(document.getElementById("root")!).render(
  <App terminalSessionReady={terminalSessionReady} />,
);
traceWindowOpen("reactRender:scheduled", {
  durationMs: Math.round((performance.now() - renderStartedAt) * 100) / 100,
});
recordStartupMilestone("react:scheduled");
