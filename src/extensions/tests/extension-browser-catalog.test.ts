import { describe, expect, it } from "vite-plus/test";
import { bundledExtensionManifests } from "@/extensions/bundled/bundled-extension-manifests";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
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
  it("surfaces managed ACP agent versions and updates", () => {
    const agentManifest = manifest({
      id: "athas.agent.example",
      agents: [
        {
          id: "example-agent",
          name: "Example Agent",
          binaryName: "example-agent",
          args: [],
          install: {
            runtime: "node",
            package: "example-agent@2.0.0",
            version: "2.0.0",
            command: "example-agent",
          },
        },
      ],
    });

    const result = buildExtensionCatalog({
      availableExtensions: new Map([[agentManifest.id, available(agentManifest)]]),
      agents: [
        {
          id: "example-agent",
          name: "Example Agent",
          binaryName: "example-agent",
          binaryPath: "/tmp/example-agent",
          args: [],
          envVars: {},
          icon: null,
          description: null,
          installed: true,
          installRuntime: "node",
          installPackage: "example-agent@2.0.0",
          availableVersion: "2.0.0",
          installedVersion: "1.0.0",
          updateAvailable: true,
          managed: true,
          canInstall: true,
        },
      ],
      marketplaceSkills: [],
      aiSkills: [],
      selectedThemeId: "athas-dark",
      selectedIconThemeId: "athas-icons",
    });

    expect(result.find((extension) => extension.id === "agent:example-agent")).toMatchObject({
      version: "2.0.0",
      installedVersion: "1.0.0",
      availableVersion: "2.0.0",
      hasUpdate: true,
    });
  });

  it("normalizes language packages for the browser", () => {
    const language = manifest({
      id: "athas.example-language",
      icon: "/extensions/official/example/icon.svg",
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
      icon: "/extensions/official/example/icon.svg",
      isInstalled: true,
    });
  });

  it("marks only the selected contributed appearance options active", () => {
    const theme = manifest({
      id: "athas.example-theme",
      themes: [
        {
          id: "example-dark",
          name: "Example Dark",
          appearance: "dark",
          colors: { primary: "#111111", surface: "#222222", background: "#000000" },
          syntax: { keyword: "#333333", string: "#444444" },
        },
        {
          id: "example-light",
          name: "Example Light",
          appearance: "light",
          colors: { primary: "#eeeeee", surface: "#ffffff", background: "#f5f5f5" },
          syntax: { keyword: "#cccccc", string: "#dddddd" },
        },
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
      appearancePreview: {
        kind: "theme",
        colors: ["#eeeeee", "#cccccc", "#dddddd", "#ffffff"],
      },
    });
  });

  it("keeps bundled icon themes visible without duplicating catalog contributions", () => {
    const symbols = {
      id: "symbols",
      name: "Symbols Icons",
      description: "Symbols icon theme",
      getFileIcon: () => ({}),
    };
    const symbolsManifest = bundledExtensionManifests.find(
      ({ manifest: extensionManifest }) => extensionManifest.id === "athas.icon-theme.symbols",
    )?.manifest;

    expect(symbolsManifest).toBeDefined();
    iconThemeRegistry.registerTheme(symbols, {
      extensionId: "athas.icon-theme.symbols",
    });

    try {
      const result = buildExtensionCatalog({
        availableExtensions: new Map([[symbolsManifest!.id, available(symbolsManifest!)]]),
        agents: [],
        marketplaceSkills: [],
        aiSkills: [],
        selectedThemeId: "athas-dark",
        selectedIconThemeId: "athas-icons",
      });

      expect(
        result.find((extension) => extension.id === "athas.icon-theme.athas-icons"),
      ).toMatchObject({
        category: "icon-theme",
        isActive: true,
        isBundled: true,
        selectionId: "athas-icons",
      });
      expect(
        result.filter((extension) =>
          extension.appearanceOptions?.some((option) => option.id === "symbols"),
        ),
      ).toHaveLength(1);
      expect(
        result.find((extension) => extension.id === "athas.icon-theme.symbols")?.appearancePreview,
      ).toMatchObject({ kind: "icon-theme" });
    } finally {
      iconThemeRegistry.unregisterTheme(symbols.id);
    }
  });
});
