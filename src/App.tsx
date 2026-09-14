import { lazy, Suspense, use, useEffect, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { parseDetachedWindowUrl } from "@/features/window/detached/detached-window-protocol";
import { recordStartupMilestoneAfterFrame } from "@/features/bootstrap/startup-performance";
import {
  getWindowOpenDiagnostics,
  traceWindowOpen,
  traceWindowOpenAfterFrame,
} from "@/features/window/utils/window-open-diagnostics";

const WorkbenchApp = lazy(() => import("./workbench-app"));
const DetachedAgentWindow = lazy(() => import("./features/ai/detached/detached-agent-window"));
const DetachedResourceWindow = lazy(
  () => import("./features/window/detached/detached-resource-window"),
);

const StandaloneContentWindow = lazy(
  () => import("./features/window/detached/standalone-content-window"),
);

function isBlankWindowOpen() {
  const diagnostics = getWindowOpenDiagnostics();
  return Boolean(diagnostics.traceId && !diagnostics.target);
}

function handleInitialWindowShellMouseDown(event: React.MouseEvent<HTMLDivElement>) {
  if (event.button !== 0) return;

  void getCurrentWindow()
    .startDragging()
    .catch(() => {});
}

function InitialWindowShell() {
  return (
    <div className="athas-layout-shell relative h-dvh w-dvw overflow-hidden bg-surface">
      <div
        className="athas-title-bar absolute inset-x-0 top-0 h-title-bar bg-transparent"
        data-tauri-drag-region
        onMouseDown={handleInitialWindowShellMouseDown}
      />
    </div>
  );
}

interface WorkbenchBoundaryProps {
  blankWindowOpen: boolean;
  terminalSessionReady: Promise<void>;
}

function WorkbenchBoundary({ blankWindowOpen, terminalSessionReady }: WorkbenchBoundaryProps) {
  use(terminalSessionReady);

  useEffect(() => {
    const readyAt = performance.now();
    traceWindowOpen("app:workbenchReady", { blankWindowOpen });
    return traceWindowOpenAfterFrame("app:workbenchReadyFrame", () => ({
      shell: true,
      blankWindowOpen,
      durationMs: Math.round((performance.now() - readyAt) * 100) / 100,
    }));
  }, [blankWindowOpen]);

  return <WorkbenchApp />;
}

interface AppProps {
  terminalSessionReady: Promise<void>;
}

function App({ terminalSessionReady }: AppProps) {
  const detachedWindow = useMemo(() => parseDetachedWindowUrl(new URL(window.location.href)), []);
  const blankWindowOpen = useMemo(() => isBlankWindowOpen(), []);

  useEffect(() => {
    const mountedAt = performance.now();
    traceWindowOpen("app:mounted", { shell: true, blankWindowOpen });
    const cleanupTrace = traceWindowOpenAfterFrame("app:firstFrame", () => ({
      shell: true,
      blankWindowOpen,
      durationMs: Math.round((performance.now() - mountedAt) * 100) / 100,
    }));
    const cleanupStartupMilestone = recordStartupMilestoneAfterFrame("app:first-frame");

    return () => {
      cleanupTrace();
      cleanupStartupMilestone();
    };
  }, [blankWindowOpen]);

  return (
    <Suspense fallback={<InitialWindowShell />}>
      {detachedWindow?.kind === "agent" ? (
        <DetachedAgentWindow />
      ) : detachedWindow?.kind === "standalone" ? (
        <StandaloneContentWindow />
      ) : detachedWindow?.kind === "resource" ? (
        <DetachedResourceWindow />
      ) : (
        <WorkbenchBoundary
          blankWindowOpen={blankWindowOpen}
          terminalSessionReady={terminalSessionReady}
        />
      )}
    </Suspense>
  );
}

export default App;
