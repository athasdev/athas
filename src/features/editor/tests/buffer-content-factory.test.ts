import { describe, expect, it } from "vite-plus/test";
import { createPaneContent } from "../stores/buffer-content-factory";

describe("createPaneContent onboarding surfaces", () => {
  it("names setup onboarding Welcome", () => {
    const content = createPaneContent("first-run", {
      type: "onboarding",
      context: { mode: "first-run", currentVersion: "1.2.0" },
    });

    expect(content).toMatchObject({
      type: "onboarding",
      name: "Welcome",
      path: "onboarding://first-run/1.2.0",
    });
  });

  it("names update and manual release surfaces What's New", () => {
    for (const mode of ["updated", "release-notes"] as const) {
      const content = createPaneContent(mode, {
        type: "onboarding",
        context: { mode, currentVersion: "1.2.0" },
      });

      expect(content).toMatchObject({
        type: "onboarding",
        name: "What's New",
        path: `onboarding://${mode}/1.2.0`,
      });
    }
  });
});
