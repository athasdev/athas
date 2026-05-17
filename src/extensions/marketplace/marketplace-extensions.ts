import type { ExtensionCategory, ExtensionManifest } from "../types/extension-manifest";

const CDN_BASE_URL = import.meta.env.VITE_PARSER_CDN_URL || "https://athas.dev/extensions";
const ATHAS_EXTENSIONS_CDN_PREFIX = "https://athas.dev/extensions";
const USE_LOCAL_MARKETPLACE_SOURCES = import.meta.env.VITE_EXTENSION_MARKETPLACE_LOCAL === "true";
const withCdnCacheBuster = (url: string) => {
  if (!url.startsWith(ATHAS_EXTENSIONS_CDN_PREFIX)) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
};

const MANIFEST_SOURCES = import.meta.env.VITE_PARSER_CDN_URL
  ? [withCdnCacheBuster(`${CDN_BASE_URL}/manifests.json`)]
  : import.meta.env.DEV && USE_LOCAL_MARKETPLACE_SOURCES
    ? [
        "http://localhost:3000/api/extensions/manifests",
        "http://localhost:3001/manifests.json",
        withCdnCacheBuster(`${CDN_BASE_URL}/manifests.json`),
      ]
    : [withCdnCacheBuster(`${CDN_BASE_URL}/manifests.json`)];

function toExtensionCategories(rawCategories: string[] | undefined): ExtensionCategory[] {
  if (!rawCategories || rawCategories.length === 0) return ["Other"];

  return rawCategories.map((category) => {
    const normalized = category.trim().toLowerCase();
    if (normalized === "database") return "Database";
    if (normalized === "agent") return "Agent";
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
    manifest.databaseProviders?.length ||
    manifest.contributes?.databaseProviders?.length ||
    manifest.agents?.length ||
    manifest.contributes?.agents?.length ||
    manifest.themes?.length ||
    manifest.contributes?.themes?.length ||
    manifest.iconThemes?.length ||
    manifest.contributes?.iconThemes?.length,
  );
}

let cachedMarketplaceExtensions: ExtensionManifest[] | null = null;

async function fetchMarketplaceManifests(): Promise<Record<string, ExtensionManifest>> {
  const errors: string[] = [];

  for (const url of MANIFEST_SOURCES) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as Record<string, ExtensionManifest>;
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Failed to load marketplace manifests. ${errors.join("; ")}`);
}

export async function loadMarketplaceContributionExtensions(): Promise<ExtensionManifest[]> {
  if (cachedMarketplaceExtensions && !import.meta.env.DEV) {
    return cachedMarketplaceExtensions;
  }

  try {
    const manifests = await fetchMarketplaceManifests();
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
