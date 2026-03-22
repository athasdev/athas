import { useAuthStore } from "@/features/window/stores/auth-store";
import type { AvailableExtension } from "./extension-store-types";
import { extensionRegistry } from "./extension-registry";
import type { ExtensionManifest } from "../types/extension-manifest";

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

  if (!typescript || !tsx?.languages?.length) {
    return visibleExtensions;
  }

  const mergedLanguages = [...(typescript.languages || [])];
  const existingLanguageIds = new Set(mergedLanguages.map((lang) => lang.id));

  for (const language of tsx.languages) {
    if (!existingLanguageIds.has(language.id)) {
      mergedLanguages.push({
        ...language,
        extensions: [...language.extensions],
        aliases: language.aliases ? [...language.aliases] : undefined,
        filenames: language.filenames ? [...language.filenames] : undefined,
      });
      existingLanguageIds.add(language.id);
    }
  }

  const mergedActivationEvents = Array.from(
    new Set([...(typescript.activationEvents || []), ...(tsx.activationEvents || [])]),
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
  const fileName = filePath.split("/").pop() || filePath;
  const ext = fileName.split(".").pop()?.toLowerCase();
  const fileExt = ext ? `.${ext}` : null;

  for (const [, extension] of availableExtensions) {
    if (extension.manifest.languages) {
      for (const lang of extension.manifest.languages) {
        if ((fileExt && lang.extensions.includes(fileExt)) || lang.filenames?.includes(fileName)) {
          return extension;
        }
      }
    }
  }

  const bundledExtensions = extensionRegistry.getAllExtensions();
  for (const bundled of bundledExtensions) {
    if (bundled.manifest.languages) {
      for (const lang of bundled.manifest.languages) {
        if ((fileExt && lang.extensions.includes(fileExt)) || lang.filenames?.includes(fileName)) {
          return {
            manifest: bundled.manifest,
            isInstalled: true,
            isInstalling: false,
          };
        }
      }
    }
  }

  return undefined;
}
