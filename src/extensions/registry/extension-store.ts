import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { wasmParserLoader } from "@/features/editor/lib/wasm-parser/loader";
import { createSelectors } from "@/utils/zustand-selectors";
import { extensionInstaller } from "../installer/extension-installer";
import { getDownloadInfoForPlatform, getFullExtensions } from "../languages/full-extensions";
import {
  getHighlightQueryUrl,
  getPackagedLanguageExtensions,
  getWasmUrlForLanguage,
} from "../languages/language-packager";
import { extensionRegistry } from "../registry/extension-registry";
import type { ExtensionManifest } from "../types/extension-manifest";

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
  // Available extensions (from registry)
  availableExtensions: Map<string, AvailableExtension>;

  // Installed extensions metadata
  installedExtensions: Map<string, ExtensionInstallationMetadata>;

  // Loading states
  isLoadingRegistry: boolean;
  isLoadingInstalled: boolean;

  actions: {
    // Load available extensions from registry
    loadAvailableExtensions: () => Promise<void>;

    // Load installed extensions
    loadInstalledExtensions: () => Promise<void>;

    // Check if extension is installed
    isExtensionInstalled: (extensionId: string) => boolean;

    // Get extension for file
    getExtensionForFile: (filePath: string) => AvailableExtension | undefined;

    // Install extension
    installExtension: (extensionId: string) => Promise<void>;

    // Uninstall extension
    uninstallExtension: (extensionId: string) => Promise<void>;

    // Update installation progress
    updateInstallProgress: (extensionId: string, progress: number, error?: string) => void;
  };
}

