import { describe, expect, it } from "vite-plus/test";
import type { AvailableExtension } from "@/extensions/registry/extension-store-types";
import type { BundledExtension, ExtensionManifest } from "@/extensions/types/extension-manifest";
import { buildExtensionRuntimeCandidates } from "@/extensions/runtime/extension-runtime-candidates";

function manifest(id: string): ExtensionManifest {
  return {
    id,
    name: id,
    displayName: id,
    description: `${id} extension`,
    version: "1.0.0",
    publisher: "Athas",
    categories: ["Other"],
  };
}

describe("extension runtime candidates", () => {
  it("activates bundled registry extensions even when they are absent from the catalog", () => {
    const athasIcons = manifest("athas.icon-theme.athas-icons");
    const registered: BundledExtension = {
      manifest: athasIcons,
      path: "/bundled/icon-themes/athas",
      isBundled: true,
      isEnabled: true,
      state: "installed",
    };

    expect(buildExtensionRuntimeCandidates([], [registered])).toEqual([
      {
        manifest: athasIcons,
        path: "/bundled/icon-themes/athas",
      },
    ]);
  });

  it("deduplicates catalog entries against their registered runtime extension", () => {
    const symbols = manifest("athas.icon-theme.symbols");
    const available: AvailableExtension = {
      manifest: symbols,
      isInstalled: true,
      isEnabled: true,
      isInstalling: false,
    };
    const registered: BundledExtension = {
      manifest: symbols,
      path: "/bundled/icon-themes/symbols",
      isBundled: true,
      isEnabled: true,
      state: "installed",
    };

    expect(buildExtensionRuntimeCandidates([available], [registered])).toEqual([
      {
        manifest: symbols,
        path: "/bundled/icon-themes/symbols",
      },
    ]);
  });
});
