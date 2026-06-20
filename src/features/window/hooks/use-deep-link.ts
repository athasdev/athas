import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useEffect } from "react";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { toast } from "@/ui/toast";
import type { Settings } from "@/features/settings/types/settings.types";
import type { SettingsTab } from "@/features/window/stores/ui-state/types/ui-state.types";
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
 *   athas://settings?tab=extensions
 */
export function useDeepLink() {
  useEffect(() => {
    let disposed = false;

    void getCurrent().then((urls) => {
      if (disposed || !urls) return;
      for (const url of urls) {
        handleDeepLink(url);
      }
    });

    const unlisten = onOpenUrl((urls: string[]) => {
      for (const url of urls) {
        handleDeepLink(url);
      }
    });

    return () => {
      disposed = true;
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
    } else if (action.type === "extensionInstall") {
      installExtensionFromDeepLink(action.extensionId);
    } else {
      void openSettingsFromDeepLink(action.tab, action.extensionsCategory);
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
  | { type: "extensionInstall"; extensionId: string }
  | { type: "settings"; tab: SettingsTab; extensionsCategory?: Settings["extensionsActiveTab"] };

const SUPPORTED_SETTINGS_TABS = new Set<SettingsTab>([
  "account",
  "general",
  "editor",
  "git",
  "appearance",
  "databases",
  "extensions",
  "ai",
  "keyboard",
  "language",
  "features",
  "collaboration",
  "enterprise",
  "advanced",
  "terminal",
  "file-explorer",
]);

const SUPPORTED_EXTENSION_CATEGORIES = new Set<Settings["extensionsActiveTab"]>([
  "all",
  "language",
  "theme",
  "icon-theme",
  "database",
  "skill",
  "agent",
]);

function parseSettingsTab(value: string | null): SettingsTab {
  if (value && SUPPORTED_SETTINGS_TABS.has(value as SettingsTab)) {
    return value as SettingsTab;
  }
  return "general";
}

function parseExtensionsCategory(
  value: string | null,
): Settings["extensionsActiveTab"] | undefined {
  if (value && SUPPORTED_EXTENSION_CATEGORIES.has(value as Settings["extensionsActiveTab"])) {
    return value as Settings["extensionsActiveTab"];
  }
  return undefined;
}

export function parseDeepLinkAction(url: string): DeepLinkAction | null {
  const parsed = new URL(url);

  if (!isSupportedDeepLinkProtocol(parsed.protocol)) {
    return null;
  }

  const openRequest = parseWindowOpenUrl(parsed);
  if (openRequest) {
    if (openRequest.type === "settings") {
      return {
        type: "settings",
        tab: parseSettingsTab(parsed.searchParams.get("tab")),
        extensionsCategory: parseExtensionsCategory(parsed.searchParams.get("category")),
      };
    }

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

  if (segments[0] === "settings") {
    return {
      type: "settings",
      tab: parseSettingsTab(parsed.searchParams.get("tab")),
      extensionsCategory: parseExtensionsCategory(parsed.searchParams.get("category")),
    };
  }

  return null;
}

async function openSettingsFromDeepLink(
  tab: SettingsTab,
  extensionsCategory?: Settings["extensionsActiveTab"],
) {
  const [{ useSettingsStore }, { useUIState }] = await Promise.all([
    import("@/features/settings/stores/settings.store"),
    import("@/features/window/stores/ui-state.store"),
  ]);

  if (tab === "extensions" && extensionsCategory) {
    void useSettingsStore.getState().updateSetting("extensionsActiveTab", extensionsCategory);
  }
  useUIState.getState().openSettingsDialog(tab);
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
