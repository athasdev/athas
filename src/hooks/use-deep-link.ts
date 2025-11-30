import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useEffect } from "react";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { toast } from "@/stores/toast-store";

/**
 * Hook to handle deep link URLs
 * Supports: athas://extension/install/{extensionId}
 */
export function useDeepLink() {
  useEffect(() => {
    const unlisten = onOpenUrl((urls: string[]) => {
      for (const url of urls) {
        handleDeepLink(url);
      }
    });

    return () => {
      unlisten.then((fn: () => void) => fn());
    };
  }, []);
}

function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "athas:") {
      return;
    }

    const path = parsed.pathname.replace(/^\/\//, "");
    const segments = path.split("/").filter(Boolean);

    if (segments[0] === "extension" && segments[1] === "install" && segments[2]) {
      const extensionId = segments[2];
      installExtensionFromDeepLink(extensionId);
    }
  } catch (error) {
    console.error("Failed to parse deep link:", error);
  }
}

async function installExtensionFromDeepLink(extensionId: string) {
  const { installExtension } = useExtensionStore.getState().actions;
  const { availableExtensions } = useExtensionStore.getState();

  const extension = availableExtensions.get(extensionId);

  if (!extension) {
    toast.error(`Extension "${extensionId}" not found`);
    return;
  }

  if (extension.isInstalled) {
    toast.info(`${extension.manifest.displayName} is already installed`);
    return;
  }

  try {
    toast.info(`Installing ${extension.manifest.displayName}...`);
    await installExtension(extensionId);
    toast.success(`${extension.manifest.displayName} installed successfully`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    toast.error(`Failed to install extension: ${message}`);
  }
}
