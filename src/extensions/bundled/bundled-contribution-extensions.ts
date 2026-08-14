import { vercelThemeManifest } from "./vercel-theme-manifest";
import { v0ExtensionManifest } from "./v0-extension-manifest";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";

export function getBundledContributionExtensions(): ExtensionManifest[] {
  return [v0ExtensionManifest, vercelThemeManifest];
}

export function isBundledContributionExtension(manifest: ExtensionManifest): boolean {
  return manifest.installation?.type === "bundled";
}
