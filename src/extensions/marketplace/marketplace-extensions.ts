import type { ExtensionManifest } from "../types/extension-manifest";
import { normalizeExtensionCategories } from "../manifest/extension-package-contract";
import { filterRetiredExtensions } from "../registry/retired-extensions";
import {
  getManifestAIProviderContributions,
  getManifestDatabaseContributions,
  getManifestIconContributions,
  getManifestIntegrationContributions,
} from "../types/extension-contributions";
import { getServiceUrls } from "@/config/services";

const CDN_BASE_URL = getServiceUrls().extensionsCdnBaseUrl;
const ATHAS_EXTENSIONS_CDN_PREFIX = getServiceUrls().extensionsCdnBaseUrl;
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

function isContributionExtension(manifest: ExtensionManifest): boolean {
  return Boolean(
    getManifestDatabaseContributions(manifest).length ||
    manifest.agents?.length ||
    manifest.contributes?.agents?.length ||
    getManifestAIProviderContributions(manifest).length ||
    getManifestIntegrationContributions(manifest).length ||
    manifest.themes?.length ||
    manifest.contributes?.themes?.length ||
    getManifestIconContributions(manifest).length ||
    Boolean(manifest.main),
  );
}

function isAbsoluteIconUrl(icon: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(icon) || icon.startsWith("/") || icon.startsWith("data:");
}

function resolveMarketplaceIcon(path: string, icon: string | undefined): string {
  const normalizedIcon = icon?.trim() || "icon.svg";

  if (isAbsoluteIconUrl(normalizedIcon)) {
    return normalizedIcon;
  }

  return `${CDN_BASE_URL}/${path}/${normalizedIcon.replace(/^\.?\//, "")}`;
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
    cachedMarketplaceExtensions = filterRetiredExtensions(
      Object.entries(manifests).map(([path, manifest]) => ({
        ...manifest,
        icon: resolveMarketplaceIcon(path, manifest.icon),
        displayName: manifest.displayName || manifest.name,
        description: manifest.description || `${manifest.name} extension`,
        version: manifest.version || "1.0.0",
        publisher: manifest.publisher || "Athas",
        categories: normalizeExtensionCategories(manifest.categories),
      })),
    ).filter(isContributionExtension);
  } catch (error) {
    console.warn("Failed to load marketplace contribution extensions:", error);
    cachedMarketplaceExtensions = [];
  }

  return cachedMarketplaceExtensions;
}
