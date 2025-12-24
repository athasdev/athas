import { invoke } from "@tauri-apps/api/core";
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

    const language = languageId || getLanguageFromPath(filePath);
    const formatterName = getFormatterName(formatterConfig.command);

    // Get workspace folder (if available)
    const workspaceFolder = getWorkspaceFolder(filePath);

    try {
      const response = await invoke<{
        formatted_content: string;
        success: boolean;
        error?: string;
      }>("format_code", {
        request: {
          content: options.content,
          language,
          formatter: formatterName,
          formatter_config: {
            command: formatterConfig.command,
            args: formatterConfig.args || [],
            env: formatterConfig.env,
            input_method: formatterConfig.inputMethod,
            output_method: formatterConfig.outputMethod,
          },
          file_path: filePath,
          workspace_folder: workspaceFolder,
        },
      });

      if (response.success) {
        logger.debug("FormatterService", `Successfully formatted ${filePath}`);
        return {
          success: true,
          formattedContent: response.formatted_content,
        };
      }

      logger.warn("FormatterService", `Formatting failed: ${response.error}`);
      return {
        success: false,
        error: response.error || "Formatting failed",
      };
    } catch (error) {
      logger.error("FormatterService", `Failed to invoke formatter:`, error);
      throw error;
    }
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

/**
 * Extract formatter name from command path
 * TODO: This should come from extension manifest instead
 */
function getFormatterName(command: string): string {
  const commandLower = command.toLowerCase();

  if (commandLower.includes("prettier")) return "prettier";
  if (commandLower.includes("rustfmt")) return "rustfmt";
  if (commandLower.includes("gofmt")) return "gofmt";
  if (commandLower.includes("eslint")) return "eslint";

  // Default to prettier for unknown formatters
  return "prettier";
}

/**
 * Get language ID from file path
 */
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";

  const extToLang: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    html: "html",
    css: "css",
    md: "markdown",
    rs: "rust",
    go: "go",
    py: "python",
    java: "java",
    c: "c",
    cpp: "cpp",
  };

  return extToLang[ext] || "typescript";
}

/**
 * Get workspace folder from file path
 */
function getWorkspaceFolder(filePath: string): string | undefined {
  // Try to get workspace folder from file system store
  // For now, use the directory containing the file
  // TODO: Get actual workspace root from file system store
  const parts = filePath.split("/");
  if (parts.length > 1) {
    return parts.slice(0, -1).join("/");
  }
  return undefined;
}
