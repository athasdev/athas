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
    const pierreIcons = manifest("athas.icon-theme.pierre");
    const registered: BundledExtension = {
      manifest: pierreIcons,
      path: "/bundled/icon-themes/pierre",
      isBundled: true,
      isEnabled: true,
      state: "installed",
    };

    expect(buildExtensionRuntimeCandidates([], [registered])).toEqual([
      {
        manifest: pierreIcons,
        path: "/bundled/icon-themes/pierre",
      },
    ]);
  });

  it("deduplicates catalog entries against their registered runtime extension", () => {
    const pierreIcons = manifest("athas.icon-theme.pierre");
    const available: AvailableExtension = {
      manifest: pierreIcons,
      isInstalled: true,
      isEnabled: true,
      isInstalling: false,
    };
    const registered: BundledExtension = {
      manifest: pierreIcons,
      path: "/bundled/icon-themes/pierre",
      isBundled: true,
      isEnabled: true,
      state: "installed",
    };

    expect(buildExtensionRuntimeCandidates([available], [registered])).toEqual([
      {
        manifest: pierreIcons,
        path: "/bundled/icon-themes/pierre",
      },
    ]);
  });
});
