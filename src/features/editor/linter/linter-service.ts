import { commands, type Diagnostic as BackendDiagnostic } from "@/bindings/commands";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { logger } from "@/features/editor/utils/logger";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";

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

  if (filePath.startsWith("wsl://")) {
    return {
      success: true,
      diagnostics: [],
    };
  }

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
      const response = await commands.lintCode({
        content: options.content,
        language,
        linter: "generic",
        linter_config: {
          command: linterConfig.command,
          args: linterConfig.args || [],
          env: linterConfig.env ?? null,
          input_method: linterConfig.inputMethod ?? null,
          diagnostic_format: linterConfig.diagnosticFormat ?? null,
          diagnostic_pattern: linterConfig.diagnosticPattern ?? null,
        },
        file_path: filePath,
        workspace_folder: workspaceFolder ?? null,
      });

      if (response.success) {
        logger.debug(
          "LinterService",
          `Successfully linted ${filePath}: ${response.diagnostics.length} diagnostics`,
        );
        return {
          success: true,
          diagnostics: response.diagnostics.map(toLintDiagnostic),
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

const LINT_SEVERITIES = new Set<Diagnostic["severity"]>(["error", "warning", "info", "hint"]);

function toLintDiagnostic(diagnostic: BackendDiagnostic): Diagnostic {
  const severity = diagnostic.severity as Diagnostic["severity"];
  return {
    line: diagnostic.line,
    column: diagnostic.column,
    endLine: diagnostic.end_line ?? undefined,
    endColumn: diagnostic.end_column ?? undefined,
    severity: LINT_SEVERITIES.has(severity) ? severity : "info",
    message: diagnostic.message,
    code: diagnostic.code ?? undefined,
    source: diagnostic.source ?? undefined,
  };
}

/**
 * Get workspace folder from file path
 */
function getWorkspaceFolder(filePath: string): string | undefined {
  const rootFolderPath = useFileSystemStore.getState().rootFolderPath;
  if (rootFolderPath) return rootFolderPath;

  // Fallback to file's directory if no project is open
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash > 0) {
    return filePath.slice(0, lastSlash);
  }
  return undefined;
}
