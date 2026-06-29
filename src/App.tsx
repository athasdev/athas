import { useEffect } from "react";
import { FontStyleInjector } from "@/features/settings/components/font-style-injector";
import { useAppBootstrap } from "@/bootstrap/use-app-bootstrap";
import { traceWindowOpen } from "@/features/window/utils/window-open-diagnostics";

import { MainLayout } from "./features/layout/components/main-layout";
import { ZoomIndicator } from "./features/window/components/zoom-indicator";
import { ToastContainer } from "./ui/toast";
import { TooltipProvider } from "./ui/tooltip";
import { WindowResizeBorder } from "./features/window/components/window-resize-border";

function App() {
  useAppBootstrap();

  useEffect(() => {
    const mountedAt = performance.now();
    traceWindowOpen("app:mounted");
    const frame = window.requestAnimationFrame(() => {
      traceWindowOpen("app:firstFrame", {
        durationMs: Math.round((performance.now() - mountedAt) * 100) / 100,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <TooltipProvider>
      {/* Borderless desktop window resize handles (must be outside zoom container) */}
      <WindowResizeBorder />

      <div className="h-dvh w-dvw overflow-hidden">
        <FontStyleInjector />
        <div className="window-container flex size-full flex-col overflow-hidden bg-primary-bg">
          <MainLayout />
        </div>
        <ZoomIndicator />
        <ToastContainer />
      </div>
    </TooltipProvider>
  );
}

export default App;
