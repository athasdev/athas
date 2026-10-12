// @vitest-environment jsdom
import { createEvent, fireEvent } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { onAppEvent } from "@/utils/app-events";
import {
  setInternalTabDragData,
  setInternalTabDragHoverTarget,
} from "@/features/tabs/services/internal-tab-drag";
import { ROOT_PANE_ID } from "../constants/pane";
import { findPaneGroup, getAllPaneGroups } from "../services/pane-tree";
import { usePaneStore } from "../stores/pane.store";

const io = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string) => Promise.resolve(cmd.includes("get_all") ? [] : null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return { opened: [] as Array<[string, string | undefined]> };
});

vi.mock("@/features/editor/components/code-editor", () => ({
  default: ({ bufferId }: { bufferId: string }) => (
    <div data-testid="code-editor" data-buffer-id={bufferId} />
  ),
}));
vi.mock("@/features/editor/services/editor-language-preload", () => ({
  preloadEditorLanguagesForPaths: async () => {},
}));

const { PaneContainer } = await import("../components/pane-container");

enableMapSet();

let root: Root;
let container: HTMLDivElement;

function Harness({ paneId }: { paneId: string }) {
  const tree = usePaneStore.use.root();
  const pane = findPaneGroup(tree, paneId);
  return pane ? <PaneContainer pane={pane} /> : null;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(paneId = ROOT_PANE_ID) {
  await act(async () => root.render(<Harness paneId={paneId} />));
  await flush();
}

function open(path: string, content = "line one\nline two") {
  return useBufferStore.getState().actions.openBuffer(path, path.split("/").pop()!, content);
}

function transfer(data: Record<string, string>, files: Array<File & { path?: string }> = []) {
  return {
    types: [...Object.keys(data), ...(files.length ? ["Files"] : [])],
    files,
    dropEffect: "none",
    effectAllowed: "all",
    getData: (type: string) => data[type] ?? "",
    setData: (type: string, value: string) => {
      data[type] = value;
    },
  };
}

const paneElement = () => container.querySelector<HTMLElement>("[data-pane-container]")!;
const overlay = () => container.querySelector<HTMLElement>("[data-split-drop-overlay]");
const groups = () => getAllPaneGroups(usePaneStore.getState().root);
const group = (id: string) => groups().find((candidate) => candidate.id === id)!;

function dispatchDrag(
  type: "dragOver" | "drop",
  target: HTMLElement,
  dataTransfer: ReturnType<typeof transfer>,
  point: { clientX: number; clientY: number },
) {
  const event = createEvent[type](target, { dataTransfer });
  Object.defineProperties(event, {
    clientX: { value: point.clientX },
    clientY: { value: point.clientY },
  });
  fireEvent(target, event);
}

async function dragOver(target: HTMLElement, dataTransfer: ReturnType<typeof transfer>) {
  await act(async () =>
    dispatchDrag("dragOver", target, dataTransfer, { clientX: 500, clientY: 500 }),
  );
}

async function drop(
  target: HTMLElement,
  dataTransfer: ReturnType<typeof transfer>,
  point = { clientX: 500, clientY: 500 },
) {
  await act(async () => dispatchDrag("drop", target, dataTransfer, point));
  await flush();
}

function splitWith(bufferId: string) {
  return usePaneStore.getState().actions.splitPane(ROOT_PANE_ID, "horizontal", bufferId)!;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  io.opened = [];
  useProjectStore.setState({ rootFolderPath: "/repo" });
  useFileSystemStore.setState({
    handleFileOpen: async (path: string, _isDir: boolean, options?: { paneId?: string }) => {
      io.opened.push([path, options?.paneId]);
    },
  } as never);
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
    if (typeof options === "object") this.scrollLeft = options.left ?? 0;
  } as Element["scrollTo"];
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 1000,
    height: 1000,
    right: 1000,
    bottom: 1000,
    toJSON() {},
  } as DOMRect);
  document.elementsFromPoint = () => [paneElement()];
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
  delete window.__fileDragData;
  delete window.__athasInternalTabDragData;
  delete window.__athasInternalTabDragHover;
  useSettingsStore.setState((state) => ({
    settings: { ...state.settings, horizontalTabScroll: false },
  }));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pane container drops", () => {
  it("shows the active editor and activates an inactive pane on click", async () => {
    const first = open("/repo/a.ts");
    const other = splitWith(first);
    await render();
    expect(usePaneStore.getState().activePaneId).toBe(other);
    expect(
      container.querySelector('[data-testid="code-editor"]')?.getAttribute("data-buffer-id"),
    ).toBe(group(ROOT_PANE_ID).activeBufferId);

    await act(async () => {
      fireEvent.mouseDown(paneElement());
      paneElement().click();
    });
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("moves a tab dragged from another pane into this one", async () => {
    const first = open("/repo/a.ts");
    const moved = open("/repo/b.ts");
    const other = splitWith(moved);
    await render();
    const data = transfer({
      "application/tab-data": JSON.stringify({ bufferId: moved, paneId: other }),
    });
    await dragOver(paneElement(), data);
    expect(overlay()).not.toBeNull();
    await dragOver(overlay()!, data);
    await drop(overlay()!, data);

    expect(group(ROOT_PANE_ID).bufferIds).toEqual([first, moved]);
    expect(group(ROOT_PANE_ID).activeBufferId).toBe(moved);
    expect(overlay()).toBeNull();
  });

  it("splits the pane when a tab is dropped on an edge", async () => {
    const first = open("/repo/a.ts");
    const second = open("/repo/b.ts");
    await render();
    const data = transfer({
      "application/tab-data": JSON.stringify({ bufferId: second, paneId: ROOT_PANE_ID }),
    });
    await dragOver(paneElement(), data);
    await drop(overlay()!, data, { clientX: 990, clientY: 500 });

    expect(groups()).toHaveLength(2);
    const created = groups().find((candidate) => candidate.id !== ROOT_PANE_ID)!;
    expect(created.bufferIds).toEqual([second]);
    expect(group(ROOT_PANE_ID).bufferIds).toEqual([first]);
  });

  it("moves a tab from another pane into a new split on the opposite edge", async () => {
    open("/repo/a.ts");
    const moved = open("/repo/b.ts");
    const other = splitWith(moved);
    await render();
    setInternalTabDragData({ source: "pane", bufferId: moved, paneId: other });
    const data = transfer({});
    await dragOver(paneElement(), data);
    await drop(overlay()!, data, { clientX: 500, clientY: 10 });

    expect(groups()).toHaveLength(2);
    const created = groups().find((candidate) => candidate.id !== ROOT_PANE_ID)!;
    expect(created.id).not.toBe(other);
    expect(created.bufferIds).toEqual([moved]);
    expect(window.__athasInternalTabDragData).toBeUndefined();
  });

  it("detaches a terminal from the panel into the pane", async () => {
    open("/repo/a.ts");
    const detached: string[] = [];
    const unsubscribe = onAppEvent("terminal:detach-to-buffer", ({ terminalId }) =>
      detached.push(terminalId),
    );
    await render();
    const payload = {
      source: "terminal-panel",
      terminalId: "term-1",
      name: "server",
      currentDirectory: "/repo",
    };
    let data = transfer({ "application/tab-data": JSON.stringify(payload) });
    await dragOver(paneElement(), data);
    await drop(overlay()!, data);
    expect(detached).toEqual(["term-1"]);
    const terminal = useBufferStore.getState().buffers.find((buffer) => buffer.type === "terminal");
    expect(terminal?.name).toBe("server");
    expect(group(ROOT_PANE_ID).bufferIds).toContain(terminal?.id);

    data = transfer({
      "application/tab-data": JSON.stringify({ ...payload, terminalId: "term-2" }),
    });
    await dragOver(paneElement(), data);
    await drop(overlay()!, data, { clientX: 10, clientY: 500 });
    expect(detached).toEqual(["term-1", "term-2"]);
    expect(groups()).toHaveLength(2);
    unsubscribe();
  });

  it("ignores drops without a zone or with an unreadable payload", async () => {
    const first = open("/repo/a.ts");
    await render();
    const broken = transfer({ "application/tab-data": "{not json" });
    await dragOver(paneElement(), broken);
    await drop(overlay()!, broken);
    expect(groups()).toHaveLength(1);
    expect(group(ROOT_PANE_ID).bufferIds).toEqual([first]);

    await dragOver(paneElement(), transfer({ "application/tab-data": "{}" }));
    await act(async () => {
      fireEvent.dragLeave(paneElement(), { relatedTarget: null });
    });
    expect(overlay()).toBeNull();
  });

  it("opens files dropped from the operating system in this pane", async () => {
    await render();
    const data = transfer({ "text/plain": "/repo/notes.md\n/repo/todo.md" });
    await dragOver(paneElement(), data);
    expect(overlay()).toBeNull();
    await drop(paneElement(), data);
    expect(io.opened).toEqual([
      ["/repo/notes.md", ROOT_PANE_ID],
      ["/repo/todo.md", ROOT_PANE_ID],
    ]);
  });

  it("opens a sidebar file resource in the zone it was dropped on", async () => {
    open("/repo/a.ts");
    await render();
    const resource = { type: "file", path: "/repo/c.ts", name: "c.ts", isDir: false };
    await drop(
      paneElement(),
      transfer({ "application/x-athas-sidebar-resource": JSON.stringify(resource) }),
      { clientX: 500, clientY: 990 },
    );
    expect(groups()).toHaveLength(2);
    const created = groups().find((candidate) => candidate.id !== ROOT_PANE_ID)!;
    expect(io.opened).toEqual([["/repo/c.ts", created.id]]);
  });

  it("opens a file dragged from the file tree where it is released", async () => {
    await render();
    window.__fileDragData = { path: "/repo/tree.ts", name: "tree.ts", isDir: false };
    await act(async () => {
      fireEvent.mouseUp(paneElement(), { clientX: 500, clientY: 500 });
    });
    await flush();
    expect(io.opened).toEqual([["/repo/tree.ts", ROOT_PANE_ID]]);
    expect(window.__fileDragData).toBeUndefined();

    window.__fileDragData = { path: "/repo/folder", name: "folder", isDir: true };
    await act(async () => {
      fireEvent.mouseUp(paneElement(), { clientX: 500, clientY: 500 });
    });
    expect(io.opened).toHaveLength(1);
  });

  it("highlights the drop zone while a tab is dragged over the pane from elsewhere", async () => {
    open("/repo/a.ts");
    await render();
    await act(async () => setInternalTabDragHoverTarget({ paneId: ROOT_PANE_ID, zone: "left" }));
    expect(overlay()).not.toBeNull();
    expect(overlay()!.children).toHaveLength(1);
    await act(async () => setInternalTabDragHoverTarget({ paneId: "other", zone: "left" }));
    expect(overlay()).toBeNull();
  });
});

