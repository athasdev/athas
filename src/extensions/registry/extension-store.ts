import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { wasmParserLoader } from "@/features/editor/lib/wasm-parser/loader";
import { useAuthStore } from "@/stores/auth-store";
import { NODE_PLATFORM, PLATFORM_ARCH } from "@/utils/platform";
import { createSelectors } from "@/utils/zustand-selectors";
import { extensionInstaller } from "../installer/extension-installer";
import {
  getHighlightQueryUrl,
  getHighlightQueryUrlForExtension,
  getLanguageExtensionById,
  getPackagedLanguageExtensions,
  getWasmUrlForLanguage,
  initializeLanguagePackager,
} from "../languages/language-packager";
import { extensionRegistry } from "../registry/extension-registry";
import type { ExtensionManifest, ToolRuntime } from "../types/extension-manifest";

export interface ExtensionInstallationMetadata {
  id: string;
  name: string;
  version: string;
  installed_at: string;
  enabled: boolean;
}

export interface AvailableExtension {
  manifest: ExtensionManifest;
  isInstalled: boolean;
  isInstalling: boolean;
  installProgress?: number;
  installError?: string;
}

interface ExtensionStoreState {
  availableExtensions: Map<string, AvailableExtension>;
  installedExtensions: Map<string, ExtensionInstallationMetadata>;
  extensionsWithUpdates: Set<string>;
  isLoadingRegistry: boolean;
  isLoadingInstalled: boolean;
  isCheckingUpdates: boolean;
  actions: {
    loadAvailableExtensions: () => Promise<void>;
    loadInstalledExtensions: () => Promise<void>;
    isExtensionInstalled: (extensionId: string) => boolean;
    getExtensionForFile: (filePath: string) => AvailableExtension | undefined;
    installExtension: (extensionId: string) => Promise<void>;
    uninstallExtension: (extensionId: string) => Promise<void>;
    updateExtension: (extensionId: string) => Promise<void>;
    checkForUpdates: () => Promise<string[]>;
    updateInstallProgress: (extensionId: string, progress: number, error?: string) => void;
  };
}

const HIDDEN_MARKETPLACE_EXTENSION_IDS = new Set(["athas.tsx"]);

const normalizeExtensionId = (value: string) => value.trim().toLowerCase();

function isExtensionAllowedByEnterprisePolicy(extensionId: string): boolean {
  const subscription = useAuthStore.getState().subscription;
  const enterprise = subscription?.enterprise;
  const policy = enterprise?.policy;

  if (!enterprise?.has_access || !policy?.managedMode || !policy.requireExtensionAllowlist) {
    return true;
  }

  const allowedIds = new Set((policy.allowedExtensionIds || []).map(normalizeExtensionId));
  return allowedIds.has(normalizeExtensionId(extensionId));
}

function mergeMarketplaceLanguageExtensions(extensions: ExtensionManifest[]): ExtensionManifest[] {
  const visibleExtensions = extensions.filter(
    (manifest) => !HIDDEN_MARKETPLACE_EXTENSION_IDS.has(manifest.id),
  );

  const typescript = visibleExtensions.find((manifest) => manifest.id === "athas.typescript");
  const tsx = extensions.find((manifest) => manifest.id === "athas.tsx");

  if (!typescript || !tsx?.languages?.length) {
    return visibleExtensions;
  }

  const mergedLanguages = [...(typescript.languages || [])];
  const existingLanguageIds = new Set(mergedLanguages.map((lang) => lang.id));

  for (const language of tsx.languages) {
    if (!existingLanguageIds.has(language.id)) {
      mergedLanguages.push({
        ...language,
        extensions: [...language.extensions],
        aliases: language.aliases ? [...language.aliases] : undefined,
        filenames: language.filenames ? [...language.filenames] : undefined,
      });
      existingLanguageIds.add(language.id);
    }
  }

  const mergedActivationEvents = Array.from(
    new Set([...(typescript.activationEvents || []), ...(tsx.activationEvents || [])]),
  );

  return visibleExtensions.map((manifest) =>
    manifest.id === typescript.id
      ? {
          ...manifest,
          languages: mergedLanguages,
          activationEvents: mergedActivationEvents,
        }
      : manifest,
  );
}

/**
 * Helper function to register a language provider with the ExtensionManager.
 * This consolidates the registration logic used in both loadInstalledExtensions and installExtension.
 */
