import type { OnboardingContext } from "./onboarding-state";

export interface OnboardingViewModel {
  title: string;
  description: string;
  showSettings: boolean;
  primaryAction: "open-folder" | "open-whats-new";
  primaryLabel: string;
  secondaryLabel: string;
}

export function buildOnboardingViewModel(context: OnboardingContext): OnboardingViewModel {
  if (context.mode === "updated") {
    const versionCopy = context.previousVersion
      ? `Updated from ${context.previousVersion} to ${context.currentVersion}.`
      : `Athas ${context.currentVersion} is installed.`;

    return {
      title: "Athas was updated",
      description: `${versionCopy} Review the release notes and continue with your existing setup.`,
      showSettings: false,
      primaryAction: "open-whats-new",
      primaryLabel: "What's New",
      secondaryLabel: "Done",
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
