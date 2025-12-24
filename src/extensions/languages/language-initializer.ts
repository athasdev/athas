/**
 * Language Extension Initializer
 * Loads all language extensions at app startup
 */

import { extensionManager } from "@/features/editor/extensions/manager";
import { logger } from "@/features/editor/utils/logger";
import { allLanguages } from "./language-registry";

/**
 * Initialize all language extensions
 * Should be called after the extension manager is initialized
 */
export async function initializeLanguageExtensions(): Promise<void> {
  logger.info("LanguageExtensions", `Loading ${allLanguages.length} language extensions...`);

  let loaded = 0;
  let failed = 0;

  for (const language of allLanguages) {
    try {
      await extensionManager.loadLanguageExtension(language);
      loaded++;
      logger.info("LanguageExtensions", `Loaded ${language.displayName}`);
    } catch (error) {
      failed++;
      logger.error("LanguageExtensions", `Failed to load ${language.displayName}:`, error);
    }
  }

  logger.info(
    "LanguageExtensions",
    `Language extensions initialized: ${loaded} loaded, ${failed} failed`,
  );
}
