import { invoke } from "@tauri-apps/api/core";
import { NODE_PLATFORM, PLATFORM_ARCH } from "@/utils/platform";
import {
  getHighlightQueryUrl,
  getHighlightQueryUrlForExtension,
  getLanguageExtensionById,
  getWasmUrlForLanguage,
} from "../languages/language-packager";
import { extensionInstaller } from "../installer/extension-installer";
import type { AvailableExtension } from "./extension-store-types";
import type { ExtensionManifest, ToolRuntime } from "../types/extension-manifest";

type ToolType = "lsp" | "formatter" | "linter";
type ToolPathMap = Partial<Record<ToolType, string>>;
type BackendToolRuntime = Extract<
  ToolRuntime,
  "bun" | "node" | "python" | "go" | "rust" | "binary"
>;

interface BackendToolConfig {
  name: string;
  runtime: BackendToolRuntime;
  package?: string;
  downloadUrl?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface BackendLanguageToolConfigSet {
  lsp?: BackendToolConfig;
  formatter?: BackendToolConfig;
  linter?: BackendToolConfig;
}

function getCommandDefault(
  command:
    | {
        default?: string;
        darwin?: string;
        linux?: string;
        win32?: string;
      }
    | undefined,
): string | undefined {
  return command?.default || command?.darwin || command?.linux || command?.win32;
}

function getArchToken(): "arm64" | "x64" {
  return PLATFORM_ARCH.endsWith("arm64") ? "arm64" : "x64";
}

function getTargetOsToken(): "apple-darwin" | "unknown-linux-gnu" | "pc-windows-msvc" {
  if (NODE_PLATFORM === "darwin") return "apple-darwin";
  if (NODE_PLATFORM === "win32") return "pc-windows-msvc";
  return "unknown-linux-gnu";
}

function getTargetArchToken(): "aarch64" | "x86_64" {
  return getArchToken() === "arm64" ? "aarch64" : "x86_64";
}

function resolveDownloadUrlTemplate(template: string, extensionVersion: string): string {
  return template
    .replace(/\$\{os\}/g, NODE_PLATFORM)
    .replace(/\$\{arch\}/g, getArchToken())
    .replace(/\$\{platformArch\}/g, PLATFORM_ARCH)
    .replace(/\$\{targetOs\}/g, getTargetOsToken())
    .replace(/\$\{targetArch\}/g, getTargetArchToken())
    .replace(/\$\{archiveExt\}/g, NODE_PLATFORM === "win32" ? "zip" : "gz")
    .replace(/\$\{version\}/g, extensionVersion || "latest");
}

function toBackendToolConfig(
  input: {
    name?: string;
    runtime?: ToolRuntime;
    package?: string;
    downloadUrl?: string;
    args?: string[];
    env?: Record<string, string>;
  },
  extensionVersion: string,
): BackendToolConfig | undefined {
  const name = input.name?.trim();
  if (!name || !input.runtime) {
    return undefined;
  }

  const downloadUrl = input.downloadUrl
    ? resolveDownloadUrlTemplate(input.downloadUrl, extensionVersion)
    : undefined;

  return {
    name,
    runtime: input.runtime,
    ...(input.package ? { package: input.package } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(input.args ? { args: input.args } : {}),
    ...(input.env ? { env: input.env } : {}),
  };
}

function getLanguageToolConfigSet(
  manifest?: ExtensionManifest,
): BackendLanguageToolConfigSet | undefined {
  if (!manifest) return undefined;

  const lsp = manifest.lsp
    ? toBackendToolConfig(
        {
          name: manifest.lsp.name || getCommandDefault(manifest.lsp.server),
          runtime: manifest.lsp.runtime,
          package: manifest.lsp.package,
          downloadUrl: manifest.lsp.downloadUrl,
          args: manifest.lsp.args,
          env: manifest.lsp.env,
        },
        manifest.version,
      )
    : undefined;

  const formatter = manifest.formatter
    ? toBackendToolConfig(
        {
          name: manifest.formatter.name || getCommandDefault(manifest.formatter.command),
          runtime: manifest.formatter.runtime,
          package: manifest.formatter.package,
          downloadUrl: manifest.formatter.downloadUrl,
          args: manifest.formatter.args,
          env: manifest.formatter.env,
        },
        manifest.version,
      )
    : undefined;

  const linter = manifest.linter
    ? toBackendToolConfig(
        {
          name: manifest.linter.name || getCommandDefault(manifest.linter.command),
          runtime: manifest.linter.runtime,
          package: manifest.linter.package,
          downloadUrl: manifest.linter.downloadUrl,
          args: manifest.linter.args,
          env: manifest.linter.env,
        },
        manifest.version,
      )
    : undefined;

  const tools: BackendLanguageToolConfigSet = {
    ...(lsp ? { lsp } : {}),
    ...(formatter ? { formatter } : {}),
    ...(linter ? { linter } : {}),
  };

  return Object.keys(tools).length > 0 ? tools : undefined;
}

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
    if (availableExtensions.has(candidate)) {
      return candidate;
    }
  }

