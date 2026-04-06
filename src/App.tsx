import { lazy, Suspense } from "react";
import { useOnboardingStore } from "@/features/onboarding/store";
import { FontStyleInjector } from "@/features/settings/components/font-style-injector";
import { useAutoUpdate } from "@/features/settings/hooks/use-auto-update";
import { useAppBootstrap } from "@/hooks/use-app-bootstrap";

const OnboardingDialog = lazy(() => import("@/features/onboarding/components/onboarding-dialog"));
const UpdateDialog = lazy(() => import("@/features/settings/components/update-dialog"));

import { MainLayout } from "./features/layout/components/main-layout";
import { ZoomIndicator } from "./features/layout/components/zoom-indicator";
import { ToastContainer } from "./ui/toast";
import { WindowResizeBorder } from "./features/window/components/window-resize-border";

function App() {
  // Auto-update check
  const {
    showDialog: showUpdateDialog,
    updateInfo,
    downloadProgress,
    downloading,
    installing,
    error: updateError,
    onDismiss: dismissUpdate,
    onDownload: downloadUpdate,
  } = useAutoUpdate();
  useAppBootstrap();
  const isOnboardingOpen = useOnboardingStore((state) => state.isOpen);
  const onboardingContext = useOnboardingStore((state) => state.context);
  const dismissOnboarding = useOnboardingStore((state) => state.dismiss);
  const completeOnboarding = useOnboardingStore((state) => state.complete);

  return (
    <>
      {/* Linux window resize handles (must be outside zoom container) */}
      <WindowResizeBorder />

      <div className="h-dvh w-dvw overflow-hidden">
        <FontStyleInjector />
        <div className="window-container flex h-full w-full flex-col overflow-hidden bg-primary-bg">
          <MainLayout />
        </div>
        <ZoomIndicator />
        <ToastContainer />

        {showUpdateDialog && updateInfo && (
          <Suspense fallback={null}>
            <UpdateDialog
              updateInfo={updateInfo}
              downloadProgress={downloadProgress}
              downloading={downloading}
              installing={installing}
              error={updateError}
              onDownload={downloadUpdate}
              onDismiss={dismissUpdate}
            />
          </Suspense>
        )}

        {isOnboardingOpen && onboardingContext && (
          <Suspense fallback={null}>
            <OnboardingDialog
              context={onboardingContext}
              onClose={() => void dismissOnboarding()}
              onComplete={completeOnboarding}
            />
          </Suspense>
        )}
      </div>
    </>
  );
}

export default App;
