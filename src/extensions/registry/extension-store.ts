import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import { extensionInstaller } from "../installer/extension-installer";
import {
  getHighlightQueryUrl,
  getPackagedLanguageExtensions,
  getWasmUrlForLanguage,
} from "../languages/language-packager";
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

        try {
          // Load language extensions from packager
          const extensions: ExtensionManifest[] = getPackagedLanguageExtensions();

          // Check which extensions are installed
          const installed = get().installedExtensions;

          set((state) => {
            state.availableExtensions = new Map(
              extensions.map((manifest) => [
                manifest.id,
                {
                  manifest,
                  isInstalled: installed.has(manifest.id),
                  isInstalling: false,
                },
              ]),
            );
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
          const installed = await invoke<ExtensionInstallationMetadata[]>(
            "list_installed_extensions_new",
          );

          set((state) => {
            state.installedExtensions = new Map(installed.map((ext) => [ext.id, ext]));
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

        for (const [, extension] of get().availableExtensions) {
          if (extension.manifest.languages) {
            for (const lang of extension.manifest.languages) {
              if (lang.extensions.includes(fileExt)) {
                return extension;
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
          const { downloadUrl, checksum } = extension.manifest.installation;

          // Check if this is a language extension
          if (extension.manifest.languages && extension.manifest.languages.length > 0) {
            const languageId = extension.manifest.languages[0].id;

            // Use the download URL from the manifest, or generate it if not provided
            const wasmUrl = downloadUrl || getWasmUrlForLanguage(languageId);
            const highlightQueryUrl = getHighlightQueryUrl(languageId);

            // Install using extension installer
            await extensionInstaller.installLanguage(languageId, wasmUrl, highlightQueryUrl, {
              version: extension.manifest.version,
              checksum: checksum || "",
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
              }
            });
          } else {
            // Non-language extension - use old download method
            await invoke("install_extension_from_url", {
              extensionId,
              url: downloadUrl,
              checksum,
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

  // Load available and installed extensions
  const { loadAvailableExtensions, loadInstalledExtensions } =
    useExtensionStoreBase.getState().actions;

  await Promise.all([loadAvailableExtensions(), loadInstalledExtensions()]);
};
