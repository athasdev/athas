import { invoke } from "@tauri-apps/api/core";
import { wasmParserLoader } from "@/features/editor/lib/wasm-parser/loader";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { PLATFORM_ARCH } from "@/utils/platform";
import { getServiceUrls } from "@/config/services";
import { isBundledContributionExtension } from "../bundled/bundled-contribution-extensions";
import { extensionInstaller } from "../installer/extension-installer";
import {
  activateExtensionContributions,
  deactivateExtensionContributions,
} from "../runtime/extension-contribution-runtime";
import {
  getManifestLanguageContributions,
  matchesLanguageContribution,
} from "../types/extension-contributions";
import type { PlatformPackage } from "../types/extension-manifest";
import {
  markBundledContributionExtensionInstalled,
  markBundledContributionExtensionUninstalled,
} from "./bundled-contribution-install-state";
import { extensionRegistry } from "./extension-registry";
import {
  buildRuntimeManifest,
  installLanguageExtensionManifest,
  registerLanguageProvider,
  resolveToolPaths,
} from "./extension-store-runtime";
import type { AvailableExtension, ExtensionInstallationMetadata } from "./extension-store-types";

async function refreshSyntaxHighlightingForActiveBuffer(extension: AvailableExtension) {
  const languages = getManifestLanguageContributions(extension.manifest);
  if (languages.length === 0) {
    return;
  }

  const bufferState = useBufferStore.getState();
  const activeBuffer = bufferState.buffers.find((buffer) => buffer.isActive);

  if (!activeBuffer) {
    return;
  }

  const matchesLanguage = languages.some((language) =>
    matchesLanguageContribution(activeBuffer.path, language),
  );

  if (!matchesLanguage) {
    return;
  }

  const { setSyntaxHighlightingFilePath } =
    await import("@/features/editor/extensions/builtin/syntax-highlighting");
  setSyntaxHighlightingFilePath(activeBuffer.path);
}

async function unloadLanguageProviders(extensionId: string, languageIds: string[]) {
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
}

async function uninstallLanguageArtifacts(languageIds: string[]) {
  await Promise.all(
    languageIds.map(async (languageId) => {
      wasmParserLoader.unloadParser(languageId);
      await extensionInstaller.uninstallLanguage(languageId);
    }),
  );
}

function withCdnCacheBuster(url: string): string {
  if (!url.startsWith(`${getServiceUrls().extensionsCdnBaseUrl}/`)) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
}

function resolveExtensionPackage(extension: AvailableExtension): PlatformPackage {
  const installation = extension.manifest.installation;
  const platformPackages = installation?.platformArch;
  const platformPackage = platformPackages?.[PLATFORM_ARCH];

  if (platformPackages) {
    if (isCompleteExtensionPackage(platformPackage)) {
      return {
        ...platformPackage,
        downloadUrl: withCdnCacheBuster(platformPackage.downloadUrl),
      };
    }

    throw new Error(
      `No compatible package for ${extension.manifest.displayName} on ${PLATFORM_ARCH}`,
    );
  }

  const genericPackage = installation
    ? {
        downloadUrl: installation.downloadUrl,
        checksum: installation.checksum,
        size: installation.size,
      }
    : undefined;

  if (isCompleteExtensionPackage(genericPackage)) {
    return {
      ...genericPackage,
      downloadUrl: withCdnCacheBuster(genericPackage.downloadUrl),
    };
  }

  throw new Error(
    `No compatible package for ${extension.manifest.displayName} on ${PLATFORM_ARCH}`,
  );
}

function isCompleteExtensionPackage(
  extensionPackage: Partial<PlatformPackage> | undefined,
): extensionPackage is PlatformPackage {
  return (
    typeof extensionPackage?.downloadUrl === "string" &&
    extensionPackage.downloadUrl.length > 0 &&
    typeof extensionPackage.size === "number" &&
    extensionPackage.size > 0 &&
    typeof extensionPackage.checksum === "string" &&
    extensionPackage.checksum.length > 0
  );
}

export async function installExtensionLifecycle(params: {
  extensionId: string;
  extension: AvailableExtension;
  onProgress: (progress: number) => void;
  onLanguageInstalled: (
    runtimeManifest: AvailableExtension["manifest"],
    runtimeIssues: AvailableExtension["runtimeIssues"],
  ) => void;
  onNonLanguageInstalled: () => void;
  reloadInstalledExtensions: () => Promise<void>;
}) {
  const {
    extensionId,
    extension,
    onProgress,
    onLanguageInstalled,
    onNonLanguageInstalled,
    reloadInstalledExtensions,
  } = params;

  const languageConfigs = getManifestLanguageContributions(extension.manifest);
  if (languageConfigs.length > 0) {
    await installLanguageExtensionManifest(extensionId, extension.manifest, onProgress);

    const primaryLanguageId = languageConfigs[0].id;
    const resolvedTools = await resolveToolPaths(primaryLanguageId, extension.manifest, {
      ensureInstalled: true,
    });
    const runtimeManifest = buildRuntimeManifest(extension.manifest, resolvedTools.toolPaths);

    if (extension.manifest.lsp && !runtimeManifest.lsp) {
      const runtimeIssue =
        resolvedTools.issues.find((issue) => issue.tool === "lsp")?.message ||
        "Language server could not be installed. Reinstall the language tools.";
      throw new Error(runtimeIssue);
    }

    extensionRegistry.registerExtension(runtimeManifest, {
      isBundled: false,
      isEnabled: true,
      state: "installed",
    });

    onLanguageInstalled(runtimeManifest, resolvedTools.issues);

    await Promise.all(
      languageConfigs.map((languageConfig) =>
        registerLanguageProvider({
          extensionId,
          languageId: languageConfig.id,
          displayName: extension.manifest.displayName,
          version: extension.manifest.version,
          extensions: languageConfig.extensions,
          aliases: languageConfig.aliases,
        }),
      ),
    );

    await refreshSyntaxHighlightingForActiveBuffer(extension);
    return;
  }

  if (isBundledContributionExtension(extension.manifest)) {
    markBundledContributionExtensionInstalled(extensionId);
    extensionRegistry.registerExtension(extension.manifest, {
      isBundled: false,
      isEnabled: true,
      state: "installed",
    });
    await activateExtensionContributions(extensionId, extension.manifest);
    onNonLanguageInstalled();
    return;
  }

  const extensionPackage = resolveExtensionPackage(extension);

  await invoke("install_extension_from_url", {
    extensionId,
    url: extensionPackage.downloadUrl,
    checksum: extensionPackage.checksum,
    size: extensionPackage.size,
  });

  await reloadInstalledExtensions();
  await activateExtensionContributions(extensionId, extension.manifest);
  onNonLanguageInstalled();
}

