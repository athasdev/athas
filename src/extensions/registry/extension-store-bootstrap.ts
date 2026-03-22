import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { wasmParserLoader } from "@/features/editor/lib/wasm-parser/loader";
import { extensionInstaller } from "../installer/extension-installer";
import { initializeLanguagePackager } from "../languages/language-packager";
import { extensionRegistry } from "./extension-registry";
import {
  buildRuntimeManifest,
  getExtensionManifestForLanguage,
  registerLanguageProvider,
  resolveInstalledExtensionId,
  resolveToolPaths,
} from "./extension-store-runtime";
import type { AvailableExtension, ExtensionInstallationMetadata } from "./extension-store-types";

interface IndexedDbInstalledExtension {
  languageId: string;
  extensionId?: string;
  version: string;
}

export async function loadInstalledExtensionsSnapshot(
  availableExtensions: Map<string, AvailableExtension>,
): Promise<{
  backendInstalled: ExtensionInstallationMetadata[];
  indexedDBInstalled: IndexedDbInstalledExtension[];
}> {
  let backendInstalled: ExtensionInstallationMetadata[] = [];

  try {
    backendInstalled = await invoke<ExtensionInstallationMetadata[]>("list_installed_extensions_new");
  } catch {
    // Backend command may not exist yet, continue with IndexedDB check.
  }

  const indexedDBInstalled = await extensionInstaller.listInstalled();

  for (const installed of indexedDBInstalled) {
    const languageId = installed.languageId;
    const extensionId = resolveInstalledExtensionId(installed, availableExtensions);
    const extension = getExtensionManifestForLanguage(extensionId, availableExtensions, languageId);
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

  return {
    backendInstalled,
    indexedDBInstalled,
  };
}

export function buildInstalledExtensionsMap(params: {
  backendInstalled: ExtensionInstallationMetadata[];
  indexedDBInstalled: IndexedDbInstalledExtension[];
  availableExtensions: Map<string, AvailableExtension>;
}): Map<string, ExtensionInstallationMetadata> {
  const { backendInstalled, indexedDBInstalled, availableExtensions } = params;
  const installedExtensions = new Map(backendInstalled.map((extension) => [extension.id, extension]));

  for (const installed of indexedDBInstalled) {
    const extensionId = resolveInstalledExtensionId(installed, availableExtensions);

    if (!installedExtensions.has(extensionId)) {
      const extension =
        availableExtensions.get(extensionId) ||
        (() => {
          const manifest = getExtensionManifestForLanguage(
            extensionId,
            availableExtensions,
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

      installedExtensions.set(extensionId, {
        id: extensionId,
        name: extension?.manifest.displayName || installed.languageId,
        version: installed.version,
        installed_at: new Date().toISOString(),
        enabled: true,
      });
    }
  }

  return installedExtensions;
}

let progressListenerInitialized = false;

export async function initializeExtensionStoreBootstrap(params: {
  onProgress: (extensionId: string, progress: number, error?: string) => void;
  loadAvailableExtensions: () => Promise<void>;
  loadInstalledExtensions: () => Promise<void>;
  checkForUpdates: () => Promise<string[]>;
}) {
  const {
    onProgress,
    loadAvailableExtensions,
    loadInstalledExtensions,
    checkForUpdates,
  } = params;

  if (!progressListenerInitialized) {
    await listen<{
      extension_id: string;
      status: { type: string; error?: string };
      progress: number;
      message: string;
    }>("extension://install-progress", (event) => {
      const { extension_id, progress, status } = event.payload;
      const error = status.type === "failed" ? status.error : undefined;
      onProgress(extension_id, progress * 100, error);
    });

    progressListenerInitialized = true;
  }

  try {
    await wasmParserLoader.initialize();
  } catch (error) {
    console.error("Failed to initialize WASM parser loader:", error);
  }

  await initializeLanguagePackager();
  await loadAvailableExtensions();
  await loadInstalledExtensions();
  await checkForUpdates();
}
