/**
 * Language Extension Initializer
 * Languages are now loaded dynamically via the extension store when installed
 */

import { logger } from "@/features/editor/utils/logger";

/**
 * Initialize language extensions
 * This is now a no-op since languages are loaded via the extension store
 */
export async function initializeLanguageExtensions(): Promise<void> {
  logger.info("LanguageExtensions", "Language extensions are loaded via the extension store");
}
