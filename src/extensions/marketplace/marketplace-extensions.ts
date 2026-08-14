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
import { loadExtensionCatalog } from "./extension-catalog";

const CDN_BASE_URL = getServiceUrls().extensionsCdnBaseUrl;

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

export async function loadMarketplaceContributionExtensions(): Promise<ExtensionManifest[]> {
  try {
    const manifests = await loadExtensionCatalog<ExtensionManifest>({ fresh: import.meta.env.DEV });
    return filterRetiredExtensions(
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
    return [];
  }
}
