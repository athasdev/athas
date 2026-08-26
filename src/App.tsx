import { lazy, Suspense, use, useEffect, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { recordStartupMilestoneAfterFrame } from "@/features/bootstrap/startup-performance";
import {
  getWindowOpenDiagnostics,
  traceWindowOpen,
  traceWindowOpenAfterFrame,
} from "@/features/window/utils/window-open-diagnostics";

const WorkbenchApp = lazy(() => import("./workbench-app"));
const SettingsWindowApp = lazy(() => import("./features/settings/components/settings-window-app"));

function isBlankWindowOpen() {
  const diagnostics = getWindowOpenDiagnostics();
  return Boolean(diagnostics.traceId && !diagnostics.target);
}

function InitialWindowShell() {
  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    void getCurrentWindow()
      .startDragging()
      .catch(() => {});
  };

  return (
    <div className="athas-layout-shell relative h-dvh w-dvw overflow-hidden bg-surface">
      <div
        className="athas-title-bar absolute inset-x-0 top-0 h-title-bar bg-transparent"
        data-tauri-drag-region
        onMouseDown={handleMouseDown}
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
  const isSettingsWindow = useMemo(
    () => new URL(window.location.href).searchParams.get("window") === "settings",
    [],
  );
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

  if (isSettingsWindow) {
    return (
      <Suspense fallback={<InitialWindowShell />}>
        <SettingsWindowApp />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<InitialWindowShell />}>
      <WorkbenchBoundary
        blankWindowOpen={blankWindowOpen}
        terminalSessionReady={terminalSessionReady}
      />
    </Suspense>
  );
}

export default App;
