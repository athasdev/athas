import { invoke } from "@tauri-apps/api/core";
import { wasmParserLoader } from "@/features/editor/lib/wasm-parser/loader";
import { extensionInstaller } from "../installer/extension-installer";
import { extensionRegistry } from "./extension-registry";
import {
  buildRuntimeManifest,
  installLanguageExtensionManifest,
  registerLanguageProvider,
  resolveToolPaths,
} from "./extension-store-runtime";
import type { AvailableExtension, ExtensionInstallationMetadata } from "./extension-store-types";

async function refreshSyntaxHighlightingForActiveBuffer(extension: AvailableExtension) {
  if (!extension.manifest.languages?.length) {
    return;
  }

  const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
  const bufferState = useBufferStore.getState();
  const activeBuffer = bufferState.buffers.find((buffer) => buffer.isActive);

  if (!activeBuffer) {
    return;
  }

  const fileExt = `.${activeBuffer.path.split(".").pop()?.toLowerCase()}`;
  const matchesLanguage = extension.manifest.languages.some((language) =>
    language.extensions.includes(fileExt),
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

export async function installExtensionLifecycle(params: {
  extensionId: string;
  extension: AvailableExtension;
  onProgress: (progress: number) => void;
  onLanguageInstalled: (runtimeManifest: AvailableExtension["manifest"]) => void;
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

  if (extension.manifest.languages?.length) {
    const languageConfigs = extension.manifest.languages;

    await installLanguageExtensionManifest(extensionId, extension.manifest, onProgress);

    const primaryLanguageId = languageConfigs[0].id;
    const toolPaths = await resolveToolPaths(primaryLanguageId, extension.manifest, {
      ensureInstalled: true,
    });
    const runtimeManifest = buildRuntimeManifest(extension.manifest, toolPaths);

    extensionRegistry.registerExtension(runtimeManifest, {
      isBundled: false,
      isEnabled: true,
      state: "installed",
    });

    onLanguageInstalled(runtimeManifest);

    for (const languageConfig of languageConfigs) {
      await registerLanguageProvider({
        extensionId,
        languageId: languageConfig.id,
        displayName: extension.manifest.displayName,
        version: extension.manifest.version,
        extensions: languageConfig.extensions,
        aliases: languageConfig.aliases,
      });
    }

    await refreshSyntaxHighlightingForActiveBuffer(extension);
    return;
  }

  await invoke("install_extension_from_url", {
    extensionId,
    url: extension.manifest.installation?.downloadUrl,
    checksum: extension.manifest.installation?.checksum,
    size: extension.manifest.installation?.size,
  });

  await reloadInstalledExtensions();
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

  if (extension.manifest.languages?.length) {
    const languageIds = extension.manifest.languages.map((language) => language.id);

    await uninstallLanguageArtifacts(languageIds);
    await unloadLanguageProviders(extensionId, languageIds);
    extensionRegistry.unregisterExtension(extensionId);
    onLanguageUninstalled();
    return;
  }

  await invoke("uninstall_extension_new", { extensionId });
  await reloadInstalledExtensions();
  onNonLanguageUninstalled();
}

export async function updateExtensionLifecycle(params: {
  extensionId: string;
  extension: AvailableExtension;
  clearInstalledStateForUpdate: () => void;
  reinstall: () => Promise<void>;
}) {
  const { extensionId, extension, clearInstalledStateForUpdate, reinstall } = params;

  const languageIds = extension.manifest.languages?.map((language) => language.id) || [];

  await unloadLanguageProviders(extensionId, languageIds);
  await uninstallLanguageArtifacts(languageIds);
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
