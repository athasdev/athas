// @vitest-environment jsdom
import { act, createElement } from "react";
import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { getInternalTabDragHover } from "@/features/tabs/services/internal-tab-drag";
import { onAppEvent } from "@/utils/app-events";
import { useFileExplorerDragDrop } from "../hooks/use-file-explorer-drag-drop";

const native = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return { invoke: vi.fn(), isMac: false };
});

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: native.invoke,
}));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  get IS_MAC() {
    return native.isMac;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HookResult = ReturnType<typeof useFileExplorerDragDrop>;

interface HarnessOptions {
  rootFolderPath?: string;
  onFileMove?: (oldPath: string, newPath: string) => void | Promise<void>;
}

const pointTargets = new Map<number, Element>();
let nextX = 1;
let root: Root;
let hook: { current: HookResult };
let moves: Array<[string, string]>;
let expanded: string[];
let moveErrors: string[];

function place(element: Element) {
  const x = nextX++;
  pointTargets.set(x, element);
  return { clientX: x, clientY: 5 };
}

function buildTree() {
  document.body.innerHTML = "";
  const tree = document.createElement("div");
  tree.className = "file-tree-container";
  const row = (path: string, isDir: boolean) => {
    const element = document.createElement("div");
    element.setAttribute("data-file-path", path);
    element.setAttribute("data-is-dir", String(isDir));
    const label = document.createElement("span");
    element.appendChild(label);
    tree.appendChild(element);
    return label;
  };
  const pane = document.createElement("div");
  pane.setAttribute("data-pane-container", "");
  pane.setAttribute("data-pane-id", "pane-1");
  const ai = document.createElement("div");
  ai.setAttribute("data-ai-context-drop-target", "");
  const outside = document.createElement("div");
  document.body.append(tree, pane, ai, outside);

  return {
    src: place(row("/repo/src", true)),
    nested: place(row("/repo/src/nested", true)),
    readme: place(row("/repo/README.md", false)),
    deepFile: place(row("/repo/src/nested/util.ts", false)),
    treeBackground: place(tree),
    pane: place(pane),
    ai: place(ai),
    outside: place(outside),
  };
}

async function render(options: HarnessOptions = {}) {
  const props = {
    rootFolderPath: "rootFolderPath" in options ? options.rootFolderPath : "/repo",
    onFileMove:
      "onFileMove" in options
        ? options.onFileMove
        : (oldPath: string, newPath: string) => {
            moves.push([oldPath, newPath]);
          },
  };
  hook = { current: undefined as unknown as HookResult };
  function Harness() {
    hook.current = useFileExplorerDragDrop(
      props.rootFolderPath,
      props.onFileMove,
      (path) => expanded.push(path),
      (message) => moveErrors.push(message),
    );
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
}

function mouseEvent(point: { clientX: number; clientY: number }, altKey = false) {
  return {
    ...point,
    altKey,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent;
}

const file = (path: string, isDir = false): FileEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  isDir,
});

async function startDrag(entry: FileEntry, at = { clientX: 0, clientY: 0 }, altKey = false) {
  await act(async () => hook.current.startDrag(mouseEvent(at, altKey), entry));
}

async function moveTo(point: { clientX: number; clientY: number }) {
  await act(async () => {
    document.dispatchEvent(new MouseEvent("mousemove", point));
  });
}

async function dropAt(point: { clientX: number; clientY: number }) {
  await act(async () => {
    document.dispatchEvent(new MouseEvent("mouseup", point));
    await Promise.resolve();
  });
}

let targets: ReturnType<typeof buildTree>;

beforeEach(async () => {
  moves = [];
  expanded = [];
  moveErrors = [];
  pointTargets.clear();
  nextX = 1;
  native.isMac = false;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  native.invoke.mockReset().mockResolvedValue(undefined);
  targets = buildTree();
  document.elementFromPoint = (x: number) => pointTargets.get(x) ?? null;
  document.elementsFromPoint = (x: number) => {
    const element = pointTargets.get(x);
    return element ? [element] : [];
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  await render();
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("file explorer drag and drop", () => {
  it("moves a file into the folder it is dropped on", async () => {
    await startDrag(file("/repo/README.md"));
    expect(hook.current.dragState.isDragging).toBe(true);
    expect(window.__fileDragData).toEqual({
      path: "/repo/README.md",
      name: "README.md",
      isDir: false,
    });

    await moveTo(targets.src);
    expect(hook.current.dragState).toMatchObject({
      dragOverPath: "/repo/src",
      dragOverIsDir: true,
    });
    await dropAt(targets.src);

    expect(moves).toEqual([["/repo/README.md", "/repo/src/README.md"]]);
    expect(hook.current.dragState.isDragging).toBe(false);
    expect(window.__fileDragData).toBeUndefined();
  });

  it("follows the pointer with a preview that is removed when the drag ends", async () => {
    await startDrag(file("/repo/README.md"), { clientX: 40, clientY: 60 });
    const preview = [...document.body.children].find(
      (element) => element.textContent === "README.md" && !element.hasAttribute("data-file-path"),
    ) as HTMLElement;
    expect(preview.style.left).toBe("50px");
    expect(preview.style.top).toBe("50px");

    await moveTo(targets.outside);
    expect(preview.style.left).toBe(`${targets.outside.clientX + 10}px`);

    await dropAt(targets.outside);
    expect(preview.isConnected).toBe(false);
    expect(moves).toEqual([]);
  });

  it("drops onto a file by moving into that file's folder", async () => {
    await startDrag(file("/repo/src/nested/util.ts"));
    await moveTo(targets.readme);
    await dropAt(targets.readme);

    expect(moves).toEqual([["/repo/src/nested/util.ts", "/repo/util.ts"]]);
  });

  it("moves to the workspace root when dropped on empty tree space", async () => {
    await startDrag(file("/repo/src/nested", true));
    await moveTo(targets.treeBackground);
    expect(hook.current.dragState.dragOverPath).toBe("__ROOT__");
    await dropAt(targets.treeBackground);

    expect(moves).toEqual([["/repo/src/nested", "/repo/nested"]]);
  });

  it("refuses to drop a folder into itself or one of its descendants", async () => {
    await startDrag(file("/repo/src", true));
    await moveTo(targets.nested);
    expect(hook.current.dragState.dragOverPath).toBeNull();
    await moveTo(targets.src);
    expect(hook.current.dragState.dragOverPath).toBeNull();
    await dropAt(targets.nested);

    expect(moves).toEqual([]);
  });

  it("does not move to the root when no workspace folder is open", async () => {
    act(() => root.unmount());
    await render({ rootFolderPath: undefined });

    await startDrag(file("/repo/README.md"));
    await moveTo(targets.treeBackground);
    await dropAt(targets.treeBackground);

    expect(moves).toEqual([]);
    expect(hook.current.dragState.isDragging).toBe(false);
  });

  it("expands a folder after hovering it and cancels when the pointer leaves", async () => {
    vi.useFakeTimers();
    await startDrag(file("/repo/README.md"));

    await moveTo(targets.src);
    await act(async () => vi.advanceTimersByTime(300));
    await moveTo(targets.outside);
    await act(async () => vi.advanceTimersByTime(600));
    expect(expanded).toEqual([]);

    await moveTo(targets.nested);
    await moveTo(targets.nested);
    await act(async () => vi.advanceTimersByTime(600));
    expect(expanded).toEqual(["/repo/src/nested"]);

    await moveTo(targets.readme);
    await act(async () => vi.advanceTimersByTime(600));
    expect(expanded).toEqual(["/repo/src/nested"]);
  });

  it("hands a file dropped on an editor pane to the pane", async () => {
    const drops: unknown[] = [];
    const stop = onAppEvent("file-tree:drop-on-pane", (detail) => drops.push(detail));

    await startDrag(file("/repo/README.md"));
    await moveTo(targets.pane);
    expect(getInternalTabDragHover().paneId).toBe("pane-1");
    await dropAt(targets.pane);
    stop();

    expect(getInternalTabDragHover().paneId).toBeNull();

    expect(drops).toEqual([
      { path: "/repo/README.md", name: "README.md", isDir: false, x: targets.pane.clientX, y: 5 },
    ]);
    expect(moves).toEqual([]);
  });

  it("adds the dragged entry as AI context when dropped on the chat", async () => {
    const resources: unknown[] = [];
    const stop = onAppEvent("sidebar:resource-drop-on-ai", ({ resource }) =>
      resources.push(resource),
    );

    await startDrag(file("/repo/src", true));
    await moveTo(targets.ai);
    await dropAt(targets.ai);
    stop();

    expect(resources).toEqual([{ type: "file", path: "/repo/src", name: "src", isDir: true }]);
    expect(moves).toEqual([]);
  });

  it("reports move failures with the entry name", async () => {
    act(() => root.unmount());
    await render({
      onFileMove: async () => {
        throw new Error("disk full");
      },
    });

    await startDrag(file("/repo/README.md"));
    await moveTo(targets.src);
    await dropAt(targets.src);

    expect(moveErrors).toEqual(["Failed to move README.md: disk full"]);
  });

  it("reports a drop when no move handler is available", async () => {
    act(() => root.unmount());
    await render({ onFileMove: undefined });

    await startDrag(file("/repo/README.md"));
    await moveTo(targets.src);
    await dropAt(targets.src);

    expect(moveErrors).toEqual(["Failed to move README.md: File move handler is unavailable."]);
  });

  it("starts a native drag on macOS when Option is held", async () => {
    native.isMac = true;

    await startDrag(file("/repo/README.md"), { clientX: 0, clientY: 0 }, true);

    expect(hook.current.dragState.isDragging).toBe(false);
    expect(native.invoke).toHaveBeenCalledWith(
      "plugin:drag|start_drag",
      expect.objectContaining({
        item: ["/repo/README.md"],
        options: { mode: "copy" },
        image: expect.stringMatching(/^data:image\/png;base64,/),
      }),
    );
  });

  it("logs native drag failures without starting an internal drag", async () => {
    native.isMac = true;
    native.invoke.mockRejectedValue(new Error("drag plugin missing"));

    await startDrag(file("/repo/README.md"), { clientX: 0, clientY: 0 }, true);
    await act(async () => {
      await Promise.resolve();
    });

    expect(hook.current.dragState.isDragging).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to start native file drag:",
      expect.any(Error),
    );
  });
});
