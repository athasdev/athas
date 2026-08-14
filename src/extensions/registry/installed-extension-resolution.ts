import { getManifestLanguageContributions } from "../types/extension-contributions";
import type { AvailableExtension } from "./extension-store-types";

export function resolveInstalledExtensionId(
  installed: { languageId: string; extensionId?: string },
  availableExtensions: Map<string, AvailableExtension>,
): string {
  const candidates = [
    installed.extensionId,
    installed.extensionId?.replace(/-full$/, ""),
    `athas.${installed.languageId}`,
    `language.${installed.languageId}`,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (availableExtensions.has(candidate)) return candidate;
  }

  for (const [extensionId, extension] of availableExtensions) {
    if (
      getManifestLanguageContributions(extension.manifest).some(
        (language) => language.id === installed.languageId,
      )
    ) {
      return extensionId;
    }
  }

  return installed.extensionId || `athas.${installed.languageId}`;
}
