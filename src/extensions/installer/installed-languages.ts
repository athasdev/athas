import { indexedDBParserCache } from "@/features/editor/lib/wasm-parser/cache-indexeddb";
import { logger } from "@/features/editor/utils/logger";

export interface InstalledLanguage {
  languageId: string;
  extensionId?: string;
  version: string;
  size: number;
  downloadedAt?: number;
}

/**
 * The installed language integrations, read from the parser cache. Kept apart from the installer,
 * which downloads and verifies packages, so startup can list what is installed without loading
 * the download machinery.
 */
export const installedLanguages = {
  async list(): Promise<InstalledLanguage[]> {
    const entries = await indexedDBParserCache.list();
    return entries.map((entry) => ({
      languageId: entry.languageId,
      extensionId: entry.extensionId,
      version: entry.version,
      size: entry.size,
      downloadedAt: entry.downloadedAt,
    }));
  },

  async uninstall(languageId: string): Promise<void> {
    logger.info("ExtensionInstaller", `Uninstalling language integration: ${languageId}`);
    try {
      await indexedDBParserCache.delete(languageId);
      logger.info("ExtensionInstaller", `Successfully uninstalled ${languageId}`);
    } catch (error) {
      logger.error("ExtensionInstaller", `Failed to uninstall ${languageId}:`, error);
      throw error;
    }
  },

  async has(languageId: string): Promise<boolean> {
    return await indexedDBParserCache.has(languageId);
  },

  async version(languageId: string): Promise<string | null> {
    const entry = await indexedDBParserCache.get(languageId);
    return entry?.version || null;
  },
};
