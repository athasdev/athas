// @vitest-environment jsdom
import { act, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MainPaneTabBar } from "../components/main-pane-tab-bar";
import { MainTabBarHostContext } from "../contexts/main-tab-bar-host";

vi.mock("@/features/tabs/components/tab-bar", () => ({
  default: ({ paneId, inTitleBar }: { paneId: string; inTitleBar: boolean }) => (
    <div data-test-pane-tab-bar={paneId} data-test-title-surface={inTitleBar} />
  ),
}));

const resizeCallbacks: ResizeObserverCallback[] = [];
class TestResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }
  observe() {}
  disconnect() {}
}

function rect(left: number, top: number, width: number): DOMRect {
  return { left, top, width, right: left + width } as DOMRect;
}

let root: Root;
let header: HTMLDivElement;
let content: HTMLDivElement;
let pane: HTMLDivElement;
let paneRect: DOMRect;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  resizeCallbacks.length = 0;
  header = document.createElement("div");
  content = document.createElement("div");
  pane = document.createElement("div");
  content.append(pane);
  document.body.append(header, content);
  paneRect = rect(300, 34, 400);
  vi.spyOn(header, "getBoundingClientRect").mockImplementation(() => rect(100, 0, 900));
  vi.spyOn(content, "getBoundingClientRect").mockImplementation(() => rect(300, 34, 700));
  vi.spyOn(pane, "getBoundingClientRect").mockImplementation(() => paneRect);
  root = createRoot(pane);
});

afterEach(async () => {
  await act(async () => root.unmount());
  header.remove();
  content.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("main pane tab bar", () => {
  it("puts each top pane in the separate title row at its measured width", async () => {
    await act(async () => {
      root.render(
        <MainTabBarHostContext.Provider value={{ header, content }}>
          <MainPaneTabBar
            paneId="editor"
            onTabClick={() => {}}
            containerRef={{ current: pane } as RefObject<HTMLDivElement>}
            active
            disablePaneActions={false}
          />
        </MainTabBarHostContext.Provider>,
      );
    });

    const slot = header.querySelector<HTMLElement>('[data-slot="title-pane-tabs"]');
    expect(slot?.style.left).toBe("0px");
    expect(slot?.style.width).toBe("600px");
    expect(slot?.querySelector('[data-test-pane-tab-bar="editor"]')).not.toBeNull();
    expect(slot?.querySelector('[data-test-title-surface="true"]')).not.toBeNull();
    expect(pane.querySelector("[data-test-pane-tab-bar]")).toBeNull();

    paneRect = rect(360, 34, 340);
    await act(async () =>
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)),
    );
    expect(slot?.style.left).toBe("260px");
    expect(slot?.style.width).toBe("340px");

    paneRect = rect(300, 220, 400);
    await act(async () =>
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)),
    );
    expect(header.querySelector('[data-slot="title-pane-tabs"]')).toBeNull();
    expect(pane.querySelector('[data-test-pane-tab-bar="editor"]')).not.toBeNull();
    expect(pane.querySelector('[data-test-title-surface="false"]')).not.toBeNull();
  });
});
