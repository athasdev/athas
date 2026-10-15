// @vitest-environment jsdom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue(null),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { IS_MAC } from "@/utils/platform";
import { ROOT_PANE_ID } from "../constants/pane";
import { usePaneKeyboard } from "../hooks/use-pane-keyboard";
import { useResizeObserver } from "../hooks/use-resize-observer";
import {
  activateBufferInPaneAndSync,
  activatePaneAndSyncBuffer,
} from "../services/pane-activation";
import { getAllPaneGroups } from "../services/pane-tree";
import {
  getPaneView,
  isResourceBuffer,
  prefetchPaneViews,
  registerPaneView,
  releaseClosedPaneView,
  reloadPaneView,
  renderPaneView,
} from "../services/pane-view-registry";
import { usePaneStore } from "../stores/pane.store";
import type { PaneContent } from "../types/pane-content.types";
import { seedPaneTabs } from "./helpers/seed-pane-tabs";

let root: Root;

function mount(useHook: () => void) {
  function Probe() {
    useHook();
    return null;
  }
  act(() => root.render(createElement(Probe)));
}

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
    metaKey: IS_MAC,
    ctrlKey: !IS_MAC,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

const groups = () => getAllPaneGroups(usePaneStore.getState().root);
const activePaneId = () => usePaneStore.getState().activePaneId;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  workspaceRuntimeRegistry.resetForTests();
  vi.unstubAllGlobals();
});

describe("pane keyboard shortcuts", () => {
  beforeEach(() => {
    useBufferStore.setState({
      buffers: [
        {
          id: "file-a",
          type: "editor",
          path: "/ws/a.ts",
          name: "a.ts",
          content: "a",
          savedContent: "a",
          isDirty: false,
          isVirtual: false,
          language: "typescript",
        },
      ],
    });
    seedPaneTabs(["file-a"], "file-a");
    mount(usePaneKeyboard);
  });

  it("splits the active editor group right and down", () => {
    const right = press({ key: "\\" });
    expect(right.defaultPrevented).toBe(true);
    expect(groups()).toHaveLength(2);

    press({ key: "\\", shiftKey: true });
    expect(groups()).toHaveLength(3);
    expect(groups().every((group) => group.bufferIds.includes("file-a"))).toBe(true);
  });

  it("moves focus between panes with the arrow chord and syncs the active buffer", () => {
    press({ key: "\\" });
    const [left, right] = groups();
    expect(activePaneId()).toBe(right.id);

    press({ key: "ArrowLeft", altKey: true });
    expect(activePaneId()).toBe(left.id);
    expect(useBufferStore.getState().actions.getActiveBuffer()?.id).toBe("file-a");

    press({ key: "ArrowRight", altKey: true });
    expect(activePaneId()).toBe(right.id);
  });

  it("ignores keys without the platform modifier", () => {
    const event = new KeyboardEvent("keydown", { key: "\\", cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    press({ key: "x" });
    expect(event.defaultPrevented).toBe(false);
    expect(groups()).toHaveLength(1);
  });
});

describe("pane activation", () => {
  it("focuses an empty pane without changing buffers", () => {
    usePaneStore.getState().actions.splitPane(ROOT_PANE_ID, "horizontal");
    const [, empty] = groups();
    usePaneStore.getState().actions.setActivePane(ROOT_PANE_ID);

    activatePaneAndSyncBuffer(empty.id);

    expect(activePaneId()).toBe(empty.id);
  });

  it("shows a buffer in the requested pane", () => {
    useBufferStore.setState({
      buffers: [
        {
          id: "b",
          type: "browser",
          path: "browser://b",
          name: "b",
          url: "https://a.dev",
        } as PaneContent,
      ],
    });
    activateBufferInPaneAndSync(ROOT_PANE_ID, "b");
    expect(usePaneStore.getState().actions.getPaneById(ROOT_PANE_ID)?.activeBufferId).toBe("b");
  });
});

describe("useResizeObserver", () => {
  it("reports the element's size and stops observing on unmount", () => {
    let callback: ResizeObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(next: ResizeObserverCallback) {
          callback = next;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const element = document.createElement("div");
    const result = { current: { width: -1, height: -1 } };
    function Probe() {
      const ref = useRef<HTMLElement | null>(element);
      result.current = useResizeObserver(ref);
      return null;
    }
    act(() => root.render(createElement(Probe)));
    expect(result.current).toEqual({ width: 0, height: 0 });

    const resize = (width: number, height: number) =>
      act(() =>
        callback([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver),
      );
    resize(320, 200);
    expect(result.current).toEqual({ width: 320, height: 200 });

    const measured = result.current;
    resize(320, 200);
    act(() => callback([], {} as ResizeObserver));
    expect(result.current).toBe(measured);

    act(() => root.unmount());
    root = createRoot(document.createElement("div"));
    expect(disconnect).toHaveBeenCalled();
  });
});

describe("pane view registry", () => {
  const ViewComponent = (props: { label: string }) => createElement("span", null, props.label);

  it("renders registered views with props from the buffer and host", () => {
    registerPaneView("references", {
      component: ViewComponent,
      getProps: (buffer, host) => ({ label: `${buffer.name}@${host.paneId}` }),
      keyByBuffer: true,
    });

    const buffer = {
      id: "refs",
      type: "references",
      path: "references://",
      name: "Refs",
    } as PaneContent;
    const element = renderPaneView(buffer, { paneId: "p1" });

    expect(element?.props).toEqual({ label: "Refs@p1" });
    expect(element?.key).toBe("refs");
    expect(getPaneView("references")).toBeDefined();
    expect(renderPaneView({ ...buffer, type: "workspaces" } as PaneContent, {})).toBeNull();
  });

  it("runs close, reload and prefetch hooks and marks resource views", () => {
    const onClose = vi.fn();
    const reload = vi.fn();
    const prefetch = vi.fn().mockResolvedValue(undefined);
    registerPaneView("pdf", {
      component: ViewComponent,
      getProps: () => ({ label: "pdf" }),
      onClose,
      reload,
      prefetch,
      resource: { icon: () => null },
    });
    const pdf = { id: "p", type: "pdf", path: "/ws/a.pdf", name: "a.pdf" } as PaneContent;
    const binary = { id: "b", type: "binary", path: "/ws/a.bin", name: "a.bin" } as PaneContent;

    releaseClosedPaneView(pdf);
    releaseClosedPaneView(binary);
    expect(onClose).toHaveBeenCalledWith(pdf);

    expect(reloadPaneView(pdf)).toBe(true);
    expect(reload).toHaveBeenCalledWith(pdf);
    expect(reloadPaneView(binary)).toBe(false);

    expect(isResourceBuffer(pdf)).toBe(true);
    expect(isResourceBuffer(binary)).toBe(false);

    prefetchPaneViews();
    expect(prefetch).toHaveBeenCalledTimes(1);
  });
});
