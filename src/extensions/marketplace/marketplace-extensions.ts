import type { ExtensionCategory, ExtensionManifest } from "../types/extension-manifest";

const CDN_BASE_URL = import.meta.env.VITE_PARSER_CDN_URL || "https://athas.dev/extensions";
const MANIFESTS_URL = `${CDN_BASE_URL}/manifests.json`;

function toExtensionCategories(rawCategories: string[] | undefined): ExtensionCategory[] {
  if (!rawCategories || rawCategories.length === 0) return ["Other"];

  return rawCategories.map((category) => {
    const normalized = category.trim().toLowerCase();
    if (normalized === "database") return "Database";
    if (normalized === "icon theme" || normalized === "icon-theme" || normalized === "icontheme") {
      return "Icon Theme";
    }
    if (normalized === "language") return "Language";
    if (normalized === "linter") return "Linter";
    if (normalized === "formatter") return "Formatter";
    if (normalized === "theme") return "Theme";
    if (normalized === "keymaps") return "Keymaps";
    if (normalized === "snippets") return "Snippets";
    if (normalized === "ui") return "UI";
    return "Other";
  });
}

function isContributionExtension(manifest: ExtensionManifest): boolean {
  return Boolean(
    manifest.databaseProviders?.length || manifest.themes?.length || manifest.iconThemes?.length,
  );
}

let cachedMarketplaceExtensions: ExtensionManifest[] | null = null;

export async function loadMarketplaceContributionExtensions(): Promise<ExtensionManifest[]> {
  if (cachedMarketplaceExtensions) {
    return cachedMarketplaceExtensions;
  }

  try {
    const response = await fetch(MANIFESTS_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const manifests = (await response.json()) as Record<string, ExtensionManifest>;
    cachedMarketplaceExtensions = Object.values(manifests)
      .map((manifest) => ({
        ...manifest,
        displayName: manifest.displayName || manifest.name,
        description: manifest.description || `${manifest.name} extension`,
        version: manifest.version || "1.0.0",
        publisher: manifest.publisher || "Athas",
        categories: toExtensionCategories(manifest.categories),
      }))
      .filter(isContributionExtension);
  } catch (error) {
    console.warn("Failed to load marketplace contribution extensions:", error);
    cachedMarketplaceExtensions = [];
  }

  return cachedMarketplaceExtensions;
}
