import athasIconTheme from "./icon-themes/athas/extension.json";
import materialIconTheme from "./icon-themes/material/extension.json";
import pierreIconTheme from "./icon-themes/pierre/extension.json";
import symbolsIconTheme from "./icon-themes/symbols/extension.json";
import type { ExtensionManifest } from "../types/extension-manifest";

export interface BundledExtensionManifestEntry {
  manifest: ExtensionManifest;
  relativePath: string;
}

export const bundledExtensionManifests: BundledExtensionManifestEntry[] = [
  {
    manifest: athasIconTheme as ExtensionManifest,
    relativePath: "icon-themes/athas",
  },
  {
    manifest: symbolsIconTheme as ExtensionManifest,
    relativePath: "icon-themes/symbols",
  },
  {
    manifest: pierreIconTheme as ExtensionManifest,
    relativePath: "icon-themes/pierre",
  },
  {
    manifest: materialIconTheme as ExtensionManifest,
    relativePath: "icon-themes/material",
  },
];
