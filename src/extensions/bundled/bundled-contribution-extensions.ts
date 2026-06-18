import { v0ExtensionManifest } from "@/extensions/v0/manifest";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";

export function getBundledContributionExtensions(): ExtensionManifest[] {
  return [v0ExtensionManifest];
}

export function isBundledContributionExtension(manifest: ExtensionManifest): boolean {
  return manifest.installation?.type === "bundled";
}
