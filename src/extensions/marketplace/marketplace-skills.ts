import type { MarketplaceSkill } from "@/features/ai/types/skills.types";
import { getManifestSkillContributions } from "../types/extension-contributions";
import type { ExtensionManifest } from "../types/extension-manifest";
import { EXTENSION_ASSET_BASE_URL, loadExtensionCatalog } from "./extension-catalog";

const CDN_BASE_URL = EXTENSION_ASSET_BASE_URL;

function resolveAssetUrl(extensionPath: string, assetPath: string) {
  if (/^(?:[a-z]+:)?\/\//i.test(assetPath)) return assetPath;
  return `${CDN_BASE_URL}/${extensionPath}/${assetPath.replace(/^\.?\//, "")}`;
}

export async function loadMarketplaceSkillContributions(): Promise<MarketplaceSkill[]> {
  const manifests = await loadExtensionCatalog<ExtensionManifest>({ fresh: import.meta.env.DEV });

  return Object.entries(manifests).flatMap(([extensionPath, manifest]) => {
    if (!manifest.license?.trim()) return [];

    return getManifestSkillContributions(manifest).map((skill) => ({
      id: skill.id,
      title: skill.name,
      description: skill.description || manifest.description,
      author: manifest.publisher,
      license: manifest.license,
      version: manifest.version,
      tags: skill.tags || [],
      detailUrl: resolveAssetUrl(extensionPath, skill.path),
      sourceUrl: manifest.repository?.url,
    }));
  });
}
