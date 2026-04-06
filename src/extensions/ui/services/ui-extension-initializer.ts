import { useExtensionStore } from "@/extensions/registry/extension-store";
import { uiExtensionHost } from "./ui-extension-host";

export async function initializeUIExtensions(): Promise<void> {
  const { availableExtensions, installedExtensions } = useExtensionStore.getState();

  const uiExtensions = Array.from(availableExtensions.values()).filter(
    (ext) => ext.manifest.categories.includes("UI") && installedExtensions.has(ext.manifest.id),
  );

  const loadPromises = uiExtensions.map(async (ext) => {
    try {
      await uiExtensionHost.loadExtension(ext.manifest, "");
    } catch (error) {
      console.error(`Failed to initialize UI extension ${ext.manifest.id}:`, error);
    }
  });

  await Promise.allSettled(loadPromises);
}
