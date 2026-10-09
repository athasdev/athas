// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferByPath } from "@/features/editor/stores/buffer-index";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import {
  clearInternalTabDragData,
  getInternalTabDragData,
  setInternalTabDragData,
} from "@/features/tabs/services/internal-tab-drag";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { onAppEvent } from "@/utils/app-events";
import type { NativeDragDropPayload } from "@/utils/tauri-drag-drop";
import { useFileSystemFolderDrop } from "../hooks/use-file-system-folder-drop";
import { TERMINAL_FILE_DROP_EVENT } from "../services/file-system-drop-controller";

const native = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    handler: undefined as ((payload: NativeDragDropPayload) => void) | undefined,
    unlisten: vi.fn(),
    listen: undefined as (() => Promise<() => void>) | undefined,
  };
});

vi.mock("@/utils/tauri-drag-drop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/tauri-drag-drop")>()),
  listenToNativeDragDrop: (handler: (payload: NativeDragDropPayload) => void) => {
    native.handler = handler;
    return native.listen ? native.listen() : Promise.resolve(native.unlisten);
  },
}));

enableMapSet();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pointTargets = new Map<number, Element>();
let nextX = 1;
let root: Root | undefined;
let hook: { current: ReturnType<typeof useFileSystemFolderDrop> };
let dropped: string[][];

function place(element: Element) {
  const x = nextX++;
  pointTargets.set(x, element);
  return { x, y: 1 };
}

function element(attributes: Record<string, string>) {
  const node = document.createElement("div");
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  document.body.appendChild(node);
  return node;
}

async function render(
  options: { treatPaneDropAsGlobal?: boolean; onDrop?: (paths: string[]) => unknown } = {},
) {
  hook = { current: undefined as unknown as ReturnType<typeof useFileSystemFolderDrop> };
  const onDrop =
    options.onDrop ??
    ((paths: string[]) => {
      dropped.push(paths);
    });
  function Harness() {
    hook.current = useFileSystemFolderDrop(
      onDrop as (paths: string[]) => void,
      options.treatPaneDropAsGlobal,
    );
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Harness)));
}

async function emitNative(payload: NativeDragDropPayload) {
  await act(async () => {
    native.handler?.(payload);
    await Promise.resolve();
  });
}

function domDrag(type: string, target: Element, types: string[] = ["Files"]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types } });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

let globalArea: { x: number; y: number };
let terminal: HTMLElement;
let editorPane: HTMLElement;
let aiTarget: HTMLElement;

beforeEach(async () => {
  workspaceRuntimeRegistry.resetForTests();
  document.body.innerHTML = "";
  pointTargets.clear();
  nextX = 1;
  dropped = [];
  native.handler = undefined;
  native.listen = undefined;
  native.unlisten.mockReset();
  clearInternalTabDragData();
  globalArea = place(element({}));
  terminal = element({ "data-terminal-drop-target": "" });
  editorPane = element({ "data-pane-container": "", "data-pane-id": ROOT_PANE_ID });
  aiTarget = element({ "data-ai-context-drop-target": "" });
  document.elementFromPoint = (x: number) => pointTargets.get(x) ?? null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  await render();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  clearInternalTabDragData();
  vi.restoreAllMocks();
});

