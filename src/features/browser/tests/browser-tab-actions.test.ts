// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BrowserEvent } from "@/bindings/commands";
import { commands } from "@/bindings/commands";
import { toast } from "sonner";
import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { browserTabManager } from "../services/browser-tab-manager";
import { useBrowserTabStore } from "../stores/browser-tab.store";

interface TestBuffer {
  id: string;
  type: string;
  url: string;
  name?: string;
  favicon?: string;
  zoom?: number;
}

const harness = vi.hoisted(() => ({
  buffers: [] as TestBuffer[],
  channels: [] as { onmessage: ((event: unknown) => void) | null }[],
  pageCommands: new Set<string>(),
  openBrowserBuffer: vi.fn() as (url: string) => void,
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
    constructor() {
      harness.channels.push(this);
    }
  },
}));
vi.mock("@/bindings/commands", () => ({
  commands: {
    browserCloseWindowTabs: vi.fn(async () => null),
    browserCreate: vi.fn(async () => "browser-0"),
    browserSetBounds: vi.fn(async () => null),
    browserNavigate: vi.fn(async () => null),
    browserPerform: vi.fn(async () => null),
    browserSetZoom: vi.fn(async () => null),
    browserFocus: vi.fn(async () => null),
    browserOpenDevtools: vi.fn(async () => null),
    browserClearData: vi.fn(async () => null),
    browserClose: vi.fn(async () => null),
    browserFocusWorkbench: vi.fn(async () => null),
    browserSnapshot: vi.fn(async () => new ArrayBuffer(8)),
    browserCapabilities: vi.fn(async () => ({ holes: true, snapshots: true })),
  },
}));
vi.mock("@/features/editor/stores/buffer.store", () => {
  const state = {
    get buffers() {
      return harness.buffers;
    },
    actions: {
      updateBrowserBuffer: (id: string, patch: Partial<TestBuffer>) => {
        harness.buffers = harness.buffers.map((buffer) =>
          buffer.id === id ? { ...buffer, ...patch } : buffer,
        );
      },
      openBrowserBuffer: (url: string) => harness.openBrowserBuffer(url),
    },
  };
  const store = { getState: () => state };
  return { useBufferStore: Object.assign(store, { getStore: () => store }) };
});
vi.mock("../utils/browser-key-bindings", () => ({
  getBrowserKeyBindings: () => [],
  isPageCommand: (command: string) => harness.pageCommands.has(command),
}));
vi.mock("@/features/keymaps/services/keymap-registry", () => ({
  keymapRegistry: { executeCommand: vi.fn(async () => {}) },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn(async () => {}) }));

const flush = async () => {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const attached: Array<() => void> = [];
const opened: string[] = [];

function createSlot() {
  const element = document.createElement("div");
  document.getElementById("root")?.append(element);
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }) as DOMRect;
  return { element, onFocus: vi.fn() };
}

function buffer(id: string): TestBuffer | undefined {
  return harness.buffers.find((candidate) => candidate.id === id);
}

async function openTab(id: string, url = "https://athas.dev", label = `label-${id}`) {
  harness.buffers.push({ id, type: "browser", url });
  vi.mocked(commands.browserCreate).mockResolvedValueOnce(label);
  const slot = createSlot();
  attached.push(browserTabManager.attach(id, null, slot, url));
  opened.push(id);
  await flush();
  const channel = harness.channels[harness.channels.length - 1];
  const emit = (event: BrowserEvent) => channel.onmessage?.(event);
  return { slot, emit };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.buffers = [];
  harness.channels = [];
  harness.pageCommands = new Set();
  harness.openBrowserBuffer = vi.fn();
  document.body.innerHTML = '<div id="root"></div>';
  Object.assign(window, { innerWidth: 1200, innerHeight: 800 });
  document.elementFromPoint = (() => null) as typeof document.elementFromPoint;
  useBrowserTabStore.setState({ tabs: {}, focusedBufferId: null });
});

