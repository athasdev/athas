import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { logger } from "@/features/editor/utils/logger";

export interface FormatOptions {
  filePath: string;
  content: string;
  languageId?: string;
}

export interface FormatResult {
  success: boolean;
  formattedContent?: string;
  error?: string;
}

/**
 * Format content using the configured formatter for the file type
 */
export async function formatContent(options: FormatOptions): Promise<FormatResult> {
  const { filePath, languageId } = options;

  try {
    // Try to get formatter by file path first, then by language ID
    let formatterConfig = extensionRegistry.getFormatterForFile(filePath);

    if (!formatterConfig && languageId) {
      formatterConfig = extensionRegistry.getFormatterForLanguage(languageId);
    }

    if (!formatterConfig) {
      logger.debug("FormatterService", `No formatter configured for ${filePath}`);
      return {
        success: false,
        error: "No formatter configured for this file type",
      };
    }

    logger.debug("FormatterService", `Formatting ${filePath} with ${formatterConfig.command}`);

    // TODO: Implement generic formatter invocation in backend
    // For now, return error to indicate formatter is not yet fully implemented
    logger.warn(
      "FormatterService",
      "Formatter invocation not yet fully implemented - skipping formatting",
    );

    return {
      success: false,
      error: "Formatter backend not yet fully implemented",
    };
  } catch (error) {
    logger.error("FormatterService", `Failed to format ${filePath}:`, error);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if formatting is available for a file
 */
export function isFormattingAvailable(filePath: string, languageId?: string): boolean {
  const formatterConfig = extensionRegistry.getFormatterForFile(filePath);
  if (formatterConfig) return true;

  if (languageId) {
    const langFormatterConfig = extensionRegistry.getFormatterForLanguage(languageId);
    return langFormatterConfig !== null;
  }

  return false;
}
