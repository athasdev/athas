import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getWindowOpenDiagnostics,
  traceWindowOpen,
} from "@/features/window/utils/window-open-diagnostics";

const WorkbenchApp = lazy(() => import("./workbench-app"));

function isBlankWindowOpen() {
  const diagnostics = getWindowOpenDiagnostics();
  return Boolean(diagnostics.traceId && !diagnostics.target);
}

function useWorkbenchReady(blankWindowOpen: boolean) {
  const [ready, setReady] = useState(!blankWindowOpen);

  useEffect(() => {
    if (!blankWindowOpen) {
      setReady(true);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      window.setTimeout(() => setReady(true), 0);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [blankWindowOpen]);

  return ready;
}

function InitialWindowShell() {
  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    void getCurrentWindow().startDragging().catch(() => {});
  };

  return (
    <div className="h-dvh w-dvw overflow-hidden bg-secondary-bg">
      <div
        className="h-10 w-full bg-secondary-bg/70"
        data-tauri-drag-region
        onMouseDown={handleMouseDown}
      />
      <div className="h-[calc(100dvh-2.5rem)] w-full bg-primary-bg" />
    </div>
  );
}

function App() {
  const blankWindowOpen = useMemo(() => isBlankWindowOpen(), []);
  const workbenchReady = useWorkbenchReady(blankWindowOpen);

  useEffect(() => {
    const mountedAt = performance.now();
    traceWindowOpen("app:mounted", { shell: true, blankWindowOpen });
    const frame = window.requestAnimationFrame(() => {
      traceWindowOpen("app:firstFrame", {
        shell: true,
        blankWindowOpen,
        durationMs: Math.round((performance.now() - mountedAt) * 100) / 100,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [blankWindowOpen]);

  if (!workbenchReady) {
    return <InitialWindowShell />;
  }

  return (
    <Suspense fallback={<InitialWindowShell />}>
      <WorkbenchApp />
    </Suspense>
  );
}

export default App;