afterEach(() => {
  for (const detach of attached.splice(0)) detach();
  for (const id of opened.splice(0)) browserTabManager.close(id);
});

describe("browser tab navigation", () => {
  it("navigates a created page and records the new address", async () => {
    await openTab("nav");
    useBrowserTabStore.getState().actions.patchTab("nav", { error: "old" });

    browserTabManager.navigate("nav", "https://example.com");

    expect(commands.browserNavigate).toHaveBeenCalledWith("label-nav", "https://example.com");
    expect(buffer("nav")?.url).toBe("https://example.com");
    expect(useBrowserTabStore.getState().tabs.nav?.error).toBeNull();
  });

  it("shows a navigation failure on the tab", async () => {
    await openTab("nav-fail");
    vi.mocked(commands.browserNavigate).mockRejectedValueOnce(new Error("blocked"));

    browserTabManager.navigate("nav-fail", "https://bad.example");
    await flush();

    expect(useBrowserTabStore.getState().tabs["nav-fail"]).toMatchObject({
      error: "blocked",
      isLoading: false,
    });
  });

  it("creates the page on navigate when a blank tab had no webview yet", async () => {
    harness.buffers.push({ id: "blank", type: "browser", url: "about:blank" });
    vi.mocked(commands.browserCreate).mockResolvedValueOnce("label-blank");
    attached.push(browserTabManager.attach("blank", null, createSlot(), "about:blank"));
    opened.push("blank");
    await flush();
    expect(commands.browserCreate).not.toHaveBeenCalled();

    browserTabManager.navigate("blank", "https://athas.dev/docs");
    await flush();

    expect(commands.browserCreate).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://athas.dev/docs" }),
      expect.anything(),
    );
    expect(commands.browserNavigate).not.toHaveBeenCalled();
  });

  it("ignores navigation for unknown tabs", () => {
    browserTabManager.navigate("missing", "https://athas.dev");
    browserTabManager.perform("missing", "reload");
    browserTabManager.zoom("missing", 1);
    browserTabManager.focusPage("missing");
    browserTabManager.openDevTools("missing");

    expect(commands.browserNavigate).not.toHaveBeenCalled();
    expect(commands.browserPerform).not.toHaveBeenCalled();
    expect(commands.browserSetZoom).not.toHaveBeenCalled();
    expect(commands.browserFocus).not.toHaveBeenCalled();
    expect(commands.browserOpenDevtools).not.toHaveBeenCalled();
  });

  it("forwards history actions to the page and reports failures", async () => {
    await openTab("history");
    vi.mocked(commands.browserPerform).mockRejectedValueOnce("no history");

    browserTabManager.perform("history", "back");
    await flush();

    expect(commands.browserPerform).toHaveBeenCalledWith("label-history", "back");
    expect(useBrowserTabStore.getState().tabs.history?.error).toBe("no history");
  });

  it("retries the address on reload when the page failed to be created", async () => {
    harness.buffers.push({ id: "retry", type: "browser", url: "https://athas.dev" });
    vi.mocked(commands.browserCreate).mockRejectedValueOnce(new Error("engine missing"));
    attached.push(browserTabManager.attach("retry", null, createSlot(), "https://athas.dev"));
    opened.push("retry");
    await flush();
    expect(useBrowserTabStore.getState().tabs.retry?.error).toBe("engine missing");

    vi.mocked(commands.browserCreate).mockResolvedValueOnce("label-retry");
    browserTabManager.perform("retry", "reload");
    await flush();

    expect(commands.browserCreate).toHaveBeenCalledTimes(2);
    expect(useBrowserTabStore.getState().tabs.retry?.error).toBeNull();
  });
});

