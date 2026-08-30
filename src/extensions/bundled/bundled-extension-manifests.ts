import pierreIconTheme from "./icon-themes/pierre/extension.json";
import type { ExtensionManifest } from "../types/extension-manifest";

export interface BundledExtensionManifestEntry {
  manifest: ExtensionManifest;
  relativePath: string;
}

export const bundledExtensionManifests: BundledExtensionManifestEntry[] = [
  {
    manifest: pierreIconTheme as ExtensionManifest,
    relativePath: "icon-themes/pierre",
  },
];
