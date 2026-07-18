import { describe, expect, it } from "vite-plus/test";
import type { ExtensionManifest } from "../types/extension-manifest";
import { buildInstalledExtensionsMap } from "@/extensions/registry/extension-store-bootstrap";
import type { AvailableExtension } from "@/extensions/registry/extension-store-types";

function createAvailableExtension(manifest: ExtensionManifest): AvailableExtension {
  return {
    manifest,
    isInstalled: false,
    isEnabled: false,
    isInstalling: false,
    runtimeIssues: [],
  };
}

describe("extension-store bootstrap", () => {
  it("drops retired installed extensions before activation state is built", () => {
    const availableExtensions = new Map<string, AvailableExtension>([
      [
        "athas.theme.market",
        createAvailableExtension({
          id: "athas.theme.market",
          name: "Athas Themes",
          displayName: "Athas Theme Pack",
          description: "Retired theme pack",
          version: "1.0.0",
          publisher: "Athas",
          categories: ["Theme"],
          themes: [
            {
              id: "market-light",
              name: "Athas Light",
              appearance: "light",
              colors: {},
              syntax: {},
            },
          ],
        }),
      ],
      [
        "athas.theme.vercel",
        createAvailableExtension({
          id: "athas.theme.vercel",
          name: "vercel",
          displayName: "Vercel Theme",
          description: "Vercel theme",
          version: "1.0.0",
          publisher: "Athas",
          categories: ["Theme"],
          installation: { type: "bundled" },
          themes: [
            {
              id: "vercel-light",
              name: "Vercel Light",
              appearance: "light",
              colors: {},
              syntax: {},
            },
          ],
        }),
      ],
    ]);

    const installedExtensions = buildInstalledExtensionsMap({
      backendInstalled: [
        {
          id: "athas.theme.market",
          name: "Athas Theme Pack",
          version: "1.0.0",
          installed_at: "2026-07-08T00:00:00.000Z",
          enabled: true,
        },
      ],
      indexedDBInstalled: [{ languageId: "athas.theme.market", version: "1.0.0" }],
      bundledContributionInstalled: ["athas.theme.market", "athas.theme.vercel"],
      availableExtensions,
    });

    expect(installedExtensions.has("athas.theme.market")).toBe(false);
    expect(installedExtensions.has("athas.theme.vercel")).toBe(true);
  });
});
