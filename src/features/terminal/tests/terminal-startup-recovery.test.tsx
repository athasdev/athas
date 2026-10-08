// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defaultSettings } from "@/features/settings/config/default-settings";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { WorkspaceStoreScopeContext } from "@/features/workspace/stores/create-workspace-scoped-store";
import { useTerminalStore } from "../stores/terminal.store";
import { TerminalEmulator } from "../components/terminal";
import { getTerminalEmulator } from "../services/terminal-emulator-registry";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  font: vi.fn(),
  ready: vi.fn(),
  currentConnectionId: { current: null },
  callback: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class<T> {
    constructor(public onmessage: (message: T) => void) {}
  },
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ settings: defaultSettings }),
    { getState: () => ({ settings: defaultSettings, actions: { updateSetting: vi.fn() } }) },
  ),
}));
vi.mock("@/features/layout/stores/zoom.store", () => ({
  useZoomStore: { use: { terminalZoomLevel: () => 1 } },
}));
vi.mock("@/features/workspace/stores/project.store", () => ({
  useProjectStore: (selector: (state: unknown) => unknown) =>
    selector({ rootFolderPath: "/project" }),
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: { getState: () => ({ handleFileSelect: vi.fn() }) },
}));
vi.mock("@/utils/frontend-trace", () => ({ frontendTrace: vi.fn() }));
vi.mock("../services/frontend-terminal-session", () => ({
  getFrontendTerminalSessionArgs: () => ({ windowLabel: "main", frontendSessionId: "frontend" }),
}));
vi.mock("../utils/resolve-font", () => ({ resolveTerminalFont: mocks.font }));
vi.mock("../hooks/use-terminal-theme", () => ({
  useTerminalTheme: () => ({ getTerminalTheme: () => ({}) }),
}));
vi.mock("../hooks/use-terminal-connection", () => ({
  useTerminalConnection: () => ({
    currentConnectionIdRef: mocks.currentConnectionId,
    sendTerminalSize: mocks.callback,
    writeBuffered: mocks.callback,
  }),
}));
vi.mock("../hooks/use-terminal-addons", () => ({
  createTerminalAddons: () => ({
    fitAddon: { fit: mocks.callback },
    progressAddon: { onChange: mocks.callback },
    searchAddon: { onDidChangeResults: () => ({ dispose: mocks.callback }) },
  }),
  createTerminalLinkHandler: mocks.callback,
  loadWebLinksAddon: mocks.callback,
  registerFileLinksProvider: mocks.callback,
}));
vi.mock("../lib/terminal-link-tooltip", () => ({
  TerminalLinkTooltip: class {
    dispose() {}
  },
}));
vi.mock("../lib/terminal-shell-integration", () => ({
  TerminalShellIntegration: class {
    dispose() {}
  },
}));
vi.mock("../components/terminal-search", () => ({ TerminalSearch: () => null }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = {};
    rows = 24;
    cols = 80;
    element: HTMLElement | undefined;
    open(element: HTMLElement) {
      this.element = element;
    }
    attachCustomKeyEventHandler() {}
    refresh() {}
    dispose() {}
    focus() {}
  },
}));

let root: Root;
let container: HTMLDivElement;
let restoreBounds: () => void;
let restoreParent: () => void;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  workspaceRuntimeRegistry.resetForTests();
  useTerminalStore.getStore("workspace-a").getState().actions.registerSession("session");
  mocks.invoke.mockResolvedValue("pty-1");
  mocks.font.mockResolvedValue({ fontFamily: "monospace", fontSize: 14 });
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 640,
    height: 480,
    top: 0,
    left: 0,
    bottom: 480,
    right: 640,
    toJSON: () => ({}),
  });
  const parent = vi
    .spyOn(HTMLElement.prototype, "offsetParent", "get")
    .mockImplementation(() => document.body);
  restoreBounds = () => bounds.mockRestore();
  restoreParent = () => parent.mockRestore();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  restoreBounds();
  restoreParent();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderTerminal() {
  await act(async () =>
    root.render(
      <WorkspaceStoreScopeContext.Provider value="workspace-a">
        <TerminalEmulator sessionId="session" isActive onReady={mocks.ready} />
      </WorkspaceStoreScopeContext.Provider>,
    ),
  );
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe("terminal startup recovery", () => {
  it("registers the live emulator by session id until the view unmounts", async () => {
    await renderTerminal();
    await act(async () => {});
    expect(mocks.ready).toHaveBeenCalledTimes(1);
    const handle = getTerminalEmulator("session");
    expect(handle?.terminal).toBeDefined();
    await act(async () => root.render(null));
    expect(getTerminalEmulator("session")).toBeUndefined();
  });

  it("skips process creation when the view closes while font setup is pending", async () => {
    let finishFont: (value: unknown) => void = () => {};
    mocks.font.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFont = resolve;
        }),
    );
    await renderTerminal();
    expect(mocks.font).toHaveBeenCalledTimes(1);
    await act(async () => {
      useTerminalStore.getStore("workspace-a").getState().actions.removeSession("session");
      root.render(null);
    });
    await act(async () => finishFont({ fontFamily: "monospace", fontSize: 14 }));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.ready).not.toHaveBeenCalled();
  });

  it("closes a native process that arrives after the owning tab and view close", async () => {
    let finishLaunch: (value: string) => void = () => {};
    const native = new Promise<string>((resolve) => {
      finishLaunch = resolve;
    });
    mocks.invoke.mockImplementation((command) =>
      command === "create_terminal" ? native : Promise.resolve(undefined),
    );
    await renderTerminal();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      useTerminalStore.getStore("workspace-a").getState().actions.removeSession("session");
      root.render(null);
    });
    await act(async () => finishLaunch("late-pty"));
    expect(mocks.invoke).toHaveBeenCalledWith("close_terminal", { id: "late-pty" });
    expect(useTerminalStore.getStore("workspace-a").getState().sessions.has("session")).toBe(false);
    expect(mocks.ready).not.toHaveBeenCalled();
  });
  it("shows authentication failure and retries without replacing the owning session", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Authentication failed"));
    await renderTerminal();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Incorrect username or password",
    );
    expect(mocks.ready).not.toHaveBeenCalled();
    const lifetime = useTerminalStore
      .getStore("workspace-a")
      .getState()
      .actions.getSessionSignal("session");
    const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Retry",
    )!;
    await act(async () => retry.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(mocks.ready).toHaveBeenCalledTimes(1);
    expect(
      useTerminalStore.getStore("workspace-a").getState().actions.getSession("session")
        ?.connectionId,
    ).toBe("pty-1");
    expect(
      useTerminalStore.getStore("workspace-a").getState().actions.getSessionSignal("session"),
    ).toBe(lifetime);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("recovers from font setup failure before creating a native process", async () => {
    mocks.font.mockRejectedValueOnce(new Error("Font setup failed"));
    await renderTerminal();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Font setup failed");
    expect(mocks.invoke).not.toHaveBeenCalled();
    const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Retry",
    )!;
    await act(async () => retry.click());
    expect(mocks.ready).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
