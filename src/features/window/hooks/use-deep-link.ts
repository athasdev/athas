import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { commands } from "@/bindings/commands";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { toast } from "sonner";
import type { Settings } from "@/features/settings/types/settings.types";
import type { SettingsTab } from "@/features/layout/stores/ui-state/types/ui-state.types";
import {
  enqueueWindowOpenRequest,
  parseWindowOpenUrl,
  type WindowOpenRequest,
} from "../services/window-open-request";
import { createPendingQueueDrain } from "../utils/pending-queue-drain";
import { disposeListener } from "@/utils/tauri-drag-drop";
import { parseMcpInstallLink } from "@/features/ai/services/mcp-install-link";
import { usePendingMcpInstallStore } from "@/features/ai/stores/pending-mcp-install.store";
import type { McpServerDraft } from "@/features/ai/types/mcp-server.types";

const drainPendingDeepLinks = createPendingQueueDrain({
  take: () => commands.takePendingDeepLinks(),
  handle: handleDeepLink,
  onError: (error) => console.error("Failed to load pending deep links:", error),
});

/**
 * Hook to handle deep link URLs. The native side queues every link, including
 * the one that launched the app, so links are drained here instead of relying
 * on an event that can fire before this window subscribes.
 * Supports:
 *   athas://open?path=...&line=...&type=directory
 *   athas://extension/install/{extensionId}
 *   athas://mcp/install?name=...&config=<base64 JSON>
 *   athas://settings?tab=advanced
 */
export function useDeepLink() {
  useEffect(() => {
    let disposed = false;
    const drain = () => void drainPendingDeepLinks();

    const unlisten = listen<void>("deep_links_pending", drain);
    unlisten.then(
      () => {
        if (!disposed) drain();
      },
      (error: unknown) => console.error("Failed to listen for deep links:", error),
    );

    return () => {
      disposed = true;
      disposeListener(unlisten);
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
    } else if (action.type === "mcpInstall") {
      openMcpInstallFromDeepLink(action.draft);
    } else if (action.type === "invalidMcpInstall") {
      toast.error("This MCP server link is not valid");
    } else if (action.type === "extensions") {
      void openExtensionsTabFromDeepLink(action.extensionsCategory);
    } else {
      void openSettingsFromDeepLink(action.tab, action.extensionsCategory);
    }
  } catch (error) {
    console.error("Failed to parse deep link:", error);
  }
}

const SUPPORTED_DEEP_LINK_PROTOCOLS = new Set(["athas:", "athas-dev:"]);

function isSupportedDeepLinkProtocol(protocol: string) {
  return SUPPORTED_DEEP_LINK_PROTOCOLS.has(protocol);
}

type DeepLinkAction =
  | { type: "windowOpen"; request: WindowOpenRequest }
  | { type: "extensionInstall"; extensionId: string }
  | { type: "mcpInstall"; draft: McpServerDraft }
  | { type: "invalidMcpInstall" }
  | { type: "extensions"; extensionsCategory?: Settings["extensionsActiveTab"] }
  | { type: "settings"; tab: SettingsTab; extensionsCategory?: Settings["extensionsActiveTab"] };

const SUPPORTED_SETTINGS_TABS = new Set<SettingsTab>([
  "account",
  "general",
  "editor",
  "git",
  "appearance",
  "ai",
  "ai-models",
  "ai-completion",
  "ai-agents",
  "ai-mcp",
  "keyboard",
  "language",
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
  "ai",
  "integration",
  "skill",
  "agent",
]);

function parseSettingsTab(value: string | null): SettingsTab {
  if (value === "features") {
    return "advanced";
  }

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

function parseDeepLinkAction(url: string): DeepLinkAction | null {
  const parsed = new URL(url);

  if (!isSupportedDeepLinkProtocol(parsed.protocol)) {
    return null;
  }

  const openRequest = parseWindowOpenUrl(parsed);
  if (openRequest) {
    if (openRequest.type === "settings") {
      if (parsed.searchParams.get("tab") === "extensions") {
        return {
          type: "extensions",
          extensionsCategory: parseExtensionsCategory(parsed.searchParams.get("category")),
        };
      }

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

  if (segments[0] === "mcp" && segments[1] === "install") {
    const draft = parseMcpInstallLink(parsed);
    return draft ? { type: "mcpInstall", draft } : { type: "invalidMcpInstall" };
  }

  if (segments[0] === "settings") {
    if (parsed.searchParams.get("tab") === "extensions") {
      return {
        type: "extensions",
        extensionsCategory: parseExtensionsCategory(parsed.searchParams.get("category")),
      };
    }

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
  _extensionsCategory?: Settings["extensionsActiveTab"],
) {
  const { useUIState } = await import("@/features/layout/stores/ui-state.store");
  useUIState.getState().openSettings(tab);
}

function openMcpInstallFromDeepLink(draft: McpServerDraft) {
  usePendingMcpInstallStore.getState().actions.request(draft);
  void openSettingsFromDeepLink("ai-mcp");
}

async function openExtensionsTabFromDeepLink(extensionsCategory?: Settings["extensionsActiveTab"]) {
  const [{ useSettingsStore }, { useBufferStore }] = await Promise.all([
    import("@/features/settings/stores/settings.store"),
    import("@/features/editor/stores/buffer.store"),
  ]);

  if (extensionsCategory) {
    void useSettingsStore
      .getState()
      .actions.updateSetting("extensionsActiveTab", extensionsCategory);
  }

  useBufferStore.getState().actions.openExtensionsBuffer();
}

async function installExtensionFromDeepLink(extensionId: string) {
  const { installExtension } = useExtensionStore.getState().actions;
  const { availableExtensions } = useExtensionStore.getState();

  const extension = availableExtensions.get(extensionId);

  if (!extension) {
    toast.error(`Integration "${extensionId}" not found`);
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
    toast.error(`Failed to install integration: ${message}`);
  }
}

export const __test__ = { isSupportedDeepLinkProtocol, parseDeepLinkAction };