async function registerLanguageProvider(params: {
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

  const { tokenizeCode, convertToEditorTokens } = await import("@/features/editor/lib/wasm-parser");

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

function resolveInstalledExtensionId(
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
    await invoke("install_language_tools", {
      languageId,
      tools: getLanguageToolConfigSet(manifest),
    });
  } catch (error) {
    console.warn(`Failed to install tools for ${languageId}:`, error);
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
  } catch {
    return null;
  }
}

async function resolveToolPaths(
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

  return {
    ...(lsp ? { lsp } : {}),
    ...(formatter ? { formatter } : {}),
    ...(linter ? { linter } : {}),
  };
}

function buildRuntimeManifest(
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

const useExtensionStoreBase = create<ExtensionStoreState>()(
  immer((set, get) => ({
    availableExtensions: new Map(),
    installedExtensions: new Map(),
    extensionsWithUpdates: new Set(),
    isLoadingRegistry: false,
    isLoadingInstalled: false,
    isCheckingUpdates: false,

    actions: {
      loadAvailableExtensions: async () => {
        set((state) => {
          state.isLoadingRegistry = true;
        });

        try {
          // Load language extensions from packager (all installable from server)
          const extensions: ExtensionManifest[] = mergeMarketplaceLanguageExtensions(
            getPackagedLanguageExtensions(),
          );

          // Check which extensions are installed
          const installed = get().installedExtensions;

          set((state) => {
            // Add all language extensions as installable
            for (const manifest of extensions) {
              state.availableExtensions.set(manifest.id, {
                manifest,
                isInstalled: installed.has(manifest.id),
                isInstalling: false,
              });
            }

            state.isLoadingRegistry = false;
          });
        } catch (error) {
          console.error("Failed to load available extensions:", error);
          set((state) => {
            state.isLoadingRegistry = false;
          });
        }
      },

      loadInstalledExtensions: async () => {
        set((state) => {
          state.isLoadingInstalled = true;
        });

        try {
          // Load from backend (non-language extensions)
          let backendInstalled: ExtensionInstallationMetadata[] = [];
          try {
            backendInstalled = await invoke<ExtensionInstallationMetadata[]>(
              "list_installed_extensions_new",
            );
          } catch {
            // Backend command may not exist yet, continue with IndexedDB check
          }

          // Also check IndexedDB for installed language parsers
          const indexedDBInstalled = await extensionInstaller.listInstalled();
          const availableExtensions = get().availableExtensions;

          // Register language extensions with the ExtensionManager
          for (const installed of indexedDBInstalled) {
            const languageId = installed.languageId;
            const extensionId = resolveInstalledExtensionId(installed, availableExtensions);

            const extension =
              availableExtensions.get(extensionId)?.manifest ||
              getLanguageExtensionById(languageId);
            const languageConfig = extension?.languages?.find((lang) => lang.id === languageId);
            const languageExtensions = languageConfig?.extensions || [`.${languageId}`];
            const aliases = languageConfig?.aliases;

            if (extension) {
              const toolPaths = await resolveToolPaths(languageId, extension);
              const runtimeManifest = buildRuntimeManifest(extension, toolPaths);
              extensionRegistry.registerExtension(runtimeManifest, {
                isBundled: false,
                isEnabled: true,
                state: "installed",
              });
            }

            try {
              await registerLanguageProvider({
                extensionId,
                languageId,
                displayName: extension?.displayName || languageId,
                version: installed.version,
                extensions: languageExtensions,
                aliases,
              });
            } catch (error) {
              console.debug(`Could not load language extension ${languageId}:`, error);
            }
          }

          set((state) => {
            // Start with backend installed extensions
            state.installedExtensions = new Map(backendInstalled.map((ext) => [ext.id, ext]));

            // Add language extensions from IndexedDB
            for (const installed of indexedDBInstalled) {
              const extensionId = resolveInstalledExtensionId(installed, state.availableExtensions);

              if (!state.installedExtensions.has(extensionId)) {
                // Get manifest info if available, but always add to installedExtensions
                // to avoid timing issues where availableExtensions hasn't loaded yet
                const ext =
                  state.availableExtensions.get(extensionId) ||
                  (() => {
                    const manifest = getLanguageExtensionById(installed.languageId);
                    return manifest
                      ? {
                          manifest,
                          isInstalled: true,
                          isInstalling: false,
                        }
                      : undefined;
                  })();
                state.installedExtensions.set(extensionId, {
                  id: extensionId,
                  name: ext?.manifest.displayName || installed.languageId,
                  version: installed.version,
                  installed_at: new Date().toISOString(),
                  enabled: true,
                });
              }
            }

            state.isLoadingInstalled = false;

            // Update available extensions with installation status
            for (const [id, ext] of state.availableExtensions) {
              ext.isInstalled = state.installedExtensions.has(id);
            }
          });
        } catch (error) {
          console.error("Failed to load installed extensions:", error);
          set((state) => {
            state.isLoadingInstalled = false;
          });
        }
      },

      isExtensionInstalled: (extensionId: string) => {
        return get().installedExtensions.has(extensionId);
      },

      getExtensionForFile: (filePath: string) => {
        const fileName = filePath.split("/").pop() || filePath;
        const ext = fileName.split(".").pop()?.toLowerCase();
        const fileExt = ext ? `.${ext}` : null;

        // First check availableExtensions (loaded extensions)
        for (const [, extension] of get().availableExtensions) {
          if (extension.manifest.languages) {
            for (const lang of extension.manifest.languages) {
              if (
                (fileExt && lang.extensions.includes(fileExt)) ||
                lang.filenames?.includes(fileName)
              ) {
                return extension;
              }
            }
          }
        }

        // Fallback: check bundled extensions directly if store not loaded yet
        const bundledExtensions = extensionRegistry.getAllExtensions();
        for (const bundled of bundledExtensions) {
          if (bundled.manifest.languages) {
            for (const lang of bundled.manifest.languages) {
              if (
                (fileExt && lang.extensions.includes(fileExt)) ||
                lang.filenames?.includes(fileName)
              ) {
                // Return as AvailableExtension with isInstalled: true
                return {
                  manifest: bundled.manifest,
                  isInstalled: true,
                  isInstalling: false,
                };
              }
            }
          }
        }

        return undefined;
      },

      installExtension: async (extensionId: string) => {
        const extension = get().availableExtensions.get(extensionId);
        if (!extension) {
          throw new Error(`Extension ${extensionId} not found in registry`);
        }

        if (!isExtensionAllowedByEnterprisePolicy(extensionId)) {
          throw new Error(
            `Installation blocked by enterprise policy. "${extensionId}" is not in the extension allowlist.`,
          );
        }

        if (!extension.manifest.installation) {
          throw new Error(`Extension ${extensionId} has no installation metadata`);
        }

        set((state) => {
          const ext = state.availableExtensions.get(extensionId);
          if (ext) {
            ext.isInstalling = true;
            ext.installProgress = 0;
            ext.installError = undefined;
          }
        });

        try {
          if (extension.manifest.languages && extension.manifest.languages.length > 0) {
            const languageConfigs = extension.manifest.languages;
            const languageCount = languageConfigs.length;

            for (const [index, languageConfig] of languageConfigs.entries()) {
              const languageId = languageConfig.id;
              const wasmUrl = getWasmUrlForLanguage(languageId);
              const highlightQueryUrl =
                getHighlightQueryUrl(languageId) ||
                getHighlightQueryUrlForExtension(extension.manifest) ||
                `${wasmUrl.replace(/parser\.wasm$/, "highlights.scm")}`;

              await extensionInstaller.installLanguage(languageId, wasmUrl, highlightQueryUrl, {
                extensionId,
                version: extension.manifest.version,
                checksum: extension.manifest.installation.checksum || "",
                onProgress: (progress) => {
                  const completedLanguages = index * 100;
                  const normalizedProgress =
                    (completedLanguages + progress.percentage) / languageCount;

                  set((state) => {
                    const ext = state.availableExtensions.get(extensionId);
                    if (ext) {
                      ext.installProgress = normalizedProgress;
                    }
                  });
                },
              });
            }

            const primaryLanguageId = languageConfigs[0].id;
            const toolPaths = await resolveToolPaths(primaryLanguageId, extension.manifest, {
              ensureInstalled: true,
            });
            const runtimeManifest = buildRuntimeManifest(extension.manifest, toolPaths);
            extensionRegistry.registerExtension(runtimeManifest, {
              isBundled: false,
              isEnabled: true,
              state: "installed",
            });

            set((state) => {
              const ext = state.availableExtensions.get(extensionId);
              if (ext) {
                ext.isInstalling = false;
                ext.isInstalled = true;
                ext.installProgress = 100;
                ext.manifest = runtimeManifest;

                state.installedExtensions.set(extensionId, {
                  id: extensionId,
                  name: ext.manifest.displayName,
                  version: ext.manifest.version,
                  installed_at: new Date().toISOString(),
                  enabled: true,
                });
              }
              state.availableExtensions = new Map(state.availableExtensions);
            });

            for (const languageConfig of languageConfigs) {
              await registerLanguageProvider({
                extensionId,
                languageId: languageConfig.id,
                displayName: extension.manifest.displayName,
                version: extension.manifest.version,
                extensions: languageConfig.extensions,
                aliases: languageConfig.aliases,
              });
            }

            const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
            const bufferState = useBufferStore.getState();
            const activeBuffer = bufferState.buffers.find((b) => b.isActive);

            if (activeBuffer && extension.manifest.languages) {
              const fileExt = `.${activeBuffer.path.split(".").pop()?.toLowerCase()}`;
              const matchesLanguage = extension.manifest.languages.some((lang) =>
                lang.extensions.includes(fileExt),
              );

              if (matchesLanguage) {
                const { setSyntaxHighlightingFilePath } = await import(
                  "@/features/editor/extensions/builtin/syntax-highlighting"
                );
                setSyntaxHighlightingFilePath(activeBuffer.path);
              }
            }
          } else {
            // Non-language extension without LSP - use backend download
            await invoke("install_extension_from_url", {
              extensionId,
              url: extension.manifest.installation.downloadUrl,
              checksum: extension.manifest.installation.checksum,
              size: extension.manifest.installation.size,
            });

            // Reload installed extensions
            await get().actions.loadInstalledExtensions();

            set((state) => {
              const ext = state.availableExtensions.get(extensionId);
              if (ext) {
                ext.isInstalling = false;
                ext.isInstalled = true;
                ext.installProgress = 100;
              }
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          set((state) => {
            const ext = state.availableExtensions.get(extensionId);
            if (ext) {
              ext.isInstalling = false;
              ext.installError = errorMessage;
            }
          });

          throw error;
        }
      },

      uninstallExtension: async (extensionId: string) => {
        const extension = get().availableExtensions.get(extensionId);
        if (!extension) {
          throw new Error(`Extension ${extensionId} not found`);
        }

        try {
          // Check if this is a language extension
          if (extension.manifest.languages && extension.manifest.languages.length > 0) {
            const languageIds = extension.manifest.languages.map((language) => language.id);

            // Uninstall all languages for this extension (removes from IndexedDB)
            await Promise.all(
              languageIds.map(async (languageId) => {
                wasmParserLoader.unloadParser(languageId);
                await extensionInstaller.uninstallLanguage(languageId);
              }),
            );

            // Also unload from extension manager if loaded
            const { extensionManager } = await import("@/features/editor/extensions/manager");
            try {
              await Promise.all(
                languageIds.map((languageId) =>
                  extensionManager.unloadLanguageExtension(`${extensionId}:${languageId}`),
                ),
              );
              // Backward compatibility for previously loaded single-id providers.
              await extensionManager.unloadLanguageExtension(extensionId);
            } catch (error) {
              console.warn(`Failed to unload language extension ${extensionId}:`, error);
            }

            extensionRegistry.unregisterExtension(extensionId);

            // Mark as not installed
            set((state) => {
              const ext = state.availableExtensions.get(extensionId);
              if (ext) {
                ext.isInstalled = false;
              }
              // Also remove from installedExtensions map for consistency
              state.installedExtensions.delete(extensionId);
              // Create new Map reference to trigger React re-render
              state.availableExtensions = new Map(state.availableExtensions);
            });
          } else {
            // Non-language extension - use backend uninstall
            await invoke("uninstall_extension_new", { extensionId });

            // Reload installed extensions
            await get().actions.loadInstalledExtensions();

            set((state) => {
              const ext = state.availableExtensions.get(extensionId);
              if (ext) {
                ext.isInstalled = false;
              }
            });
          }
        } catch (error) {
          console.error(`Failed to uninstall extension ${extensionId}:`, error);
          throw error;
        }
      },

      updateInstallProgress: (extensionId: string, progress: number, error?: string) => {
        set((state) => {
          const ext = state.availableExtensions.get(extensionId);
          if (ext) {
            ext.installProgress = progress;
            if (error) {
              ext.installError = error;
              ext.isInstalling = false;
            }
          }
        });
      },

      checkForUpdates: async () => {
        set((state) => {
          state.isCheckingUpdates = true;
        });

        try {
          const installed = await extensionInstaller.listInstalled();
          const updates: string[] = [];

          for (const ext of installed) {
            const extensionId = resolveInstalledExtensionId(ext, get().availableExtensions);
            const available = get().availableExtensions.get(extensionId);
            if (available && available.manifest.version !== ext.version) {
              updates.push(extensionId);
            }
          }

          set((state) => {
            state.extensionsWithUpdates = new Set(updates);
            state.isCheckingUpdates = false;
          });

          return updates;
        } catch (error) {
          console.error("Failed to check for extension updates:", error);
          set((state) => {
            state.isCheckingUpdates = false;
          });
          return [];
        }
      },

      updateExtension: async (extensionId: string) => {
        const extension = get().availableExtensions.get(extensionId);
        if (!extension?.manifest.languages?.[0]) {
          throw new Error(`Extension ${extensionId} not found or has no languages`);
        }

        if (!isExtensionAllowedByEnterprisePolicy(extensionId)) {
          throw new Error(
            `Update blocked by enterprise policy. "${extensionId}" is not in the extension allowlist.`,
          );
        }

        const languageIds = extension.manifest.languages.map((language) => language.id);

        // Unload from memory
        const { extensionManager } = await import("@/features/editor/extensions/manager");
        try {
          await Promise.all(
            languageIds.map((languageId) =>
              extensionManager.unloadLanguageExtension(`${extensionId}:${languageId}`),
            ),
          );
          // Backward compatibility for previously loaded single-id providers.
          await extensionManager.unloadLanguageExtension(extensionId);
        } catch {
          // May not be loaded
        }

        // Unload parsers from memory and delete from IndexedDB
        await Promise.all(
          languageIds.map(async (languageId) => {
            wasmParserLoader.unloadParser(languageId);
            await extensionInstaller.uninstallLanguage(languageId);
          }),
        );
        extensionRegistry.unregisterExtension(extensionId);

        // Remove from updates set
        set((state) => {
          state.extensionsWithUpdates.delete(extensionId);
          state.installedExtensions.delete(extensionId);
          const ext = state.availableExtensions.get(extensionId);
          if (ext) {
            ext.isInstalled = false;
          }
        });

        // Reinstall
        await get().actions.installExtension(extensionId);
      },
    },
  })),
);

// Create selectors wrapper
export const useExtensionStore = createSelectors(useExtensionStoreBase);

// Setup progress listener
let progressListenerInitialized = false;
let extensionStoreInitPromise: Promise<void> | null = null;

export async function waitForExtensionStoreInitialization(): Promise<void> {
  if (extensionStoreInitPromise) {
    await extensionStoreInitPromise;
  }
}

export const initializeExtensionStore = (): Promise<void> => {
  if (extensionStoreInitPromise) return extensionStoreInitPromise;
  extensionStoreInitPromise = initializeExtensionStoreImpl();
  return extensionStoreInitPromise;
};

async function initializeExtensionStoreImpl(): Promise<void> {
  if (!progressListenerInitialized) {
    // Listen for installation progress events
    await listen<{
      extension_id: string;
      status: { type: string; error?: string };
      progress: number;
      message: string;
    }>("extension://install-progress", (event) => {
      const { extension_id, progress, status } = event.payload;
      const error = status.type === "failed" ? status.error : undefined;

      useExtensionStoreBase
        .getState()
        .actions.updateInstallProgress(extension_id, progress * 100, error);
    });

    progressListenerInitialized = true;
  }

  // Initialize Tree-sitter WASM (needed for syntax highlighting)
  try {
    await wasmParserLoader.initialize();
  } catch (error) {
    console.error("Failed to initialize WASM parser loader:", error);
  }

  // Fetch extension manifests from CDN before loading available extensions
  await initializeLanguagePackager();

  // Load available extensions first, then installed extensions
  // (installed extensions check needs available extensions to be loaded first)
  const { loadAvailableExtensions, loadInstalledExtensions, checkForUpdates } =
    useExtensionStoreBase.getState().actions;

  await loadAvailableExtensions();
  await loadInstalledExtensions();
  await checkForUpdates();
}
