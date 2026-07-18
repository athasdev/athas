import { useAuthStore } from "@/features/window/stores/auth.store";
import type { AvailableExtension } from "./extension-store-types";
import { extensionRegistry } from "./extension-registry";
import type { ExtensionManifest } from "../types/extension-manifest";
import {
  getManifestActivationEvents,
  getManifestLanguageContributions,
  matchesLanguageContribution,
} from "../types/extension-contributions";

const HIDDEN_MARKETPLACE_EXTENSION_IDS = new Set(["athas.tsx"]);

const normalizeExtensionId = (value: string) => value.trim().toLowerCase();

export function isExtensionAllowedByEnterprisePolicy(extensionId: string): boolean {
  const subscription = useAuthStore.getState().subscription;
  const enterprise = subscription?.enterprise;
  const policy = enterprise?.policy;

  if (!enterprise?.has_access || !policy?.managedMode || !policy.requireExtensionAllowlist) {
    return true;
  }

  const allowedIds = new Set((policy.allowedExtensionIds || []).map(normalizeExtensionId));
  return allowedIds.has(normalizeExtensionId(extensionId));
}

export function mergeMarketplaceLanguageExtensions(
  extensions: ExtensionManifest[],
): ExtensionManifest[] {
  const visibleExtensions = extensions.filter(
    (manifest) => !HIDDEN_MARKETPLACE_EXTENSION_IDS.has(manifest.id),
  );

  const typescript = visibleExtensions.find((manifest) => manifest.id === "athas.typescript");
  const tsx = extensions.find((manifest) => manifest.id === "athas.tsx");

  const tsxLanguages = tsx ? getManifestLanguageContributions(tsx) : [];
  if (!typescript || !tsx || tsxLanguages.length === 0) {
    return visibleExtensions;
  }

  const mergedLanguages = [...getManifestLanguageContributions(typescript)];
  const existingLanguageIds = new Set(mergedLanguages.map((lang) => lang.id));

  for (const language of tsxLanguages) {
    if (!existingLanguageIds.has(language.id)) {
      mergedLanguages.push({
        ...language,
        extensions: [...language.extensions],
        aliases: language.aliases ? [...language.aliases] : undefined,
        filenames: language.filenames ? [...language.filenames] : undefined,
        filenamePatterns: language.filenamePatterns ? [...language.filenamePatterns] : undefined,
      });
      existingLanguageIds.add(language.id);
    }
  }

  const mergedActivationEvents = Array.from(
    new Set([...getManifestActivationEvents(typescript), ...getManifestActivationEvents(tsx)]),
  );

  return visibleExtensions.map((manifest) =>
    manifest.id === typescript.id
      ? {
          ...manifest,
          languages: mergedLanguages,
          activationEvents: mergedActivationEvents,
        }
      : manifest,
  );
}

export function findExtensionForFile(
  filePath: string,
  availableExtensions: Map<string, AvailableExtension>,
): AvailableExtension | undefined {
  for (const [, extension] of availableExtensions) {
    for (const lang of getManifestLanguageContributions(extension.manifest)) {
      if (matchesLanguageContribution(filePath, lang)) {
        return extension;
      }
    }
  }

  const bundledExtensions = extensionRegistry.getAllExtensions();
  for (const bundled of bundledExtensions) {
    for (const lang of getManifestLanguageContributions(bundled.manifest)) {
      if (matchesLanguageContribution(filePath, lang)) {
        return {
          manifest: bundled.manifest,
          isInstalled: true,
          isEnabled: true,
          isInstalling: false,
        };
      }
    }
  }

  return undefined;
}
