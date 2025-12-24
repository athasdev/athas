import { invoke } from "@tauri-apps/api/core";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { logger } from "@/features/editor/utils/logger";

export interface LintOptions {
  filePath: string;
  content: string;
  languageId?: string;
}

export interface Diagnostic {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  code?: string;
  source?: string;
}

export interface LintResult {
  success: boolean;
  diagnostics?: Diagnostic[];
  error?: string;
}

/**
 * Lint content using the configured linter for the file type
 */
export async function lintContent(options: LintOptions): Promise<LintResult> {
  const { filePath, languageId } = options;

  try {
    // Try to get linter by file path first, then by language ID
    let linterConfig = extensionRegistry.getLinterForFile(filePath);

    if (!linterConfig && languageId) {
      linterConfig = extensionRegistry.getLinterForLanguage(languageId);
    }

    if (!linterConfig) {
      logger.debug("LinterService", `No linter configured for ${filePath}`);
      return {
        success: true,
        diagnostics: [],
      };
    }

    logger.debug("LinterService", `Linting ${filePath} with ${linterConfig.command}`);

    const language = languageId || extensionRegistry.getLanguageId(filePath) || "unknown";

    // Get workspace folder (if available)
    const workspaceFolder = getWorkspaceFolder(filePath);

    try {
      const response = await invoke<{
        diagnostics: Diagnostic[];
        success: boolean;
        error?: string;
      }>("lint_code", {
        request: {
          content: options.content,
          language,
          linter: "generic",
          linter_config: {
            command: linterConfig.command,
            args: linterConfig.args || [],
            env: linterConfig.env,
            input_method: linterConfig.inputMethod,
            diagnostic_format: linterConfig.diagnosticFormat,
            diagnostic_pattern: linterConfig.diagnosticPattern,
          },
          file_path: filePath,
          workspace_folder: workspaceFolder,
        },
      });

      if (response.success) {
        logger.debug(
          "LinterService",
          `Successfully linted ${filePath}: ${response.diagnostics.length} diagnostics`,
        );
        return {
          success: true,
          diagnostics: response.diagnostics,
        };
      }

      logger.warn("LinterService", `Linting failed: ${response.error}`);
      return {
        success: false,
        error: response.error || "Linting failed",
        diagnostics: [],
      };
    } catch (error) {
      logger.error("LinterService", `Failed to invoke linter:`, error);
      throw error;
    }
  } catch (error) {
    logger.error("LinterService", `Failed to lint ${filePath}:`, error);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      diagnostics: [],
    };
  }
}

/**
 * Check if linting is available for a file
 */
export function isLintingAvailable(filePath: string, languageId?: string): boolean {
  const linterConfig = extensionRegistry.getLinterForFile(filePath);
  if (linterConfig) return true;

  if (languageId) {
    const langLinterConfig = extensionRegistry.getLinterForLanguage(languageId);
    return langLinterConfig !== null;
  }

  return false;
}

/**
 * Get workspace folder from file path
 *
 * This should ideally return the project root (where .git, package.json, Cargo.toml, etc. are)
 * For now, it returns the directory containing the file as a fallback
 *
 * TODO: Integrate with file system store to get actual workspace root
 */
function getWorkspaceFolder(filePath: string): string | undefined {
  const parts = filePath.split("/");
  if (parts.length > 1) {
    return parts.slice(0, -1).join("/");
  }
  return undefined;
}
