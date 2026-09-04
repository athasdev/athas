import { describe, expect, it } from "vite-plus/test";
import { resolveOnboardingContextFromState } from "../lib/onboarding-state";

describe("resolveOnboardingContextFromState", () => {
  it("opens first-run onboarding when no version has been seen", () => {
    expect(resolveOnboardingContextFromState("1.2.0", {})).toEqual({
      mode: "first-run",
      currentVersion: "1.2.0",
    });
  });

  it("does not interrupt returning users after an update", () => {
    expect(resolveOnboardingContextFromState("1.2.0", { lastSeenVersion: "1.1.0" })).toBeNull();
  });

  it("does not reopen onboarding for the same seen version", () => {
    expect(resolveOnboardingContextFromState("1.2.0", { lastSeenVersion: "1.2.0" })).toBeNull();
  });
});