describe("native drops from the operating system", () => {
  it("shows the drop overlay while dragging and hands dropped paths to the workspace", async () => {
    await emitNative({ type: "enter", paths: ["/tmp/project"], position: globalArea });
    expect(hook.current.isDraggingOver).toBe(true);

    await emitNative({ type: "drop", paths: ["/tmp/project", " "], position: globalArea });

    expect(dropped).toEqual([["/tmp/project"]]);
    expect(hook.current.isDraggingOver).toBe(false);
  });

  it("clears the overlay when the drag leaves the window", async () => {
    await emitNative({ type: "enter", paths: ["/tmp/a"], position: globalArea });
    await emitNative({ type: "leave" });

    expect(hook.current.isDraggingOver).toBe(false);
    expect(dropped).toEqual([]);
  });

  it("routes drops over a terminal into that terminal", async () => {
    const received: string[][] = [];
    terminal.addEventListener(TERMINAL_FILE_DROP_EVENT, (event) =>
      received.push((event as CustomEvent<{ paths: string[] }>).detail.paths),
    );

    await emitNative({ type: "drop", paths: ["/tmp/a.txt"], position: place(terminal) });

    expect(received).toEqual([["/tmp/a.txt"]]);
    expect(dropped).toEqual([]);
  });

  it("leaves drops over editor panes and the AI chat to those surfaces", async () => {
    await emitNative({ type: "drop", paths: ["/tmp/a.txt"], position: place(editorPane) });
    await emitNative({ type: "drop", paths: ["/tmp/b.txt"], position: place(aiTarget) });

    expect(dropped).toEqual([]);
    expect(hook.current.isDraggingOver).toBe(false);
  });

  it("treats editor panes as global drop targets when asked to", async () => {
    act(() => root!.unmount());
    await render({ treatPaneDropAsGlobal: true });

    await emitNative({ type: "drop", paths: ["/tmp/a.txt"], position: place(editorPane) });

    expect(dropped).toEqual([["/tmp/a.txt"]]);
  });

  it("logs a failing drop handler instead of throwing", async () => {
    act(() => root!.unmount());
    await render({
      onDrop: async () => {
        throw new Error("cannot open");
      },
    });

    await emitNative({ type: "drop", paths: ["/tmp/a"], position: globalArea });

    expect(console.error).toHaveBeenCalledWith("Error handling dropped items:", expect.any(Error));
    expect(hook.current.isDraggingOver).toBe(false);
  });

  it("stops listening on unmount, including when the listener registers late", async () => {
    act(() => root!.unmount());
    root = undefined;
    expect(native.unlisten).toHaveBeenCalledTimes(1);

    let finishListening: (unlisten: () => void) => void = () => undefined;
    native.listen = () => new Promise((resolve) => (finishListening = resolve));
    await render();
    act(() => root!.unmount());
    root = undefined;
    const lateUnlisten = vi.fn();
    await act(async () => finishListening(lateUnlisten));

    expect(lateUnlisten).toHaveBeenCalledTimes(1);
  });

  it("reports when native drop events cannot be subscribed", async () => {
    act(() => root!.unmount());
    native.listen = () => Promise.reject(new Error("no webview"));
    await render();
    await act(async () => {
      await Promise.resolve();
    });

    expect(console.error).toHaveBeenCalledWith(
      "Failed to listen for native file drops:",
      expect.any(Error),
    );
  });
});

describe("internal tab drags ending in a native drop", () => {
  it("moves a dragged tab into the pane it is dropped on", async () => {
    const bufferId = useBufferStore.getState().actions.openContent({
      type: "editor",
      path: "/repo/a.ts",
      name: "a.ts",
      content: "a",
    });
    const splitPaneId = usePaneStore.getState().actions.splitPane(ROOT_PANE_ID, "horizontal")!;
    const target = element({ "data-pane-id": splitPaneId });
    setInternalTabDragData({ source: "pane", bufferId, paneId: ROOT_PANE_ID });

    await emitNative({ type: "drop", paths: [], position: place(target) });

    const splitPane = usePaneStore.getState().actions.getPaneById(splitPaneId);
    expect(splitPane?.bufferIds).toContain(bufferId);
    expect(splitPane?.activeBufferId).toBe(bufferId);
    expect(getInternalTabDragData()).toBeNull();
    expect(dropped).toEqual([]);
  });

  it("detaches a terminal panel tab into a buffer in the bottom pane", async () => {
    const detached: string[] = [];
    const stop = onAppEvent("terminal:detach-to-buffer", ({ terminalId }) =>
      detached.push(terminalId),
    );
    setInternalTabDragData({
      source: "terminal-panel",
      terminalId: "term-1",
      name: "zsh",
      currentDirectory: "/repo",
    });

    await emitNative({
      type: "drop",
      paths: [],
      position: place(element({ "data-bottom-pane-drop-target": "" })),
    });
    stop();

    const buffer = useBufferStore.getState().buffers.find((item) => item.type === "terminal");
    expect(buffer).toBeDefined();
    expect(usePaneStore.getState().actions.getPaneById(BOTTOM_PANE_ID)?.bufferIds).toContain(
      buffer!.id,
    );
    expect(detached).toEqual(["term-1"]);
    expect(useUIState.getState().isBottomPaneVisible).toBe(true);
    expect(useUIState.getState().bottomPaneActiveTab).toBe("buffers");
  });

  it("ignores tab drops outside panes and drops onto the tab's own pane", async () => {
    const bufferId = useBufferStore.getState().actions.openContent({
      type: "editor",
      path: "/repo/b.ts",
      name: "b.ts",
      content: "b",
    });
    setInternalTabDragData({ source: "pane", bufferId, paneId: ROOT_PANE_ID });

    await emitNative({ type: "enter", paths: [], position: globalArea });
    await emitNative({ type: "drop", paths: [], position: globalArea });
    await emitNative({ type: "drop", paths: [], position: place(editorPane) });
    await emitNative({ type: "leave" });

    expect(getBufferByPath(useBufferStore.getState().buffers, "/repo/b.ts")?.id).toBe(bufferId);
    expect(usePaneStore.getState().actions.getPaneById(ROOT_PANE_ID)?.bufferIds).toContain(
      bufferId,
    );
    expect(getInternalTabDragData()).not.toBeNull();
    expect(hook.current.isDraggingOver).toBe(false);
  });
});