export async function uninstallExtensionLifecycle(params: {
  extensionId: string;
  extension: AvailableExtension;
  onLanguageUninstalled: () => void;
  onNonLanguageUninstalled: () => void;
  reloadInstalledExtensions: () => Promise<void>;
}) {
  const {
    extensionId,
    extension,
    onLanguageUninstalled,
    onNonLanguageUninstalled,
    reloadInstalledExtensions,
  } = params;

  const languageConfigs = getManifestLanguageContributions(extension.manifest);
  if (languageConfigs.length > 0) {
    const languageIds = languageConfigs.map((language) => language.id);

    await uninstallLanguageArtifacts(languageIds);
    await unloadLanguageProviders(extensionId, languageIds);
    extensionRegistry.registerExtension(extension.manifest, {
      isBundled: false,
      isEnabled: true,
      state: "not-installed",
    });
    onLanguageUninstalled();
    return;
  }

  if (isBundledContributionExtension(extension.manifest)) {
    await deactivateExtensionContributions(extensionId, extension.manifest);
    markBundledContributionExtensionUninstalled(extensionId);
    extensionRegistry.registerExtension(extension.manifest, {
      isBundled: false,
      isEnabled: true,
      state: "not-installed",
    });
    onNonLanguageUninstalled();
    return;
  }

  await deactivateExtensionContributions(extensionId, extension.manifest);
  await invoke("uninstall_extension_new", { extensionId });
  await reloadInstalledExtensions();
  onNonLanguageUninstalled();
}

export async function enableExtensionLifecycle(params: {
  extensionId: string;
  extension: AvailableExtension;
}) {
  const { extensionId, extension } = params;
  const languageConfigs = getManifestLanguageContributions(extension.manifest);

  if (languageConfigs.length > 0) {
    const primaryLanguageId = languageConfigs[0].id;
    const resolvedTools = await resolveToolPaths(primaryLanguageId, extension.manifest, {
      ensureInstalled: false,
    });
    const runtimeManifest = buildRuntimeManifest(extension.manifest, resolvedTools.toolPaths);

    extensionRegistry.registerExtension(runtimeManifest, {
      isBundled: false,
      isEnabled: true,
      state: "installed",
    });

    await Promise.all(
      languageConfigs.map((languageConfig) =>
        registerLanguageProvider({
          extensionId,
          languageId: languageConfig.id,
          displayName: extension.manifest.displayName,
          version: extension.manifest.version,
          extensions: languageConfig.extensions,
          aliases: languageConfig.aliases,
        }),
      ),
    );

    await refreshSyntaxHighlightingForActiveBuffer(extension);
    return;
  }

  extensionRegistry.registerExtension(extension.manifest, {
    isBundled: false,
    isEnabled: true,
    state: "installed",
  });
  await activateExtensionContributions(extensionId, extension.manifest);
}

export async function disableExtensionLifecycle(params: {
  extensionId: string;
  extension: AvailableExtension;
}) {
  const { extensionId, extension } = params;
  const languageConfigs = getManifestLanguageContributions(extension.manifest);

  if (languageConfigs.length > 0) {
    await unloadLanguageProviders(
      extensionId,
      languageConfigs.map((language) => language.id),
    );
    extensionRegistry.registerExtension(extension.manifest, {
      isBundled: false,
      isEnabled: false,
      state: "deactivated",
    });
    await refreshSyntaxHighlightingForActiveBuffer(extension);
    return;
  }

  await deactivateExtensionContributions(extensionId, extension.manifest);
  extensionRegistry.registerExtension(extension.manifest, {
    isBundled: false,
    isEnabled: false,
    state: "deactivated",
  });
}

export async function updateExtensionLifecycle(params: {
  extensionId: string;
  extension: AvailableExtension;
  clearInstalledStateForUpdate: () => void;
  reinstall: () => Promise<void>;
}) {
  const { extensionId, extension, clearInstalledStateForUpdate, reinstall } = params;

  const languageIds = getManifestLanguageContributions(extension.manifest).map(
    (language) => language.id,
  );

  if (languageIds.length > 0) {
    await unloadLanguageProviders(extensionId, languageIds);
    await uninstallLanguageArtifacts(languageIds);
  } else {
    await deactivateExtensionContributions(extensionId, extension.manifest);
  }

  extensionRegistry.unregisterExtension(extensionId);

  clearInstalledStateForUpdate();
  await reinstall();
}

export function buildInstalledExtensionMetadata(
  extensionId: string,
  extension: AvailableExtension,
): ExtensionInstallationMetadata {
  return {
    id: extensionId,
    name: extension.manifest.displayName,
    version: extension.manifest.version,
    installed_at: new Date().toISOString(),
    enabled: true,
  };
}
