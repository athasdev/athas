import { useEffect } from "react";
import { FontStyleInjector } from "@/features/settings/components/font-style-injector";
import { initializeAppBootstrap } from "@/features/bootstrap/initialize-app-bootstrap";
import { useAppBootstrap } from "@/features/bootstrap/use-app-bootstrap";
import {
  traceWindowOpen,
  traceWindowOpenAfterFrame,
} from "@/features/window/utils/window-open-diagnostics";

import { MainLayout } from "./features/layout/components/main-layout";
import { ZoomIndicator } from "./features/window/components/zoom-indicator";
import { ToastContainer } from "./ui/toast";
import { TooltipProvider } from "./ui/tooltip";
import { WindowResizeBorder } from "./features/window/components/window-resize-border";
import { ToastProvider } from "./features/layout/contexts/toast-context";
import { DialogServiceProvider } from "./features/dialogs/services/dialog-service";

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

function WorkbenchApp() {
  useAppBootstrap();

  useEffect(() => {
    const mountedAt = performance.now();
    traceWindowOpen("workbench:mounted");
    return traceWindowOpenAfterFrame("workbench:firstFrame", () => ({
      durationMs: Math.round((performance.now() - mountedAt) * 100) / 100,
    }));
  }, []);

  return (
    <ToastProvider>
      <DialogServiceProvider>
        <TooltipProvider>
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
      </DialogServiceProvider>
    </ToastProvider>
  );
}

export default WorkbenchApp;
