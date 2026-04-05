import type { ExtensionManifest } from "@/extensions/types/extension-manifest";
import { useUIExtensionStore } from "../stores/ui-extension-store";
import { createExtensionAPI } from "./ui-extension-api";

interface LoadedExtension {
  extensionId: string;
  deactivate?: () => void | Promise<void>;
}

class UIExtensionHost {
  private loaded = new Map<string, LoadedExtension>();

  async loadExtension(manifest: ExtensionManifest, extensionPath: string): Promise<void> {
    const extensionId = manifest.id;

    if (this.loaded.has(extensionId)) {
      return;
    }

    const store = useUIExtensionStore.getState();

    store.registerExtension({
      extensionId,
      manifestId: manifest.id,
      state: "loading",
    });

    try {
      if (!manifest.main) {
        store.updateExtensionState(extensionId, "active");
        this.loaded.set(extensionId, { extensionId });
        return;
      }

      const entryPoint = `${extensionPath}/${manifest.main}`;
      const extensionModule = await import(/* @vite-ignore */ entryPoint);
      const api = createExtensionAPI(extensionId);

      if (typeof extensionModule.activate === "function") {
        await extensionModule.activate(api);
      }

      store.updateExtensionState(extensionId, "active");
      this.loaded.set(extensionId, {
        extensionId,
        deactivate: extensionModule.deactivate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      store.updateExtensionState(extensionId, "error", message);
      console.error(`Failed to load UI extension ${extensionId}:`, error);
    }
  }

  async unloadExtension(extensionId: string): Promise<void> {
    const loaded = this.loaded.get(extensionId);
    if (!loaded) return;

    try {
      if (typeof loaded.deactivate === "function") {
        await loaded.deactivate();
      }
    } catch (error) {
      console.error(`Error deactivating UI extension ${extensionId}:`, error);
    }

    useUIExtensionStore.getState().cleanupExtension(extensionId);
    this.loaded.delete(extensionId);
  }

  isLoaded(extensionId: string): boolean {
    return this.loaded.has(extensionId);
  }
}

export const uiExtensionHost = new UIExtensionHost();
