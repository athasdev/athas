// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { browserTabManager } from "../services/browser-tab-manager";

const buffers = vi.hoisted(() => [] as { id: string; type: string; url: string }[]);

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
}));
vi.mock("@/bindings/commands", () => ({
  commands: {
    browserCloseWindowTabs: vi.fn(async () => null),
    browserCreate: vi.fn(async () => "browser-0"),
    browserSetBounds: vi.fn(async () => null),
    browserNavigate: vi.fn(async () => null),
    browserClose: vi.fn(async () => null),
    browserFocusWorkbench: vi.fn(async () => null),
  },
}));
vi.mock("@/features/editor/stores/buffer.store", () => {
  const state = { buffers, actions: { updateBrowserBuffer: vi.fn() } };
  const store = { getState: () => state };
  return { useBufferStore: Object.assign(store, { getStore: () => store }) };
});
vi.mock("../utils/browser-key-bindings", () => ({
  getBrowserKeyBindings: () => [],
  isPageCommand: () => true,
}));

let coveringElement: Element | null = null;

function createSlot(rect = { left: 10, top: 40, width: 600, height: 400 }) {
  const element = document.createElement("div");
  document.body.append(element);
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }) as DOMRect;
  return { element, onFocus: vi.fn() };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("browser tab manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coveringElement = null;
    buffers.length = 0;
    document.body.innerHTML = "";
    Object.assign(window, { innerWidth: 1200, innerHeight: 800 });
    document.elementFromPoint = (() => coveringElement) as typeof document.elementFromPoint;
  });

  it("creates no webview for a blank tab", async () => {
    const detach = browserTabManager.attach("blank", null, createSlot(), "about:blank");
    await flush();

    expect(commands.browserCreate).not.toHaveBeenCalled();
    detach();
    browserTabManager.close("blank");
  });

  it("creates the webview over the slot the first time the tab shows", async () => {
    const detach = browserTabManager.attach("docs", null, createSlot(), "https://athas.dev");
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
    detach();
    browserTabManager.close("docs");
  });

  it("hides the page while its tab is not shown and keeps it for the next time", async () => {
    vi.mocked(commands.browserCreate).mockResolvedValueOnce("browser-7");
    const detach = browserTabManager.attach("app", null, createSlot(), "http://localhost:5173");
    await flush();
    detach();

    expect(commands.browserSetBounds).toHaveBeenLastCalledWith("browser-7", null);

    const detachAgain = browserTabManager.attach(
      "app",
      null,
      createSlot({ left: 300, top: 40, width: 500, height: 400 }),
      "http://localhost:5173",
    );

    expect(commands.browserCreate).toHaveBeenCalledTimes(1);
    expect(commands.browserSetBounds).toHaveBeenLastCalledWith("browser-7", {
      x: 300,
      y: 40,
      width: 500,
      height: 400,
    });
    detachAgain();
    browserTabManager.close("app");
    expect(commands.browserClose).toHaveBeenCalledWith("browser-7");
  });

  it("waits to create the page while workbench UI covers its slot", async () => {
    coveringElement = document.createElement("div");
    const detach = browserTabManager.attach("covered", null, createSlot(), "https://athas.dev");
    await flush();

    expect(commands.browserCreate).not.toHaveBeenCalled();
    detach();
    browserTabManager.close("covered");
  });

  it("closes a page whose tab closed while it was being created", async () => {
    let finishCreate: (label: string) => void = () => {};
    vi.mocked(commands.browserCreate).mockImplementationOnce(
      () => new Promise((resolve) => (finishCreate = resolve)),
    );
    browserTabManager.attach("closing", null, createSlot(), "https://athas.dev");
    await flush();
    browserTabManager.close("closing");
    finishCreate("browser-9");
    await flush();

    expect(commands.browserClose).toHaveBeenCalledWith("browser-9");
  });
});
