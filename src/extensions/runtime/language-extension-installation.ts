import { installedLanguages } from "../installer/installed-languages";
import { getLanguageExtensionById } from "../languages/language-packager";
import type { AvailableExtension } from "../registry/extension-store-types";
import { getManifestLanguageContributions } from "../types/extension-contributions";
import type { ExtensionManifest } from "../types/extension-manifest";

export async function registerLanguageProvider(params: {
  extensionId: string;
  languageId: string;
  extensions: string[];
  aliases?: string[];
}): Promise<void> {
  const { extensionId, languageId, extensions, aliases } = params;
  const { languageProviderRegistry } =
    await import("@/extensions/languages/language-provider-registry");
  const runtimeExtensionId = `${extensionId}:${languageId}`;
  if (languageProviderRegistry.has(runtimeExtensionId)) return;
  languageProviderRegistry.register(runtimeExtensionId, { id: languageId, extensions, aliases });
}

/**
 * Records a language integration's languages as installed. There is nothing to download: syntax
 * highlighting comes with the editor, and the integration's tools (language server, formatter,
 * linter) are resolved separately.
 */
export async function installLanguageExtensionManifest(
  extensionId: string,
  manifest: ExtensionManifest,
  onProgress: (progress: number) => void,
): Promise<void> {
  const languageConfigs = getManifestLanguageContributions(manifest);
  for (const languageConfig of languageConfigs) {
    await installedLanguages.add({
      languageId: languageConfig.id,
      extensionId,
      version: manifest.version,
    });
  }
  onProgress(100);
}

export function getExtensionManifestForLanguage(
  extensionId: string,
  availableExtensions: Map<string, AvailableExtension>,
  languageId: string,
): ExtensionManifest | undefined {
  return availableExtensions.get(extensionId)?.manifest || getLanguageExtensionById(languageId);
}
