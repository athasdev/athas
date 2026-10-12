// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  unlistened: [] as string[],
  listenError: null as unknown,
  enqueue: vi.fn(async () => {}),
  openSettings: vi.fn(),
  openExtensionsBuffer: vi.fn(),
  installExtension: vi.fn<(id: string) => Promise<void>>(async () => {}),
  availableExtensions: new Map<string, unknown>(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    if (harness.listenError) throw harness.listenError;
    harness.handlers.set(name, handler);
    return () => harness.unlistened.push(name);
  }),
}));
vi.mock("@/features/bootstrap/stores/bootstrap-phase.store", () => ({
  waitForBootstrapPhase: async () => {},
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: { getState: () => ({}) },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({ actions: { openExtensionsBuffer: harness.openExtensionsBuffer } }),
  },
}));
vi.mock("@/features/window/services/window-open-request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/window-open-request")>()),
  enqueueWindowOpenRequest: harness.enqueue,
}));
vi.mock("@/features/layout/stores/ui-state.store", () => ({
  useUIState: { getState: () => ({ openSettings: harness.openSettings }) },
}));
vi.mock("@/extensions/registry/extension-store", () => ({
  useExtensionStore: {
    getState: () => ({
      availableExtensions: harness.availableExtensions,
      actions: { installExtension: harness.installExtension },
    }),
  },
}));
vi.mock("sonner", () => ({ toast: harness.toast }));

