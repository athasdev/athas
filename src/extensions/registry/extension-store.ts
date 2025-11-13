import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
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
          // For now, we'll define available extensions inline
          // In production, this would fetch from a remote registry
          const extensions: ExtensionManifest[] = [
            {
              id: "athas.typescript",
              name: "TypeScript",
              displayName: "TypeScript",
              description: "TypeScript and JavaScript language support",
              version: "1.0.0",
              publisher: "Athas",
              categories: ["Language"],
              languages: [
                {
                  id: "typescript",
                  extensions: [".ts", ".tsx", ".mts", ".cts"],
                  aliases: ["TypeScript", "ts"],
                },
                {
                  id: "javascript",
                  extensions: [".js", ".jsx", ".mjs", ".cjs"],
                  aliases: ["JavaScript", "js"],
                },
              ],
              installation: {
                downloadUrl:
                  "https://extensions.athas.dev/typescript/v1.0.0/typescript-extension.tar.gz",
                size: 52428800,
                checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                minEditorVersion: "0.1.0",
              },
              activationEvents: ["onLanguage:typescript", "onLanguage:javascript"],
            },
            {
              id: "athas.rust",
              name: "Rust",
              displayName: "Rust",
              description: "Rust language support",
              version: "1.0.0",
              publisher: "Athas",
              categories: ["Language"],
              languages: [
                {
                  id: "rust",
                  extensions: [".rs"],
                  aliases: ["Rust", "rs"],
                },
              ],
              installation: {
                downloadUrl: "https://extensions.athas.dev/rust/v1.0.0/rust-extension.tar.gz",
                size: 45678901,
                checksum: "a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890",
                minEditorVersion: "0.1.0",
              },
              activationEvents: ["onLanguage:rust"],
            },
          ];

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
          const { downloadUrl, checksum, size } = extension.manifest.installation;

          await invoke("install_extension_from_url", {
            extensionId,
            url: downloadUrl,
            checksum,
            size,
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
        try {
          await invoke("uninstall_extension_new", { extensionId });

          // Reload installed extensions
          await get().actions.loadInstalledExtensions();

          set((state) => {
            const ext = state.availableExtensions.get(extensionId);
            if (ext) {
              ext.isInstalled = false;
            }
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
