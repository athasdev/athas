import { SharingRuntime } from "@/features/sharing/components/sharing-runtime";
import { GitHubActionsWatcher } from "@/features/github/components/github-actions-watcher";
import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { FontStyleInjector } from "@/features/settings/components/font-style-injector";
import { initializeAppBootstrap } from "@/features/bootstrap/initialize-app-bootstrap";
import {
  recordStartupMilestone,
  recordStartupMilestoneAfterFrame,
} from "@/features/bootstrap/startup-performance";
import { SettingsReadyBootstrap } from "@/features/bootstrap/components/settings-ready-bootstrap";
import { useAppBootstrap } from "@/features/bootstrap/use-app-bootstrap";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  traceWindowOpen,
  traceWindowOpenAfterFrame,
} from "@/features/window/utils/window-open-diagnostics";
import { NotificationRecorder } from "@/features/notifications/components/notification-recorder";
import { useNativeNotificationIntegration } from "@/features/notifications/hooks/use-native-notification-integration";
import { useAcpEventSync } from "@/features/ai/hooks/use-acp-event-sync";
import { useAgentTabSessionRelease } from "@/features/ai/hooks/use-agent-tab-session-release";

import { MainLayout } from "./features/layout/components/main-layout";
import { ZoomIndicator } from "./features/layout/components/zoom-indicator";
import { Toaster } from "./ui/sonner";
import { TooltipProvider } from "./ui/tooltip";
import { WindowResizeBorder } from "./features/window/components/window-resize-border";
import { DialogServiceProvider } from "@/ui/dialog";
import { ContinuousAgentsRuntime } from "@/features/ai/continuous-agents/continuous-agents-runtime";
import { DeferredEventDialog } from "@/components/deferred-event-dialog";
import { bucketFrictionDuration } from "@/features/telemetry/lib/friction-signals";
import { recordFrictionSignal } from "@/features/telemetry/services/telemetry";

// Dialogs that open on a window event load the first time they are asked for.
const loadAgentSessionsDialog = () =>
  import("@/features/ai/components/history/agent-sessions-dialog").then(
    (module) => module.AgentSessionsDialog,
  );
const loadProductFeedbackDialog = () =>
  import("@/features/feedback/components/product-feedback-dialog").then(
    (module) => module.ProductFeedbackDialog,
  );
const loadShareDialog = () =>
  import("@/features/sharing/components/share-dialog").then((module) => module.ShareDialog);

function WorkbenchApp() {
  useAppBootstrap();
  useNativeNotificationIntegration();
  useAcpEventSync();
  useAgentTabSessionRelease();
  const reduceMotion = useSettingsStore((state) => state.settings.reduceMotion);

  useEffect(() => {
    const mountedAt = performance.now();
    traceWindowOpen("workbench:mounted");
    const cleanupTrace = traceWindowOpenAfterFrame("workbench:firstFrame", () => ({
      durationMs: Math.round((performance.now() - mountedAt) * 100) / 100,
    }));
    const cleanupStartupMilestone = recordStartupMilestoneAfterFrame("workbench:first-frame");
    const frictionFrame = window.requestAnimationFrame(() => {
      const readyDuration = performance.now();
      if (readyDuration >= 5_000) {
        void recordFrictionSignal({
          area: "startup",
          signal: "slow_ready",
          durationBucket: bucketFrictionDuration(readyDuration),
        });
      }
    });

    return () => {
      cleanupTrace();
      cleanupStartupMilestone();
      window.cancelAnimationFrame(frictionFrame);
    };
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        const bootstrapStartedAt = performance.now();
        void initializeAppBootstrap()
          .then(() => {
            recordStartupMilestone("bootstrap:complete");
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
      }, 0);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
      <DialogServiceProvider>
        <TooltipProvider>
          <SettingsReadyBootstrap />
          <WindowResizeBorder />

          <div className="h-dvh w-dvw overflow-hidden">
            <FontStyleInjector />
            <div className="window-container flex size-full flex-col overflow-hidden bg-background">
              <MainLayout />
            </div>
            <ZoomIndicator />
            <Toaster />
            <NotificationRecorder />
            <ContinuousAgentsRuntime />
            <DeferredEventDialog event="athas:open-agent-sessions" load={loadAgentSessionsDialog} />
            <DeferredEventDialog
              event="athas:open-product-feedback"
              load={loadProductFeedbackDialog}
            />
            <DeferredEventDialog event="athas:open-share" load={loadShareDialog} />
            <SharingRuntime />
            <GitHubActionsWatcher />
          </div>
        </TooltipProvider>
      </DialogServiceProvider>
    </MotionConfig>
  );
}

export default WorkbenchApp;
