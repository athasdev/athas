// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BrowserEvent } from "@/bindings/commands";
import { commands } from "@/bindings/commands";
import { browserTabManager } from "../services/browser-tab-manager";
import { useBrowserTabStore } from "../stores/browser-tab.store";

const harness = vi.hoisted(() => ({
  buffers: [] as { id: string; type: string; url: string }[],
  channels: [] as { onmessage: ((event: unknown) => void) | null }[],
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
    browserCapabilities: vi.fn(async () => ({ holes: true, snapshots: true })),
    browserCreate: vi.fn(async () => "browser-0"),
    browserSetBounds: vi.fn(async () => null),
    browserNavigate: vi.fn(async () => null),
    browserPerform: vi.fn(async () => null),
    browserFocus: vi.fn(async () => null),
    browserClose: vi.fn(async () => null),
    browserFocusWorkbench: vi.fn(async () => null),
    browserSnapshot: vi.fn(async () => new ArrayBuffer(8)),
  },
}));
vi.mock("@/features/editor/stores/buffer.store", () => {
  const state = {
    get buffers() {
      return harness.buffers;
    },
    actions: {
      updateBrowserBuffer: (id: string, patch: { url?: string }) => {
        harness.buffers = harness.buffers.map((buffer) =>
          buffer.id === id ? { ...buffer, ...patch } : buffer,
        );
      },
    },
  };
  const store = { getState: () => state };
  return { useBufferStore: Object.assign(store, { getStore: () => store }) };
});
vi.mock("../utils/browser-key-bindings", () => ({
  getBrowserKeyBindings: () => [],
  isPageCommand: () => true,
}));

type Box = { left: number; top: number; width: number; height: number };

const opened = new Set<string>();
let coveringElement: Element | null = null;
let nextLabel = 0;

function place(element: Element, rect: Box) {
  element.getBoundingClientRect = () =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) as DOMRect;
  return element;
}

function createSlot(rect: Box = { left: 10, top: 40, width: 600, height: 400 }) {
  const element = place(document.createElement("div"), rect) as HTMLElement;
  document.getElementById("root")?.append(element);
  return { element, onFocus: vi.fn() };
}

function attach(pageId: string, slot = createSlot(), url = "https://athas.dev") {
  opened.add(pageId);
  if (!harness.buffers.some((buffer) => buffer.id === pageId)) {
    harness.buffers.push({ id: pageId, type: "browser", url });
  }
  return { slot, detach: browserTabManager.attach(pageId, null, slot, url) };
}

/** A popup in a portal next to the app root. */
function openPopup(rect: Box) {
  const popup = place(document.createElement("div"), rect) as HTMLElement;
  popup.style.backgroundColor = "rgb(30, 30, 30)";
  document.body.append(popup);
  return popup;
}

function boundsCalls(label: string) {
  return vi.mocked(commands.browserSetBounds).mock.calls.filter((call) => call[0] === label);
}

function lastLayout(label: string) {
  const calls = boundsCalls(label);
  return calls[calls.length - 1]?.slice(1);
}

