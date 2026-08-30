import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { wasmParserLoader } from "@/features/editor/lib/wasm-parser/loader";
import { extensionInstaller } from "../installer/extension-installer";
import {
  markBundledContributionExtensionUninstalled,
  readInstalledBundledContributionExtensionIds,
} from "./bundled-contribution-install-state";
import { readDisabledExtensionIds } from "./extension-enabled-state";
import { initializeLanguagePackager } from "../languages/language-packager";
import { extensionRegistry } from "./extension-registry";
import { isRetiredExtensionId } from "./retired-extensions";
import {
  getExtensionManifestForLanguage,
  registerLanguageProvider,
} from "../runtime/language-extension-installation";
import { buildRuntimeManifest, resolveToolPaths } from "../runtime/language-tool-resolution";
import { resolveInstalledExtensionId } from "./installed-extension-resolution";
import type {
  AvailableExtension,
  ExtensionInstallationMetadata,
  ExtensionRuntimeIssue,
} from "./extension-store-types";
import { PLATFORM_ARCH } from "@/utils/platform";
import type { ExtensionManifest, PlatformPackage } from "../types/extension-manifest";

interface IndexedDbInstalledExtension {
  languageId: string;
  extensionId?: string;
  version: string;
}

function bundledMigrationPackage(manifest: ExtensionManifest): PlatformPackage | undefined {
  const installation = manifest.installation;
  const platformPackage = installation?.platformArch?.[PLATFORM_ARCH];
  if (platformPackage) return platformPackage;
  if (
    typeof installation?.downloadUrl !== "string" ||
    typeof installation.size !== "number" ||
    typeof installation.checksum !== "string"
  ) {
    return undefined;
  }
  return {
    downloadUrl: installation.downloadUrl,
    size: installation.size,
    checksum: installation.checksum,
  };
}

export async function migrateBundledContributionInstallations(
  availableExtensions: Map<string, AvailableExtension>,
  backendInstalled: ExtensionInstallationMetadata[],
): Promise<ExtensionInstallationMetadata[]> {
  const installedIds = new Set(backendInstalled.map((extension) => extension.id));
  let installedExternalPackage = false;

  for (const extensionId of readInstalledBundledContributionExtensionIds()) {
    if (installedIds.has(extensionId)) {
      markBundledContributionExtensionUninstalled(extensionId);
      continue;
    }

    const extension = availableExtensions.get(extensionId);
    if (!extension || extension.manifest.installation?.type === "bundled") continue;
    const extensionPackage = bundledMigrationPackage(extension.manifest);
    if (!extensionPackage) continue;

    try {
      await invoke("install_extension", {
        extensionId,
        url: extensionPackage.downloadUrl,
        checksum: extensionPackage.checksum,
        size: extensionPackage.size,
      });
      markBundledContributionExtensionUninstalled(extensionId);
      installedExternalPackage = true;
    } catch (error) {
      console.warn(`Could not migrate bundled extension ${extensionId}:`, error);
    }
  }

  if (!installedExternalPackage) return backendInstalled;

  try {
    return await invoke<ExtensionInstallationMetadata[]>("list_installed_extensions");
  } catch {
    return backendInstalled;
  }
}

export async function loadInstalledExtensionsSnapshot(
  availableExtensions: Map<string, AvailableExtension>,
): Promise<{
  backendInstalled: ExtensionInstallationMetadata[];
  indexedDBInstalled: IndexedDbInstalledExtension[];
  runtimeIssues: Map<string, ExtensionRuntimeIssue[]>;
}> {
  let backendInstalled: ExtensionInstallationMetadata[] = [];
  const runtimeIssues = new Map<string, ExtensionRuntimeIssue[]>();

  try {
    backendInstalled = await invoke<ExtensionInstallationMetadata[]>("list_installed_extensions");
  } catch {
    // Backend command may not exist yet, continue with IndexedDB check.
  }

  backendInstalled = await migrateBundledContributionInstallations(
    availableExtensions,
    backendInstalled,
  );
  const indexedDBInstalled = await extensionInstaller.listInstalled();
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
        const runtimeManifest = buildRuntimeManifest(
          extension,
          resolvedTools.toolPaths,
          resolvedTools.lspBundles,
        );
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
    runtimeIssues,
  };
}

export function buildInstalledExtensionsMap(params: {
  backendInstalled: ExtensionInstallationMetadata[];
  indexedDBInstalled: IndexedDbInstalledExtension[];
  availableExtensions: Map<string, AvailableExtension>;
}): Map<string, ExtensionInstallationMetadata> {
  const { backendInstalled, indexedDBInstalled, availableExtensions } = params;
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
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_UPDATE_CHECK_DELAY_MS = 5_000;

function scheduleExtensionUpdateChecks(
  loadAvailableExtensions: () => Promise<void>,
  checkForUpdates: () => Promise<string[]>,
) {
  const check = async (refreshCatalog: boolean) => {
    try {
      if (refreshCatalog) await loadAvailableExtensions();
      await checkForUpdates();
    } catch (error) {
      console.debug("Extension update check failed:", error);
    }
  };

  setTimeout(() => void check(false), INITIAL_UPDATE_CHECK_DELAY_MS);
  setInterval(() => void check(true), UPDATE_CHECK_INTERVAL_MS);
}

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
  scheduleExtensionUpdateChecks(loadAvailableExtensions, checkForUpdates);
}
