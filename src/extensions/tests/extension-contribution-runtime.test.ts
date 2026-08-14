import { describe, expect, it } from "vite-plus/test";
import {
  activateExtensionContributions,
  deactivateExtensionContributions,
  isExtensionContributionActive,
} from "../runtime/extension-contribution-runtime";
import { themeRegistry } from "../themes/theme-registry";
import type { ExtensionManifest } from "../types/extension-manifest";

const extensionId = "athas.runtime-lifecycle-test";
const themeId = "runtime-lifecycle-test";
const manifest: ExtensionManifest = {
  id: extensionId,
  name: "Runtime lifecycle test",
  displayName: "Runtime lifecycle test",
  description: "Exercises contribution activation ownership",
  version: "1.0.0",
  publisher: "Athas",
  categories: ["Theme"],
  themes: [
    {
      id: themeId,
      name: "Runtime lifecycle test",
      appearance: "dark",
      colors: {},
    },
  ],
};

describe("extension contribution runtime", () => {
  it("activates each extension exactly once and releases owned contributions", async () => {
    await deactivateExtensionContributions(extensionId, manifest);
    const versionBeforeActivation = themeRegistry.getVersion();

    await Promise.all([
      activateExtensionContributions(extensionId, manifest),
      activateExtensionContributions(extensionId, manifest),
    ]);

    expect(themeRegistry.getVersion()).toBe(versionBeforeActivation + 1);
    expect(themeRegistry.getThemeSource(themeId)?.extensionId).toBe(extensionId);
    expect(isExtensionContributionActive(extensionId)).toBe(true);

    await deactivateExtensionContributions(extensionId, manifest);

    expect(themeRegistry.getTheme(themeId)).toBeUndefined();
    expect(isExtensionContributionActive(extensionId)).toBe(false);
  });
});