  for (const [extensionId, extension] of availableExtensions) {
    if (extension.manifest.languages?.some((lang) => lang.id === installed.languageId)) {
      return extensionId;
    }
  }

  return installed.extensionId || `athas.${installed.languageId}`;
}

async function installLanguageTools(
  languageId: string,
  manifest?: ExtensionManifest,
): Promise<void> {
  try {
    const status = await invoke<{ lsp?: string; formatter?: string; linter?: string }>(
      "install_language_tools",
      {
        languageId,
        tools: getLanguageToolConfigSet(manifest),
      },
    );

    for (const [tool, toolStatus] of Object.entries(status)) {
      if (typeof toolStatus === "object" && toolStatus && "Failed" in toolStatus) {
        console.warn(
          `Tool installation failed for ${languageId}/${tool}: ${(toolStatus as { Failed: string }).Failed}`,
        );
      }
    }
  } catch (error) {
    console.error(`Failed to install tools for ${languageId}:`, error);
    throw error;
  }
}

async function getToolPath(
  languageId: string,
  toolType: ToolType,
  manifest?: ExtensionManifest,
): Promise<string | null> {
  try {
    return await invoke<string | null>("get_tool_path", {
      languageId,
      toolType,
      tools: getLanguageToolConfigSet(manifest),
    });
  } catch (error) {
    console.warn(`Failed to resolve ${toolType} path for ${languageId}:`, error);
    return null;
  }
}

export async function resolveToolPaths(
  languageId: string,
  manifest?: ExtensionManifest,
  options: { ensureInstalled?: boolean } = {},
): Promise<ToolPathMap> {
  if (options.ensureInstalled) {
    await installLanguageTools(languageId, manifest);
  }

  const [lsp, formatter, linter] = await Promise.all([
    getToolPath(languageId, "lsp", manifest),
    getToolPath(languageId, "formatter", manifest),
    getToolPath(languageId, "linter", manifest),
  ]);

  const toolConfig = getLanguageToolConfigSet(manifest);
  if (toolConfig) {
    if (toolConfig.lsp && !lsp) {
      console.warn(`LSP configured for ${languageId} but binary path could not be resolved`);
    }
    if (toolConfig.formatter && !formatter) {
      console.warn(`Formatter configured for ${languageId} but binary path could not be resolved`);
    }
    if (toolConfig.linter && !linter) {
      console.warn(`Linter configured for ${languageId} but binary path could not be resolved`);
    }
  }

  return {
    ...(lsp ? { lsp } : {}),
    ...(formatter ? { formatter } : {}),
    ...(linter ? { linter } : {}),
  };
}

