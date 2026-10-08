import { lazy } from "react";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const OnboardingView = lazy(() => import("../components/onboarding-view"));

export function registerOnboardingViews() {
  registerPaneView("onboarding", {
    component: OnboardingView,
    getProps: (buffer) => ({
      bufferId: buffer.id,
      context: {
        mode: buffer.mode,
        currentVersion: buffer.currentVersion,
        previousVersion: buffer.previousVersion,
      },
    }),
  });
}
