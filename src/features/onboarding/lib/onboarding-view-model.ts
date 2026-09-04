import type { OnboardingContext } from "./onboarding-state";

export interface OnboardingViewModel {
  title: string;
  description: string;
  showSettings: boolean;
  primaryAction: "open-folder" | "finish";
  primaryLabel: string;
  secondaryLabel?: string;
}

export function buildOnboardingViewModel(context: OnboardingContext): OnboardingViewModel {
  if (context.mode === "release-notes") {
    return {
      title: `What's new in Athas ${context.currentVersion}`,
      description: "The latest changes, improvements, and fixes.",
      showSettings: false,
      primaryAction: "finish",
      primaryLabel: "Done",
    };
  }

  return {
    title: "Welcome to Athas",
    description: `Athas ${context.currentVersion} Choose a few defaults before you start.`,
    showSettings: true,
    primaryAction: "open-folder",
    primaryLabel: "Open Folder",
    secondaryLabel: "Done",
  };
}