const flush = async () => {
  for (let turn = 0; turn < 6; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const settle = async () => {
  for (let frame = 0; frame < 6; frame += 1) {
    await nextFrame();
    await flush();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  coveringElement = null;
  nextLabel = 0;
  harness.buffers = [];
  harness.channels = [];
  document.body.innerHTML = '<div id="root"></div>';
  Object.assign(window, { innerWidth: 1200, innerHeight: 800 });
  document.elementFromPoint = (() => coveringElement) as typeof document.elementFromPoint;
  URL.createObjectURL = vi.fn(() => "blob:snapshot");
  URL.revokeObjectURL = vi.fn();
  HTMLImageElement.prototype.decode = () => Promise.resolve();
  vi.mocked(commands.browserCreate).mockImplementation(async () => `browser-${nextLabel++}`);
  useBrowserTabStore.setState({ tabs: {}, focusedBufferId: null });
  // Each test picks the platform it runs on through the capabilities mock.
  Object.assign(browserTabManager, { capabilities: null, capabilitiesRequest: null });
});

afterEach(() => {
  for (const pageId of opened) browserTabManager.close(pageId);
  opened.clear();
});

describe("browser page lifecycle", () => {
  it("creates no webview for a blank page", async () => {
    attach("blank", createSlot(), "about:blank");
    await flush();

    expect(commands.browserCreate).not.toHaveBeenCalled();
  });

  it("creates the webview over the slot the first time the page shows", async () => {
    attach("docs");
    await flush();

    expect(commands.browserCloseWindowTabs).toHaveBeenCalledBefore(
      vi.mocked(commands.browserCreate),
    );
    expect(commands.browserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://athas.dev",
        bounds: { x: 10, y: 40, width: 600, height: 400 },
      }),
      expect.anything(),
    );
  });

  it("hides the page while its place is not shown and keeps it for the next time", async () => {
    const { detach } = attach("app");
    await flush();
    detach();

    expect(lastLayout("browser-0")).toEqual([null, null]);

    browserTabManager.attach(
      "app",
      null,
      createSlot({ left: 300, top: 40, width: 500, height: 400 }),
      "https://athas.dev",
    );

    expect(commands.browserCreate).toHaveBeenCalledTimes(1);
    expect(lastLayout("browser-0")).toEqual([{ x: 300, y: 40, width: 500, height: 400 }, null]);

    browserTabManager.close("app");
    expect(commands.browserClose).toHaveBeenCalledWith("browser-0");
  });

  it("hides a page whose slot sits in a hidden pane layer", async () => {
    const { slot } = attach("layer");
    await flush();

    slot.element.style.visibility = "hidden";
    window.dispatchEvent(new Event("resize"));
    await settle();

    expect(lastLayout("browser-0")).toEqual([null, null]);
  });

  it("waits to create the page while workbench UI covers all of its slot", async () => {
    openPopup({ left: 0, top: 0, width: 1200, height: 800 });
    attach("covered");
    await flush();

    expect(commands.browserCreate).not.toHaveBeenCalled();
  });

  it("closes a page whose tab closed while it was being created", async () => {
    let finishCreate: (label: string) => void = () => {};
    vi.mocked(commands.browserCreate).mockImplementationOnce(
      () => new Promise((resolve) => (finishCreate = resolve)),
    );
    attach("closing");
    await flush();
    browserTabManager.close("closing");
    finishCreate("browser-9");
    await flush();

    expect(commands.browserClose).toHaveBeenCalledWith("browser-9");
  });
});

describe("several browser pages at once", () => {
  it("shows two pages side by side, each over its own slot", async () => {
    attach("left", createSlot({ left: 0, top: 40, width: 500, height: 400 }));
    attach(
      "right",
      createSlot({ left: 520, top: 40, width: 500, height: 400 }),
      "http://localhost:3000",
    );
    await flush();

    expect(commands.browserCreate).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("resize"));
    await settle();

    expect(boundsCalls("browser-0").some((call) => call[1] === null)).toBe(false);
    expect(boundsCalls("browser-1").some((call) => call[1] === null)).toBe(false);
  });

  it("gives a page shown in two panes a webview in each", async () => {
    const left = attach("split", createSlot({ left: 0, top: 40, width: 500, height: 400 }));
    await flush();
    const right = attach("split", createSlot({ left: 520, top: 40, width: 500, height: 400 }));
    await flush();

    expect(commands.browserCreate).toHaveBeenCalledTimes(2);
    expect(commands.browserCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ bounds: { x: 520, y: 40, width: 500, height: 400 } }),
      expect.anything(),
    );

    browserTabManager.navigate("split", "https://athas.dev/docs");
    expect(commands.browserNavigate).toHaveBeenCalledWith("browser-0", "https://athas.dev/docs");
    expect(commands.browserNavigate).toHaveBeenCalledWith("browser-1", "https://athas.dev/docs");

    browserTabManager.perform("split", "back", left.slot.element);
    expect(commands.browserPerform).toHaveBeenLastCalledWith("browser-0", "back");
    browserTabManager.perform("split", "reload", right.slot.element);
    expect(commands.browserPerform).toHaveBeenLastCalledWith("browser-1", "reload");

    right.detach();
    expect(lastLayout("browser-1")).toEqual([null, null]);
    expect(boundsCalls("browser-0").some((call) => call[1] === null)).toBe(false);

    left.detach();
    expect(commands.browserClose).toHaveBeenCalledTimes(1);

    browserTabManager.attach("split", null, createSlot(), "https://athas.dev/docs");
    expect(commands.browserCreate).toHaveBeenCalledTimes(2);
  });

  it("follows the page's address from the view last used", async () => {
    const left = attach("follow", createSlot({ left: 0, top: 40, width: 500, height: 400 }));
    await flush();
    attach("follow", createSlot({ left: 520, top: 40, width: 500, height: 400 }));
    await flush();
    const [leftChannel, rightChannel] = harness.channels;

    leftChannel.onmessage?.({
      event: "urlChanged",
      url: "https://athas.dev/left",
      canGoBack: true,
      canGoForward: false,
    } satisfies BrowserEvent);
    expect(harness.buffers[0].url).toBe("https://athas.dev");

    rightChannel.onmessage?.({
      event: "urlChanged",
      url: "https://athas.dev/right",
      canGoBack: null,
      canGoForward: null,
    } satisfies BrowserEvent);
    expect(harness.buffers[0].url).toBe("https://athas.dev/right");

    browserTabManager.focusPage("follow", left.slot.element);
    expect(commands.browserFocus).toHaveBeenLastCalledWith("browser-0");
    expect(harness.buffers[0].url).toBe("https://athas.dev/left");
    expect(useBrowserTabStore.getState().tabs.follow?.canGoBack).toBe(true);
  });
});