export function buildRuntimeManifest(
  manifest: ExtensionManifest,
  toolPaths: ToolPathMap,
): ExtensionManifest {
  const runtimeManifest: ExtensionManifest = {
    ...manifest,
    languages: manifest.languages?.map((lang) => ({
      ...lang,
      extensions: [...lang.extensions],
      aliases: lang.aliases ? [...lang.aliases] : undefined,
      filenames: lang.filenames ? [...lang.filenames] : undefined,
    })),
  };

  if (runtimeManifest.lsp) {
    const defaultServer = getCommandDefault(runtimeManifest.lsp.server);
    runtimeManifest.lsp = {
      ...runtimeManifest.lsp,
      server: {
        default: toolPaths.lsp || defaultServer,
      },
    };
  }

  if (runtimeManifest.formatter) {
    const defaultCommand = getCommandDefault(runtimeManifest.formatter.command);
    runtimeManifest.formatter = {
      ...runtimeManifest.formatter,
      command: {
        default: toolPaths.formatter || defaultCommand,
      },
    };
  }

  if (runtimeManifest.linter) {
    const defaultCommand = getCommandDefault(runtimeManifest.linter.command);
    runtimeManifest.linter = {
      ...runtimeManifest.linter,
      command: {
        default: toolPaths.linter || defaultCommand,
      },
    };
  }

  return runtimeManifest;
}

export async function registerLanguageProvider(params: {
  extensionId: string;
  languageId: string;
  displayName: string;
  version: string;
  extensions: string[];
  aliases?: string[];
}): Promise<void> {
  const { extensionId, languageId, displayName, version, extensions, aliases } = params;
  const { extensionManager } = await import("@/features/editor/extensions/manager");
  const runtimeExtensionId = `${extensionId}:${languageId}`;

  if (extensionManager.isExtensionLoaded(runtimeExtensionId)) {
    return;
  }

  const { tokenizeCode, convertToEditorTokens } =
    await import("@/features/editor/lib/wasm-parser/wasm-parser-api");

  const languageExtension = {
    id: runtimeExtensionId,
    displayName,
    version,
    category: "language",
    languageId,
    extensions,
    aliases,

    activate: async (context: {
      registerLanguage: (lang: { id: string; extensions: string[]; aliases?: string[] }) => void;
    }) => {
      context.registerLanguage({
        id: languageId,
        extensions,
        aliases,
      });
    },

    deactivate: async () => {
      // Cleanup if needed
    },

    getTokens: async (content: string) => {
      const highlightTokens = await tokenizeCode(content, languageId);
      return convertToEditorTokens(highlightTokens);
    },
  };

  await extensionManager.loadLanguageExtension(languageExtension);
}

export async function installLanguageExtensionManifest(
  extensionId: string,
  manifest: ExtensionManifest,
  onProgress: (progress: number) => void,
) {
  const languageConfigs = manifest.languages ?? [];
  const languageCount = languageConfigs.length;

  for (const [index, languageConfig] of languageConfigs.entries()) {
    const languageId = languageConfig.id;
    const wasmUrl = getWasmUrlForLanguage(languageId);
    const highlightQueryUrl =
      getHighlightQueryUrl(languageId) ||
      getHighlightQueryUrlForExtension(manifest) ||
      `${wasmUrl.replace(/parser\.wasm$/, "highlights.scm")}`;

    await extensionInstaller.installLanguage(languageId, wasmUrl, highlightQueryUrl, {
      extensionId,
      version: manifest.version,
      checksum: manifest.installation?.checksum || "",
      onProgress: (progress) => {
        const completedLanguages = index * 100;
        const normalizedProgress = (completedLanguages + progress.percentage) / languageCount;
        onProgress(normalizedProgress);
      },
    });
  }
}

export function getExtensionManifestForLanguage(
  extensionId: string,
  availableExtensions: Map<string, AvailableExtension>,
  languageId: string,
) {
  return availableExtensions.get(extensionId)?.manifest || getLanguageExtensionById(languageId);
}
