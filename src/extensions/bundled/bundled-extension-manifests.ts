import materialIconTheme from "./icon-themes/material/extension.json";
import symbolsIconTheme from "./icon-themes/symbols/extension.json";
import type { ExtensionManifest } from "../types/extension-manifest";

export interface BundledExtensionManifestEntry {
  manifest: ExtensionManifest;
  relativePath: string;
}

export const bundledExtensionManifests: BundledExtensionManifestEntry[] = [
  {
    manifest: symbolsIconTheme as ExtensionManifest,
    relativePath: "icon-themes/symbols",
  },
  {
    manifest: materialIconTheme as ExtensionManifest,
    relativePath: "icon-themes/material",
  },
];
