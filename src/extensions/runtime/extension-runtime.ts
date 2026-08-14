import { logger } from "@/features/editor/utils/logger";
import { initializeExtensionStore, useExtensionStore } from "../registry/extension-store";
import { extensionRegistry } from "../registry/extension-registry";
import { initializeGeneratedUIExtensions } from "../ui/services/generated-ui-extension-installer";
import { runExtensionLoadBatch } from "./extension-activation-batch";
import { activateExtensionContributions } from "./extension-contribution-runtime";

let initializationPromise: Promise<void> | null = null;

async function initializeExtensionRuntimeServices(): Promise<void> {
  await initializeExtensionStore();
  await extensionRegistry.ensureInitialized();

  const installedExtensions = Array.from(
    useExtensionStore.getState().availableExtensions.values(),
  ).filter((extension) => extension.isInstalled && extension.isEnabled);
  const results = await runExtensionLoadBatch(installedExtensions, async (extension) => {
    const extensionId = extension.manifest.id;
    const registryExtension = extensionRegistry.getExtension(extensionId);
    await activateExtensionContributions(extensionId, extension.manifest, registryExtension?.path);
    if (registryExtension) {
      extensionRegistry.setExtensionState(extensionId, "activated");
    }
  });

  for (const result of results) {
    if (result.status === "failed") {
      logger.error(
        "ExtensionRuntime",
        `Failed to activate extension ${result.error.displayName}:`,
        result.error.reason,
      );
    }
  }

  initializeGeneratedUIExtensions();
}

export function initializeExtensionRuntime(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = initializeExtensionRuntimeServices();
  }
  return initializationPromise;
}

export async function waitForExtensionRuntimeInitialization(): Promise<void> {
  await initializeExtensionRuntime();
}