describe("browser tab zoom", () => {
  it("steps through zoom levels and resets", async () => {
    await openTab("zoom");

    browserTabManager.zoom("zoom", 1);
    expect(buffer("zoom")?.zoom).toBe(1.1);
    browserTabManager.zoom("zoom", 1);
    expect(buffer("zoom")?.zoom).toBe(1.25);
    browserTabManager.zoom("zoom", -1);
    browserTabManager.zoom("zoom", -1);
    expect(buffer("zoom")?.zoom).toBeUndefined();
    browserTabManager.zoom("zoom", -1);
    expect(buffer("zoom")?.zoom).toBe(0.9);
    browserTabManager.zoom("zoom", 0);
    expect(buffer("zoom")?.zoom).toBeUndefined();

    expect(vi.mocked(commands.browserSetZoom).mock.calls.map((call) => call[1])).toEqual([
      1.1, 1.25, 1.1, 1, 0.9, 1,
    ]);
  });

  it("stays at the limits of the zoom range", async () => {
    await openTab("zoom-max");
    buffer("zoom-max")!.zoom = 3;

    browserTabManager.zoom("zoom-max", 1);
    expect(buffer("zoom-max")?.zoom).toBe(3);

    harness.buffers = harness.buffers.map((candidate) =>
      candidate.id === "zoom-max" ? { ...candidate, zoom: 0.5 } : candidate,
    );
    browserTabManager.zoom("zoom-max", -1);
    expect(buffer("zoom-max")?.zoom).toBe(0.5);
  });
});

describe("browser tab tools", () => {
  it("focuses the page and opens developer tools", async () => {
    await openTab("tools");
    vi.mocked(commands.browserOpenDevtools).mockRejectedValueOnce(new Error("disabled"));

    browserTabManager.focusPage("tools");
    browserTabManager.openDevTools("tools");
    await flush();

    expect(commands.browserFocus).toHaveBeenCalledWith("label-tools");
    expect(toast.error).toHaveBeenCalledWith("disabled");
  });

  it("clears browsing data and reports the outcome", async () => {
    await openTab("data");

    await browserTabManager.clearBrowsingData("data");
    expect(commands.browserClearData).toHaveBeenCalledWith("label-data");
    expect(toast.success).toHaveBeenCalledWith("Cleared browsing data");

    vi.mocked(commands.browserClearData).mockRejectedValueOnce("denied");
    await browserTabManager.clearBrowsingData("data");
    expect(toast.error).toHaveBeenCalledWith("denied");

    await browserTabManager.clearBrowsingData("missing");
    expect(commands.browserClearData).toHaveBeenCalledTimes(2);
  });
});

