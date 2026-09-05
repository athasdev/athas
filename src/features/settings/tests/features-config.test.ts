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

  it("keeps Outline out of Advanced feature toggles", () => {
    const feature = createCoreFeaturesList(defaultSettings.coreFeatures).find(
      (item) => item.id === "outline",
    );

    expect(feature).toBeUndefined();
  });

  it("keeps Debugger stable and on by default", () => {
    const feature = createCoreFeaturesList(defaultSettings.coreFeatures).find(
      (item) => item.id === "debugger",
    );

    expect(feature).toMatchObject({
      name: "Debugger",
      description: "Run and debug files with launch configurations and breakpoints",
      enabled: true,
    });
    expect(feature).not.toHaveProperty("status");
  });

  it("keeps the Ghostty terminal engine experimental and off by default", () => {
    const feature = createCoreFeaturesList(defaultSettings.coreFeatures).find(
      (item) => item.id === "ghosttyTerminal",
    );

    expect(feature).toMatchObject({
      name: "Ghostty Terminal Engine",
      description: "Use Ghostty's WebAssembly terminal engine for new terminal sessions",
      enabled: false,
      status: "experimental",
    });
  });
});
