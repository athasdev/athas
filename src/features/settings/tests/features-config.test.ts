import { describe, expect, it } from "vite-plus/test";
import { defaultSettings } from "@/features/settings/config/default-settings";
import { createCoreFeaturesList } from "@/features/settings/config/features";

describe("features config", () => {
  it("keeps Teams Collaboration copy compact", () => {
    const feature = createCoreFeaturesList(defaultSettings.coreFeatures).find(
      (item) => item.id === "teamCollaboration",
    );

    expect(feature).toMatchObject({
      name: "Teams Collaboration",
      description: "Team workspace invites, roles, projects, and channels",
      enabled: true,
    });
  });
});
