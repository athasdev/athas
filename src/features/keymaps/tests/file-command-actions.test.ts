import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent, PaneContent } from "@/features/panes/types/pane-content.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import type { PaneGroup } from "@/features/panes/types/pane.types";
import {
  closeActiveTab,
  closeAllTabs,
  closeOtherTabs,
  closeSavedTabs,
  closeTabsToLeft,
  closeTabsToRight,
  createNewFile,
  saveActiveFileAs,
  showNewTab,
} from "../commands/file-command-actions";
import { useKeymapStore } from "../stores/keymaps.store";

const createMockStorage = () => {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
};

function makeTab(id: string, isPinned = false): PaneContent {
  return {
    id,
    type: "newTab",
    path: `newtab://${id}`,
    name: id,
    isPinned,
    isPreview: false,
    isActive: id === "b",
  };
}

function makeEditorTab(
  id: string,
  options: { isDirty?: boolean; isPinned?: boolean } = {},
): EditorContent {
  const content = options.isDirty ? "dirty" : "saved";

  return {
    id,
    type: "editor",
    path: `/tmp/${id}.txt`,
    name: `${id}.txt`,
    isPinned: options.isPinned ?? false,
    isPreview: false,
    isActive: id === "b",
    content,
    savedContent: options.isDirty ? "saved" : content,
    isDirty: options.isDirty ?? false,
    isVirtual: false,
    language: "text",
  };
}

describe("file command actions", () => {
  beforeEach(() => {
    const testStorage = createMockStorage();
    vi.stubGlobal("localStorage", testStorage);
    vi.stubGlobal("window", {
      localStorage: testStorage,
      __TAURI_INTERNALS__: {
        invoke: vi.fn().mockResolvedValue([]),
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    useBufferStore.setState({
      activeBufferId: null,
      buffers: [],
      pendingClose: null,
      closedBuffersHistory: [],
    });
    useKeymapStore.setState((state) => ({
      contexts: { ...state.contexts, terminalFocus: false },
    }));
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("opens a terminal when the new-tab command is triggered with terminal focus", () => {
    useKeymapStore.setState((state) => ({
      contexts: { ...state.contexts, terminalFocus: true },
    }));

    showNewTab();

    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "terminal-new" }),
    );
  });

  it("closes the active terminal and creates a terminal while the terminal has focus", () => {
    const createFile = vi.spyOn(useFileSystemStore.getState(), "handleCreateNewFile");
    useKeymapStore.setState((state) => ({
      contexts: { ...state.contexts, terminalFocus: true },
    }));
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeTab("a"), makeTab("b")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeActiveTab();
    createNewFile();

    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "close-active-terminal" }),
    );
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "terminal-new" }),
    );
    expect(createFile).not.toHaveBeenCalled();
    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["a", "b"]);
    createFile.mockRestore();
  });

  it("closes the tab of the focused pane", () => {
    const group = (id: string, bufferId: string): PaneGroup => ({
      id,
      type: "group",
      bufferIds: [bufferId],
      activeBufferId: bufferId,
    });
    usePaneStore.setState({
      root: {
        id: "split",
        type: "split",
        direction: "horizontal",
        children: [group("left", "b"), group("right", "a")],
        sizes: [50, 50],
      },
      activePaneId: "right",
    });
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeTab("a"), makeTab("b")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeActiveTab();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["b"]);
    usePaneStore.getState().actions.reset();
  });

  it("closes every unpinned tab except the active tab", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeTab("a"), makeTab("b"), makeTab("c"), makeTab("pinned", true)],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeOtherTabs();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["b", "pinned"]);
  });

  it("closes around the tab a context menu names instead of the active tab", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeTab("a"), makeTab("b"), makeTab("c"), makeTab("pinned", true)],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeOtherTabs({ bufferId: "c" });

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["c", "pinned"]);
  });

  it("routes close all through the dirty close guard", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeEditorTab("a"), makeEditorTab("b", { isDirty: true }), makeEditorTab("c")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeAllTabs();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["a", "b", "c"]);
    expect(useBufferStore.getState().pendingClose).toMatchObject({
      bufferId: "b",
      type: "all",
    });
  });

  it("closes saved unpinned tabs while keeping dirty and pinned tabs", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [
        makeEditorTab("a"),
        makeEditorTab("b", { isDirty: true }),
        makeEditorTab("c", { isPinned: true }),
        makeEditorTab("d"),
      ],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeSavedTabs();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["b", "c"]);
  });

  it("closes unpinned tabs to the left of the active tab", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeTab("a"), makeTab("pinned", true), makeTab("b"), makeTab("c")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeTabsToLeft();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual([
      "pinned",
      "b",
      "c",
    ]);
  });

  it("keeps the close-left anchor while prompting for a dirty tab", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeEditorTab("a", { isDirty: true }), makeTab("b"), makeTab("c")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeTabsToLeft();

    expect(useBufferStore.getState().pendingClose).toMatchObject({
      bufferId: "a",
      anchorBufferId: "b",
      type: "to-left",
    });

    useBufferStore.getState().actions.confirmCloseWithoutSaving();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["b", "c"]);
  });

  it("closes unpinned tabs to the right of the active tab", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeTab("a"), makeTab("b"), makeTab("c"), makeTab("pinned", true), makeTab("d")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeTabsToRight();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual([
      "a",
      "b",
      "pinned",
    ]);
  });

  it("keeps the close-right anchor while prompting for a dirty tab", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeTab("a"), makeTab("b"), makeEditorTab("c", { isDirty: true }), makeTab("d")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeTabsToRight();

    expect(useBufferStore.getState().pendingClose).toMatchObject({
      bufferId: "c",
      anchorBufferId: "b",
      type: "to-right",
    });

    useBufferStore.getState().actions.confirmCloseWithoutSaving();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["a", "b"]);
  });

  it("routes Save As through the shared editor save lifecycle", async () => {
    const saveAs = vi
      .spyOn(useEditorAppStore.getState().actions, "handleSaveAs")
      .mockResolvedValueOnce(true);
    await saveActiveFileAs();
    expect(saveAs).toHaveBeenCalledOnce();
    saveAs.mockRestore();
  });
});
