import { describe, expect, it } from "vite-plus/test";
import { buildExtensionCatalog } from "@/extensions/ui/components/build-extension-catalog";
import type { AvailableExtension } from "@/extensions/registry/extension-store-types";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";

function available(manifest: ExtensionManifest): AvailableExtension {
  return {
    manifest,
    isInstalled: true,
    isEnabled: true,
    isInstalling: false,
  };
}

function manifest(overrides: Partial<ExtensionManifest>): ExtensionManifest {
  return {
    id: "athas.example",
    name: "example",
    displayName: "Example",
    description: "Example extension",
    version: "1.0.0",
    publisher: "Athas",
    categories: ["Other"],
    ...overrides,
  };
}

describe("extension browser catalog", () => {
  it("normalizes language packages for the browser", () => {
    const language = manifest({
      id: "athas.example-language",
      languages: [{ id: "example", extensions: [".example"], aliases: ["Example"] }],
    });

    const result = buildExtensionCatalog({
      availableExtensions: new Map([[language.id, available(language)]]),
      agents: [],
      marketplaceSkills: [],
      aiSkills: [],
      selectedThemeId: "athas-dark",
      selectedIconThemeId: "athas-icons",
    });

    expect(result.find((extension) => extension.id === language.id)).toMatchObject({
      category: "language",
      extensions: ["example"],
      isInstalled: true,
    });
  });

  it("marks only the selected contributed appearance options active", () => {
    const theme = manifest({
      id: "athas.example-theme",
      themes: [
        { id: "example-dark", name: "Example Dark", appearance: "dark", colors: {} },
        { id: "example-light", name: "Example Light", appearance: "light", colors: {} },
      ],
    });

    const result = buildExtensionCatalog({
      availableExtensions: new Map([[theme.id, available(theme)]]),
      agents: [],
      marketplaceSkills: [],
      aiSkills: [],
      selectedThemeId: "example-light",
      selectedIconThemeId: "athas-icons",
    });

    expect(result.find((extension) => extension.id === theme.id)).toMatchObject({
      category: "theme",
      isActive: true,
      selectionId: "example-light",
    });
  });
});