const useExtensionStoreBase = create<ExtensionStoreState>()(
  immer((set, get) => ({
    availableExtensions: new Map(),
    installedExtensions: new Map(),
    isLoadingRegistry: false,
    isLoadingInstalled: false,

    actions: {
      loadAvailableExtensions: async () => {
        set((state) => {
          state.isLoadingRegistry = true;
        });

        // Built-in language IDs that are always available (syntax highlighting only, no LSP)
        const BUILTIN_LANGUAGE_IDS = new Set(["html", "css", "markdown"]);

        try {
          // Load language extensions from packager (installable)
          const extensions: ExtensionManifest[] = getPackagedLanguageExtensions();

          // Also load bundled extensions from extension registry
          const bundledExtensions = extensionRegistry.getAllExtensions();

          // Check which extensions are installed
          const installed = get().installedExtensions;

          set((state) => {
            // Add installable extensions
            for (const manifest of extensions) {
              // Check if this is a built-in language (by checking its language IDs)
              const isBuiltIn = manifest.languages?.some((lang) =>
                BUILTIN_LANGUAGE_IDS.has(lang.id),
              );

              if (isBuiltIn) {
                // Built-in languages: remove installation metadata and mark as installed
                const builtInManifest = { ...manifest };
                delete builtInManifest.installation;
                state.availableExtensions.set(manifest.id, {
                  manifest: builtInManifest,
                  isInstalled: true,
                  isInstalling: false,
                });
              } else {
                // Marketplace extensions: keep installation metadata
                state.availableExtensions.set(manifest.id, {
                  manifest,
                  isInstalled: installed.has(manifest.id),
                  isInstalling: false,
                });
              }
            }

            // Add bundled extensions (always installed)
            for (const bundled of bundledExtensions) {
              state.availableExtensions.set(bundled.manifest.id, {
                manifest: bundled.manifest,
                isInstalled: true, // Bundled extensions are always installed
                isInstalling: false,
              });

              // Also add to installed map if not present
              if (!state.installedExtensions.has(bundled.manifest.id)) {
                state.installedExtensions.set(bundled.manifest.id, {
                  id: bundled.manifest.id,
                  name: bundled.manifest.displayName,
                  version: bundled.manifest.version,
                  installed_at: new Date().toISOString(),
                  enabled: true,
                });
              }
            }

            // Add full extensions (with LSP, formatters, etc.)
            const fullExts = getFullExtensions();
            for (const manifest of fullExts) {
              // Skip if this extension ID was already added as a simple language extension
              // Full extensions take precedence
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

          set((state) => {
            // Start with backend installed extensions
            state.installedExtensions = new Map(backendInstalled.map((ext) => [ext.id, ext]));

            // Add language extensions from IndexedDB
            for (const installed of indexedDBInstalled) {
              // Map languageId to extension ID (e.g., "css" -> "language.css")
              const extensionId = `language.${installed.languageId}`;

              if (!state.installedExtensions.has(extensionId)) {
                // Check if we have manifest info for this extension
                const ext = state.availableExtensions.get(extensionId);
                if (ext) {
                  state.installedExtensions.set(extensionId, {
                    id: extensionId,
                    name: ext.manifest.displayName,
                    version: installed.version,
                    installed_at: new Date().toISOString(),
                    enabled: true,
                  });
                }
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
        const ext = filePath.split(".").pop()?.toLowerCase();
        if (!ext) return undefined;

        const fileExt = `.${ext}`;

        // First check availableExtensions (loaded extensions)
        for (const [, extension] of get().availableExtensions) {
          if (extension.manifest.languages) {
            for (const lang of extension.manifest.languages) {
              if (lang.extensions.includes(fileExt)) {
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
              if (lang.extensions.includes(fileExt)) {
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
          // Check if this is a full extension with LSP (needs filesystem installation)
          const hasLsp = extension.manifest.lsp !== undefined;

          if (hasLsp) {
            // Full extension with LSP - use Tauri backend for filesystem extraction
            // Get platform-specific download info
            const downloadInfo = getDownloadInfoForPlatform(extension.manifest);
            if (!downloadInfo) {
              throw new Error(
                `No download available for extension ${extensionId} on this platform`,
              );
            }

            await invoke("install_extension_from_url", {
              extensionId,
              url: downloadInfo.downloadUrl,
              checksum: downloadInfo.checksum,
              size: downloadInfo.size,
            });

            // Reload installed extensions
            await get().actions.loadInstalledExtensions();

            set((state) => {
              const ext = state.availableExtensions.get(extensionId);
              if (ext) {
                ext.isInstalling = false;
                ext.isInstalled = true;
                ext.installProgress = 100;

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

            // Trigger re-highlighting for open files that match this language
            if (extension.manifest.languages) {
              const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
              const bufferState = useBufferStore.getState();
              const activeBuffer = bufferState.buffers.find((b) => b.isActive);

              if (activeBuffer) {
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
            }
          } else if (extension.manifest.languages && extension.manifest.languages.length > 0) {
            // Simple language extension (WASM + queries only) - use IndexedDB
            const languageId = extension.manifest.languages[0].id;

            // Use the download URL from the manifest, or generate it if not provided
            const wasmUrl =
              extension.manifest.installation.downloadUrl || getWasmUrlForLanguage(languageId);
            const highlightQueryUrl = getHighlightQueryUrl(languageId);

            // Install using extension installer
            await extensionInstaller.installLanguage(languageId, wasmUrl, highlightQueryUrl, {
              version: extension.manifest.version,
              checksum: extension.manifest.installation.checksum || "",
              onProgress: (progress) => {
                set((state) => {
                  const ext = state.availableExtensions.get(extensionId);
                  if (ext) {
                    ext.installProgress = progress.percentage;
                  }
                });
              },
            });

            // Mark as installed
            set((state) => {
              const ext = state.availableExtensions.get(extensionId);
              if (ext) {
                ext.isInstalling = false;
                ext.isInstalled = true;
                ext.installProgress = 100;

                // Also add to installedExtensions map for consistency
                state.installedExtensions.set(extensionId, {
                  id: extensionId,
                  name: ext.manifest.displayName,
                  version: ext.manifest.version,
                  installed_at: new Date().toISOString(),
                  enabled: true,
                });
              }
              // Create new Map reference to trigger React re-render
              state.availableExtensions = new Map(state.availableExtensions);
            });

            // Trigger re-highlighting for open files that match this language
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
            const languageId = extension.manifest.languages[0].id;

            // Uninstall using extension installer (removes from IndexedDB)
            await extensionInstaller.uninstallLanguage(languageId);

            // Also unload from extension manager if loaded
            const { extensionManager } = await import("@/features/editor/extensions/manager");
            try {
              await extensionManager.unloadLanguageExtension(extensionId);
            } catch (error) {
              console.warn(`Failed to unload language extension ${extensionId}:`, error);
            }

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
    },
  })),
);

// Create selectors wrapper
export const useExtensionStore = createSelectors(useExtensionStoreBase);

// Setup progress listener
let progressListenerInitialized = false;

export const initializeExtensionStore = async () => {
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

  // Load available extensions first, then installed extensions
  // (installed extensions check needs available extensions to be loaded first)
  const { loadAvailableExtensions, loadInstalledExtensions } =
    useExtensionStoreBase.getState().actions;

  await loadAvailableExtensions();
  await loadInstalledExtensions();
};