describe("browser page events", () => {
  it("tracks loading, address, history and title changes", async () => {
    const { emit } = await openTab("events");

    emit({ event: "loadStarted", url: "https://athas.dev/a" });
    expect(useBrowserTabStore.getState().tabs.events?.isLoading).toBe(true);
    expect(buffer("events")?.url).toBe("https://athas.dev/a");

    emit({ event: "loadFinished", url: "https://athas.dev/a" });
    expect(useBrowserTabStore.getState().tabs.events?.isLoading).toBe(false);

    emit({ event: "urlChanged", url: "https://athas.dev/b", canGoBack: null, canGoForward: null });
    expect(buffer("events")?.url).toBe("https://athas.dev/b");
    expect(useBrowserTabStore.getState().tabs.events?.canGoBack).toBeNull();

    emit({ event: "urlChanged", url: "https://athas.dev/c", canGoBack: true, canGoForward: false });
    expect(useBrowserTabStore.getState().tabs.events).toMatchObject({
      canGoBack: true,
      canGoForward: false,
    });

    emit({ event: "titleChanged", title: "  Docs  " });
    expect(buffer("events")?.name).toBe("Docs");
    emit({ event: "titleChanged", title: "" });
    expect(buffer("events")?.name).toBe("athas.dev");

    emit({ event: "faviconChanged", url: "https://athas.dev/favicon.ico" });
    expect(buffer("events")?.favicon).toBe("https://athas.dev/favicon.ico");
    emit({ event: "faviconChanged", url: null });
    expect(buffer("events")?.favicon).toBeUndefined();
  });

  it("activates the pane when the page takes focus and releases it on window focus", async () => {
    const { emit, slot } = await openTab("focus");

    emit({ event: "focused" });

    expect(useBrowserTabStore.getState().focusedBufferId).toBe("focus");
    expect(slot.onFocus).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event("focus"));
    expect(useBrowserTabStore.getState().focusedBufferId).toBeNull();
  });

  it("returns focus to the workbench when a focused tab closes", async () => {
    const { emit } = await openTab("closing-focus");
    emit({ event: "focused" });

    browserTabManager.close("closing-focus");
    opened.splice(opened.indexOf("closing-focus"), 1);
    await flush();

    expect(commands.browserFocusWorkbench).toHaveBeenCalled();
    expect(useBrowserTabStore.getState().focusedBufferId).toBeNull();
    emit({ event: "loadStarted", url: "https://late.example" });
    expect(useBrowserTabStore.getState().tabs["closing-focus"]).toBeUndefined();
  });

  it("runs workbench shortcuts after moving focus out of the page", async () => {
    const { emit } = await openTab("shortcut");
    harness.pageCommands.add("browser.reload");

    emit({ event: "shortcut", command: "workbench.toggleSidebar" });
    await flush();
    expect(commands.browserFocusWorkbench).toHaveBeenCalledOnce();
    expect(keymapRegistry.executeCommand).toHaveBeenCalledWith("workbench.toggleSidebar");

    emit({ event: "shortcut", command: "browser.reload" });
    await flush();
    expect(commands.browserFocusWorkbench).toHaveBeenCalledOnce();
    expect(keymapRegistry.executeCommand).toHaveBeenLastCalledWith("browser.reload");
  });

  it("opens new-window requests as browser tabs", async () => {
    const { emit } = await openTab("popup");

    emit({ event: "openInNewTab", url: "https://athas.dev/new" });

    expect(harness.openBrowserBuffer).toHaveBeenCalledWith("https://athas.dev/new");
  });

  it("reports downloads and reveals finished files", async () => {
    const { emit } = await openTab("download");

    emit({ event: "downloadStarted", url: "https://x/file.zip", path: "/tmp/dl/file.zip" });
    expect(toast).toHaveBeenCalledWith("Downloading file.zip");

    emit({
      event: "downloadFinished",
      url: "https://x/file.zip",
      path: "C:\\dl\\file.zip",
      success: true,
    });
    const [message, options] = vi.mocked(toast.success).mock.calls[0] as [
      string,
      { action?: { onClick: () => void } },
    ];
    expect(message).toBe("Downloaded file.zip");
    options.action?.onClick();
    await vi.waitFor(() => expect(revealItemInDir).toHaveBeenCalledWith("C:\\dl\\file.zip"));

    emit({ event: "downloadFinished", url: "https://x/a", path: null, success: true });
    expect(toast.success).toHaveBeenLastCalledWith("Download finished", { action: undefined });

    emit({ event: "downloadFinished", url: "https://x/a", path: null, success: false });
    expect(toast.error).toHaveBeenCalledWith("Download failed");
  });
});

describe("browser page layout monitoring", () => {
  it("hides the page while a drag is in progress and restores it afterwards", async () => {
    await openTab("drag");
    vi.mocked(commands.browserSnapshot).mockRejectedValueOnce("unsupported");

    window.dispatchEvent(new Event("dragstart"));

    await vi.waitFor(() =>
      expect(commands.browserSetBounds).toHaveBeenLastCalledWith("label-drag", null, null),
    );
    expect(commands.browserSnapshot).toHaveBeenCalledWith("label-drag");

    window.dispatchEvent(new Event("dragend"));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(commands.browserSetBounds).toHaveBeenLastCalledWith(
      "label-drag",
      { x: 0, y: 0, width: 400, height: 300 },
      null,
    );
  });
});