describe("pane buffer carousel", () => {
  async function renderCarousel() {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, horizontalTabScroll: true },
    }));
    await render();
  }

  const cards = () =>
    [...container.querySelectorAll<HTMLElement>("[data-buffer-card-id]")].map(
      (card) => card.dataset.bufferCardId,
    );
  const card = (id: string) =>
    container.querySelector<HTMLElement>(`[data-buffer-card-id="${id}"]`)!;

  it("shows every buffer as a card and switches with click or keyboard", async () => {
    const first = open("/repo/a.ts");
    const second = open("/repo/b.ts");
    const third = open("/repo/c.ts");
    await renderCarousel();
    expect(cards()).toEqual([first, second, third]);

    await act(async () => card(first).click());
    expect(group(ROOT_PANE_ID).activeBufferId).toBe(first);

    await act(async () => {
      fireEvent.keyDown(card(second), { key: "Enter" });
    });
    expect(group(ROOT_PANE_ID).activeBufferId).toBe(second);

    await act(async () => {
      fireEvent.mouseOver(card(third));
    });
    expect(group(ROOT_PANE_ID).activeBufferId).toBe(third);
    expect(card(third).getAttribute("role")).toBeNull();
    expect(card(first).getAttribute("role")).toBe("button");
  });

  it("reorders buffers by dragging one card onto another", async () => {
    const first = open("/repo/a.ts");
    const second = open("/repo/b.ts");
    const third = open("/repo/c.ts");
    await renderCarousel();
    const data = transfer({});
    await act(async () => {
      fireEvent.dragStart(card(first), { dataTransfer: data });
    });
    await act(async () => {
      fireEvent.dragOver(card(third), { dataTransfer: data });
    });
    await act(async () => {
      fireEvent.drop(card(third), { dataTransfer: data });
    });
    expect(group(ROOT_PANE_ID).bufferIds).toEqual([second, third, first]);

    await act(async () => {
      fireEvent.dragStart(card(second), { dataTransfer: data });
      fireEvent.dragEnd(card(second), { dataTransfer: data });
    });
    await act(async () => {
      fireEvent.drop(card(second), { dataTransfer: transfer({}) });
    });
    expect(group(ROOT_PANE_ID).bufferIds).toEqual([second, third, first]);
  });

  it("resizes the cards and scrolls them with the wheel", async () => {
    const first = open("/repo/a.ts");
    open("/repo/b.ts");
    await renderCarousel();
    const handle = card(first).querySelector<HTMLElement>(
      '[aria-label="Resize buffer carousel cards"]',
    )!;
    const viewport = card(first).parentElement!;
    Object.defineProperty(viewport, "scrollWidth", { value: 2000, configurable: true });
    Object.defineProperty(viewport, "clientWidth", { value: 1000, configurable: true });
    await act(async () => {
      fireEvent.mouseDown(handle, { clientX: 100 });
    });
    expect(document.body.style.cursor).toBe("col-resize");
    await act(async () => {
      fireEvent.mouseMove(document, { clientX: 5000 });
    });
    await act(async () => {
      fireEvent.mouseUp(document);
    });
    expect(document.body.style.cursor).toBe("");
    expect(card(first).style.width).toBe("840px");

    await act(async () => {
      fireEvent.mouseDown(handle, { clientX: 5000 });
    });
    await act(async () => {
      fireEvent.mouseMove(document, { clientX: 0 });
      fireEvent.mouseUp(document);
    });
    expect(card(first).style.width).toBe("320px");
    await act(async () => {
      fireEvent.wheel(card(first), { deltaY: 300 });
    });
    expect(viewport.scrollLeft).toBe(300);
    await act(async () => {
      fireEvent.wheel(card(first), { deltaX: -1000 });
    });
    expect(viewport.scrollLeft).toBe(0);
    await act(async () => {
      fireEvent.wheel(card(first), { deltaY: 300, ctrlKey: true });
    });
    expect(viewport.scrollLeft).toBe(0);
  });

  it("previews non-editor buffers in their cards", async () => {
    open("/repo/a.ts");
    useBufferStore.getState().actions.openTerminalBuffer({ sessionId: "s1", name: "shell" });
    await renderCarousel();
    expect(cards()).toHaveLength(2);
    expect(container.textContent).not.toContain("No preview available");
  });
});
