import { describe, expect, it } from "vite-plus/test";
import { defaultSettings } from "@/features/settings/config/default-settings";
import { createCoreFeaturesList } from "@/features/settings/config/features";

describe("features config", () => {
  it("keeps Collaboration copy compact", () => {
    const feature = createCoreFeaturesList(defaultSettings.coreFeatures).find(
      (item) => item.id === "teamCollaboration",
    );

    expect(feature).toMatchObject({
      name: "Collaboration",
      description: "Team workspace invites, roles, projects, and channels",
      enabled: true,
      status: "experimental",
    });
  });

  it("includes Outline in core features", () => {
    const feature = createCoreFeaturesList(defaultSettings.coreFeatures).find(
      (item) => item.id === "outline",
    );

    expect(feature).toMatchObject({
      name: "Outline",
      description: "Document symbols and quick navigation for the active file",
      enabled: true,
    });
  });

  it("keeps Web Viewer experimental and off by default", () => {
    const feature = createCoreFeaturesList(defaultSettings.coreFeatures).find(
      (item) => item.id === "webViewer",
    );

    expect(feature).toMatchObject({
      name: "Web Viewer",
      description: "Open URLs in embedded editor tabs",
      enabled: false,
      status: "experimental",
    });
  });

  it("keeps Energy Edge experimental and off by default", () => {
    const feature = createCoreFeaturesList(defaultSettings.coreFeatures).find(
      (item) => item.id === "energyEdge",
    );

    expect(feature).toMatchObject({
      name: "Energy Edge",
      description: "Adds a luminous animated edge to resize handles while dragging",
      enabled: false,
      status: "experimental",
    });
  });
});
