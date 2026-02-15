/**
 * Unified Extension Store
 *
 * Zustand store for managing all extension state across categories.
 * Handles installation, activation, and theme/icon theme selection.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { logger } from "@/features/editor/utils/logger";
import { createSelectors } from "@/utils/zustand-selectors";
import { extensionRegistry } from "./registry";
import type {
  ExtensionManifest,
  InstalledExtension,
  InstallProgress,
  InstallStatus,
  LanguageCapabilities,
} from "./types";

/**
 * Extension Store State
 */
interface ExtensionStoreState {
  // Installed extensions by ID
  installedExtensions: Map<string, InstalledExtension>;

  // Currently active theme variant ID
  activeThemeVariantId: string | null;

  // Currently active icon theme ID
  activeIconThemeId: string | null;

  // Installation progress by extension ID
  installProgress: Map<string, InstallProgress>;

  // Loading states
  isInitialized: boolean;
  isLoading: boolean;

  // Actions
  actions: {
    // Initialize the store
    initialize: () => Promise<void>;

    // Install an extension
    installExtension: (extensionId: string) => Promise<void>;

    // Uninstall an extension
    uninstallExtension: (extensionId: string) => Promise<void>;

    // Check if extension is installed
    isExtensionInstalled: (extensionId: string) => boolean;

    // Get extension for a file path
    getExtensionForFile: (filePath: string) => ExtensionManifest | undefined;

    // Set active theme
    setActiveTheme: (variantId: string) => void;

    // Set active icon theme
    setActiveIconTheme: (iconThemeId: string) => void;

    // Update install progress (called by event listener)
    updateInstallProgress: (extensionId: string, progress: InstallProgress) => void;

    // Get installed extension
    getInstalledExtension: (extensionId: string) => InstalledExtension | undefined;
  };
}

/**
 * Persisted state (separate from main store for theme/icon theme persistence)
 */
interface PersistedPreferences {
  activeThemeVariantId: string | null;
  activeIconThemeId: string | null;
}

