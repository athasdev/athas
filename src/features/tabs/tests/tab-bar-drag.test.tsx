// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { findPaneGroup, getAllPaneGroups } from "@/features/panes/services/pane-tree";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string) => Promise.resolve(cmd.includes("get_all") ? [] : null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const { default: TabBar } = await import("../components/tab-bar");

enableMapSet();

const TAB_WIDTH = 100;
const BAR_HEIGHT = 30;

let root: Root;
let container: HTMLDivElement;
let hitTarget: HTMLElement | null;

function rect(left: number, top: number, width: number, height: number) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {},
  } as DOMRect;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(paneId: string = ROOT_PANE_ID) {
  await act(async () => root.render(<TabBar paneId={paneId} />));
  await flush();
}

function open(path: string) {
  return useBufferStore.getState().actions.openBuffer(path, path.split("/").pop()!, "");
}

const tabLabels = () =>
  within(container)
    .getAllByRole("tab")
    .map((tab) => tab.getAttribute("aria-label"));
const handle = (name: string) =>
  [...container.querySelectorAll<HTMLElement>("[data-sortable-id]")].find((element) =>
    element.querySelector(`[role="tab"][aria-label^="${name}"]`),
  )!;
const group = (id: string) =>
  getAllPaneGroups(usePaneStore.getState().root).find((g) => g.id === id);

async function drag(name: string, to: { x: number; y: number }, steps = 3) {
  const source = handle(name);
  const start = source.getBoundingClientRect();
  const from = { x: start.left + TAB_WIDTH / 2, y: BAR_HEIGHT / 2 };
  await act(async () => {
    fireEvent.pointerDown(source, {
      isPrimary: true,
      button: 0,
      clientX: from.x,
      clientY: from.y,
    });
  });
  for (let step = 1; step <= steps; step++) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const y = from.y + ((to.y - from.y) * step) / steps;
    await act(async () => {
      fireEvent.pointerMove(document, { isPrimary: true, clientX: x, clientY: y });
    });
  }
  await act(async () => {
    fireEvent.pointerUp(document, { isPrimary: true, button: 0, clientX: to.x, clientY: to.y });
  });
  await flush();
}

function paneTarget(paneId: string) {
  const element = document.createElement("div");
  element.dataset.paneId = paneId;
  document.body.append(element);
  return element;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useProjectStore.setState({ rootFolderPath: "/repo" });
  hitTarget = null;
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset.tabBarPaneId !== undefined) return rect(0, 0, 1000, BAR_HEIGHT);
    if (this.dataset.paneId) return rect(0, 0, 1000, 1000);
    if (this.dataset.sortableId) {
      const siblings = [...(this.parentElement?.querySelectorAll("[data-sortable-id]") ?? [])];
      return rect(siblings.indexOf(this) * TAB_WIDTH, 0, TAB_WIDTH, BAR_HEIGHT);
    }
    return rect(0, 0, 0, 0);
  });
  document.elementsFromPoint = () => (hitTarget ? [hitTarget] : []);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  useSettingsStore.setState((state) => ({
    settings: { ...state.settings, horizontalTabScroll: false },
  }));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("editor tab dragging", () => {
  it("reorders tabs by dragging along the tab row", async () => {
    open("/repo/a.ts");
    open("/repo/b.ts");
    open("/repo/c.ts");
    await render();
    await drag("a.ts", { x: 250, y: BAR_HEIGHT / 2 });
    expect(tabLabels()).toEqual(["b.ts", "c.ts", "a.ts"]);

    await drag("a.ts", { x: 20, y: BAR_HEIGHT / 2 });
    expect(tabLabels()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("moves a tab into another pane when dropped over it", async () => {
    const first = open("/repo/a.ts");
    const second = open("/repo/b.ts");
    const other = usePaneStore.getState().actions.splitPane(ROOT_PANE_ID, "horizontal", first)!;
    usePaneStore.getState().actions.setActivePane(ROOT_PANE_ID);
    await render();
    hitTarget = paneTarget(other);
    await drag("b.ts", { x: 500, y: 500 });
    expect(group(other)?.bufferIds).toContain(second);
    expect(group(other)?.activeBufferId).toBe(second);
    expect(group(ROOT_PANE_ID)?.bufferIds ?? []).not.toContain(second);
    expect(window.__athasInternalTabDragData).toBeUndefined();
  });

  it("splits its own pane when dropped on one of its edges", async () => {
    open("/repo/a.ts");
    const second = open("/repo/b.ts");
    await render();
    hitTarget = paneTarget(ROOT_PANE_ID);
    await drag("b.ts", { x: 990, y: 500 });
    const groups = getAllPaneGroups(usePaneStore.getState().root);
    expect(groups).toHaveLength(2);
    expect(groups.find((candidate) => candidate.id !== ROOT_PANE_ID)?.bufferIds).toEqual([second]);
  });

  it("sends a tab to the bottom pane and shows it there", async () => {
    open("/repo/a.ts");
    const second = open("/repo/b.ts");
    await render();
    hitTarget = document.createElement("div");
    hitTarget.setAttribute("data-bottom-pane-drop-target", "");
    document.body.append(hitTarget);
    await drag("b.ts", { x: 500, y: 800 });
    expect(findPaneGroup(usePaneStore.getState().bottomRoot, BOTTOM_PANE_ID)?.bufferIds).toEqual([
      second,
    ]);
    expect(useUIState.getState().bottomPaneActiveTab).toBe("buffers");
    expect(useUIState.getState().isBottomPaneVisible).toBe(true);
  });

  it("leaves tabs alone when dropped outside any pane", async () => {
    open("/repo/a.ts");
    open("/repo/b.ts");
    await render();
    await drag("b.ts", { x: 500, y: 500 });
    expect(tabLabels()).toEqual(["a.ts", "b.ts"]);
    expect(getAllPaneGroups(usePaneStore.getState().root)).toHaveLength(1);
  });

  it("scrolls an overflowing tab row with the mouse wheel when enabled", async () => {
    open("/repo/a.ts");
    open("/repo/b.ts");
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, horizontalTabScroll: true },
    }));
    await render();
    const strip = container.querySelector<HTMLElement>('[data-slot="tab-strip"]')!;
    Object.defineProperty(strip, "scrollWidth", { value: 800, configurable: true });
    Object.defineProperty(strip, "clientWidth", { value: 300, configurable: true });
    const bar = container.querySelector<HTMLElement>("[data-tab-bar-pane-id]")!;
    await act(async () => {
      fireEvent.wheel(bar, { deltaY: 120 });
    });
    expect(strip.scrollLeft).toBe(120);
    await act(async () => {
      fireEvent.wheel(bar, { deltaX: 1000 });
    });
    expect(strip.scrollLeft).toBe(500);
    await act(async () => {
      fireEvent.wheel(bar, { deltaY: -50, ctrlKey: true });
    });
    expect(strip.scrollLeft).toBe(500);
    await act(async () => {
      fireEvent.wheel(bar, { deltaY: -50, shiftKey: true });
    });
    expect(strip.scrollLeft).toBe(450);
  });
});