describe("browser drag events", () => {
  it("accepts external file drags over global areas", () => {
    const enter = domDrag("dragenter", pointTargets.get(globalArea.x)!);
    expect(enter.defaultPrevented).toBe(true);
    expect(hook.current.isDraggingOver).toBe(true);

    expect(domDrag("dragover", pointTargets.get(globalArea.x)!).defaultPrevented).toBe(true);

    const drop = domDrag("drop", pointTargets.get(globalArea.x)!);
    expect(drop.defaultPrevented).toBe(true);
    expect(hook.current.isDraggingOver).toBe(false);
  });

  it("does not claim drags over local drop surfaces", () => {
    domDrag("dragenter", pointTargets.get(globalArea.x)!);

    expect(domDrag("dragover", aiTarget).defaultPrevented).toBe(false);
    expect(hook.current.isDraggingOver).toBe(false);

    domDrag("dragenter", pointTargets.get(globalArea.x)!);
    expect(domDrag("dragenter", editorPane).defaultPrevented).toBe(false);
    expect(hook.current.isDraggingOver).toBe(false);

    domDrag("dragenter", pointTargets.get(globalArea.x)!);
    expect(domDrag("drop", aiTarget).defaultPrevented).toBe(false);
    expect(hook.current.isDraggingOver).toBe(false);
  });

  it("ignores drags that carry no files", () => {
    const enter = domDrag("dragenter", pointTargets.get(globalArea.x)!, ["text/plain"]);

    expect(enter.defaultPrevented).toBe(false);
    expect(hook.current.isDraggingOver).toBe(false);
    expect(domDrag("dragover", aiTarget, []).defaultPrevented).toBe(false);
    expect(domDrag("drop", aiTarget, []).defaultPrevented).toBe(false);
    expect(domDrag("dragleave", aiTarget, []).defaultPrevented).toBe(false);
  });

  it("clears the overlay when an external drag leaves", () => {
    domDrag("dragenter", pointTargets.get(globalArea.x)!);

    expect(domDrag("dragleave", pointTargets.get(globalArea.x)!).defaultPrevented).toBe(true);
    expect(hook.current.isDraggingOver).toBe(false);
  });

  it("stays out of the way while a tab is being dragged", () => {
    setInternalTabDragData({ source: "pane", bufferId: "x", paneId: ROOT_PANE_ID });
    const target = pointTargets.get(globalArea.x)!;

    expect(domDrag("dragenter", target).defaultPrevented).toBe(false);
    expect(domDrag("dragover", target).defaultPrevented).toBe(false);
    expect(hook.current.isDraggingOver).toBe(false);
    expect(domDrag("drop", target).defaultPrevented).toBe(false);
    expect(domDrag("dragleave", target).defaultPrevented).toBe(false);
  });
});