const useExtensionStoreBase = create<ExtensionStoreState>()(
  immer((set, get) => ({
    installedExtensions: new Map(),
    activeThemeVariantId: null,
    activeIconThemeId: null,
    installProgress: new Map(),
    isInitialized: false,
    isLoading: false,

    actions: {
      initialize: async () => {
        if (get().isInitialized) return;

        set((state) => {
          state.isLoading = true;
        });

        try {
          // Initialize the registry first
          await extensionRegistry.initialize();

          // Mark bundled extensions as installed
          const bundledExtensions = extensionRegistry.getBundledExtensions();
          const installedMap = new Map<string, InstalledExtension>();

          for (const manifest of bundledExtensions) {
            installedMap.set(manifest.id, {
              manifest,
              state: "installed",
              installedAt: new Date().toISOString(),
            });
          }

          // Load filesystem-installed extensions from backend
          try {
            const backendInstalled = await invoke<
              Array<{
                id: string;
                name: string;
                version: string;
                installed_at: string;
                enabled: boolean;
              }>
            >("list_installed_extensions_new");

            for (const ext of backendInstalled) {
              const manifest = extensionRegistry.getExtension(ext.id);
              if (manifest) {
                installedMap.set(ext.id, {
                  manifest,
                  state: ext.enabled ? "installed" : "deactivated",
                  installedAt: ext.installed_at,
                });
              }
            }
          } catch (error) {
            // Backend command may not exist, continue
            logger.debug("ExtensionStore", "Backend list command not available:", error);
          }

          // Load IndexedDB-installed language extensions
          try {
            const { extensionInstaller } = await import("../installer/extension-installer");
            const indexedDBInstalled = await extensionInstaller.listInstalled();

            for (const installed of indexedDBInstalled) {
              const extensionId = `language.${installed.languageId}`;
              const manifest = extensionRegistry.getExtension(extensionId);

              if (manifest && !installedMap.has(extensionId)) {
                installedMap.set(extensionId, {
                  manifest,
                  state: "installed",
                  installedAt: installed.downloadedAt
                    ? new Date(installed.downloadedAt).toISOString()
                    : new Date().toISOString(),
                });
              }
            }
          } catch (error) {
            logger.debug("ExtensionStore", "Failed to load IndexedDB extensions:", error);
          }

          // Load persisted preferences
          const storedPrefs = localStorage.getItem("extension-preferences");
          let prefs: PersistedPreferences = {
            activeThemeVariantId: "vitesse-dark",
            activeIconThemeId: "material", // Default icon theme
          };

          if (storedPrefs) {
            try {
              prefs = JSON.parse(storedPrefs);
            } catch {
              // Use defaults
            }
          }

          set((state) => {
            state.installedExtensions = installedMap;
            state.activeThemeVariantId = prefs.activeThemeVariantId;
            state.activeIconThemeId = prefs.activeIconThemeId;
            state.isLoading = false;
            state.isInitialized = true;
          });

          logger.info(
            "ExtensionStore",
            `Initialized with ${installedMap.size} installed extensions`,
          );
        } catch (error) {
          logger.error("ExtensionStore", "Failed to initialize:", error);
          set((state) => {
            state.isLoading = false;
            state.isInitialized = true;
          });
        }
      },

      installExtension: async (extensionId: string) => {
        const manifest = extensionRegistry.getExtension(extensionId);
        if (!manifest) {
          throw new Error(`Extension ${extensionId} not found in registry`);
        }

        if (!manifest.installation) {
          throw new Error(`Extension ${extensionId} is not installable (no installation metadata)`);
        }

        // Set initial progress
        set((state) => {
          state.installProgress.set(extensionId, {
            extensionId,
            status: "downloading",
            progress: 0,
            message: "Starting download...",
          });
        });

        try {
          if (manifest.category === "language") {
            const caps = manifest.capabilities as LanguageCapabilities;

            // Check if this is a full extension with LSP
            if (caps.lsp) {
              // Full extension - use Tauri backend for filesystem installation
              const platformArch = extensionRegistry.getPlatformArch();
              const platformPackage = manifest.installation.platforms[platformArch];

              if (!platformPackage) {
                throw new Error(`No download available for platform ${platformArch}`);
              }

              await invoke("install_extension_from_url", {
                extensionId,
                url: platformPackage.downloadUrl,
                checksum: platformPackage.checksum,
                size: platformPackage.size,
              });
            } else {
              // Simple language extension - use IndexedDB
              const { extensionInstaller } = await import("../installer/extension-installer");

              // Get WASM and query URLs from CDN
              const cdnBase = import.meta.env.VITE_PARSER_CDN_URL || "https://athas.dev/extensions";
              const wasmUrl = `${cdnBase}/shared/parsers/tree-sitter-${caps.languageId}.wasm`;
              const queryUrl = `${cdnBase}/shared/queries/${caps.languageId}/highlights.scm`;

              await extensionInstaller.installLanguage(caps.languageId, wasmUrl, queryUrl, {
                version: manifest.version,
                checksum: "", // TODO: Add checksum support
                onProgress: (progress) => {
                  set((state) => {
                    state.installProgress.set(extensionId, {
                      extensionId,
                      status: "downloading",
                      progress: progress.percentage / 100,
                      message: `Downloading... ${progress.percentage}%`,
                    });
                  });
                },
              });
            }
          } else if (manifest.category === "theme" || manifest.category === "icon-theme") {
            // Themes and icon themes - download JSON manifest to IndexedDB
            const platformArch = extensionRegistry.getPlatformArch();
            const platformPackage = manifest.installation.platforms[platformArch];

            if (!platformPackage) {
              throw new Error(`No download available for platform ${platformArch}`);
            }

            // Download and store in IndexedDB
            const response = await fetch(platformPackage.downloadUrl);
            if (!response.ok) {
              throw new Error(`Failed to download: ${response.status}`);
            }

            // Parse and store in IndexedDB (implement later)
            await response.json();
            logger.info("ExtensionStore", `Downloaded theme/icon theme: ${extensionId}`);
          }

          // Mark as installed
          set((state) => {
            state.installedExtensions.set(extensionId, {
              manifest,
              state: "installed",
              installedAt: new Date().toISOString(),
            });
            state.installProgress.delete(extensionId);
          });

          logger.info("ExtensionStore", `Installed extension: ${extensionId}`);

          // Trigger re-highlighting for language extensions
          if (manifest.category === "language") {
            await triggerRehighlighting(manifest);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          set((state) => {
            state.installProgress.set(extensionId, {
              extensionId,
              status: "failed",
              progress: 0,
              message: errorMessage,
            });
          });

          logger.error("ExtensionStore", `Failed to install ${extensionId}:`, error);
          throw error;
        }
      },

      uninstallExtension: async (extensionId: string) => {
        const installed = get().installedExtensions.get(extensionId);
        if (!installed) {
          throw new Error(`Extension ${extensionId} is not installed`);
        }

        const manifest = installed.manifest;

        try {
          if (manifest.category === "language") {
            const caps = manifest.capabilities as LanguageCapabilities;

            if (caps.lsp) {
              // Full extension - uninstall from filesystem
              await invoke("uninstall_extension_new", { extensionId });
            } else {
              // Simple language - uninstall from IndexedDB
              const { extensionInstaller } = await import("../installer/extension-installer");
              await extensionInstaller.uninstallLanguage(caps.languageId);
            }
          } else {
            // Theme/icon theme - remove from IndexedDB
            // TODO: Implement theme uninstallation
          }

          set((state) => {
            state.installedExtensions.delete(extensionId);
          });

          logger.info("ExtensionStore", `Uninstalled extension: ${extensionId}`);
        } catch (error) {
          logger.error("ExtensionStore", `Failed to uninstall ${extensionId}:`, error);
          throw error;
        }
      },

      isExtensionInstalled: (extensionId: string) => {
        return get().installedExtensions.has(extensionId);
      },

      getExtensionForFile: (filePath: string) => {
        return extensionRegistry.getLanguageExtensionForFile(filePath);
      },

      setActiveTheme: (variantId: string) => {
        set((state) => {
          state.activeThemeVariantId = variantId;
        });

        // Persist preference
        const prefs: PersistedPreferences = {
          activeThemeVariantId: variantId,
          activeIconThemeId: get().activeIconThemeId,
        };
        localStorage.setItem("extension-preferences", JSON.stringify(prefs));

        logger.info("ExtensionStore", `Set active theme: ${variantId}`);
      },

      setActiveIconTheme: (iconThemeId: string) => {
        set((state) => {
          state.activeIconThemeId = iconThemeId;
        });

        // Persist preference
        const prefs: PersistedPreferences = {
          activeThemeVariantId: get().activeThemeVariantId,
          activeIconThemeId: iconThemeId,
        };
        localStorage.setItem("extension-preferences", JSON.stringify(prefs));

        logger.info("ExtensionStore", `Set active icon theme: ${iconThemeId}`);
      },

      updateInstallProgress: (extensionId: string, progress: InstallProgress) => {
        set((state) => {
          if (progress.status === "completed") {
            state.installProgress.delete(extensionId);
          } else {
            state.installProgress.set(extensionId, progress);
          }
        });
      },

      getInstalledExtension: (extensionId: string) => {
        return get().installedExtensions.get(extensionId);
      },
    },
  })),
);

/**
 * Trigger re-highlighting for open files matching a language extension
 */
async function triggerRehighlighting(manifest: ExtensionManifest): Promise<void> {
  if (manifest.category !== "language") return;

  try {
    const caps = manifest.capabilities as LanguageCapabilities;
    const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
    const bufferState = useBufferStore.getState();
    const activeBuffer = bufferState.buffers.find((b) => b.isActive);

    if (activeBuffer) {
      const fileExt = activeBuffer.path.split(".").pop()?.toLowerCase();
      if (fileExt && caps.fileExtensions.includes(fileExt)) {
        const { setSyntaxHighlightingFilePath } = await import(
          "@/features/editor/extensions/builtin/syntax-highlighting"
        );
        setSyntaxHighlightingFilePath(activeBuffer.path);
      }
    }
  } catch (error) {
    logger.error("ExtensionStore", "Failed to trigger re-highlighting:", error);
  }
}

// Create selectors wrapper
export const useExtensionStore = createSelectors(useExtensionStoreBase);

// Progress listener state
let progressListenerInitialized = false;

/**
 * Initialize the extension store and setup event listeners
 */
export async function initializeExtensionStore(): Promise<void> {
  // Setup progress event listener (once)
  if (!progressListenerInitialized) {
    try {
      await listen<{
        extension_id: string;
        status: { type: string; error?: string };
        progress: number;
        message: string;
      }>("extension://install-progress", (event) => {
        const { extension_id, progress, status, message } = event.payload;

        const installStatus: InstallStatus =
          status.type === "completed"
            ? "completed"
            : status.type === "failed"
              ? "failed"
              : status.type === "extracting"
                ? "extracting"
                : status.type === "verifying"
                  ? "verifying"
                  : "downloading";

        useExtensionStoreBase.getState().actions.updateInstallProgress(extension_id, {
          extensionId: extension_id,
          status: installStatus,
          progress,
          message: status.type === "failed" ? status.error || "Installation failed" : message,
        });
      });

      progressListenerInitialized = true;
    } catch (error) {
      logger.debug("ExtensionStore", "Failed to setup progress listener:", error);
    }
  }

  // Initialize the store
  await useExtensionStoreBase.getState().actions.initialize();
}

// Export store for direct access
export { useExtensionStoreBase };
