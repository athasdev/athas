// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  calls: [] as string[],
  enqueue: vi.fn(async () => {}),
  initializeAuth: vi.fn(async () => {}),
  initializeWhatsNew: vi.fn(async () => {}),
  initializeOnboarding: vi.fn(async () => {}),
  cleanupStaleTabs: vi.fn(async () => {}),
}));

vi.mock("@/features/bootstrap/hooks/use-platform-setup", () => ({ usePlatformSetup: () => {} }));
vi.mock("@/features/window/hooks/use-window-document-state", () => ({
  useWindowDocumentState: () => {},
}));
vi.mock("@/features/window/hooks/use-deep-link", () => ({ useDeepLink: () => {} }));
vi.mock("@/features/window/hooks/use-cli-open", () => ({ useCliOpen: () => {} }));
vi.mock("@/features/window/hooks/use-external-navigation-guard", () => ({
  useExternalNavigationGuard: () => {},
}));
vi.mock("@/extensions/hooks/use-extension-install-prompt", () => ({
  useExtensionInstallPrompt: () => {},
}));
vi.mock("@/features/keymaps/hooks/use-keymap-context", () => ({ useKeymapContext: () => {} }));
vi.mock("@/features/keymaps/hooks/use-keymaps", () => ({ useKeymaps: () => {} }));
vi.mock("@/features/editor/hooks/use-lsp-initialization", () => ({
  useLspInitialization: () => {},
}));
vi.mock("@/features/ai/services/acp-buffer-reads", () => ({
  initializeAcpBufferReads: vi.fn(async () => harness.calls.push("acp:init")),
  cleanupAcpBufferReads: vi.fn(async () => harness.calls.push("acp:cleanup")),
}));
vi.mock("@/features/ai/integrations/claude-code/services/claude-ide-bridge", () => ({
  initializeClaudeIdeBridge: vi.fn(async () => harness.calls.push("claude-ide:init")),
  cleanupClaudeIdeBridge: vi.fn(async () => harness.calls.push("claude-ide:cleanup")),
}));
vi.mock("@/features/file-explorer/services/file-explorer-clipboard-listener", () => ({
  initializeFileClipboardListener: vi.fn(async () => harness.calls.push("clipboard:init")),
  cleanupFileClipboardListener: vi.fn(async () => harness.calls.push("clipboard:cleanup")),
}));
vi.mock("@/features/file-system/services/file-watcher-listener", () => ({
  initializeFileWatcherListener: vi.fn(async () => harness.calls.push("watcher:init")),
  cleanupFileWatcherListener: vi.fn(async () => harness.calls.push("watcher:cleanup")),
}));
vi.mock("@/features/onboarding/stores/onboarding.store", async () => {
  const { create } = await import("zustand");
  return {
    useOnboardingStore: create(() => ({
      actions: { initialize: harness.initializeOnboarding },
    })),
  };
});
vi.mock("@/features/settings/stores/whats-new.store", async () => {
  const { create } = await import("zustand");
  return {
    useWhatsNewStore: create(() => ({ actions: { initialize: harness.initializeWhatsNew } })),
  };
});
vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ actions: { initialize: harness.initializeAuth } }) },
}));
vi.mock("@/features/browser/services/browser-tab-manager", () => ({
  browserTabManager: { cleanupStaleTabs: harness.cleanupStaleTabs },
}));
vi.mock("@/features/window/services/window-open-request", () => ({
  parseWindowOpenUrl: (url: URL) =>
    url.searchParams.get("target") === "open" ? { path: url.searchParams.get("path") } : null,
  enqueueWindowOpenRequest: harness.enqueue,
}));

import { commands } from "@/bindings/commands";
import { useAppBootstrap } from "../hooks/use-app-bootstrap";
import { useContextMenuPrevention } from "../hooks/use-context-menu-prevention";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function mount(useHook: () => void) {
  function Probe() {
    useHook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  return () => act(async () => root.unmount());
}

beforeEach(() => {
  harness.calls = [];
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("useAppBootstrap", () => {
  it("starts app services once and stops listeners on unmount", async () => {
    vi.spyOn(commands, "warmTerminalEnvironment").mockResolvedValue(undefined);

    const unmount = await mount(useAppBootstrap);
    await vi.waitFor(() => expect(harness.cleanupStaleTabs).toHaveBeenCalledOnce());

    expect(harness.initializeAuth).toHaveBeenCalledOnce();
    expect(harness.initializeWhatsNew).toHaveBeenCalledOnce();
    expect(harness.initializeOnboarding).toHaveBeenCalledOnce();
    expect(harness.calls).toEqual([
      "watcher:init",
      "acp:init",
      "claude-ide:init",
      "clipboard:init",
    ]);

    await unmount();
    expect(harness.calls.slice(4).sort()).toEqual([
      "acp:cleanup",
      "claude-ide:cleanup",
      "clipboard:cleanup",
      "watcher:cleanup",
    ]);
  });

  it("warms the terminal environment after the first frame", async () => {
    const warm = vi.spyOn(commands, "warmTerminalEnvironment").mockRejectedValue("no shell");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const unmount = await mount(useAppBootstrap);
    await vi.waitFor(() => expect(warm).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith("Failed to warm terminal environment:", "no shell"),
    );
    await unmount();
  });

  it("skips warming when unmounted before the first frame", async () => {
    vi.useFakeTimers();
    const warm = vi.spyOn(commands, "warmTerminalEnvironment").mockResolvedValue(undefined);

    const unmount = await mount(useAppBootstrap);
    await unmount();
    vi.advanceTimersByTime(100);

    expect(warm).not.toHaveBeenCalled();
  });

  it("opens the request in the window URL and removes it from the address", async () => {
    vi.spyOn(commands, "warmTerminalEnvironment").mockResolvedValue(undefined);
    window.history.replaceState({ keep: true }, "", "/index.html?target=open&path=/repo#main");

    const unmount = await mount(useAppBootstrap);

    expect(harness.enqueue).toHaveBeenCalledWith({ path: "/repo" });
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/index.html#main",
    );
    expect(window.history.state).toEqual({ keep: true });
    await unmount();
  });

  it("leaves ordinary window URLs alone", async () => {
    vi.spyOn(commands, "warmTerminalEnvironment").mockResolvedValue(undefined);
    window.history.replaceState(null, "", "/?theme=dark");

    const unmount = await mount(useAppBootstrap);

    expect(harness.enqueue).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?theme=dark");
    await unmount();
  });
});

describe("useContextMenuPrevention", () => {
  function contextMenuOn(target: Element) {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it("blocks the native menu outside editors in production builds", async () => {
    vi.stubEnv("MODE", "production");
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const line = document.createElement("span");
    editor.append(line);
    const panel = document.createElement("div");
    document.body.append(editor, panel);

    const unmount = await mount(useContextMenuPrevention);

    expect(contextMenuOn(panel)).toBe(true);
    expect(contextMenuOn(line)).toBe(false);

    await unmount();
    expect(contextMenuOn(panel)).toBe(false);
    editor.remove();
    panel.remove();
  });

  it("keeps the native menu during development", async () => {
    vi.stubEnv("MODE", "development");
    const panel = document.createElement("div");
    document.body.append(panel);

    const unmount = await mount(useContextMenuPrevention);

    expect(contextMenuOn(panel)).toBe(false);
    await unmount();
    panel.remove();
  });
});
