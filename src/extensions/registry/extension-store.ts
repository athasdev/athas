import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import { extensionInstaller } from "../installer/extension-installer";
import { getFullExtensions } from "../languages/full-extensions";
import { getPackagedLanguageExtensions } from "../languages/language-packager";
import { extensionRegistry } from "./extension-registry";
import {
  findExtensionForFile,
  isExtensionAllowedByEnterprisePolicy,
  mergeMarketplaceLanguageExtensions,
} from "./extension-store-helpers";
import {
  buildInstalledExtensionsMap,
  initializeExtensionStoreBootstrap,
  loadInstalledExtensionsSnapshot,
} from "./extension-store-bootstrap";
import {
  buildInstalledExtensionMetadata,
  installExtensionLifecycle,
  uninstallExtensionLifecycle,
  updateExtensionLifecycle,
} from "./extension-store-lifecycle";
import { resolveInstalledExtensionId } from "./extension-store-runtime";
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
          const packagedExtensions = getPackagedLanguageExtensions();
          const fallbackExtensions = getFullExtensions();
          const extensions: ExtensionManifest[] = mergeMarketplaceLanguageExtensions(
            packagedExtensions.length > 0 ? packagedExtensions : fallbackExtensions,
          );

          // Check which extensions are installed
          const installed = get().installedExtensions;

          for (const manifest of extensions) {
            const existing = extensionRegistry.getExtension(manifest.id);
            if (existing?.state === "installed") {
              continue;
            }

            extensionRegistry.registerExtension(manifest, {
              isBundled: false,
              isEnabled: true,
              state: installed.has(manifest.id) ? "installed" : "not-installed",
            });
          }

          set((state) => {
            // Add all language extensions as installable
            for (const manifest of extensions) {
              state.availableExtensions.set(manifest.id, {
                manifest,
                isInstalled: installed.has(manifest.id),
                isInstalling: false,
                runtimeIssues: [],
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
          const availableExtensions = get().availableExtensions;
          const { backendInstalled, indexedDBInstalled, runtimeIssues } =
            await loadInstalledExtensionsSnapshot(availableExtensions);
          const installedExtensions = buildInstalledExtensionsMap({
            backendInstalled,
            indexedDBInstalled,
            availableExtensions,
          });

          set((state) => {
            state.installedExtensions = installedExtensions;
            state.isLoadingInstalled = false;

            for (const [id, ext] of state.availableExtensions) {
              ext.isInstalled = state.installedExtensions.has(id);
              ext.runtimeIssues = runtimeIssues.get(id) || [];
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
            ext.runtimeIssues = [];
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
              onLanguageInstalled: (runtimeManifest, runtimeIssues) => {
                set((state) => {
                  const ext = state.availableExtensions.get(extensionId);
                  if (ext) {
                    ext.isInstalling = false;
                    ext.isInstalled = true;
                    ext.installProgress = 100;
                    ext.installError = undefined;
                    ext.manifest = runtimeManifest;
                    ext.runtimeIssues = runtimeIssues || [];
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
              ext.runtimeIssues = [];
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
                  ext.runtimeIssues = [];
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
                  ext.runtimeIssues = [];
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
  const { loadAvailableExtensions, loadInstalledExtensions, checkForUpdates } =
    useExtensionStoreBase.getState().actions;
  await initializeExtensionStoreBootstrap({
    onProgress: (extensionId, progress, error) => {
      useExtensionStoreBase.getState().actions.updateInstallProgress(extensionId, progress, error);
    },
    loadAvailableExtensions,
    loadInstalledExtensions,
    checkForUpdates,
  });
}
