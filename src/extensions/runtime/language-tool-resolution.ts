import { invoke } from "@tauri-apps/api/core";
import type { ExtensionRuntimeIssue } from "../registry/extension-store-types";
import { getManifestLanguageContributions } from "../types/extension-contributions";
import type { ExtensionManifest } from "../types/extension-manifest";
import {
  getLanguageToolConfigSet,
  type BackendLanguageToolConfigSet,
  type LanguageToolType,
} from "./language-tool-config";

type ToolPathMap = Partial<Record<LanguageToolType, string>>;
type ToolIssueMap = Partial<Record<LanguageToolType, string>>;

interface ResolvedToolPathsResult {
  toolPaths: ToolPathMap;
  issues: ExtensionRuntimeIssue[];
}

function extractFailedToolMessage(toolStatus: unknown): string | null {
  if (!toolStatus || typeof toolStatus !== "object") return null;
  if ("Failed" in toolStatus && typeof toolStatus.Failed === "string") {
    return toolStatus.Failed;
  }
  if ("failed" in toolStatus && typeof toolStatus.failed === "string") {
    return toolStatus.failed;
  }
  return null;
}

export function isExpectedMissingToolError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("system tool not found") ||
    message.includes("not found in PATH") ||
    message.includes("known toolchain locations")
  );
}

function buildRuntimeIssues(
  toolConfig: BackendLanguageToolConfigSet | undefined,
  issues: ToolIssueMap,
): ExtensionRuntimeIssue[] {
  if (!toolConfig) return [];

  const runtimeIssues: ExtensionRuntimeIssue[] = [];
  const toolTypes: LanguageToolType[] = ["lsp", "formatter", "linter"];
  for (const toolType of toolTypes) {
    const message = issues[toolType];
    if (toolConfig[toolType] && message) {
      runtimeIssues.push({ tool: toolType, message });
    }
  }
  return runtimeIssues;
}

async function installLanguageTools(
  languageId: string,
  manifest?: ExtensionManifest,
): Promise<ToolIssueMap> {
  const status = await invoke<Record<string, unknown>>("install_language_tools", {
    languageId,
    tools: getLanguageToolConfigSet(manifest),
  });
  const issues: ToolIssueMap = {};

  for (const [tool, toolStatus] of Object.entries(status)) {
    const failureMessage = extractFailedToolMessage(toolStatus);
    if (failureMessage) {
      issues[tool as LanguageToolType] = failureMessage;
    }
  }
  return issues;
}

async function getToolPath(
  languageId: string,
  toolType: LanguageToolType,
  manifest?: ExtensionManifest,
): Promise<string | null> {
  try {
    return await invoke<string | null>("get_tool_path", {
      languageId,
      toolType,
      tools: getLanguageToolConfigSet(manifest),
    });
  } catch (error) {
    if (!isExpectedMissingToolError(error)) {
      console.warn(`Failed to resolve ${toolType} path for ${languageId}:`, error);
    }
    return null;
  }
}

export async function resolveToolPaths(
  languageId: string,
  manifest?: ExtensionManifest,
  options: { ensureInstalled?: boolean; repairMissing?: boolean } = {},
): Promise<ResolvedToolPathsResult> {
  const toolConfig = getLanguageToolConfigSet(manifest);
  let issues: ToolIssueMap = options.ensureInstalled
    ? await installLanguageTools(languageId, manifest)
    : {};
  const resolvePaths = async () => {
    const [lsp, formatter, linter] = await Promise.all([
      getToolPath(languageId, "lsp", manifest),
      getToolPath(languageId, "formatter", manifest),
      getToolPath(languageId, "linter", manifest),
    ]);
    return { lsp, formatter, linter };
  };

  let toolPaths = await resolvePaths();
  const missingTools = (["lsp", "formatter", "linter"] as LanguageToolType[]).filter(
    (toolType) => Boolean(toolConfig?.[toolType]) && !toolPaths[toolType],
  );

  if (options.repairMissing && missingTools.length > 0) {
    issues = { ...(await installLanguageTools(languageId, manifest)), ...issues };
    toolPaths = await resolvePaths();
  }

  if (toolConfig?.lsp && !toolPaths.lsp) {
    issues.lsp ||= "Language server binary could not be resolved. Reinstall the language tools.";
  }
  if (toolConfig?.formatter && !toolPaths.formatter) {
    issues.formatter ||= "Formatter binary could not be resolved. Reinstall the language tools.";
  }
  if (toolConfig?.linter && !toolPaths.linter) {
    issues.linter ||= "Linter binary could not be resolved. Reinstall the language tools.";
  }

  return {
    toolPaths: {
      ...(toolPaths.lsp ? { lsp: toolPaths.lsp } : {}),
      ...(toolPaths.formatter ? { formatter: toolPaths.formatter } : {}),
      ...(toolPaths.linter ? { linter: toolPaths.linter } : {}),
    },
    issues: buildRuntimeIssues(toolConfig, issues),
  };
}

export function buildRuntimeManifest(
  manifest: ExtensionManifest,
  toolPaths: ToolPathMap,
): ExtensionManifest {
  const managedTools = getLanguageToolConfigSet(manifest);
  const languages = getManifestLanguageContributions(manifest);
  const runtimeManifest: ExtensionManifest = {
    ...manifest,
    ...(languages.length > 0 ? { languages } : {}),
  };

  if (runtimeManifest.lsp && managedTools?.lsp) {
    if (toolPaths.lsp) {
      runtimeManifest.lsp = { ...runtimeManifest.lsp, server: { default: toolPaths.lsp } };
    } else {
      delete runtimeManifest.lsp;
    }
  }
  if (runtimeManifest.formatter && managedTools?.formatter) {
    if (toolPaths.formatter) {
      runtimeManifest.formatter = {
        ...runtimeManifest.formatter,
        command: { default: toolPaths.formatter },
      };
    } else {
      delete runtimeManifest.formatter;
    }
  }
  if (runtimeManifest.linter && managedTools?.linter) {
    if (toolPaths.linter) {
      runtimeManifest.linter = {
        ...runtimeManifest.linter,
        command: { default: toolPaths.linter },
      };
    } else {
      delete runtimeManifest.linter;
    }
  }

  return runtimeManifest;
}
