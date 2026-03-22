import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { wasmParserLoader } from "@/features/editor/lib/wasm-parser/loader";
import { createSelectors } from "@/utils/zustand-selectors";
import { extensionInstaller } from "../installer/extension-installer";
import {
  getPackagedLanguageExtensions,
  initializeLanguagePackager,
} from "../languages/language-packager";
import { extensionRegistry } from "../registry/extension-registry";
import {
  findExtensionForFile,
  isExtensionAllowedByEnterprisePolicy,
  mergeMarketplaceLanguageExtensions,
} from "./extension-store-helpers";
import {
  buildInstalledExtensionMetadata,
  installExtensionLifecycle,
  uninstallExtensionLifecycle,
  updateExtensionLifecycle,
} from "./extension-store-lifecycle";
import {
  buildRuntimeManifest,
  getExtensionManifestForLanguage,
  registerLanguageProvider,
  resolveInstalledExtensionId,
  resolveToolPaths,
} from "./extension-store-runtime";
import type { AvailableExtension, ExtensionInstallationMetadata } from "./extension-store-types";
import type { ExtensionManifest } from "../types/extension-manifest";

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

            const extension = getExtensionManifestForLanguage(
              extensionId,
              availableExtensions,
              languageId,
            );
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
                    const manifest = getExtensionManifestForLanguage(
                      extensionId,
                      state.availableExtensions,
                      installed.languageId,
                    );
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
        return findExtensionForFile(filePath, get().availableExtensions);
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
            await installExtensionLifecycle({
              extensionId,
              extension,
              onProgress: (progress) => {
                set((state) => {
                  const ext = state.availableExtensions.get(extensionId);
                  if (ext) {
                    ext.installProgress = progress;
                  }
                });
              },
              onLanguageInstalled: (runtimeManifest) => {
                set((state) => {
                  const ext = state.availableExtensions.get(extensionId);
                  if (ext) {
                    ext.isInstalling = false;
                    ext.isInstalled = true;
                    ext.installProgress = 100;
                    ext.manifest = runtimeManifest;
                    state.installedExtensions.set(
                      extensionId,
                      buildInstalledExtensionMetadata(extensionId, ext),
                    );
                  }
                  state.availableExtensions = new Map(state.availableExtensions);
                });
              },
              onNonLanguageInstalled: () => {
                set((state) => {
                  const ext = state.availableExtensions.get(extensionId);
                  if (ext) {
                    ext.isInstalling = false;
                    ext.isInstalled = true;
                    ext.installProgress = 100;
                  }
                });
              },
              reloadInstalledExtensions: get().actions.loadInstalledExtensions,
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
          await uninstallExtensionLifecycle({
            extensionId,
            extension,
            onLanguageUninstalled: () => {
              set((state) => {
                const ext = state.availableExtensions.get(extensionId);
                if (ext) {
                  ext.isInstalled = false;
                }
                state.installedExtensions.delete(extensionId);
                state.availableExtensions = new Map(state.availableExtensions);
              });
            },
            onNonLanguageUninstalled: () => {
              set((state) => {
                const ext = state.availableExtensions.get(extensionId);
                if (ext) {
                  ext.isInstalled = false;
                }
              });
            },
            reloadInstalledExtensions: get().actions.loadInstalledExtensions,
          });
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

        await updateExtensionLifecycle({
          extensionId,
          extension,
          clearInstalledStateForUpdate: () => {
            set((state) => {
              state.extensionsWithUpdates.delete(extensionId);
              state.installedExtensions.delete(extensionId);
              const ext = state.availableExtensions.get(extensionId);
              if (ext) {
                ext.isInstalled = false;
              }
            });
          },
          reinstall: () => get().actions.installExtension(extensionId),
        });
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
