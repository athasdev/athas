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
});
