import { extensionInstaller } from "../installer/extension-installer";
import {
  getHighlightQueryUrl,
  getHighlightQueryUrlForExtension,
  getLanguageExtensionById,
  getWasmUrlForLanguage,
} from "../languages/language-packager";
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

  const { tokenizeCode, convertToEditorTokens } =
    await import("@/features/editor/lib/wasm-parser/wasm-parser-api");
  languageProviderRegistry.register(runtimeExtensionId, {
    id: languageId,
    extensions,
    aliases,
    getTokens: async (content: string) => {
      const wasmPath = getWasmUrlForLanguage(languageId);
      const highlightQueryUrl = getHighlightQueryUrl(languageId);
      const highlightTokens = await tokenizeCode(content, languageId, {
        languageId,
        wasmPath,
        highlightQueryUrl,
      });
      return convertToEditorTokens(highlightTokens);
    },
  });
}

export async function installLanguageExtensionManifest(
  extensionId: string,
  manifest: ExtensionManifest,
  onProgress: (progress: number) => void,
): Promise<void> {
  const languageConfigs = getManifestLanguageContributions(manifest);
  const progressByLanguage = languageConfigs.map(() => 0);

  await Promise.all(
    languageConfigs.map((languageConfig, index) => {
      const languageId = languageConfig.id;
      const wasmUrl = getWasmUrlForLanguage(languageId);
      const highlightQueryUrl =
        getHighlightQueryUrl(languageId) ||
        getHighlightQueryUrlForExtension(manifest) ||
        wasmUrl.replace(/parser\.wasm$/, "highlights.scm");

      return extensionInstaller.installLanguage(languageId, wasmUrl, highlightQueryUrl, {
        extensionId,
        version: manifest.version,
        checksum: manifest.installation?.checksum || "",
        onProgress: (progress) => {
          progressByLanguage[index] = progress.percentage;
          onProgress(
            progressByLanguage.reduce((sum, value) => sum + value, 0) / progressByLanguage.length,
          );
        },
      });
    }),
  );
}

export function getExtensionManifestForLanguage(
  extensionId: string,
  availableExtensions: Map<string, AvailableExtension>,
  languageId: string,
): ExtensionManifest | undefined {
  return availableExtensions.get(extensionId)?.manifest || getLanguageExtensionById(languageId);
}
