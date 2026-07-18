import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { wasmParserLoader } from "@/features/editor/lib/wasm-parser/loader";
import { extensionInstaller } from "../installer/extension-installer";
import { isBundledContributionExtension } from "../bundled/bundled-contribution-extensions";
import { readInstalledBundledContributionExtensionIds } from "./bundled-contribution-install-state";
import { readDisabledExtensionIds } from "./extension-enabled-state";
import { initializeLanguagePackager } from "../languages/language-packager";
import { extensionRegistry } from "./extension-registry";
import { isRetiredExtensionId } from "./retired-extensions";
import {
  buildRuntimeManifest,
  getExtensionManifestForLanguage,
  registerLanguageProvider,
  resolveInstalledExtensionId,
  resolveToolPaths,
} from "./extension-store-runtime";
import type {
  AvailableExtension,
  ExtensionInstallationMetadata,
  ExtensionRuntimeIssue,
} from "./extension-store-types";

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
  bundledContributionInstalled: string[];
  runtimeIssues: Map<string, ExtensionRuntimeIssue[]>;
}> {
  let backendInstalled: ExtensionInstallationMetadata[] = [];
  const runtimeIssues = new Map<string, ExtensionRuntimeIssue[]>();

  try {
    backendInstalled = await invoke<ExtensionInstallationMetadata[]>(
      "list_installed_extensions_new",
    );
  } catch {
    // Backend command may not exist yet, continue with IndexedDB check.
  }

  const indexedDBInstalled = await extensionInstaller.listInstalled();
  const bundledContributionInstalled = Array.from(readInstalledBundledContributionExtensionIds());
  const disabledExtensionIds = readDisabledExtensionIds();

  await Promise.all(
    indexedDBInstalled.map(async (installed) => {
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

      if (disabledExtensionIds.has(extensionId)) {
        return;
      }

      if (extension) {
        const resolvedTools = await resolveToolPaths(languageId, extension, {
          repairMissing: true,
        });
        const runtimeManifest = buildRuntimeManifest(extension, resolvedTools.toolPaths);
        extensionRegistry.registerExtension(runtimeManifest, {
          isBundled: false,
          isEnabled: true,
          state: "installed",
        });
        runtimeIssues.set(extensionId, resolvedTools.issues);
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
    }),
  );

  return {
    backendInstalled,
    indexedDBInstalled,
    bundledContributionInstalled,
    runtimeIssues,
  };
}

export function buildInstalledExtensionsMap(params: {
  backendInstalled: ExtensionInstallationMetadata[];
  indexedDBInstalled: IndexedDbInstalledExtension[];
  bundledContributionInstalled: string[];
  availableExtensions: Map<string, AvailableExtension>;
}): Map<string, ExtensionInstallationMetadata> {
  const {
    backendInstalled,
    indexedDBInstalled,
    bundledContributionInstalled,
    availableExtensions,
  } = params;
  const disabledExtensionIds = readDisabledExtensionIds();
  const installedExtensions = new Map(
    backendInstalled
      .filter((extension) => !isRetiredExtensionId(extension.id))
      .map((extension) => [
        extension.id,
        {
          ...extension,
          enabled: extension.enabled !== false && !disabledExtensionIds.has(extension.id),
        },
      ]),
  );

  for (const extensionId of bundledContributionInstalled) {
    if (isRetiredExtensionId(extensionId)) {
      continue;
    }

    const extension = availableExtensions.get(extensionId);
    if (!extension || !isBundledContributionExtension(extension.manifest)) {
      continue;
    }

    installedExtensions.set(extensionId, {
      id: extensionId,
      name: extension.manifest.displayName,
      version: extension.manifest.version,
      installed_at: new Date().toISOString(),
      enabled: !disabledExtensionIds.has(extensionId),
    });
  }

  for (const installed of indexedDBInstalled) {
    const extensionId = resolveInstalledExtensionId(installed, availableExtensions);
    if (isRetiredExtensionId(extensionId)) {
      continue;
    }

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
        enabled: !disabledExtensionIds.has(extensionId),
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
  const { onProgress, loadAvailableExtensions, loadInstalledExtensions, checkForUpdates } = params;

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

  // Periodic update check (every 6 hours)
  const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      await loadAvailableExtensions();
      await checkForUpdates();
    } catch (error) {
      console.debug("Periodic extension update check failed:", error);
    }
  }, CHECK_INTERVAL_MS);
}
