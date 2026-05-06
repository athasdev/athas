import { describe, expect, it } from "vite-plus/test";
import { buildOnboardingViewModel } from "../lib/onboarding-view-model";

describe("buildOnboardingViewModel", () => {
  it("keeps first-run onboarding on setup defaults", () => {
    expect(
      buildOnboardingViewModel({
        mode: "first-run",
        currentVersion: "1.2.0",
      }),
    ).toMatchObject({
      title: "Welcome to Athas",
      showSettings: true,
      primaryAction: "open-folder",
    });
  });

  it("shows release notes instead of setup defaults after an update", () => {
    expect(
      buildOnboardingViewModel({
        mode: "updated",
        currentVersion: "1.2.0",
        previousVersion: "1.1.0",
      }),
    ).toMatchObject({
      title: "Athas was updated",
      showSettings: false,
      primaryAction: "open-whats-new",
    });
  });
});
