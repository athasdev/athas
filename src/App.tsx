import { lazy, Suspense } from "react";
import { useOnboardingStore } from "@/features/onboarding/store";
import { FontStyleInjector } from "@/features/settings/components/font-style-injector";
import { useAppBootstrap } from "@/bootstrap/use-app-bootstrap";

const OnboardingDialog = lazy(() => import("@/features/onboarding/components/onboarding-dialog"));

import { MainLayout } from "./features/layout/components/main-layout";
import { ZoomIndicator } from "./features/window/components/zoom-indicator";
import { ToastContainer } from "./ui/toast";
import { TooltipProvider } from "./ui/tooltip";
import { WindowResizeBorder } from "./features/window/components/window-resize-border";

function App() {
  useAppBootstrap();
  const isOnboardingOpen = useOnboardingStore((state) => state.isOpen);
  const onboardingContext = useOnboardingStore((state) => state.context);
  const dismissOnboarding = useOnboardingStore((state) => state.dismiss);
  const completeOnboarding = useOnboardingStore((state) => state.complete);

  return (
    <TooltipProvider>
      {/* Borderless desktop window resize handles (must be outside zoom container) */}
      <WindowResizeBorder />

      <div className="h-dvh w-dvw overflow-hidden">
        <FontStyleInjector />
        <div className="window-container flex h-full w-full flex-col overflow-hidden bg-primary-bg">
          <MainLayout />
        </div>
        <ZoomIndicator />
        <ToastContainer />

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
    </TooltipProvider>
  );
}

export default App;