import { commands } from "@/bindings/commands";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useCliOpen } from "../hooks/use-cli-open";
import { useDeepLink } from "../hooks/use-deep-link";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function mount(useHook: () => void) {
  function Probe() {
    useHook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  await settle();
  return () => act(async () => root.unmount());
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

function extension(id: string, isInstalled: boolean) {
  return { id, isInstalled, manifest: { displayName: `Ext ${id}` } };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.handlers.clear();
  harness.unlistened = [];
  harness.listenError = null;
  harness.availableExtensions = new Map();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDeepLink", () => {
  it("drains links queued before the window subscribed", async () => {
    vi.spyOn(commands, "takePendingDeepLinks")
      .mockResolvedValueOnce(["athas://open?path=/repo/a.ts&line=7"])
      .mockResolvedValue([]);

    const unmount = await mount(useDeepLink);

    expect(harness.enqueue).toHaveBeenCalledWith({
      type: "path",
      source: "deepLink",
      path: "/repo/a.ts",
      isDirectory: false,
      line: 7,
      column: undefined,
    });
    await unmount();
    await settle();
    expect(harness.unlistened).toEqual(["deep_links_pending"]);
  });

  it("drains again whenever the native side signals new links", async () => {
    const take = vi.spyOn(commands, "takePendingDeepLinks").mockResolvedValue([]);
    const unmount = await mount(useDeepLink);
    take.mockResolvedValueOnce(["athas://settings?tab=git", "https://evil.example/open"]);

    await act(async () => harness.handlers.get("deep_links_pending")?.({ payload: undefined }));
    await vi.waitFor(() => expect(harness.openSettings).toHaveBeenCalledWith("git"));
    expect(harness.enqueue).not.toHaveBeenCalled();
    await unmount();
  });

  it("opens the extensions view and remembers the requested category", async () => {
    const take = vi
      .spyOn(commands, "takePendingDeepLinks")
      .mockResolvedValueOnce(["athas://settings?tab=extensions&category=theme"])
      .mockResolvedValue([]);
    const unmount = await mount(useDeepLink);
    await vi.waitFor(() => expect(harness.openExtensionsBuffer).toHaveBeenCalledOnce());
    expect(useSettingsStore.getState().settings.extensionsActiveTab).toBe("theme");

    take.mockResolvedValueOnce(["athas://open?type=settings&tab=extensions&category=bogus"]);
    await act(async () => harness.handlers.get("deep_links_pending")?.({ payload: undefined }));
    await vi.waitFor(() => expect(harness.openExtensionsBuffer).toHaveBeenCalledTimes(2));
    expect(useSettingsStore.getState().settings.extensionsActiveTab).toBe("theme");

    take.mockResolvedValueOnce(["athas://open?type=settings&tab=ai"]);
    await act(async () => harness.handlers.get("deep_links_pending")?.({ payload: undefined }));
    await vi.waitFor(() => expect(harness.openSettings).toHaveBeenCalledWith("ai"));
    await unmount();
  });

  it("installs extensions named by a link and explains every outcome", async () => {
    harness.availableExtensions = new Map<string, unknown>([
      ["theme-dark", extension("theme-dark", false)],
      ["lang-go", extension("lang-go", true)],
      ["broken", extension("broken", false)],
    ]);
    harness.installExtension.mockImplementation(async (id: string) => {
      if (id === "broken") throw new Error("checksum mismatch");
    });
    vi.spyOn(commands, "takePendingDeepLinks")
      .mockResolvedValueOnce([
        "athas://extension/install/theme-dark",
        "athas://extension/install/lang-go",
        "athas://extension/install/missing",
        "athas://extension/install/broken",
      ])
      .mockResolvedValue([]);

    const unmount = await mount(useDeepLink);
    await settle();

    expect(harness.installExtension).toHaveBeenCalledWith("theme-dark");
    expect(harness.installExtension).not.toHaveBeenCalledWith("lang-go");
    expect(harness.toast.success).toHaveBeenCalledWith("Ext theme-dark installed successfully");
    expect(harness.toast.info).toHaveBeenCalledWith("Ext lang-go is already installed");
    expect(harness.toast.error).toHaveBeenCalledWith('Integration "missing" not found');
    expect(harness.toast.error).toHaveBeenCalledWith(
      "Failed to install integration: checksum mismatch",
    );
    await unmount();
  });

  it("survives malformed links and failed drains", async () => {
    vi.spyOn(commands, "takePendingDeepLinks")
      .mockResolvedValueOnce(["not a url", "athas://unknown/thing"])
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValue([]);

    const unmount = await mount(useDeepLink);
    await act(async () => harness.handlers.get("deep_links_pending")?.({ payload: undefined }));
    await settle();

    expect(console.error).toHaveBeenCalledWith("Failed to parse deep link:", expect.any(TypeError));
    expect(console.error).toHaveBeenCalledWith(
      "Failed to load pending deep links:",
      new Error("queue unavailable"),
    );
    expect(harness.enqueue).not.toHaveBeenCalled();
    await unmount();
  });

  it("reports when it cannot subscribe", async () => {
    harness.listenError = new Error("no event bridge");
    const take = vi.spyOn(commands, "takePendingDeepLinks").mockResolvedValue([]);

    const unmount = await mount(useDeepLink);

    expect(console.error).toHaveBeenCalledWith(
      "Failed to listen for deep links:",
      harness.listenError,
    );
    expect(take).not.toHaveBeenCalled();
    await unmount();
  });
});

describe("useCliOpen", () => {
  it("enqueues requests pushed by the CLI and drains the pending queue", async () => {
    vi.spyOn(commands, "takePendingCliOpenRequests")
      .mockResolvedValueOnce([
        { kind: "path", path: "/repo", is_directory: true, line: null, column: null },
        { kind: "empty" },
      ] as never)
      .mockResolvedValue([]);

    const unmount = await mount(useCliOpen);

    expect(harness.enqueue).toHaveBeenCalledWith({
      type: "path",
      source: "cli",
      path: "/repo",
      isDirectory: true,
      line: undefined,
      column: undefined,
    });

    act(() =>
      harness.handlers.get("cli_open_request")?.({
        payload: { kind: "web", url: "https://athas.dev" },
      }),
    );
    expect(harness.enqueue).toHaveBeenLastCalledWith({
      type: "web",
      source: "cli",
      url: "https://athas.dev",
    });

    act(() => harness.handlers.get("cli_open_request")?.({ payload: { kind: "web" } }));
    expect(harness.enqueue).toHaveBeenCalledTimes(2);

    await unmount();
    await settle();
    expect(harness.unlistened.sort()).toEqual(["cli_open_request", "cli_open_requests_pending"]);
  });

  it("logs failed drains and failed subscriptions", async () => {
    vi.spyOn(commands, "takePendingCliOpenRequests").mockRejectedValue(new Error("gone"));
    const unmount = await mount(useCliOpen);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to load pending CLI open requests:",
      new Error("gone"),
    );
    await unmount();

    harness.listenError = new Error("no bridge");
    const unmountAgain = await mount(useCliOpen);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to listen for CLI open requests:",
      harness.listenError,
    );
    await unmountAgain();
  });
});