describe("workbench UI over a browser page", () => {
  it("cuts a menu out of the page over a picture of it", async () => {
    const { slot } = attach("menu");
    await flush();

    openPopup({ left: 560, top: 44, width: 46, height: 76 });
    await settle();

    expect(commands.browserSnapshot).toHaveBeenCalledWith("browser-0");
    expect(slot.element.style.backgroundImage).toContain("blob:snapshot");
    expect(lastLayout("browser-0")).toEqual([
      { x: 10, y: 40, width: 600, height: 400 },
      [{ x: 550, y: 4, width: 46, height: 76 }],
    ]);

    document.body.lastElementChild?.remove();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(lastLayout("browser-0")).toEqual([{ x: 10, y: 40, width: 600, height: 400 }, null]);
    expect(slot.element.style.backgroundImage).toBe("");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:snapshot");
  });

  it("cuts a toast out of the page, though toasts render inside the app", async () => {
    attach("toast");
    await flush();
    vi.mocked(commands.browserSnapshot).mockRejectedValueOnce("unsupported");

    const toaster = document.createElement("ol");
    toaster.setAttribute("data-sonner-toaster", "");
    const toast = place(document.createElement("li"), {
      left: 300,
      top: 380,
      width: 300,
      height: 56,
    });
    (toast as HTMLElement).style.backgroundColor = "rgb(30, 30, 30)";
    toaster.append(toast);
    document.getElementById("root")?.append(toaster);
    await settle();

    expect(lastLayout("browser-0")).toEqual([
      { x: 10, y: 40, width: 600, height: 400 },
      [{ x: 290, y: 340, width: 300, height: 56 }],
    ]);
  });

  it("hides the page under a dialog backdrop over all of it", async () => {
    attach("dialog");
    await flush();
    vi.mocked(commands.browserSnapshot).mockRejectedValueOnce("unsupported");

    openPopup({ left: 0, top: 0, width: 1200, height: 800 });
    await settle();

    expect(lastLayout("browser-0")).toEqual([null, null]);
  });

  it("cuts holes without waiting for a picture where pictures are not available", async () => {
    vi.mocked(commands.browserCapabilities).mockResolvedValueOnce({
      holes: true,
      snapshots: false,
    });
    attach("windows");
    await flush();

    openPopup({ left: 560, top: 44, width: 46, height: 76 });
    await settle();

    expect(commands.browserSnapshot).not.toHaveBeenCalled();
    expect(lastLayout("browser-0")?.[1]).toEqual([{ x: 550, y: 4, width: 46, height: 76 }]);
  });

  it("hides the page under any UI where pages can't be cut", async () => {
    vi.mocked(commands.browserCapabilities).mockResolvedValueOnce({
      holes: false,
      snapshots: false,
    });
    attach("linux");
    await flush();

    const popup = openPopup({ left: 560, top: 44, width: 46, height: 76 });
    await settle();
    expect(lastLayout("browser-0")).toEqual([null, null]);

    popup.remove();
    await settle();
    expect(lastLayout("browser-0")).toEqual([{ x: 10, y: 40, width: 600, height: 400 }, null]);
  });

  it("closes workbench popups when a click lands on the visible part of the page", async () => {
    attach("click");
    await flush();
    openPopup({ left: 560, top: 44, width: 46, height: 76 });
    await settle();
    const pointerDowns = vi.fn();
    document.addEventListener("pointerdown", pointerDowns);

    harness.channels[0].onmessage?.({ event: "focused" } satisfies BrowserEvent);

    expect(pointerDowns).toHaveBeenCalledTimes(1);
    document.removeEventListener("pointerdown", pointerDowns);
  });
});
