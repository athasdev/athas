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

describe("createPaneContent extension surfaces", () => {
  it("creates the singleton extension catalog tab", () => {
    const content = createPaneContent("extensions", { type: "extensions" });

    expect(content).toMatchObject({
      type: "extensions",
      name: "Extensions",
      path: "extensions://marketplace",
      isPreview: false,
    });
  });

  it("creates a tab-addressable page for one extension", () => {
    const content = createPaneContent("extension", {
      type: "extension",
      extensionId: "athas.typescript",
      name: "TypeScript",
    });

    expect(content).toMatchObject({
      type: "extension",
      extensionId: "athas.typescript",
      name: "TypeScript",
      path: "extension://athas.typescript",
      isPreview: false,
    });
  });
});

describe("createPaneContent data source surfaces", () => {
  it("creates a project-scoped setup tab", () => {
    const content = createPaneContent("new-source", {
      type: "adminData",
      projectPath: "/projects/athas",
    });

    expect(content).toMatchObject({
      type: "adminData",
      name: "New Data Source",
      path: "admin-data://create/%2Fprojects%2Fathas",
      projectPath: "/projects/athas",
      sourceId: undefined,
      isPreview: false,
    });
  });

  it("creates a stable tab for a saved source", () => {
    const content = createPaneContent("release-source", {
      type: "adminData",
      projectPath: "/projects/athas",
      sourceId: "release-downloads",
      name: "Release downloads",
    });

    expect(content).toMatchObject({
      type: "adminData",
      name: "Release downloads",
      path: "admin-data://%2Fprojects%2Fathas/release-downloads",
      projectPath: "/projects/athas",
      sourceId: "release-downloads",
      isPreview: false,
    });
  });
});

describe("createPaneContent web viewer surfaces", () => {
  it("preserves explicit access when the general web viewer feature is disabled", () => {
    const content = createPaneContent("github-notification", {
      type: "webViewer",
      url: "https://github.com/athasdev/athas/actions",
      allowWhenDisabled: true,
    });

    expect(content).toMatchObject({
      type: "webViewer",
      url: "https://github.com/athasdev/athas/actions",
      allowWhenDisabled: true,
    });
  });
});
