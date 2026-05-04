import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useEffect } from "react";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { toast } from "@/ui/toast";
import {
  enqueueWindowOpenRequest,
  parseWindowOpenUrl,
  type WindowOpenRequest,
} from "../utils/window-open-request";

/**
 * Hook to handle deep link URLs
 * Supports:
 *   athas://open?path=...&line=...&type=directory
 *   athas://extension/install/{extensionId}
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
    const action = parseDeepLinkAction(url);
    if (!action) return;

    if (action.type === "windowOpen") {
      void enqueueWindowOpenRequest(action.request);
    } else {
      installExtensionFromDeepLink(action.extensionId);
    }
  } catch (error) {
    console.error("Failed to parse deep link:", error);
  }
}

const SUPPORTED_DEEP_LINK_PROTOCOLS = new Set(["athas:", "athas-dev:", "athas-preview:"]);

function isSupportedDeepLinkProtocol(protocol: string) {
  return SUPPORTED_DEEP_LINK_PROTOCOLS.has(protocol);
}

export type DeepLinkAction =
  | { type: "windowOpen"; request: WindowOpenRequest }
  | { type: "extensionInstall"; extensionId: string };

export function parseDeepLinkAction(url: string): DeepLinkAction | null {
  const parsed = new URL(url);

  if (!isSupportedDeepLinkProtocol(parsed.protocol)) {
    return null;
  }

  const openRequest = parseWindowOpenUrl(parsed);
  if (openRequest) {
    return {
      type: "windowOpen",
      request: { ...openRequest, source: "deepLink" },
    };
  }

  const path = parsed.pathname.replace(/^\/\//, "");
  const segments = [parsed.host, ...path.split("/")].filter(Boolean);

  if (segments[0] === "extension" && segments[1] === "install" && segments[2]) {
    return {
      type: "extensionInstall",
      extensionId: segments[2],
    };
  }

  return null;
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

export const __test__ = { isSupportedDeepLinkProtocol, parseDeepLinkAction };
